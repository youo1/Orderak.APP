// ============================================================
// Shared helpers used by every module (index, billing, ads, admin).
// Kept tiny and dependency-free on purpose (beginner-friendly).
// ============================================================

import { verifyPassword, sha256Hex, keyedHash } from "../../domains/identity/auth";

const ALLOWED_CORS_ORIGINS = new Set([
	"https://orderak.app",
	"https://www.orderak.app",
	"https://api.orderak.app",
	"https://admin.orderak.app",
	"http://localhost:3000",
	"http://localhost:5173",
	"http://127.0.0.1:3000",
	"http://127.0.0.1:5173",
]);

export function corsHeaders(request?: Request): HeadersInit {
	const headers: Record<string, string> = {
		"Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
		"Access-Control-Allow-Headers":
			"Content-Type, Authorization, X-Request-ID, x-orderak-phone, x-orderak-secret, x-orderak-recent-auth, x-orderak-device-id, x-orderak-device-label, x-orderak-platform, x-orderak-app-version, x-admin-key, x-idempotency-key, idempotency-key",
		"Access-Control-Expose-Headers": "X-Request-ID, Retry-After, ETag, Allow",
	};
	const allowOrigin = allowedCorsOrigin(request);
	if (allowOrigin) {
		headers["Access-Control-Allow-Origin"] = allowOrigin;
		headers.Vary = "Origin";
	}
	return headers;
}

/**
 * The Origin to echo back, or "" when the caller's origin is not on the list.
 *
 * Split out of corsHeaders() because the origin is the one CORS header that
 * cannot be produced without the request, and jsonResponse() does not have one.
 * It called `corsHeaders()` with no argument, so `Access-Control-Allow-Origin`
 * was never present on any actual response — only on the OPTIONS preflight,
 * which does have the request. A browser therefore saw the preflight succeed
 * and then blocked the real response, and the eight-entry allowlist above had
 * no effect on anything.
 *
 * Applied as middleware in the public Worker instead, which reaches every
 * response including the ones built with `new Response` and the ones served
 * from the edge cache.
 */
export function allowedCorsOrigin(request?: Request): string {
	const origin = request?.headers.get("origin") ?? "";
	return ALLOWED_CORS_ORIGINS.has(origin) ? origin : "";
}

export function jsonResponse(data: unknown, status = 200, extraHeaders: HeadersInit = {}): Response {
	const headers = new Headers(corsHeaders());
	for (const [name, value] of new Headers(extraHeaders)) headers.set(name, value);
	if (!headers.has("x-request-id")) headers.set("x-request-id", crypto.randomUUID());

	if (status >= 400) {
		const source = data && typeof data === "object" && !Array.isArray(data)
			? data as Record<string, unknown>
			: {};
		const rawCode = typeof source.error === "string" ? source.error : `http_${status}`;
		const code = rawCode.trim().toLowerCase().replace(/[^a-z0-9._-]+/g, "_").replace(/^[._-]+|[._-]+$/g, "") || `http_${status}`;
		const title = code.split(/[._-]+/).filter(Boolean)
			.map((part) => part.charAt(0).toUpperCase() + part.slice(1)).join(" ");
		const detail = typeof source.message === "string" && source.message.trim()
			? source.message.trim()
			: title;
		const extensions: Record<string, unknown> = {};
		for (const [key, value] of Object.entries(source)) {
			if (["error", "message", "type", "title", "code", "detail", "request_id"].includes(key)) continue;
			if (key === "status") {
				if (typeof value !== "number") extensions.resource_status = value;
				continue;
			}
			extensions[key] = value;
		}
		headers.set("content-type", "application/problem+json; charset=utf-8");
		return Response.json({
			type: `https://developers.orderak.app/problems/${code}`,
			title,
			status,
			code,
			detail,
			request_id: headers.get("x-request-id"),
			...extensions,
		}, { status, headers });
	}
	return Response.json(data, { status, headers });
}

type AllowedHttpMethod = "GET" | "HEAD" | "POST" | "PUT" | "PATCH" | "DELETE" | "OPTIONS";

/** Build an RFC 9110-compliant 405 response for a known resource. */
export function methodNotAllowed(...allowed: [AllowedHttpMethod, ...AllowedHttpMethod[]]): Response {
	return jsonResponse({ error: "method" }, 405, { Allow: [...new Set(allowed)].join(", ") });
}

export interface RequestBodyLimits {
	jsonBytes?: number;
	formBytes?: number;
	otherBytes?: number;
}

/**
 * Buffers only a deliberately bounded request body and rebuilds the Request so
 * existing route handlers can safely call json()/formData(). Content-Length is
 * checked first, while the streaming counter also protects chunked requests.
 */
export async function enforceRequestBodyLimit(
	request: Request,
	limits: RequestBodyLimits = {},
): Promise<Request | Response> {
	if (request.method === "GET" || request.method === "HEAD" || !request.body) return request;
	const type = (request.headers.get("content-type") ?? "").toLowerCase();
	const limit = type.includes("multipart/form-data")
		? limits.formBytes ?? 6 * 1024 * 1024
		: type.includes("json")
			? limits.jsonBytes ?? 256 * 1024
			: limits.otherBytes ?? 512 * 1024;
	const declared = Number(request.headers.get("content-length"));
	if (Number.isFinite(declared) && declared > limit) {
		return jsonResponse({ error: "request_body_too_large", max_bytes: limit }, 413);
	}

	const reader = request.body.getReader();
	const chunks: Uint8Array[] = [];
	let total = 0;
	for (;;) {
		const { done, value } = await reader.read();
		if (done) break;
		if (!value) continue;
		total += value.byteLength;
		if (total > limit) {
			await reader.cancel("request_body_too_large").catch(() => undefined);
			return jsonResponse({ error: "request_body_too_large", max_bytes: limit }, 413);
		}
		chunks.push(value);
	}

	const body = new Uint8Array(total);
	let offset = 0;
	for (const chunk of chunks) {
		body.set(chunk, offset);
		offset += chunk.byteLength;
	}
	const headers = new Headers(request.headers);
	headers.delete("content-length");
	return new Request(request, { headers, body });
}

/** HTML-escape a value for safe interpolation into markup. */
export function esc(s: unknown): string {
	return String(s ?? "")
		.replace(/&/g, "&amp;")
		.replace(/</g, "&lt;")
		.replace(/>/g, "&gt;")
		.replace(/"/g, "&quot;");
}

// `egp(piasters)` stood here: a formatter with `/ 100` and `en-EG` hardcoded.
// It had no callers, so it is removed rather than migrated — carrying dead code
// through a currency migration only creates another place for the old
// assumption to survive. Use formatMoney() from platform/money/money.ts, which
// takes the currency and reads its exponent from ICU (ADR-009).

/**
 * Hash a seller's device secret at rest.
 *
 * Device secrets are client-generated random UUIDs (~122 bits of entropy), so
 * key stretching (PBKDF2) adds CPU cost on EVERY authenticated request without
 * any security benefit — stretching protects low-entropy human passwords, not
 * random tokens. A single salted-format SHA-256 is the right tool here.
 * (Admin *passwords* still use PBKDF2 via auth.ts — that's correct for them.)
 */
export async function hashSecret(secret: string): Promise<string> {
	return "sha256$" + (await sha256Hex(secret));
}

/**
 * Verify a presented secret against any stored format:
 *  - "sha256$<hex>"  current format (cheap, for random device secrets)
 *  - "pbkdf2$..."    previous format (expensive; upgraded on first success)
 *  - anything else   legacy plaintext (constant-time compare)
 */
export async function verifyStoredSecret(secret: string, stored: string): Promise<boolean> {
	if (!stored) return false;
	if (stored.startsWith("sha256$")) {
		return constantTimeEqual(await sha256Hex(secret), stored.slice("sha256$".length));
	}
	if (stored.startsWith("pbkdf2$")) return verifyPassword(secret, stored);
	return constantTimeEqual(stored, secret);
}

/** Constant-time string comparison (avoids timing oracles on legacy secrets). */
export function constantTimeEqual(a: string, b: string): boolean {
	const ta = new TextEncoder().encode(a);
	const tb = new TextEncoder().encode(b);
	if (ta.length !== tb.length) return false;
	let diff = 0;
	for (let i = 0; i < ta.length; i++) diff |= ta[i] ^ tb[i];
	return diff === 0;
}

// Failed-auth throttle: after AUTH_FAIL_LIMIT wrong secrets for a phone within
// AUTH_FAIL_WINDOW seconds, further attempts are rejected without touching
// crypto or the devices table. A legitimate device never fails auth (its secret
// is stored), so real users are unaffected; the residual trade-off is that an
// attacker spamming junk secrets can lock a phone out for the remainder of a
// window — pair with a per-IP Cloudflare WAF rate rule for defense in depth.
const AUTH_FAIL_LIMIT = 20;
const AUTH_FAIL_WINDOW = 300; // seconds

/**
 * Read the failure counter from whichever store recordAuthFailure() writes to.
 *
 * This MUST stay in step with checkRateLimit(). When the limiter moved to the
 * Durable Object, this function kept reading the D1 `rate_limits` table while
 * the counter was being written to the DO — so it could only ever observe an
 * absent row, always returned false, and the brute-force lockout silently
 * stopped existing. Both halves now resolve the backing store the same way.
 */
async function authFailuresExceeded(env: Env, phone: string): Promise<boolean> {
	const bucket = `authfail:${phone}`;
	try {
		const now = Math.floor(Date.now() / 1000);
		const windowStart = now - (now % AUTH_FAIL_WINDOW);

		const stub = await rateLimiterStub(env, bucket);
		if (stub) {
			const counter = await stub.peek();
			return !!counter && counter.windowStart === windowStart && counter.count >= AUTH_FAIL_LIMIT;
		}

		const row = (await env.orderak_db
			.prepare("SELECT count, window_start FROM rate_limits WHERE bucket = ?")
			.bind(bucket)
			.first()) as { count: number; window_start: number } | null;
		return !!row && row.window_start === windowStart && row.count >= AUTH_FAIL_LIMIT;
	} catch {
		return false; // never lock everyone out on a limiter error
	}
}

async function recordAuthFailure(env: Env, phone: string): Promise<void> {
	try {
		// Reuse the fixed-window counter; the "limit" is irrelevant here because
		// authFailuresExceeded() reads the count directly.
		await checkRateLimit(env, `authfail:${phone}`, Number.MAX_SAFE_INTEGER, AUTH_FAIL_WINDOW);
	} catch {
		// Best-effort.
	}
}

/**
 * Verify a seller by phone + secret. Returns the seller row or null.
 *
 * Stored formats: "sha256$..." (current), "pbkdf2$..." (previous), or legacy
 * plaintext. Older formats keep working and are transparently upgraded to
 * sha256 on first successful login — no re-registration needed.
 * Repeated failures for a phone are throttled (see AUTH_FAIL_LIMIT above).
 */
export type AuthenticatedSeller = Record<string, unknown>;

export async function authSeller(
	env: Env,
	phone: string,
	secret: string,
): Promise<AuthenticatedSeller | null> {
	if (!phone || !secret) return null;
	if (await authFailuresExceeded(env, phone)) return null;
	const seller = await verifySeller(env, phone, secret);
	if (!seller) await recordAuthFailure(env, phone);
	return seller;
}

export function hasPrimarySellerCredential(seller: Record<string, unknown>): boolean {
	return String(seller.secret ?? "").trim() !== "";
}

export async function revokeSellerCredential(env: Env, sellerId: string, secret: string): Promise<boolean> {
	const seller = await env.orderak_db.prepare("SELECT id,secret FROM sellers WHERE id=?").bind(sellerId).first<Record<string, unknown>>();
	if (!seller) return false;
	const stored = String(seller.secret ?? "");
	if (stored && await verifyStoredSecret(secret, stored)) {
		await env.orderak_db.prepare(
			`UPDATE sellers SET secret=NULL,primary_device_id=NULL,primary_device_label=NULL,primary_device_platform=NULL,
			 primary_device_app_version=NULL,primary_device_last_used_at=NULL,updated_at=datetime('now') WHERE id=?`,
		).bind(sellerId).run();
		return true;
	}
	const { results } = await env.orderak_db.prepare(
		"SELECT secret_hash FROM seller_devices WHERE seller_id=?",
	).bind(sellerId).all<{ secret_hash: string }>();
	for (const row of results ?? []) {
		if (await verifyStoredSecret(secret, row.secret_hash)) {
			await env.orderak_db.prepare(
				"DELETE FROM seller_devices WHERE seller_id=? AND secret_hash=?",
			).bind(sellerId, row.secret_hash).run();
			return true;
		}
	}
	return false;
}

/** Attach non-secret display metadata to the credential that just authenticated. */
export async function recordDeviceMetadata(
	env: Env,
	seller: Record<string, unknown>,
	secret: string,
	meta: { deviceId: string; label?: string; platform?: string; appVersion?: string },
): Promise<void> {
	if (!meta.deviceId || meta.deviceId.length > 100) return;
	try {
		if (await verifyStoredSecret(secret, String(seller.secret ?? ""))) {
			await env.orderak_db.prepare(
				`UPDATE sellers SET primary_device_id=?,primary_device_label=?,primary_device_platform=?,
				 primary_device_app_version=?,primary_device_last_used_at=datetime('now') WHERE id=?`,
			).bind(meta.deviceId, String(meta.label ?? "").slice(0, 80), String(meta.platform ?? "").slice(0, 30), String(meta.appVersion ?? "").slice(0, 30), seller.id).run();
			return;
		}
		const { results } = await env.orderak_db.prepare(
			"SELECT secret_hash FROM seller_devices WHERE seller_id=?",
		).bind(seller.id).all<{ secret_hash: string }>();
		for (const row of results ?? []) {
			if (await verifyStoredSecret(secret, row.secret_hash)) {
				await env.orderak_db.prepare(
					`UPDATE seller_devices SET device_id=?,device_label=?,platform=?,app_version=?,last_used_at=datetime('now')
					 WHERE seller_id=? AND secret_hash=?`,
				).bind(meta.deviceId, String(meta.label ?? "").slice(0, 80), String(meta.platform ?? "").slice(0, 30), String(meta.appVersion ?? "").slice(0, 30), seller.id, row.secret_hash).run();
				return;
			}
		}
	} catch {
		// Metadata is best-effort and must never make authentication unavailable.
	}
}

async function verifySeller(
	env: Env,
	phone: string,
	secret: string,
): Promise<Record<string, unknown> | null> {
	const s = (await env.orderak_db
		.prepare("SELECT * FROM sellers WHERE phone = ?")
		.bind(phone)
		.first()) as Record<string, unknown> | null;
	if (!s) return null;

	const stored = String(s.secret ?? "");
	if (stored && await verifyStoredSecret(secret, stored)) {
		// Transparent upgrade of pbkdf2/plaintext to the cheap sha256 format.
		if (!stored.startsWith("sha256$")) {
			try {
				const hashed = await hashSecret(secret);
				await env.orderak_db
					.prepare("UPDATE sellers SET secret = ? WHERE id = ?")
					.bind(hashed, s.id)
					.run();
				s.secret = hashed;
			} catch {
				// Best-effort upgrade; auth still succeeds even if the write fails.
			}
		}
		return s;
	}

	return authenticateAdditionalDevice(env, s, secret);
}

async function authenticateAdditionalDevice(
	env: Env,
	seller: Record<string, unknown>,
	secret: string,
): Promise<Record<string, unknown> | null> {
	try {
		const { results } = await env.orderak_db.prepare(
			"SELECT secret_hash FROM seller_devices WHERE seller_id = ?",
		).bind(seller.id).all<{ secret_hash: string }>();
		for (const device of results ?? []) {
			if (await verifyStoredSecret(secret, device.secret_hash)) {
				if (env.ENTITLEMENTS_ENABLED !== "true" && !(await legacyMultiDeviceAllowed(env, String(seller.id)))) return null;
				// Touch last_used_at and upgrade pbkdf2 rows to sha256 in one write.
				const newHash = device.secret_hash.startsWith("sha256$")
					? device.secret_hash
					: await hashSecret(secret);
				await env.orderak_db.prepare(
					"UPDATE seller_devices SET secret_hash=?, last_used_at=datetime('now') WHERE seller_id=? AND secret_hash=?",
				).bind(newHash, seller.id, device.secret_hash).run();
				return seller;
			}
		}
	} catch {
		// Migration may not exist yet during rolling deployment.
	}
	return null;
}

async function legacyMultiDeviceAllowed(env: Env, sellerId: string): Promise<boolean> {
	try {
		const active = await env.orderak_db.prepare(
			`SELECT p.multi_device_enabled FROM subscriptions s JOIN plans p ON p.id=s.plan_id
			 WHERE s.seller_id=? AND s.status='active' AND p.active=1 ORDER BY s.id DESC LIMIT 1`,
		).bind(sellerId).first<{ multi_device_enabled: number }>();
		if (active) return Number(active.multi_device_enabled) === 1;
		const free = await env.orderak_db.prepare("SELECT multi_device_enabled FROM plans WHERE id='free'")
			.first<{ multi_device_enabled: number }>();
		return Number(free?.multi_device_enabled ?? 0) === 1;
	} catch {
		return false;
	}
}

/**
 * Best-effort server-side error log. Writes to the `error_logs` table (shown
 * in the admin "Errors" tab) and always console.error()s. Never throws.
 */
export async function logError(
	env: Env,
	context: string,
	err: unknown,
	request?: Request,
): Promise<void> {
	const message = err instanceof Error ? err.message : String(err);
	const stack = err instanceof Error ? err.stack ?? null : null;
	console.error(`[ERROR] ${context}: ${message}`);
	const normalized = message.toLowerCase();
	if ((normalized.includes("d1") || normalized.includes("sqlite")) && (
		normalized.includes("overload") || normalized.includes("too many requests") ||
		normalized.includes("sqlite_busy") || normalized.includes("database is locked")
	)) {
		console.error(JSON.stringify({
			signal: "d1_overload",
			context: context.slice(0, 80),
		}));
	}
	try {
		let path: string | null = null;
		let method: string | null = null;
		let ip: string | null = null;
		if (request) {
			try {
				path = new URL(request.url).pathname;
			} catch {
				/* ignore malformed URL */
			}
			method = request.method;
			ip = request.headers.get("cf-connecting-ip");
		}
		await env.orderak_db
			.prepare(
				`INSERT INTO error_logs (context, message, stack, path, method, ip)
				 VALUES (?, ?, ?, ?, ?, ?)`,
			)
			.bind(
				context.slice(0, 80),
				message.slice(0, 2000),
				stack ? stack.slice(0, 4000) : null,
				path,
				method,
				ip,
			)
			.run();
	} catch (e) {
		console.error("logError failed:", e);
	}
}


/** Read the seller credentials from headers (never from query strings — log hygiene). */
export function readCreds(
	request: Request,
	url: URL,
	body?: Record<string, unknown>,
): { phone: string; secret: string } {
	const phone =
		request.headers.get("x-orderak-phone") ??
		String(body?.phone ?? "");
	const secret =
		request.headers.get("x-orderak-secret") ??
		String(body?.secret ?? "");
	return { phone, secret };
}

/** Generate an 8-char uppercase referral / code string. */
export function genCode(len = 8): string {
	const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"; // no confusing chars
	const bytes = crypto.getRandomValues(new Uint8Array(len));
	let out = "";
	for (let i = 0; i < len; i++) out += alphabet[bytes[i] % alphabet.length];
	return out;
}

/** Ensure a seller has a referral code; create & persist one if missing. */
export async function ensureReferralCode(env: Env, seller: Record<string, unknown>): Promise<string> {
	if (seller.referral_code) return String(seller.referral_code);
	// try a few times in case of collision
	for (let i = 0; i < 5; i++) {
		const code = genCode(8);
		try {
			await env.orderak_db
				.prepare("UPDATE sellers SET referral_code = ? WHERE id = ?")
				.bind(code, seller.id)
				.run();
			seller.referral_code = code;
			return code;
		} catch {
			// A duplicate code. This retry existed from the start but could never
			// run: idx_sellers_refcode was a plain index until migration 045, so
			// the UPDATE succeeded on a collision and two sellers ended up sharing
			// a code — which referralApply() resolves with `WHERE referral_code=?`,
			// crediting whichever row came back first. Now the index rejects the
			// write and the loop does what it was written to do.
		}
	}
	throw new Error("could_not_generate_referral_code");
}

/**
 * Fixed-window rate limiter. Returns true if the call is ALLOWED.
 *
 * Backed by the RATE_LIMITER Durable Object (one instance per bucket), which
 * serialises the read-modify-write that a limiter needs. The D1 path below is
 * the fallback for configurations without the binding; it is retained
 * deliberately so a missing binding degrades instead of throwing, and it stays
 * behaviourally identical — same aligned window, same post-increment compare.
 *
 * Both paths align the window to absolute time (`now - (now % windowSec)`)
 * rather than starting it at the first request. Throttling semantics are named
 * in docs/contracts/auth-phase1-contract.md; do not change this without
 * updating that contract.
 */
/**
 * Resolve the rate-limiter Durable Object namespace, or undefined when the
 * binding is absent (which selects the D1 fallback).
 *
 * Every caller that reads or writes a counter must go through this, so the
 * read path and the write path can never disagree about where counters live.
 */
function rateLimiterNamespace(
	env: Env,
): DurableObjectNamespace<import("../durable-objects/rate-limiter").RateLimiter> | undefined {
	return (env as unknown as {
		RATE_LIMITER?: DurableObjectNamespace<import("../durable-objects/rate-limiter").RateLimiter>;
	}).RATE_LIMITER;
}

/**
 * Resolve the Durable Object that owns a bucket's counter, hashing the bucket
 * first so no personal data ends up in the object's name.
 *
 * Buckets embed the thing being limited — "authfail:+201001234567",
 * "delete-request:ip:1.2.3.4" — so naming objects after them directly would
 * put phone numbers and IP addresses into Durable Object identities, where the
 * D1 retention job cannot reach them. The object stores no identifier either
 * (see rate-limiter.ts), so after this the pair is anonymous end to end.
 *
 * BUYER_PRIVACY_PEPPER is the same pepper the admin surface uses to hash buyer
 * phone numbers, so an identifier is peppered consistently wherever it is
 * derived. When it is unset the bucket is still hashed, just unkeyed: a plain
 * SHA-256 of a phone number is brute-forceable and therefore weaker, but rate
 * limiting is a protective control and must not become unavailable because a
 * secret is missing. Losing the pepper changes every derived name, which
 * resets counters once — acceptable for a fixed window, and the reason the
 * pepper should not be rotated casually.
 */
export async function rateLimiterStub(
	env: Env,
	bucket: string,
): Promise<DurableObjectStub<import("../durable-objects/rate-limiter").RateLimiter> | null> {
	const namespace = rateLimiterNamespace(env);
	if (!namespace) return null;
	const pepper = env.BUYER_PRIVACY_PEPPER;
	const name = pepper ? await keyedHash(bucket, pepper) : await sha256Hex(bucket);
	return namespace.get(namespace.idFromName(name));
}

export async function checkRateLimit(
	env: Env,
	bucket: string,
	limit: number,
	windowSec: number,
): Promise<boolean> {
	const stub = await rateLimiterStub(env, bucket);
	if (stub) {
		const { allowed } = await stub.checkIncrement(limit, windowSec);
		return allowed;
	}
	return checkRateLimitD1(env, bucket, limit, windowSec);
}

/** Legacy D1 implementation — see checkRateLimit above. */
async function checkRateLimitD1(
	env: Env,
	bucket: string,
	limit: number,
	windowSec: number,
): Promise<boolean> {
	const now = Math.floor(Date.now() / 1000);
	const windowStart = now - (now % windowSec);
	const row = await env.orderak_db.prepare(
		`INSERT INTO rate_limits(bucket,count,window_start) VALUES(?,1,?)
		 ON CONFLICT(bucket) DO UPDATE SET
		   count=CASE WHEN rate_limits.window_start=excluded.window_start
		              THEN rate_limits.count+1 ELSE 1 END,
		   window_start=excluded.window_start
		 RETURNING count`,
	).bind(bucket, windowStart).first<{ count: number }>();
	return Number(row?.count ?? limit + 1) <= limit;
}

/** Structured audit log for critical actions. */
export function audit(action: string, details: Record<string, unknown>): void {
	console.log(`[AUDIT] ${action} ${JSON.stringify(details)}`);
}

/** Compute a discounted amount in minor units, given a discount type + value. */
export function applyDiscount(
	amountPiasters: number,
	type: string,
	value: number,
): number {
	let discount = 0;
	if (type === "percentage") {
		discount = Math.floor((amountPiasters * Math.max(0, Math.min(100, value))) / 100);
	} else {
		// a fixed amount, already in minor units
		discount = Math.max(0, Math.floor(value));
	}
	return Math.max(0, amountPiasters - discount);
}
