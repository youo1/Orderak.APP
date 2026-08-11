// ============================================================
// Orderak Worker — top-level router.
// Deploy:  cd services/backend && npx wrangler deploy
//
// Responsibilities are split into modules (modular monolith):
//   identity.ts       store identity: UUIDs, codes, slugs, public_identifier
//   api-store.ts      /api/v1/register, /api/v1/store, /api/v1/categories, products/sync
//   media.ts          R2 image upload + /media/{key} serving
//   catalog.ts        public store/category/product HTML (SEO)
//   public-router.ts  /{public_identifier}[/{module}/{code}] + legacy 301s
//   billing.ts / ads.ts / admin.ts / email/*   unchanged concerns
//
// This file only dispatches; it keeps the small legacy API surface (chat,
// orders) that predates the split.
// ============================================================

import { handleBillingRoutes } from "../domains/commerce/billing";
import { handleAdsRoutes } from "../domains/commerce/ads";
import { handleInboundEmail } from "../integrations/email/inbound";
import { markQueuedEmailDeadLetter, processQueuedEmail, type QueuedEmailMessage } from "../integrations/email/emailQueue";
import { handleConfigRoute, loadClientConfig } from "../platform/config/config";
import { landingPageHtml } from "../landing";
import { publicDesignSystemCss, publicDesignSystemResponse } from "../domains/admin/admin-theme";
import { designSystemCss, designSystemFontPreload, loadActiveDesignSystem } from "../domains/design/design-system";
import { PUBLIC_SITE_URL } from "../domains/identity/identity";
import { authSeller, logError, jsonResponse, methodNotAllowed, corsHeaders, readCreds, checkRateLimit, recordDeviceMetadata, enforceRequestBodyLimit, type AuthenticatedSeller } from "../platform/http/shared";
import { getPlanLimit } from "../domains/commerce/plan-limits";
import { handleStoreRoutes } from "../domains/stores/api-store";
import { serveMedia } from "../platform/storage/media";
import { handlePublicRoutes } from "./public-router";
import { runRetentionCleanup } from "../domains/identity/retention";
import { processDeletionRequests } from "../domains/identity/deletion";
import { backfillPlayAccountHashes, handleGooglePlayRoutes, reconcileGooglePlayPurchases } from "../integrations/google-play/google-play";
import { entitlementLimitReached, reserveUsage, voidUsageReservation } from "../domains/commerce/entitlements";
import { handleSellerOperationRoutes } from "../domains/operations/seller-operations";
import { handlePhoneChangeRoutes } from "../domains/identity/phone-change";
import { requireTenantWrite, resolveTenantContextForStore, TenantWriteFencedError } from "../platform/tenancy/tenant-routing";
import { runtimeControlEnabled } from "../platform/config/runtime-config";
import { runObservedJob } from "../platform/jobs/operational-jobs";
import { AiTemporarilyUnavailableError, callDeepSeek } from "../integrations/ai/deepseek";
import { assetLinksResponse, handleAuthV2Routes, handleEmailVerification } from "../domains/identity/auth-v2";
import { handleGeoRoutes } from "../domains/catalog/geo";
import { handleBusinessTaxonomyRoutes } from "../domains/catalog/business-taxonomy";
import { pickLocale } from "../platform/localization/i18n";
import { withSentry } from "@sentry/cloudflare";
import { recordLatency, flushLatencySamples } from "../platform/observability/measurement";
import { Hono } from "hono";

// Durable Object classes must be exported from the Worker entrypoint so the
// runtime can instantiate them; the RATE_LIMITER binding resolves to this.
export { RateLimiter } from "../platform/durable-objects/rate-limiter";

type ChatRequest = { message?: string };

const CLIENT_PLATFORMS = new Set(["android", "ios", "desktop"]);

/** Enforce the shared optional Seller compatibility-header contract. */
function validateSellerCompatibilityHeaders(request: Request): Response | null {
	const platform = request.headers.get("x-orderak-platform");
	if (platform !== null && !CLIENT_PLATFORMS.has(platform)) {
		return jsonResponse({ error: "invalid_client_platform" }, 400);
	}
	const appVersion = request.headers.get("x-orderak-app-version");
	if (appVersion !== null && (appVersion.length < 1 || appVersion.length > 64)) {
		return jsonResponse({ error: "invalid_app_version" }, 400);
	}
	const requestId = request.headers.get("x-request-id");
	if (requestId !== null && requestId.length > 128) {
		return jsonResponse({ error: "invalid_request_id" }, 400);
	}
	return null;
}

// DeepSeek via OpenAI-compatible API
const DEEPSEEK_MODEL = "deepseek-chat";
const SYSTEM_PROMPT =
	"You are Orderak, a friendly assistant that helps a shop take customer orders. " +
	"Keep replies short, clear, and helpful.";

export type PublicQueueKind = "email" | "email_dlq" | "unknown";

export function classifyPublicQueue(queue: string): PublicQueueKind {
	if (/^orderak-email(?:-staging)?$/.test(queue)) return "email";
	if (/^orderak-email-dlq(?:-staging)?$/.test(queue)) return "email_dlq";
	return "unknown";
}

function publicCacheLanguage(request: Request): string {
	return pickLocale(request, new URL(request.url));
}

/**
 * Baseline security headers for every public response.
 *
 * Deliberately narrower than the admin worker's harden(). This worker serves
 * cacheable HTML, CSS and R2 images, so it must not clobber the per-response
 * `cache-control` that the caching strategy depends on, nor the page-specific
 * CSPs already set in public-router.ts and auth-v2.ts, nor set a restrictive
 * Cross-Origin-Resource-Policy — /media/ exists precisely to be embedded.
 *
 * Only the two headers that are safe to apply blindly are forced; the rest
 * fill in a default that a handler can still override by setting its own.
 */
function hardenPublic(response: Response): Response {
	const hardened = new Response(response.body, response);
	// Transport- and sniffing-level: independent of what is being served.
	hardened.headers.set("strict-transport-security", "max-age=31536000; includeSubDomains");
	hardened.headers.set("x-content-type-options", "nosniff");
	// Defaults only — a handler that set its own policy keeps it.
	if (!hardened.headers.has("referrer-policy")) {
		hardened.headers.set("referrer-policy", "strict-origin-when-cross-origin");
	}
	// SAMEORIGIN, not DENY: public store pages carry order forms worth
	// protecting from clickjacking, but same-origin embedding stays possible.
	if (!hardened.headers.has("x-frame-options")) {
		hardened.headers.set("x-frame-options", "SAMEORIGIN");
	}
	return hardened;
}

async function cachedPublicGet(
	request: Request,
	env: PublicWorkerEnv,
	ctx: ExecutionContext,
	load: () => Response | Promise<Response>,
	languageAware = false,
): Promise<Response> {
	if (request.method !== "GET" || !["production", "staging"].includes(env.DEPLOYMENT_ENVIRONMENT ?? "")) return load();
	if (request.headers.has("authorization") || request.headers.has("cookie") || request.headers.has("x-orderak-phone") || request.headers.has("x-orderak-secret")) return load();
	const keyUrl = new URL(request.url);
	if (languageAware) keyUrl.searchParams.set("__orderak_cache_lang", publicCacheLanguage(request));
	const cacheKey = new Request(keyUrl.toString(), { method: "GET" });
	const cacheStart = performance.now();
	const cached = await caches.default.match(cacheKey);
	const cacheMs = performance.now() - cacheStart;
	if (cached) {
		recordLatency("cache", "hit", Math.round(cacheMs * 100) / 100);
		return cached;
	}
	recordLatency("cache", "miss", Math.round(cacheMs * 100) / 100);
	const response = await load();
	const policy = response.headers.get("cache-control") ?? "";
	if (response.ok && /(^|,)\s*public\b/i.test(policy)) ctx.waitUntil(caches.default.put(cacheKey, response.clone()));
	return response;
}

// ---- Main Router ----

// ---- HTTP routing (Hono) ---------------------------------------------------
//
// enforceRequestBodyLimit stays outside app.fetch(): it consumes the body
// stream and returns a *new* Request, which would break Hono's body caching.
// Everything else moves in. Registration order below mirrors the original
// if-chain exactly — several of these paths overlap, so order is behaviour.

type PublicVars = { seller: AuthenticatedSeller | null | undefined };
const app = new Hono<{ Bindings: PublicWorkerEnv; Variables: PublicVars }>();

// Hono declares executionCtx with its own narrower ExecutionContext type; at
// runtime it is exactly the Workers context handed to app.fetch() below.
const wctx = (c: { executionCtx: unknown }): ExecutionContext => c.executionCtx as ExecutionContext;

// ---- Canonical host enforcement --------------------------------------------
//
// One Worker answers on several hostnames, and until this middleware nothing
// tied a hostname to the surface it is supposed to serve: api.orderak.app
// would happily render a seller's storefront, and every page existed twice for
// crawlers and once more under www.
//
// What this does NOT do is confine the JSON API to the API host. The Android
// client calls https://orderak.app directly, so a rule that the API only lives
// on api.orderak.app would break every installed app. Splitting those cleanly
// needs a client release first; until then the API is legitimately reachable
// from both, and pretending otherwise in code would be worse than documenting
// it here.
//
// It does confine *pages* to the website hosts. Nothing needs a storefront on
// the API host, and keeping HTML off it is what makes a per-host WAF or API
// Shield schema policy meaningful — a rule applied to api.orderak.app is only
// worth writing if that hostname serves one kind of thing.
const API_HOSTS = new Set(["api.orderak.app", "api.staging.orderak.app"]);
const WWW_HOSTS = new Map([["www.orderak.app", "orderak.app"]]);

/** Surfaces the API host is allowed to answer on. Everything else is a page. */
function isApiSurface(pathname: string): boolean {
	return pathname === "/health"
		|| pathname.startsWith("/api/")
		|| pathname.startsWith("/.well-known/")
		|| pathname.startsWith("/media/");
}

// ---- Request correlation ----------------------------------------------------
//
// Every response carries X-Request-ID. The contract declares it on every status
// of every operation, and until this middleware existed only responses built by
// jsonResponse() actually had one — roughly 25 `new Response(...)` sites across
// ten files did not, and neither did anything served from the edge cache.
//
// The gap was invisible until the first nightly contract run: k6 reported
// http_req_failed 0.00% — every request succeeded — while failing the header
// check on 1918 of 1918 responses, because /api/v1/theme is served through
// cachedPublicGet.
//
// Doing this in middleware rather than in cachedPublicGet is the difference
// between fixing three endpoints and fixing the class. A future handler that
// returns `new Response` directly cannot forget a header it never has to set.
//
// Two details that matter:
//
//   The id is stamped *after* next(), so it is never part of what
//   caches.default.put() stored. Setting it inside a cached loader would freeze
//   one id into the cache and replay it across every subsequent hit — worse
//   than a missing header, because request tracing would look correct while
//   silently collapsing thousands of requests into one identity.
//
//   The id is generated here, never echoed from the request. An inbound
//   X-Request-ID is attacker-controlled, and copying it into a response header
//   and into problem+json bodies (shared.ts:67) would let a client choose what
//   the logs say.
//
// Headers on a Response from caches.default are immutable, so the response is
// rebuilt rather than mutated. jsonResponse() already sets an id and keeps it.
app.use("*", async (c, next) => {
	await next();

	const response = c.res;
	if (response.headers.has("x-request-id")) return;

	const headers = new Headers(response.headers);
	headers.set("x-request-id", crypto.randomUUID());
	// 204/304 and friends must stay bodyless; their body is already null, so
	// passing it through is correct for every status.
	c.res = new Response(response.body, { status: response.status, statusText: response.statusText, headers });
});

app.use("*", async (c, next) => {
	const url = new URL(c.req.url);

	// www is a mirror, not a surface: send crawlers and users to one canonical
	// origin. Only safe methods are redirected — bouncing a POST would drop its
	// body, so anything else is served in place rather than silently corrupted.
	const canonical = WWW_HOSTS.get(url.hostname);
	if (canonical && (c.req.method === "GET" || c.req.method === "HEAD")) {
		url.hostname = canonical;
		return c.redirect(url.toString(), 301);
	}

	if (API_HOSTS.has(url.hostname) && !isApiSurface(url.pathname)) {
		return jsonResponse({ error: "not_found" }, 404);
	}

	await next();
});

app.options("*", (c) => new Response(null, { headers: corsHeaders(c.req.raw) }));

app.get("/.well-known/assetlinks.json", (c) => assetLinksResponse(c.env));

// Email verification links are matched before anything else, on every path.
app.use("*", async (c, next) => {
	const verified = await handleEmailVerification(c.req.raw, c.env, new URL(c.req.url));
	if (verified) return verified;
	await next();
});

app.get("/health", (c) => jsonResponse({
	ok: true,
	service: "orderak-worker",
	aiConfigured: c.env.AI_ASSISTANT_ENABLED === "true" && Boolean(c.env.DEEPSEEK_API_KEY),
}));

// The OpenAPI contract constrains these optional telemetry headers. Validate
// them before every Seller handler, including public cached routes such as
// /api/v1/theme, so no route can accidentally accept schema-invalid metadata.
app.use("/api/v1/*", async (c, next) => {
	const invalid = validateSellerCompatibilityHeaders(c.req.raw);
	if (invalid) return invalid;
	await next();
});

// ---- Public design tokens + branding (Android app + any client) ----
// Versioned: the ETag is a content hash, so clients sending If-None-Match get
// a bodyless 304 when nothing changed.
app.get("/api/v1/theme", (c) =>
	cachedPublicGet(c.req.raw, c.env, wctx(c), () => publicDesignSystemResponse(c.req.raw, c.env, PUBLIC_SITE_URL)));
app.get("/api/theme.css", (c) =>
	cachedPublicGet(c.req.raw, c.env, wctx(c), () => publicDesignSystemCss(c.req.raw, c.env)));
app.get("/api/theme/:file", async (c) => {
	const hash = /^([a-f0-9]{64})\.css$/.exec(c.req.param("file"))?.[1];
	if (!hash) return jsonResponse({ error: "Not found." }, 404);
	return cachedPublicGet(c.req.raw, c.env, wctx(c), () => publicDesignSystemCss(c.req.raw, c.env, hash));
});

// ---- Public media (R2): GET /media/{key} ----
app.get("/media/*", (c) =>
	cachedPublicGet(c.req.raw, c.env, wctx(c), () =>
		serveMedia(c.env, decodeURIComponent(new URL(c.req.url).pathname.slice("/media/".length)))));

// ---- External integrations: versioned separately from seller JSON APIs ----
app.all("/api/integrations/v1/*", async (c) => {
	const url = new URL(c.req.url);
	const playIntegration = await handleGooglePlayRoutes(c.req.raw, c.env, url);
	if (playIntegration) return playIntegration;
	const billingIntegration = await handleBillingRoutes(c.req.raw, c.env, url);
	if (billingIntegration) return billingIntegration;
	return jsonResponse({ error: "not_found" }, 404);
});

// ---- API routes (Android app + web) ----
// Unauthenticated surfaces first: these must resolve before any credential is
// read, exactly as in the original chain.
app.use("/api/v1/*", async (c, next) => {
	const url = new URL(c.req.url);
	const authV2 = await handleAuthV2Routes(c.req.raw, c.env, url, wctx(c));
	if (authV2) return authV2;
	const geo = await handleGeoRoutes(c.req.raw, c.env, url);
	if (geo) return geo;
	const taxonomy = await handleBusinessTaxonomyRoutes(c.req.raw, c.env, url);
	if (taxonomy) return taxonomy;
	const phoneChange = await handlePhoneChangeRoutes(c.req.raw, c.env, url);
	if (phoneChange) return phoneChange;
	await next();
});

// Seller credentials, device metadata, restriction fence and tenant write
// fence. A suspended/banned seller receives one stable response from every
// credentialed API; account status and deletion status remain available.
app.use("/api/v1/*", async (c, next) => {
	const url = new URL(c.req.url);
	const supplied = readCreds(c.req.raw, url);
	let authenticatedSeller: AuthenticatedSeller | null | undefined;

	if (supplied.phone && supplied.secret) {
		const account = await authSeller(c.env, supplied.phone, supplied.secret);
		authenticatedSeller = account;
		if (account && c.req.header("x-orderak-device-id")) {
			await recordDeviceMetadata(c.env, account, supplied.secret, {
				deviceId: c.req.header("x-orderak-device-id")!,
				label: c.req.header("x-orderak-device-label") ?? undefined,
				platform: c.req.header("x-orderak-platform") ?? undefined,
				appVersion: c.req.header("x-orderak-app-version") ?? undefined,
			});
		}
		const allowedWhileRestricted = url.pathname === "/api/v1/account/status"
			|| url.pathname === "/api/v1/account/deletion-request";
		if (account && account.status && account.status !== "active" && !allowedWhileRestricted) {
			return jsonResponse({ error: "account_restricted", status: account.status }, 403);
		}
		const bypassFence = url.pathname === "/api/v1/account/deletion-request"
			|| url.pathname === "/api/v1/account/status";
		if (account && c.req.method !== "GET" && !bypassFence) {
			try {
				requireTenantWrite(await resolveTenantContextForStore(c.env, String(account.id)));
			} catch (error) {
				if (error instanceof TenantWriteFencedError) {
					return jsonResponse({ error: "tenant_write_fenced", retryable: true }, 503, {
						"retry-after": String(error.retryAfterSeconds),
					});
				}
				throw error;
			}
		}
	}

	c.set("seller", authenticatedSeller);
	await next();
});

app.all("/api/v1/*", async (c) => {
	const url = new URL(c.req.url);
	const seller = c.get("seller");

	const sellerOperations = await handleSellerOperationRoutes(c.req.raw, c.env, url, seller);
	if (sellerOperations) return sellerOperations;
	const play = await handleGooglePlayRoutes(c.req.raw, c.env, url, seller);
	if (play) return play;
	const billing = await handleBillingRoutes(c.req.raw, c.env, url, seller);
	if (billing) return billing;
	const ads = await handleAdsRoutes(c.req.raw, c.env, url, seller);
	if (ads) return ads;
	// Config (plan limits for Android).
	const cfg = await handleConfigRoute(c.req.raw, c.env, url, seller);
	if (cfg) return cfg;
	// Store identity / categories / products / media APIs.
	const store = await handleStoreRoutes(c.req.raw, c.env, url, seller);
	if (store) return store;
	// Legacy API surface (chat, items, orders).
	return handleApi(c.req.raw, c.env, url, seller);
});

// ---- Public marketing landing page: GET / ----
app.get("/", (c) => cachedPublicGet(c.req.raw, c.env, wctx(c), async () => {
	const revision = await loadActiveDesignSystem(c.env, c.req.raw);
	return new Response(landingPageHtml(
		revision.legacyTheme,
		designSystemCss(revision.snapshot),
		designSystemFontPreload(revision.snapshot, "arabic"),
	), {
		headers: { "content-type": "text/html; charset=utf-8", "cache-control": "public, max-age=60, s-maxage=300" },
	});
}, true));
app.all("/", () => jsonResponse({ error: "Not found." }, 404));

// ---- Public store pages: /{public_identifier}[/{module}/{code}] ----
app.all("*", async (c) => {
	const url = new URL(c.req.url);
	try {
		return await cachedPublicGet(c.req.raw, c.env, wctx(c),
			async () => await handlePublicRoutes(c.req.raw, c.env, url) ?? jsonResponse({ error: "Not found." }, 404), true);
	} catch (e) {
		await logError(c.env, "public", e, c.req.raw);
		return jsonResponse({ error: "server" }, 500);
	}
});

// Anything thrown outside a handler's own try/catch lands here, so no route can
// leak a raw runtime error — or an unlogged 500 — to a public caller.
app.onError(async (error, c) => {
	await logError(c.env, "public_worker", error, c.req.raw);
	return jsonResponse({ error: "server" }, 500);
});

export default withSentry<PublicWorkerEnv, QueuedEmailMessage>(
	// SENTRY_DSN is a Wrangler secret — set via `npx wrangler secret put SENTRY_DSN`.
	// When missing, Sentry is a no-op.
	(env) => {
		const dsn = (env as unknown as Record<string, unknown>).SENTRY_DSN as string | undefined;
		return dsn ? { dsn, tracesSampleRate: 0.1 } : {};
	},
	{
	async fetch(request, env, ctx): Promise<Response> {
		const bounded = await enforceRequestBodyLimit(request, {
			jsonBytes: 256 * 1024,
			formBytes: 6 * 1024 * 1024,
			otherBytes: 512 * 1024,
		});
		if (bounded instanceof Response) return hardenPublic(bounded);
		try {
			return hardenPublic(await app.fetch(bounded as typeof request, env, ctx));
		} finally {
			// Latency samples are buffered per request and must be emitted before
			// it ends. Nothing else will: a Worker isolate is evicted without
			// warning, and anything still buffered goes with it. In `finally` so a
			// request that threw still reports what it measured — those are the
			// ones worth having.
			flushLatencySamples();
		}
	},

	// ---- Inbound email (Cloudflare Email Routing → Worker) ----
	async email(message, env, ctx): Promise<void> {
		await handleInboundEmail(message, env);
	},

	// Daily D1 cleanup: technical records that can contain IP addresses are
	// deleted or de-identified after at most 30 days.
	//
	// Each job is awaited, not handed to ctx.waitUntil(): a cron invocation
	// must fail when its job fails, otherwise the run is reported as
	// successful and a broken job stays invisible.
	async scheduled(controller, env): Promise<void> {
		if (controller.cron === "17 2 * * *") {
			await runObservedJob(env, "retention", () => runRetentionCleanup(env));
		} else if (controller.cron === "32 2 * * *") {
			await runObservedJob(env, "play-account-hash-backfill", () => backfillPlayAccountHashes(env, 1_000));
		} else if (controller.cron === "47 2 * * *") {
			await runObservedJob(env, "google-play", () => reconcileGooglePlayPurchases(env));
		} else if (controller.cron === "2 3 * * *") {
			await runObservedJob(env, "deletions", () => processDeletionRequests(env));
		}
	},

	async queue(batch: MessageBatch<QueuedEmailMessage>, env): Promise<void> {
		const kind = classifyPublicQueue(batch.queue);
		if (kind === "unknown") {
			console.error(JSON.stringify({ signal: "unknown_public_queue", queue: batch.queue }));
			batch.ackAll();
			return;
		}
		for (const message of batch.messages) {
			const body = message.body as QueuedEmailMessage | null;
			// No longer requires body.job: the payload lives in outbound_email_jobs
			// and the message carries only an id.
			if (!body || typeof body !== "object" || body.version !== 1 || !body.jobId) {
				console.error(JSON.stringify({ signal: "email_queue_message_malformed" }));
				message.ack();
				continue;
			}
			if (kind === "email_dlq") {
				await markQueuedEmailDeadLetter(env, body);
				message.ack();
				continue;
			}
			try {
				await processQueuedEmail(env, body);
				message.ack();
			} catch (error) {
				console.error(JSON.stringify({
					signal: "email_queue_consumer_error",
					job_id: body.jobId,
					message: error instanceof Error ? error.message : "unknown",
				}));
				message.retry({ delaySeconds: Math.min(3_600, 30 * (2 ** Math.max(0, message.attempts - 1))) });
			}
		}
	},
} satisfies ExportedHandler<PublicWorkerEnv, QueuedEmailMessage>);

// ===================== Legacy API (chat / orders) =====================

async function handleApi(
	request: Request,
	env: PublicWorkerEnv,
	url: URL,
	authenticatedSeller?: AuthenticatedSeller | null,
): Promise<Response> {
	try {
		// ---- Chat (AI assistant) ----
		if (url.pathname === "/api/v1/chat") {
			if (request.method !== "POST") return methodNotAllowed("POST");
			if (env.AI_ASSISTANT_ENABLED !== "true" || !(await runtimeControlEnabled(env, "ai_enabled", true))) {
				return jsonResponse({ error: "feature_disabled", feature: "ai_assistant" }, 503);
			}

			// Authenticated: the AI proxy is never open to the public (cost + abuse).
			const { phone, secret } = readCreds(request, url);
			const seller = authenticatedSeller !== undefined ? authenticatedSeller : await authSeller(env, phone, secret);
			if (!seller) return jsonResponse({ error: "auth" }, 401);

			// Abuse guard: 20 requests / minute per seller.
			if (!(await checkRateLimit(env, `chat:${seller.id}`, 20, 60))) {
				return jsonResponse({ error: "rate_limited" }, 429);
			}

			let body: ChatRequest;
			try {
				body = await request.json();
			} catch {
				return jsonResponse({ error: "Invalid JSON body." }, 400);
			}
			const message = body.message?.trim();
			if (!message) return jsonResponse({ error: "Message is required." }, 400);
			// Cost guard: rate limiting alone doesn't bound LLM spend if a single
			// message can be arbitrarily long.
			if (message.length > 2000) return jsonResponse({ error: "message_too_long" }, 400);
			if (!env.DEEPSEEK_API_KEY) {
				return jsonResponse({ error: "ai_temporarily_unavailable" }, 503, { "retry-after": "60" });
			}
			const requestId = request.headers.get("idempotency-key") || crypto.randomUUID();
			const reservation = env.ENTITLEMENTS_ENABLED === "true"
				? await reserveUsage(env, String(seller.id), "max_ai_requests_per_month", 1, requestId)
				: null;
			if (reservation && !reservation.allowed) return entitlementLimitReached(reservation.snapshot, "max_ai_requests_per_month", 429);
			if (!reservation) {
				const aiLimit = await getPlanLimit(env, String(seller.id), "max_ai_requests_per_month");
				if (aiLimit !== null) {
					const month = new Date().toISOString().slice(0, 7);
					if (!(await checkRateLimit(env, `ai:${seller.id}:${month}`, aiLimit, 60 * 60 * 24 * 31)))
						return jsonResponse({ error: "PLAN_LIMIT_REACHED", code: "plan_limit_reached", entitlement_key: "max_ai_requests_per_month", limit: aiLimit }, 429);
				}
			}
			try {
				const prompt = await loadPublishedAiPrompt(env);
				const organizationId = reservation?.snapshot.organization_id ?? (await env.orderak_db.prepare(
					"SELECT organization_id FROM organization_stores WHERE store_id=?",
				).bind(String(seller.id)).first<{ organization_id: string }>())?.organization_id ?? null;
				const result = await callDeepSeek(env, {
					organizationId,
					idempotencyKey: requestId,
					model: prompt.model,
					messages: [
						{ role: "system", content: prompt.text },
						{ role: "user", content: message },
					],
				});
				return jsonResponse({ reply: result.content, aiConfigured: true });
			} catch (err) {
				if (reservation?.reservation_id) await voidUsageReservation(env, reservation.reservation_id);
				const retryAfter = err instanceof AiTemporarilyUnavailableError ? err.retryAfterSeconds : 60;
				console.error(JSON.stringify({ signal: "ai_request_failed", provider: "deepseek" }));
				return jsonResponse({ error: "ai_temporarily_unavailable" }, 503, { "retry-after": String(retryAfter) });
			}
		}

		// ---- Pull new orders (from Android app) ----
		// Cursor is the per-store order_no (monotonic), not the UUID id.
		if (request.method === "GET" && url.pathname === "/api/v1/orders") {
			// Credentials come from headers only — never the query string (log hygiene).
			const { phone, secret } = readCreds(request, url);
			const since = Number(url.searchParams.get("since")) || 0;
			const store = authenticatedSeller !== undefined ? authenticatedSeller : await authSeller(env, phone, secret);
			if (!store) return jsonResponse({ error: "auth" }, 401);
			const { results: orderRows } = (await env.orderak_db
				.prepare(
					`SELECT id, order_no, buyer_phone, buyer_name, status, pay_method, total_piasters, note, created_at
					 FROM orders WHERE store_id = ? AND order_no > ? ORDER BY order_no LIMIT 51`,
				)
				.bind(store.id, since)
				.all()) as { results: Record<string, unknown>[] };
			const hasMore = orderRows.length > 50;
			const orders = orderRows.slice(0, 50);
			// Fetch all items in ONE query (was an N+1: one query per order).
			// product_code is included so the app can match each line to a local
			// product and keep stock in step (see SyncRepository.insertRemoteOrder).
			const itemsByOrder = new Map<unknown, Record<string, unknown>[]>();
			if (orders.length) {
				const marks = orders.map(() => "?").join(",");
				const { results: items } = (await env.orderak_db
					.prepare(
						`SELECT oi.order_id, oi.product_id, p.product_code, oi.product_name, oi.qty, oi.price_piasters
						 FROM order_items oi
						 LEFT JOIN products p ON p.id = oi.product_id
						 WHERE oi.order_id IN (${marks})`,
					)
					.bind(...orders.map((o) => o.id))
					.all()) as { results: Record<string, unknown>[] };
				for (const it of items) {
					const { order_id, ...rest } = it;
					const list = itemsByOrder.get(order_id) ?? [];
					list.push(rest);
					itemsByOrder.set(order_id, list);
				}
			}
			for (const o of orders) o.items = itemsByOrder.get(o.id) ?? [];
			const nextSince = orders.length ? Number(orders[orders.length - 1].order_no) : since;
			// Piggyback the plan/entitlement config so the app doesn't spend a
			// separate authenticated /api/v1/config request every sync. Same auth,
			// one extra join, one fewer round-trip + one fewer authSeller.
			const config = await loadClientConfig(env, store as unknown as Record<string, unknown>, request);
			return jsonResponse({ ok: true, orders, config, has_more: hasMore, next_since: nextSince });
		}

		return jsonResponse({ error: "not_found" }, 404);
	} catch (e) {
		await logError(env, "api", e, request);
		return jsonResponse({ error: "server" }, 500);
	}
}

// ===================== AI Chat =====================

async function loadPublishedAiPrompt(env: PublicWorkerEnv): Promise<{ text: string; model: string }> {
	try {
		const row = await env.orderak_db.prepare(
			"SELECT prompt_text,model FROM ai_prompts WHERE active=1 AND provider='deepseek' ORDER BY updated_at DESC,id DESC LIMIT 1",
		).first<{ prompt_text: string; model: string }>();
		return { text: row?.prompt_text?.trim() || SYSTEM_PROMPT, model: row?.model?.trim() || DEEPSEEK_MODEL };
	} catch {
		return { text: SYSTEM_PROMPT, model: DEEPSEEK_MODEL };
	}
}
