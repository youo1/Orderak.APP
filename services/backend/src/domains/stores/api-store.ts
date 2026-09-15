// ============================================================
// Store API — identity, Store Information, categories, product sync, media.
//
//   GET  /api/v1/slug/check                 (public) live slug availability
//   POST /api/v1/register                   create / update a store
//   GET  /api/v1/store                      read Store Information
//   PUT  /api/v1/store                      update Store Information
//   GET  /api/v1/categories                 list categories
//   POST /api/v1/categories                 create category
//   PUT  /api/v1/categories/{category_code} update category
//   DELETE /api/v1/categories/{category_code} delete category
//   GET  /api/v1/products                   pull the store's catalog
//   POST /api/v1/products                   create one product
//   PUT  /api/v1/products/{product_code}    replace one product's metadata
//   DELETE /api/v1/products/{product_code}  delete one product
//   PATCH /api/v1/products/{product_code}/stock  adjust stock (compare-and-set)
//   POST /api/v1/media/upload               upload logo/cover/product image
//
// Internal UUIDs are never returned to the client. The app references stores by
// public_identifier and categories/products by their immutable codes.
// ============================================================

import { jsonResponse, methodNotAllowed, readCreds, authSeller, hashSecret, checkRateLimit, revokeSellerCredential, type AuthenticatedSeller, clientIpOf, logError } from "../../platform/http/shared";
import { uploadMedia } from "../../platform/storage/media";
import { verifyFirebaseToken } from "../../platform/auth/local-jwt";
import { t, pickLocale } from "../../platform/localization/i18n";
import { getPlanLimit, limitReached } from "../commerce/plan-limits";
import { DEFAULT_CURRENCY, ENABLED_CURRENCIES } from "../../platform/money/money";
import { refreshProductTranslations } from "../catalog/product-translations";
import { ensureOrganizationForStore, entitlementLimitReached, resolveEntitlements } from "../commerce/entitlements";
import { provisionDeviceSecret } from "../identity/seller-session";
import { revokeRecentAuthProofsStatement } from "../identity/auth-v2";
import { auditDb } from "../admin/admin-auth";
import { requireTenantWrite, resolveTenantContextForStore, tenantUnavailableResponse } from "../../platform/tenancy/tenant-routing";
import {
	newUuid,
	newResourceCode,
	uniqueStoreCode,
	uniqueResourceCode,
	slugify,
	cleanSlug,
	slugIsFree,
	uniqueSlug,
	slugSuggestions,
	buildPublicIdentifier,
	countryIsoFromPhone,
	normalizeCountryIso,
	storeUrl,
	RESERVED_SLUGS,
	findSellerByVerifiedIdentity,
	newAccountFoundationStatements,
	syncVerifiedFirebaseIdentity,
} from "../identity/identity";

type Row = Record<string, unknown>;
const FRESH_FIREBASE_PROOF_SECONDS = 5 * 60;

async function allowPreAuthAttempt(
	env: Env,
	request: Request,
	prefix: string,
	phone: string,
	phoneLimit: number,
	ipLimit: number,
	windowSec: number,
): Promise<boolean> {
	const ip = request.headers.get("cf-connecting-ip")?.trim() || "unknown";
	const phoneAllowed = await checkRateLimit(env, `${prefix}:phone:${phone}`, phoneLimit, windowSec);
	const ipAllowed = await checkRateLimit(env, `${prefix}:ip:${ip}`, ipLimit, windowSec);
	return phoneAllowed && ipAllowed;
}

async function currentLegalVersion(env: Env, slug: "terms" | "privacy", locale: string) {
	return env.orderak_db.prepare(
		`SELECT version, lang FROM content_page_versions
		 WHERE slug=? AND status='published'
		 ORDER BY CASE WHEN lang=? THEN 0 WHEN lang='en' THEN 1 ELSE 2 END, version DESC
		 LIMIT 1`,
	).bind(slug, locale).first<{ version: number; lang: string }>();
}

async function recordLegalAcceptance(
	env: Env,
	body: Row,
	phone: string,
	sellerId: string | null,
	locale: string,
): Promise<"ok" | "required" | "not_configured"> {
	if (body.terms_accepted !== true) return "required";
	const [terms, privacy] = await Promise.all([
		currentLegalVersion(env, "terms", locale),
		currentLegalVersion(env, "privacy", locale),
	]);
	if (!terms || !privacy) return "not_configured";
	await env.orderak_db.prepare(
		`INSERT INTO legal_acceptances
		 (id,seller_id,phone_e164,terms_version,privacy_version,locale,source,app_version,marketing_consent)
		 VALUES(?,?,?,?,?,?,?,?,?)`,
	).bind(
		newUuid(),
		sellerId,
		phone,
		Number(terms.version),
		Number(privacy.version),
		locale,
		"android_phone_auth",
		String(body.app_version ?? "").slice(0, 40) || null,
		body.marketing_consent === true ? 1 : 0,
	).run();
	return "ok";
}

/**
 * Verify a Firebase ID token via Google Identity Toolkit and confirm the token's
 * phone number matches `phone`. Returns the stable Firebase UID on success so
 * privacy deletion can later remove the upstream identity as well.
 */
export interface FirebaseIdentity {
	uid: string;
	phone: string;
	authTime?: number;
}

function tokenAuthTime(idToken: string): number | null {
	try {
		const payload = idToken.split(".")[1];
		if (!payload) return null;
		const normalized = payload.replaceAll("-", "+").replaceAll("_", "/").padEnd(Math.ceil(payload.length / 4) * 4, "=");
		const claims = JSON.parse(atob(normalized)) as { auth_time?: unknown };
		const value = Number(claims.auth_time);
		return Number.isFinite(value) ? value : null;
	} catch {
		return null;
	}
}

/**
 * Map verified Firebase claims onto the identity the rest of the server uses.
 *
 * Exported for its own tests. The decision it makes is which claim counts as
 * proof of a recent SMS challenge, and that decision was wrong for long enough
 * to be worth pinning down somewhere a test can reach without standing up a
 * JWKS endpoint.
 *
 * `auth_time`, never `iat`:
 *
 *   `iat` is when the ID token was minted. The Firebase SDK mints a new one
 *   from a refresh token roughly every hour, with no user interaction — so on
 *   any signed-in device it is always minutes old.
 *
 *   `auth_time` is when the user last completed a real challenge. It does not
 *   move until someone receives and enters an SMS code.
 *
 * Every caller of hasFreshFirebaseProof() — enrolling a device secret on an
 * account, restoring a session, both halves of a phone-number change — is
 * asking the second question. Reading `iat` answered the first, which made
 * possession of a refresh token equivalent to possession of the SIM: anyone
 * with an exfiltrated token could mint a "fresh" proof on demand and satisfy a
 * five-minute window indefinitely. The remote verification path never had this
 * bug; it reads the real claim.
 *
 * A token with no `auth_time` (custom-token and anonymous flows omit it) yields
 * undefined, which hasFreshFirebaseProof() rejects. That is the correct way to
 * fail: a token that cannot say when its user authenticated has not shown that
 * they just did.
 */
export function firebaseIdentityFromClaims(
	// Open on purpose: a real ID token carries a dozen claims this function has
	// no opinion about, `iat` among them, and a closed literal would make the
	// test that proves `iat` is ignored impossible to write.
	claims: { sub?: unknown; phone_number?: unknown; auth_time?: unknown; [claim: string]: unknown },
	phone: string,
): FirebaseIdentity | null {
	const uid = typeof claims.sub === "string" ? claims.sub : "";
	if (!uid || claims.phone_number !== phone) return null;
	const authTime = Number(claims.auth_time);
	return { uid, phone, authTime: Number.isFinite(authTime) ? authTime : undefined };
}

export async function verifyFirebasePhone(env: Env, idToken: string, phone: string): Promise<FirebaseIdentity | null> {
	if (!env.FIREBASE_WEB_API_KEY || !idToken || !phone) return null;

	// Local-first: verify with jose JWKS (removes Google network round-trip).
	// Falls back to remote verification on failure — never fails open.
	// Gate: set LOCAL_JWT_VERIFICATION="true" and FIREBASE_PROJECT_ID in wrangler vars.
	const localEnabled = (env as unknown as Record<string, unknown>).LOCAL_JWT_VERIFICATION === "true";
	if (localEnabled && (env as unknown as Record<string, unknown>).FIREBASE_PROJECT_ID) {
		const projectId = String((env as unknown as Record<string, unknown>).FIREBASE_PROJECT_ID);
		const claims = await verifyFirebaseToken(idToken, projectId);
		const identity = claims ? firebaseIdentityFromClaims(claims, phone) : null;
		if (identity) return identity;
		// Local verification failed — fall through to remote (safe-fallback).
	}

	// Remote verification (existing path).
	try {
		const res = await fetch(
			`https://identitytoolkit.googleapis.com/v1/accounts:lookup?key=${encodeURIComponent(env.FIREBASE_WEB_API_KEY)}`,
			{ method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ idToken }) },
		);
		if (!res.ok) return null;
		const result = await res.json<{ users?: { localId?: string; phoneNumber?: string }[] }>();
		const user = result.users?.[0];
		const verifiedPhone = String(result.users?.[0]?.phoneNumber ?? "") === phone;
		if (!user?.localId || !verifiedPhone) return null;
		const authTime = tokenAuthTime(idToken);
		return authTime == null ? { uid: user.localId, phone } : { uid: user.localId, phone, authTime };
	} catch {
		return null;
	}
}

export function hasFreshFirebaseProof(identity: FirebaseIdentity): boolean {
	if (identity.authTime == null) return false;
	const age = Math.floor(Date.now() / 1000) - identity.authTime;
	return age >= 0 && age <= FRESH_FIREBASE_PROOF_SECONDS;
}

// Shape of the identity block returned after register / store reads. Read-only
// fields (country_code, store_code, public_identifier, store_url) are derived,
// never client-editable.
function identityBlock(env: Env, store: Row): Record<string, unknown> {
	const pid = String(store.public_identifier);
	return {
		store_name: store.store_name,
		slug: store.slug,
		country_code: store.country_code,
		store_code: store.store_code,
		public_identifier: pid,
		store_url: storeUrl(env, pid),
	};
}

export async function handleStoreRoutes(
	request: Request,
	env: Env,
	url: URL,
	authenticatedSeller?: AuthenticatedSeller | null,
): Promise<Response | null> {
	const p = url.pathname;
	const method = request.method;

	if (method === "POST" && p === "/api/v1/auth/session") {
		return restoreFirebaseSession(request, env);
	}
	if (method === "POST" && p === "/api/v1/auth/logout") {
		return logoutSeller(request, env, url);
	}

	// ---- GET /api/v1/slug/check (no auth) ----
	if (method === "GET" && p === "/api/v1/slug/check") {
		const raw = url.searchParams.get("slug") ?? "";
		const normalized = slugify(raw);
		const valid = cleanSlug(raw) !== "";
		const reserved = RESERVED_SLUGS.has(normalized);
		const available = valid && (await slugIsFree(env, normalized));
		return jsonResponse({
			ok: true,
			slug: normalized,
			valid,
			reserved,
			available,
			suggestions: available || !normalized ? [] : await slugSuggestions(env, normalized),
		});
	}

	// ---- POST /api/v1/register ----
	if (method === "POST" && p === "/api/v1/register") {
		return handleRegister(request, env, url);
	}

	// Everything below requires an authenticated store.
		const isStoreRoute =
		p === "/api/v1/store" ||
		p === "/api/v1/account/deletion-request" ||
		p === "/api/v1/categories" ||
		p.startsWith("/api/v1/categories/") ||
		p === "/api/v1/products" ||
		p.startsWith("/api/v1/products/") ||
		p === "/api/v1/media/upload";
	if (!isStoreRoute) return null;

	const { phone, secret } = readCreds(request, url);
	const store = authenticatedSeller !== undefined ? authenticatedSeller : await authSeller(env, phone, secret, clientIpOf(request));
	if (!store) return jsonResponse({ error: "auth" }, 401);
	// Every mutating store route belongs here, and the cost of forgetting one is
	// asymmetric: a route missing from `isStoreRoute` above fails loudly, while a
	// route missing from THIS list ships silently and writes to a tenant that is
	// fenced or mid-copy instead of answering 503. The product CRUD routes are
	// enumerated explicitly for that reason, and `product-crud.spec.ts` asserts
	// the whole set rather than trusting this line to stay complete.
	const tenantMutation = method !== "GET" && (
		p === "/api/v1/store" || p === "/api/v1/categories" || p.startsWith("/api/v1/categories/")
		|| p === "/api/v1/products"
		|| p.startsWith("/api/v1/products/") || p === "/api/v1/media/upload"
	);
	if (tenantMutation) {
		try {
			requireTenantWrite(await resolveTenantContextForStore(env, String(store.id)));
		} catch (error) {
			const unavailable = tenantUnavailableResponse(error);
			if (unavailable) return unavailable;
			throw error;
		}
	}

	if (p === "/api/v1/account/deletion-request") {
		if (method !== "POST") return methodNotAllowed("GET", "POST");
		const existing = await env.orderak_db.prepare(
			"SELECT id FROM deletion_requests WHERE phone_e164=? AND status IN ('pending','verified') LIMIT 1",
		).bind(phone).first<{ id: string }>();
		const id = existing?.id || newUuid();
		if (existing) {
			await env.orderak_db.prepare(
				"UPDATE deletion_requests SET status='verified',source='android_authenticated',verified_at=datetime('now'),deadline_at=datetime('now','+90 days') WHERE id=?",
			).bind(id).run();
		} else {
			await env.orderak_db.prepare(
				`INSERT INTO deletion_requests
				 (id,phone_e164,locale,source,status,deadline_at,verified_at)
				 VALUES(?,?,?,'android_authenticated','verified',datetime('now','+90 days'),datetime('now'))`,
			).bind(id, phone, pickLocale(request, url)).run();
		}
		await auditDb(env, null, "deletion.verified", {
			entity: "deletion_request",
			entity_id: id,
			actor_type: "seller",
			actor_id: store.id,
		}, request);
		return jsonResponse({ ok: true, request_id: id, deadline_days: 90 });
	}

	// ---- /api/v1/store ----
	if (p === "/api/v1/store") {
		if (method === "GET") return jsonResponse({ ok: true, store: fullStore(env, store) });
		if (method === "PUT") return handleStoreUpdate(request, env, url, store);
		return methodNotAllowed("GET", "PUT");
	}

	// ---- /api/v1/categories ----
	if (p === "/api/v1/categories") {
		if (method === "GET") return listCategories(env, store);
		if (method === "POST") return createCategory(request, env, store);
		return methodNotAllowed("GET", "POST");
	}
	if (p.startsWith("/api/v1/categories/")) {
		const code = decodeURIComponent(p.slice("/api/v1/categories/".length));
		if (method === "PUT") return updateCategory(request, env, store, code);
		if (method === "DELETE") return deleteCategory(env, store, code);
		return methodNotAllowed("PUT", "DELETE");
	}

		// ---- GET /api/v1/products (pull) ----
	if (p === "/api/v1/products" && method === "GET") return pullProducts(env, store);
	if (p === "/api/v1/products" && method === "POST") return createProduct(request, env, store);

	// ---- /api/v1/products/{product_code}[/stock] ----
	if (p.startsWith("/api/v1/products/")) {
		const rest = decodeURIComponent(p.slice("/api/v1/products/".length));
		// Same discipline as the customers routes: a segment containing "/" is a
		// sub-resource, not a code, so the two are told apart by shape rather than
		// by a second startsWith that could match a code containing a slash.
		if (rest.endsWith("/stock")) {
			const code = rest.slice(0, -"/stock".length);
			if (!code || code.includes("/")) return jsonResponse({ error: "not_found" }, 404);
			if (method === "PATCH") return adjustProductStock(request, env, store, code);
			return methodNotAllowed("PATCH");
		}
		if (!rest || rest.includes("/")) return jsonResponse({ error: "not_found" }, 404);
		if (method === "PUT") return updateProduct(request, env, store, rest);
		if (method === "DELETE") return deleteProduct(env, store, rest);
		return methodNotAllowed("PUT", "DELETE");
	}

	// ---- POST /api/v1/media/upload ----
	if (p === "/api/v1/media/upload" && method === "POST") {
		// Storage-abuse guard: 5 MB per file with no count limit would let one
		// store fill R2. 60/hour comfortably covers a full first-sync of a large
		// catalog while capping runaway/looping clients.
		if (!(await checkRateLimit(env, `upload:${store.id}`, 60, 3600))) {
			return jsonResponse({ error: "rate_limited" }, 429);
		}
		return uploadMedia(request, env, String(store.id));
	}

	if (p === "/api/v1/products") return methodNotAllowed("GET", "POST");
	if (p === "/api/v1/media/upload") return methodNotAllowed("POST");
	// Unreachable: isStoreRoute admits no other path and each is answered above.
	// The contract guard reads these Allow lists as the method set a path serves,
	// so the last one had to be a guard rather than a trailing comment.
	return methodNotAllowed("POST");
}

// ---- Register --------------------------------------------------------------

async function handleRegister(request: Request, env: Env, url: URL): Promise<Response> {
	const body = (await request.json().catch(() => ({}))) as Row;
	const phone = String(body.phone ?? "");
	const secret = String(body.secret ?? "");
	if (!phone || !secret) return jsonResponse({ error: "auth" }, 401);
	const lang = pickLocale(request, url);

	// Independent phone and IP limits: phone is attacker-controlled pre-auth input.
	if (!(await allowPreAuthAttempt(env, request, "register", phone, 10, 100, 60))) {
		return jsonResponse({ error: "rate_limited" }, 429);
	}

	const secretHash = await hashSecret(secret);
	const storeName = String(body.store_name ?? body.shop_name ?? "متجري").slice(0, 60);
	const rawSlug = String(body.slug ?? "");
	const manualSlug = cleanSlug(rawSlug);

	const explicitIso = normalizeCountryIso(body.country_iso);
	const countryIso = explicitIso !== "XX" ? explicitIso : countryIsoFromPhone(phone);
	let firebaseIdentity: FirebaseIdentity | null = null;

	let store = (await env.orderak_db.prepare("SELECT * FROM sellers WHERE phone = ?").bind(phone).first()) as Row | null;
	if (store) {
		// Existing store: only the owner (matching device secret) may update it.
		if (!(await authSeller(env, phone, secret, clientIpOf(request)))) {
			return jsonResponse({ error: "auth" }, 401);
		}

		// The account-restriction and tenant-write fences are applied here rather
		// than inherited.
		//
		// Both live in the credential middleware, which engages only when the
		// x-orderak-phone and x-orderak-secret HEADERS are present. This route
		// reads its credentials from the body, so neither fence has ever run for
		// it — a suspended or banned seller could still rename their store,
		// change its slug and public_identifier, and change the instapay and
		// vfcash payout details the storefront shows to buyers. That is a write
		// every other credentialed route refuses from the same account.
		if (String(store.status ?? "active") !== "active") {
			return jsonResponse({ error: "account_restricted", status: store.status }, 403);
		}

		// Repair before fencing, not after, and regardless of the entitlements
		// flag. Every write that goes through resolveTenantContextForStore() needs a row
		// in organization_stores, and a seller missing one got a 500 on all of
		// them. This is the idempotent creator for exactly that row, so running
		// it here means the next register both repairs the account and then
		// enforces against the repaired state. Ordering it after the fence would
		// make the fence block the call that fixes it.
		await ensureOrganizationForStore(env, String(store.id), storeName, lang);
		try {
			requireTenantWrite(await resolveTenantContextForStore(env, String(store.id)));
		} catch (error) {
			const unavailable = tenantUnavailableResponse(error);
			if (unavailable) return unavailable;
			throw error;
		}
	} else if (!env.FIREBASE_WEB_API_KEY) {
		// Creating a NEW store claims a phone number as public identity, which
		// requires a verified Firebase OTP token. Without the key we FAIL CLOSED:
		// a misconfigured production deploy must never let anyone claim any phone
		// number. Local dev / tests opt in explicitly via
		// ALLOW_UNVERIFIED_REGISTRATION="true" (never set in production).
		if (env.ALLOW_UNVERIFIED_REGISTRATION !== "true") {
			return jsonResponse({ error: "firebase_not_configured" }, 503);
		}
	} else {
		// Require a verified Firebase OTP token for the phone so nobody can
		// claim another person's number.
		const idToken = String(body.id_token ?? "");
		firebaseIdentity = await verifyFirebasePhone(env, idToken, phone);
		if (!firebaseIdentity) {
			return jsonResponse({ error: "auth" }, 401);
		}
		if (!hasFreshFirebaseProof(firebaseIdentity)) {
			return jsonResponse({ error: "auth_stale" }, 401);
		}
		// A verified phone alone is not permission to create an account. The
		// auth/session step records the exact published terms/privacy versions
		// accepted by this phone before registration is allowed.
		//
		// Matched against the versions that are published *now*, not merely
		// against the existence of a row. The check was `WHERE phone_e164=?
		// LIMIT 1`, so any acceptance of any version at any time in the past
		// satisfied it — which is the opposite of what the comment above claims
		// and what consent evidence is for. Someone who accepted v1 two years ago
		// could create an account under v3 without ever being shown it, and the
		// legal_acceptances row would record a version they had not agreed to
		// under the terms then in force.
		const locale = pickLocale(request, url);
		const [currentTerms, currentPrivacy] = await Promise.all([
			currentLegalVersion(env, "terms", locale),
			currentLegalVersion(env, "privacy", locale),
		]);
		if (!currentTerms || !currentPrivacy) {
			return jsonResponse({ error: "legal_not_configured" }, 503);
		}
		const acceptance = await env.orderak_db
			.prepare(
				`SELECT 1 AS accepted FROM legal_acceptances
				 WHERE phone_e164=? AND terms_version>=? AND privacy_version>=? LIMIT 1`,
			)
			.bind(phone, Number(currentTerms.version), Number(currentPrivacy.version))
			.first();
		if (!acceptance) {
			return jsonResponse({
				error: "legal_acceptance_required",
				terms_version: Number(currentTerms.version),
				privacy_version: Number(currentPrivacy.version),
			}, 400);
		}
	}

	const baseSlug =
		manualSlug || slugify(storeName) || `${countryIso.toLowerCase()}-store-${Math.random().toString(36).slice(2, 10)}`;

	if (!store) {
		// New store.
		if (manualSlug && !(await slugIsFree(env, manualSlug))) {
			return jsonResponse(
				{ error: "slug_taken", message: t(lang, "slug.taken"), suggestions: await slugSuggestions(env, manualSlug) },
				409,
			);
		}
		let slug = await uniqueSlug(env, baseSlug);
		const storeCode = await uniqueStoreCode(env);
		for (let attempt = 0; attempt < 2; attempt++) {
			const publicId = buildPublicIdentifier(countryIso, slug, storeCode);
			const id = newUuid();
			const organizationId = newUuid();
			const memberId = newUuid();
			try {
				const sellerInsert = env.orderak_db.prepare(
							`INSERT INTO sellers (id, phone, firebase_uid, store_name, slug, instapay, vfcash, secret,
							   store_code, country_code, public_identifier)
							 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
						)
					.bind(
						id,
							phone,
							firebaseIdentity?.uid ?? null,
							storeName,
						slug,
						body.instapay ?? null,
						body.vfcash ?? null,
						secretHash,
						storeCode,
						countryIso,
						publicId,
					);
				const foundation = await newAccountFoundationStatements(env, {
					sellerId: id,
					organizationId,
					memberId,
					phone,
					firebaseUid: firebaseIdentity?.uid ?? null,
					storeName,
					locale: lang,
				});
				await env.orderak_db.batch([
					sellerInsert,
					...foundation,
					env.orderak_db.prepare(
						"UPDATE legal_acceptances SET seller_id=? WHERE phone_e164=? AND seller_id IS NULL",
					).bind(id, phone),
				]);
				store = { id, store_name: storeName, slug, store_code: storeCode, country_code: countryIso, public_identifier: publicId };
				break;
			} catch {
				slug = await uniqueSlug(env, baseSlug);
				if (attempt === 1) return jsonResponse({ error: "slug_taken", message: t(lang, "slug.taken") }, 409);
			}
		}
		return jsonResponse({ ok: true, ...identityBlock(env, store!) });
	}

	// Existing store re-registering. store_code is PERMANENT; country updates
	// only if the client sends an explicit valid one.
	let newSlug = String(store.slug ?? "");
	if (manualSlug && manualSlug !== store.slug) {
		if (!(await slugIsFree(env, manualSlug, String(store.id)))) {
			return jsonResponse(
				{ error: "slug_taken", message: t(lang, "slug.taken"), suggestions: await slugSuggestions(env, manualSlug) },
				409,
			);
		}
		newSlug = manualSlug;
	} else if (!newSlug) {
		newSlug = await uniqueSlug(env, baseSlug, String(store.id));
	}

	const storeCode = String(store.store_code ?? "") || (await uniqueStoreCode(env));
	const countryCode = explicitIso !== "XX" ? explicitIso : String(store.country_code ?? "") || countryIso;
	const publicId = buildPublicIdentifier(countryCode, newSlug, storeCode);

	// `secret` is deliberately NOT in this UPDATE.
	//
	// It used to be, bound to whatever secret the caller presented — and the
	// caller here is any authorized device, not necessarily the one whose hash
	// `sellers.secret` currently holds. authSeller() accepts a `seller_devices`
	// row just as readily, so a second phone re-registering overwrote the first
	// phone's credential with its own.
	//
	// That is not a hypothetical ordering: SyncRepository re-registers whenever
	// its shop-config key changes, and that key lives in a process-scoped field,
	// so the first sync after any cold start on any device lands here. The
	// sequence was: device B signs in, provisionDeviceSecret() correctly files
	// secret_B in seller_devices, device B syncs, and this statement moved
	// secret_B into sellers.secret — leaving secret_A stored nowhere. Device A
	// was signed out with no event, no error and nothing to explain it, and
	// device B then authenticated through two rows, so it also counted twice
	// against max_concurrent_devices.
	//
	// Nothing is lost by dropping it. A caller only reaches this line after
	// authSeller() succeeded, so their credential already exists and rewriting
	// it is a no-op for the primary device and destructive for every other one.
	// Provisioning a credential is provisionDeviceSecret()'s job — the single
	// sink the plan caps and the single-device recovery rule are enforced in —
	// and the pbkdf2/plaintext upgrade this write used to double as is already
	// handled by verifySeller() on each successful authentication.
	try {
		await env.orderak_db
			.prepare(
				`UPDATE sellers SET store_name = ?, instapay = ?, vfcash = ?, slug = ?,
				   store_code = ?, country_code = ?, public_identifier = ?, updated_at = datetime('now')
				 WHERE id = ?`,
			)
			.bind(
				storeName,
				body.instapay ?? store.instapay,
				body.vfcash ?? store.vfcash,
				newSlug,
				storeCode,
				countryCode,
				publicId,
				store.id,
			)
			.run();
	} catch (error) {
		// Only a uniqueness collision is slug_taken.
		//
		// This caught everything and answered 409 "that slug is in use" to all of
		// it, so a disk error, a constraint on another column or a malformed bind
		// all told the seller to pick a different name — and nothing was logged,
		// because the handler had already produced a tidy answer. The seller then
		// picks a different name and gets the same 409, with no way to tell that
		// the name was never the problem.
		const message = String((error as { message?: string })?.message ?? error);
		if (!/UNIQUE constraint failed/i.test(message)) {
			await logError(env, "store_update_failed", error);
			return jsonResponse({ error: "store_update_failed" }, 500);
		}
		return jsonResponse({ error: "slug_taken", message: t(lang, "slug.taken") }, 409);
	}

	if (firebaseIdentity) await syncVerifiedFirebaseIdentity(env, String(store.id), firebaseIdentity.uid, phone);
	return jsonResponse({
		ok: true,
		...identityBlock(env, { store_name: storeName, slug: newSlug, store_code: storeCode, country_code: countryCode, public_identifier: publicId }),
	});
}

// ---- Store Information ------------------------------------------------------

// Full Store Information object (editable fields + read-only identity block).
export function fullStore(env: Env, store: Row): Record<string, unknown> {
	return {
		...identityBlock(env, store),
		description: store.description ?? "",
		phone: store.phone ?? "",
		whatsapp: store.whatsapp ?? "",
		email: store.email ?? "",
		website: store.website ?? "",
		address: store.address ?? "",
		instapay: store.instapay ?? "",
		vfcash: store.vfcash ?? "",
		logo_url: store.logo_url ?? "",
		cover_url: store.cover_url ?? "",
		business_category: store.business_category ?? "",
		business_category_id: store.business_category_id ?? null,
		business_subcategory_id: store.business_subcategory_id ?? null,
		business_taxonomy_version: store.business_taxonomy_version ?? null,
		city_geoname_id: store.city_geoname_id ?? null,
		city_catalog_id: store.city_catalog_id ?? null,
		city_catalog_version: store.city_catalog_version ?? null,
		city_name: store.city_name ?? "",
	};
}

async function handleStoreUpdate(request: Request, env: Env, url: URL, store: Row): Promise<Response> {
	const body = (await request.json().catch(() => ({}))) as Row;
	const lang = pickLocale(request, url);
	const storeId = String(store.id);

	// Store name (regenerates slug + public_identifier unless a manual slug is given).
	const storeName =
		body.store_name != null ? String(body.store_name).slice(0, 60) : String(store.store_name ?? "");

	// Slug: explicit manual pick wins; else derive from the (possibly new) name.
	let slug = String(store.slug ?? "");
	const nameChanged = storeName !== String(store.store_name ?? "");
	if (body.slug != null && String(body.slug).trim() !== "") {
		const manual = cleanSlug(String(body.slug));
		if (!manual) return jsonResponse({ error: "slug_invalid", message: t(lang, "slug.invalid") }, 400);
		if (manual !== store.slug && !(await slugIsFree(env, manual, storeId))) {
			return jsonResponse({ error: "slug_taken", message: t(lang, "slug.taken"), suggestions: await slugSuggestions(env, manual) }, 409);
		}
		slug = manual;
	} else if (nameChanged || !slug) {
		slug = await uniqueSlug(env, slugify(storeName) || slug, storeId);
	}

	// store_code + country are immutable here; public_identifier tracks the slug.
	const countryCode = String(store.country_code ?? "EG");
	const storeCode = String(store.store_code);
	const publicId = buildPublicIdentifier(countryCode, slug, storeCode);

	// Optional contact/media fields (undefined = keep current).
	const pick = (k: string) => (body[k] != null ? String(body[k]).slice(0, 300) : store[k] ?? null);

	// URL-bearing fields are validated when (and only when) they change:
	// http(s) only; scheme-less input gets https:// prefixed. This blocks
	// stored javascript:/data: URLs at the source — the catalog renderer
	// (catalog.ts safeHttpUrl) also guards at output for legacy rows.
	const urls: Record<string, string | null> = {};
	for (const k of ["website", "logo_url", "cover_url"] as const) {
		if (body[k] == null) {
			urls[k] = (store[k] as string | null) ?? null;
			continue;
		}
		const raw = String(body[k]).trim().slice(0, 300);
		if (!raw) { urls[k] = null; continue; }
		if (/^https?:\/\//i.test(raw)) { urls[k] = raw; continue; }
		if (/^[a-z][a-z0-9+.-]*:/i.test(raw)) {
			return jsonResponse({ error: "invalid_url", field: k }, 400);
		}
		urls[k] = "https://" + raw;
	}

	// Phone is the OTP-verified login identity, not an editable store-profile
	// field. A future phone migration must be a dedicated re-verification flow
	// that updates Firebase, D1, authorized devices, and the Android session
	// atomically. General profile updates fail closed instead of locking users out.
	const phone = String(store.phone);
	if (body.phone != null && String(body.phone) !== phone) {
		return jsonResponse({ error: "phone_change_requires_reverification" }, 409);
	}

	let businessCategory = store.business_category ?? null;
	let businessCategoryId = store.business_category_id ?? null;
	let businessSubcategoryId = store.business_subcategory_id ?? null;
	let businessTaxonomyVersion = store.business_taxonomy_version ?? null;
	if (body.business_category_id != null || body.business_subcategory_id != null) {
		const requestedCategoryId = String(body.business_category_id ?? "").trim().slice(0, 80);
		const requestedSubcategoryId = String(body.business_subcategory_id ?? "").trim().slice(0, 80);
		if (!requestedCategoryId || !requestedSubcategoryId) {
			return jsonResponse({ error: "invalid_business_category" }, 400);
		}
		const taxonomy = await env.orderak_db.prepare(
			`SELECT c.id category_id,c.key category_key,s.id subcategory_id,c.version_id
			 FROM business_categories c
			 JOIN business_subcategories s
			   ON s.category_id=c.id AND s.version_id=c.version_id
			 JOIN business_taxonomy_versions v
			   ON v.id=c.version_id AND v.status='active'
			 WHERE c.id=? AND s.id=? AND c.active=1 AND s.active=1 LIMIT 1`,
		).bind(requestedCategoryId, requestedSubcategoryId).first<{
			category_id: string;
			category_key: string;
			subcategory_id: string;
			version_id: number;
		}>();
		if (!taxonomy) return jsonResponse({ error: "invalid_business_category" }, 400);
		businessCategory = taxonomy.category_key;
		businessCategoryId = taxonomy.category_id;
		businessSubcategoryId = taxonomy.subcategory_id;
		businessTaxonomyVersion = taxonomy.version_id;
	}

	await env.orderak_db
		.prepare(
			`UPDATE sellers SET store_name = ?, slug = ?, public_identifier = ?, phone = ?,
			   description = ?, whatsapp = ?, email = ?, website = ?, address = ?,
			   instapay = ?, vfcash = ?, logo_url = ?, cover_url = ?,
			   business_category = ?, business_category_id = ?,
			   business_subcategory_id = ?, business_taxonomy_version = ?,
			   updated_at = datetime('now')
			 WHERE id = ?`,
		)
		.bind(
			storeName,
			slug,
			publicId,
			phone,
			pick("description"),
			pick("whatsapp"),
			pick("email"),
			urls.website,
			pick("address"),
			pick("instapay"),
			pick("vfcash"),
			urls.logo_url,
			urls.cover_url,
			businessCategory,
			businessCategoryId,
			businessSubcategoryId,
			businessTaxonomyVersion,
			storeId,
		)
		.run();

	const updated = (await env.orderak_db.prepare("SELECT * FROM sellers WHERE id = ?").bind(storeId).first()) as Row;
	return jsonResponse({ ok: true, store: fullStore(env, updated) });
}

// ---- Categories ------------------------------------------------------------

async function listCategories(env: Env, store: Row): Promise<Response> {
	const { results } = (await env.orderak_db
		.prepare(
			`SELECT c.category_code, c.name, c.slug, c.sort_order,
			        (SELECT COUNT(*) FROM products p WHERE p.category_id = c.id) AS product_count
			 FROM categories c WHERE c.store_id = ? ORDER BY c.sort_order, c.name`,
		)
		.bind(store.id)
		.all()) as { results: Row[] };
	return jsonResponse({ ok: true, categories: results ?? [] });
}

async function createCategory(request: Request, env: Env, store: Row): Promise<Response> {
	const limit = await getPlanLimit(env, String(store.id), "max_categories");
	const body = (await request.json().catch(() => ({}))) as Row;
	const name = String(body.name ?? "").trim().slice(0, 60);
	if (!name) return jsonResponse({ error: "name_required" }, 400);
	const slug = body.slug != null ? slugify(String(body.slug)) : slugify(name);
	const sortOrder = Math.max(0, Math.floor(Number(body.sort_order) || 0));
	const id = newUuid();
	const code = await uniqueResourceCode(env, "c");
	// `c.store_id = ?` is not redundant with the organization lookup beside it.
	//
	// A store with no `organization_stores` row makes the inner scalar subquery
	// NULL, so `organization_id = NULL` matches nothing, the IN list is empty,
	// the COUNT is 0, and the limit was not enforced at all — the one case where
	// a seller could add categories without bound. An organization always
	// contains its own store, so naming it explicitly changes nothing when the
	// row exists and restores the floor when it does not.
	const insert = (candidateSlug: string | null) => env.ENTITLEMENTS_ENABLED === "true"
		? env.orderak_db.prepare(
			`INSERT INTO categories (id, store_id, category_code, name, slug, sort_order)
			 SELECT ?,?,?,?,?,? WHERE ? IS NULL OR (
			   SELECT COUNT(*) FROM categories c
			   WHERE c.store_id = ? OR c.store_id IN (SELECT store_id FROM organization_stores WHERE organization_id=(
			     SELECT organization_id FROM organization_stores WHERE store_id=?
			   ))
			 ) < ?`,
		).bind(id, store.id, code, name, candidateSlug, sortOrder, limit, store.id, store.id, limit)
		: env.orderak_db.prepare(
			`INSERT INTO categories (id, store_id, category_code, name, slug, sort_order)
			 SELECT ?,?,?,?,?,? WHERE ? IS NULL OR (SELECT COUNT(*) FROM categories WHERE store_id=?) < ?`,
		).bind(id, store.id, code, name, candidateSlug, sortOrder, limit, store.id, limit);
	let inserted: D1Result<unknown>;
	try {
		inserted = await insert(slug || null).run();
	} catch {
		// slug collision within the store — retry once with a suffixed slug.
		inserted = await insert(`${slug || "cat"}-${code.slice(2).toLowerCase()}`).run();
	}
	if (!inserted.meta.changes) return limitReached("max_categories", Number(limit ?? 0), Number(limit ?? 0));
	return jsonResponse({ ok: true, category: { category_code: code, name, slug: slug || null, sort_order: sortOrder } }, 201);
}

async function updateCategory(request: Request, env: Env, store: Row, code: string): Promise<Response> {
	const body = (await request.json().catch(() => ({}))) as Row;
	const existing = (await env.orderak_db
		.prepare("SELECT id, name, slug, sort_order FROM categories WHERE store_id = ? AND category_code = ?")
		.bind(store.id, code)
		.first()) as Row | null;
	if (!existing) return jsonResponse({ error: "not_found" }, 404);

	const name = body.name != null ? String(body.name).trim().slice(0, 60) || String(existing.name) : String(existing.name);
	const slug = body.slug != null ? slugify(String(body.slug)) || null : (existing.slug as string | null);
	const sortOrder = body.sort_order != null ? Math.max(0, Math.floor(Number(body.sort_order) || 0)) : Number(existing.sort_order);

	// idx_categories_store_slug is UNIQUE on (store_id, slug), so renaming a
	// category onto a slug a sibling already holds violates it. createCategory
	// handles that by retrying with a suffix; this ran the UPDATE bare, so the
	// constraint surfaced as an unhandled exception and a 500 — a client error
	// reported as a server one, with no indication of which name to pick instead.
	//
	// A duplicate is answered rather than auto-suffixed: a rename is a deliberate
	// act by the seller, and silently storing something other than what they
	// typed is worse than telling them the name is taken.
	if (slug !== null && slug !== existing.slug) {
		const taken = await env.orderak_db
			.prepare("SELECT category_code FROM categories WHERE store_id = ? AND slug = ? AND id <> ?")
			.bind(store.id, slug, existing.id)
			.first<{ category_code: string }>();
		if (taken) {
			return jsonResponse({ error: "slug_taken", slug, conflicting_category_code: taken.category_code }, 409);
		}
	}

	try {
		await env.orderak_db
			.prepare("UPDATE categories SET name = ?, slug = ?, sort_order = ?, updated_at = datetime('now') WHERE id = ?")
			.bind(name, slug, sortOrder, existing.id)
			.run();
	} catch (error) {
		// The check above races a concurrent rename; the index is the authority.
		if (String((error as { message?: string })?.message ?? "").includes("UNIQUE")) {
			return jsonResponse({ error: "slug_taken", slug }, 409);
		}
		throw error;
	}
	return jsonResponse({ ok: true, category: { category_code: code, name, slug, sort_order: sortOrder } });
}

async function deleteCategory(env: Env, store: Row, code: string): Promise<Response> {
	const existing = (await env.orderak_db
		.prepare("SELECT id FROM categories WHERE store_id = ? AND category_code = ?")
		.bind(store.id, code)
		.first()) as Row | null;
	if (!existing) return jsonResponse({ error: "not_found" }, 404);
	await env.orderak_db.batch([
		env.orderak_db.prepare("UPDATE products SET category_id = NULL WHERE category_id = ?").bind(existing.id),
		env.orderak_db.prepare("DELETE FROM categories WHERE id = ?").bind(existing.id),
	]);
	return jsonResponse({ ok: true });
}

// ---- Product pull (non-destructive read) -----------------------------------

/**
 * The store's catalogue-metadata revision, bumped by create, update and delete
 * but never by a stock movement.
 *
 * It used to be the baseline a device had to hold before the mirror would let
 * it overwrite or delete anything (migrations/050_catalog_baseline_version.sql
 * still describes that world). The mirror is gone and so is that meaning: no
 * write is gated on this number any more, and the endpoint that was has no
 * successor.
 *
 * What it is for now is cache freshness and observability. A client may use it
 * to decide WHEN to refresh; it must never use it to decide WHAT is true —
 * the refresh path is unconditionally `GET /products` -> replace the cache.
 * See docs/contracts/sync-conflict-contract.md.
 */
async function catalogVersion(env: Env, storeId: string): Promise<number> {
	const row = await env.orderak_db
		.prepare("SELECT catalog_version FROM sellers WHERE id = ?")
		.bind(storeId)
		.first<{ catalog_version: number }>();
	return Number(row?.catalog_version ?? 0);
}

async function pullProducts(env: Env, store: Row): Promise<Response> {
	// The catalogue and the version that describes it are read together, and the
	// version is read FIRST. Reading it afterwards could hand back a number that
	// already covers a write this response does not contain, which would let the
	// device believe it is current when it is one edit behind — the exact state
	// the baseline exists to prevent.
	const version = await catalogVersion(env, String(store.id));
	const { results } = (await env.orderak_db
		.prepare(
			`SELECT p.id, p.app_id, p.product_code, p.name, p.slug, p.description,
			        p.price_minor, p.currency, p.stock, p.stock_version, p.available, p.image_url,
			        p.discount_type, p.discount_value, c.category_code
			 FROM products p
			 LEFT JOIN categories c ON c.id = p.category_id
			 WHERE p.store_id = ?
			 ORDER BY p.created_at DESC`,
		)
		.bind(store.id)
		.all()) as { results: Row[] };
	return jsonResponse({
		ok: true,
		catalog_version: version,
		// One shape for every product this API returns, so a pull and a write
		// cannot drift into describing the same row differently. `remote_uuid` is
		// the identity the mirror sends back on a push; `product_code` is the
		// public, shareable one and the only identity the CRUD routes use.
		// Money travels as an object so the client can render it (ADR-009).
		products: (results ?? []).map(productResponseRow),
	});
}

// ---- Product CRUD ----------------------------------------------------------
//
// One product per request, addressed by its public code. This is the surface
// that replaces the catalogue mirror below, and the difference that matters is
// not the verb count: the mirror asserts the complete set of products by
// omission, so a device that has forgotten something deletes it. These say what
// they mean, so a device that has forgotten something says nothing.
//
// Everything here deliberately re-states rules the mirror also implements rather
// than sharing them. The duplication is temporary and dies with the mirror; the
// alternative was extracting shared helpers out of a 470-line function that
// every shipped app still depends on, which is a refactor of the thing being
// removed and buys nothing.

/** A discount as the wire carries it, or a 400 explaining why it does not. */
type DiscountInput = { type: string | null; value: number | null };

/**
 * Read and check a product's discount pair.
 *
 * The pair is only meaningful together, and `discount_value` means different
 * things depending on `discount_type` — basis points for PERCENTAGE, minor units
 * for AMOUNT. Migration 057 states that contract and enforces it with triggers;
 * this rejects the same shapes earlier so the caller gets a named error instead
 * of a constraint failure.
 *
 * Absent is not the same as null. `undefined` leaves the existing value alone on
 * a PUT; an explicit null clears it. Both halves must move together either way.
 */
function readDiscount(raw: Row): DiscountInput | Response {
	const hasType = "discount_type" in raw;
	const hasValue = "discount_value" in raw;
	if (!hasType && !hasValue) return { type: null, value: null };

	const type = raw.discount_type == null ? null : String(raw.discount_type).toUpperCase();
	const value = raw.discount_value == null ? null : Math.floor(Number(raw.discount_value));

	if ((type === null) !== (value === null)) {
		return jsonResponse({
			error: "discount_incomplete",
			message: "discount_type and discount_value must be set together or both omitted.",
		}, 400);
	}
	if (type === null) return { type: null, value: null };
	if (type !== "PERCENTAGE" && type !== "AMOUNT") {
		return jsonResponse({ error: "discount_type_unknown", discount_type: type, allowed: ["PERCENTAGE", "AMOUNT"] }, 400);
	}
	if (!Number.isSafeInteger(value) || (value as number) < 0) {
		return jsonResponse({
			error: "discount_value_invalid",
			message: "discount_value is an integer: basis points for PERCENTAGE (1000 = 10.00%), minor units for AMOUNT.",
		}, 400);
	}
	if (type === "PERCENTAGE" && (value as number) > 10000) {
		return jsonResponse({
			error: "discount_value_invalid",
			message: "A PERCENTAGE discount cannot exceed 10000 basis points (100.00%).",
		}, 400);
	}
	return { type, value };
}

/**
 * Whether this store may hold one more product, under the plan it is on.
 *
 * The mirror's copy of this rule computes headroom for a whole submitted list;
 * this one answers for a single write, which is the same rule with `delta` of 1
 * on create and 0 on update. Both branches — entitlements and legacy plan limits
 * — are preserved, and so is the property that matters most:
 *
 *   Downgrades block growth, never maintenance.
 *
 * A seller already over a reduced limit may still edit and delete what they
 * have. Only `delta > 0` can be refused, which is why every caller that is not
 * creating passes 0 and always passes.
 */
async function productHeadroom(env: Env, store: Row, delta: number): Promise<Response | null> {
	const limit = await getPlanLimit(env, String(store.id), "max_products");
	if (limit === null || delta <= 0) return null;

	if (env.ENTITLEMENTS_ENABLED === "true") {
		const usage = await env.orderak_db.prepare(
			`SELECT COUNT(p.id) AS organization_count
			 FROM organization_stores os
			 LEFT JOIN products p ON p.store_id=os.store_id
			 WHERE os.organization_id=(SELECT organization_id FROM organization_stores WHERE store_id=?)`,
		).bind(store.id).first<{ organization_count: number }>();
		const currentUsage = Number(usage?.organization_count ?? 0);
		if (currentUsage + delta > limit) {
			return entitlementLimitReached(await resolveEntitlements(env, String(store.id)), "max_products");
		}
		return null;
	}

	const usage = await env.orderak_db.prepare("SELECT COUNT(*) AS c FROM products WHERE store_id=?")
		.bind(store.id).first<{ c: number }>();
	const currentUsage = Number(usage?.c ?? 0);
	if (currentUsage + delta > limit) return limitReached("max_products", limit, currentUsage);
	return null;
}

/** The product's metadata as a write supplies it, or a 400 naming what is wrong. */
type ProductFields = {
	name: string; slug: string | null; description: string | null;
	price: number; currency: string; available: number; imageUrl: string | null;
	categoryCode: string | null; categoryId: string | null;
	discount: DiscountInput;
};

async function readProductFields(env: Env, storeId: string, raw: Row): Promise<ProductFields | Response> {
	const name = String(raw.name ?? "").trim().slice(0, 80);
	if (!name) return jsonResponse({ error: "name_required" }, 400);

	// A malformed price is refused, not read as zero.
	//
	// The mirror reads `price_minor: 500` — the pre-ADR-009 shape — as a missing
	// price object and stores 0. money-wire.spec.ts documents that rather than
	// asserting it is right, and says so: "When request validation lands
	// (ADR-010) this should become a 400 instead." These routes are that
	// validation, and no shipped client calls them, so there is no compatibility
	// argument for carrying the behaviour across. A product silently priced at
	// nothing is the most expensive kind of quiet wrong answer there is.
	const rawPrice = (raw.price ?? {}) as { amount_minor?: unknown; currency?: unknown };
	if (raw.price == null || typeof raw.price !== "object" || Array.isArray(raw.price)) {
		return jsonResponse({
			error: "price_required",
			message: "price is an object: { amount_minor, currency }. A bare number is not accepted.",
		}, 400);
	}
	const amountMinor = Number(rawPrice.amount_minor);
	if (!Number.isFinite(amountMinor) || amountMinor < 0) {
		return jsonResponse({
			error: "price_invalid",
			message: "price.amount_minor is a non-negative integer in minor units.",
		}, 400);
	}
	const price = Math.floor(amountMinor);
	// Rejected rather than defaulted, for the reason the mirror states: defaulting
	// is how 15000 fils becomes 150.00 EGP — plausible, wrong by a factor of ten,
	// and undetectable afterwards because nothing recorded what was meant.
	const currency = rawPrice.currency == null ? DEFAULT_CURRENCY : String(rawPrice.currency).toUpperCase();
	if (!(ENABLED_CURRENCIES as readonly string[]).includes(currency)) {
		return jsonResponse({ error: "currency_not_enabled", currency, enabled: [...ENABLED_CURRENCIES] }, 400);
	}

	const discount = readDiscount(raw);
	if (discount instanceof Response) return discount;

	// An unknown category is refused, not silently nulled.
	//
	// The catalogue mirror this replaced filed such a product under no category
	// instead, which was defensible for a batch where one bad code should not
	// reject the other 200. A single deliberate write is different: the seller
	// named a category, and filing the product under none is a quiet wrong answer
	// to a question they asked. Refusing is also the stronger tenant boundary —
	// another store's code fails loudly rather than being ignored.
	const categoryCode = raw.category_code == null ? null : String(raw.category_code);
	let categoryId: string | null = null;
	if (categoryCode) {
		const row = await env.orderak_db
			.prepare("SELECT id FROM categories WHERE store_id=? AND category_code=?")
			.bind(storeId, categoryCode).first<{ id: string }>();
		if (!row) return jsonResponse({ error: "unknown_category_code", category_code: categoryCode }, 400);
		categoryId = String(row.id);
	}

	return {
		name,
		slug: slugify(name) || null,
		description: raw.description != null ? String(raw.description).slice(0, 500) : null,
		price,
		currency,
		available: raw.available === false ? 0 : 1,
		imageUrl: raw.image_url != null ? String(raw.image_url).slice(0, 500) : null,
		categoryCode,
		categoryId,
		discount,
	};
}

/** One product in the shape `GET /api/v1/products` already returns. */
function productResponseRow(r: Row): Record<string, unknown> {
	return {
		app_id: Number(r.app_id),
		remote_uuid: String(r.id),
		product_code: String(r.product_code),
		name: r.name,
		slug: r.slug ?? null,
		description: r.description ?? null,
		price: { amount_minor: Number(r.price_minor), currency: String(r.currency || DEFAULT_CURRENCY) },
		stock: Number(r.stock),
		stock_version: Number(r.stock_version ?? 0),
		available: r.available === 1,
		image_url: r.image_url ?? null,
		category_code: r.category_code ?? null,
		discount_type: r.discount_type ?? null,
		discount_value: r.discount_value == null ? null : Number(r.discount_value),
	};
}

const PRODUCT_SELECT = `SELECT p.id, p.app_id, p.product_code, p.name, p.slug, p.description,
	        p.price_minor, p.currency, p.stock, p.stock_version, p.available, p.image_url,
	        p.discount_type, p.discount_value, c.category_code
	 FROM products p LEFT JOIN categories c ON c.id = p.category_id
	 WHERE p.store_id = ? AND p.product_code = ?`;

async function productByCode(env: Env, storeId: string, code: string): Promise<Row | null> {
	return (await env.orderak_db.prepare(PRODUCT_SELECT).bind(storeId, code).first()) as Row | null;
}

/**
 * Create one product.
 *
 * Idempotent under retry when the caller supplies `client_request_id`: the same
 * store and the same id resolve to the product already created rather than a
 * second one. See migration 058 for why this endpoint is the only one that needs
 * it, and why the reconciliation that ships with the new client depends on it.
 */
async function createProduct(request: Request, env: Env, store: Row): Promise<Response> {
	let body: Row;
	try { body = (await request.json()) as Row; } catch { return jsonResponse({ error: "invalid_json" }, 400); }

	const storeId = String(store.id);
	const clientRequestId = body.client_request_id == null ? null : String(body.client_request_id).slice(0, 100) || null;

	// Answered before anything is written, and again on a UNIQUE collision below:
	// this read closes the ordinary retry, the collision closes the race.
	if (clientRequestId) {
		const existing = (await env.orderak_db
			.prepare(`${PRODUCT_SELECT.replace("p.product_code = ?", "p.client_request_id = ?")}`)
			.bind(storeId, clientRequestId).first()) as Row | null;
		if (existing) return jsonResponse({ ok: true, product: productResponseRow(existing), replayed: true });
	}

	const overLimit = await productHeadroom(env, store, 1);
	if (overLimit) return overLimit;

	const fields = await readProductFields(env, storeId, body);
	if (fields instanceof Response) return fields;

	const id = newUuid();
	const productCode = await uniqueResourceCode(env, "p");

	// app_id is legacy compatibility, never identity.
	//
	// It exists so an app built against the mirror can still read `pullProducts`.
	// Computing it as a separate SELECT and then binding the result would leave a
	// read/write gap two concurrent creates could both pass through; the subquery
	// closes that gap by evaluating inside the statement that consumes it. The
	// UNIQUE(store_id, app_id) constraint remains the correctness backstop, and
	// the retry below is what answers it — not a general retry on any UNIQUE,
	// which would paper over a product_code collision meaning something else.
	const insert = () => env.orderak_db.prepare(
		`INSERT INTO products (id, store_id, category_id, product_code, app_id, name, slug, description,
		   price_minor, currency, stock, available, image_url, discount_type, discount_value, client_request_id)
		 VALUES (?, ?, ?, ?, (SELECT COALESCE(MAX(app_id),0)+1 FROM products WHERE store_id=?), ?, ?, ?,
		   ?, ?, ?, ?, ?, ?, ?, ?)`,
	).bind(
		id, storeId, fields.categoryId, productCode, storeId, fields.name, fields.slug, fields.description,
		fields.price, fields.currency, 0, fields.available, fields.imageUrl,
		fields.discount.type, fields.discount.value, clientRequestId,
	);

	const bump = env.orderak_db
		.prepare("UPDATE sellers SET catalog_version = catalog_version + 1, updated_at = datetime('now') WHERE id = ?")
		.bind(storeId);

	try {
		await env.orderak_db.batch([insert(), bump]);
	} catch (error) {
		const message = String((error as Error)?.message ?? "");
		if (message.includes("products_store_client_request_id")) {
			// Two retries of the same create raced. The winner's row is the answer.
			const existing = (await env.orderak_db
				.prepare(`${PRODUCT_SELECT.replace("p.product_code = ?", "p.client_request_id = ?")}`)
				.bind(storeId, clientRequestId).first()) as Row | null;
			if (existing) return jsonResponse({ ok: true, product: productResponseRow(existing), replayed: true });
		}
		if (message.includes("app_id")) {
			try {
				await env.orderak_db.batch([insert(), bump]);
			} catch {
				return jsonResponse({ error: "internal_conflict", message: "Could not assign a product number." }, 500);
			}
		} else if (message.includes("invalid_discount")) {
			return jsonResponse({ error: "discount_value_invalid" }, 400);
		} else {
			throw error;
		}
	}

	await refreshProductTranslations(env, storeId);
	const created = await productByCode(env, storeId, productCode);
	return jsonResponse({ ok: true, product: created ? productResponseRow(created) : null }, 201);
}

/**
 * Replace one product's metadata.
 *
 * A full replacement, not a partial update wearing a PUT: a field the caller
 * omits is cleared, because a seller who removes a description means it to go.
 *
 * `stock` and `stock_version` are never written here. That is the same rule the
 * mirror's upsert keeps by omitting stock from its DO UPDATE list, and for the
 * same reason: an existing product's stock moves through a buyer's order or
 * through the compare-and-set below, never through a metadata write that happens
 * to carry a number.
 */
async function updateProduct(request: Request, env: Env, store: Row, code: string): Promise<Response> {
	let body: Row;
	try { body = (await request.json()) as Row; } catch { return jsonResponse({ error: "invalid_json" }, 400); }

	const storeId = String(store.id);
	const existing = await productByCode(env, storeId, code);
	if (!existing) return jsonResponse({ error: "not_found" }, 404);

	const fields = await readProductFields(env, storeId, body);
	if (fields instanceof Response) return fields;

	// delta 0: an edit never grows the catalogue, so a seller over a reduced limit
	// can still maintain what they have.
	const overLimit = await productHeadroom(env, store, 0);
	if (overLimit) return overLimit;

	try {
		await env.orderak_db.batch([
			env.orderak_db.prepare(
				`UPDATE products SET category_id=?, name=?, slug=?, description=?, price_minor=?, currency=?,
				   available=?, image_url=?, discount_type=?, discount_value=?, updated_at=datetime('now')
				 WHERE store_id=? AND product_code=?`,
			).bind(
				fields.categoryId, fields.name, fields.slug, fields.description, fields.price, fields.currency,
				fields.available, fields.imageUrl, fields.discount.type, fields.discount.value, storeId, code,
			),
			env.orderak_db
				.prepare("UPDATE sellers SET catalog_version = catalog_version + 1, updated_at = datetime('now') WHERE id = ?")
				.bind(storeId),
		]);
	} catch (error) {
		if (String((error as Error)?.message ?? "").includes("invalid_discount")) {
			return jsonResponse({ error: "discount_value_invalid" }, 400);
		}
		throw error;
	}

	await refreshProductTranslations(env, storeId);
	const updated = await productByCode(env, storeId, code);
	return jsonResponse({ ok: true, product: updated ? productResponseRow(updated) : null });
}

/**
 * Adjust one product's stock, and refuse a stale revision.
 *
 * `expected_stock_version` is required rather than optional. Optional is how
 * last-write-wins returns: a caller with no opinion about what it is overwriting
 * would silently erase a decrement a buyer's order had just made.
 */
async function adjustProductStock(request: Request, env: Env, store: Row, code: string): Promise<Response> {
	let body: Row;
	try { body = (await request.json()) as Row; } catch { return jsonResponse({ error: "invalid_json" }, 400); }

	const storeId = String(store.id);
	const stock = Math.floor(Number(body.stock));
	if (!Number.isSafeInteger(stock) || stock < 0) return jsonResponse({ error: "stock_invalid" }, 400);
	if (body.expected_stock_version == null || !Number.isSafeInteger(Number(body.expected_stock_version))) {
		return jsonResponse({
			error: "expected_stock_version_required",
			message: "Send the stock_version this edit was made against, from GET /api/v1/products.",
		}, 400);
	}
	const expected = Number(body.expected_stock_version);

	const current = await productByCode(env, storeId, code);
	if (!current) return jsonResponse({ error: "not_found" }, 404);

	const delta = stock - Number(current.stock);
	const statements = [
		env.orderak_db.prepare(
			`UPDATE products SET stock=?, stock_version=stock_version+1, updated_at=datetime('now')
			 WHERE store_id=? AND product_code=? AND stock_version=?`,
		).bind(stock, storeId, code, expected),
	];
	// The ledger row carries both the expected revision AND the resulting stock in
	// its predicate. The revision alone is not proof the UPDATE above applied: an
	// order's trigger moves stock and bumps the same counter, so a row could match
	// the revision while describing a different quantity. Both, or neither.
	if (delta !== 0) {
		statements.push(env.orderak_db.prepare(
			`INSERT INTO stock_movements (id, store_id, product_id, product_code, delta, balance_after,
			   cause, cause_id, actor, reconstructed)
			 SELECT lower(hex(randomblob(16))), p.store_id, p.id, p.product_code, ?, p.stock,
			        'MANUAL_ADJUSTMENT', NULL, 'seller', 0
			   FROM products p
			  WHERE p.store_id=? AND p.product_code=? AND p.stock_version=? AND p.stock=?`,
		).bind(delta, storeId, code, expected + 1, stock));
	}

	const [applied] = await env.orderak_db.batch(statements);
	if (!applied.meta.changes) {
		const fresh = await productByCode(env, storeId, code);
		return jsonResponse({
			error: "stale_stock",
			stock: Number(fresh?.stock ?? current.stock),
			stock_version: Number(fresh?.stock_version ?? current.stock_version ?? 0),
		}, 409);
	}

	const updated = await productByCode(env, storeId, code);
	return jsonResponse({ ok: true, product: updated ? productResponseRow(updated) : null });
}

/**
 * Delete one product.
 *
 * No tombstone, and none is coming. A tombstone would make local absence mean
 * something, which is the property the mirror had and this API exists to remove:
 * the server deletes, `GET /api/v1/products` returns without the row, and the
 * device's cache follows. Nothing infers a deletion from a device forgetting.
 *
 * `stock_movements` rows survive, by the design migration 052 states: the
 * movement carries its own copy of the product's identity precisely so a later
 * deletion cannot rewrite history.
 */
async function deleteProduct(env: Env, store: Row, code: string): Promise<Response> {
	const storeId = String(store.id);
	const existing = await productByCode(env, storeId, code);
	if (!existing) return jsonResponse({ error: "not_found" }, 404);

	await env.orderak_db.batch([
		env.orderak_db.prepare("DELETE FROM products WHERE store_id=? AND product_code=?").bind(storeId, code),
		env.orderak_db
			.prepare("UPDATE sellers SET catalog_version = catalog_version + 1, updated_at = datetime('now') WHERE id = ?")
			.bind(storeId),
	]);
	return jsonResponse({ ok: true, product_code: code });
}

async function restoreFirebaseSession(request: Request, env: Env): Promise<Response> {
	if (!env.FIREBASE_WEB_API_KEY) return jsonResponse({ error: "firebase_not_configured" }, 503);
	const body = (await request.json().catch(() => ({}))) as Row;
	const idToken = String(body.id_token ?? "");
	const requestedPhone = String(body.phone ?? "");
	const deviceSecret = String(body.device_secret ?? "");
	if (!idToken || !requestedPhone || !deviceSecret) return jsonResponse({ error: "auth" }, 401);

	// Abuse guard: independent phone + IP limits before the Google API call.
	if (!(await allowPreAuthAttempt(env, request, "session", requestedPhone, 10, 100, 60))) {
		return jsonResponse({ error: "rate_limited" }, 429);
	}

	const firebaseIdentity = await verifyFirebasePhone(env, idToken, requestedPhone);
	if (!firebaseIdentity) return jsonResponse({ error: "auth" }, 401);
	if (!hasFreshFirebaseProof(firebaseIdentity)) return jsonResponse({ error: "auth_stale" }, 401);
	const verifiedPhone = requestedPhone;

	let seller = await findSellerByVerifiedIdentity(env, firebaseIdentity.uid, verifiedPhone);
	if (!seller && env.AUTH_IDENTITY_ENABLED === "true") {
		// Same-phone verified recovery may present a newly issued Firebase subject.
		// Ownership follows the active phone identity; sync below supersedes its
		// prior subject without replacing the seller or organization.
		seller = await env.orderak_db.prepare(
			`SELECT s.* FROM seller_auth_identities i JOIN sellers s ON s.id=i.seller_id
			 WHERE i.provider='firebase_phone' AND i.status='active' AND i.verified_phone_e164=?`,
		).bind(verifiedPhone).first<Row>();
	}
	const consent = await recordLegalAcceptance(
		env,
		body,
		verifiedPhone,
		seller ? String(seller.id) : null,
		pickLocale(request, new URL(request.url)),
	);
	if (consent === "required") return jsonResponse({ error: "legal_acceptance_required" }, 400);
	if (consent === "not_configured") return jsonResponse({ error: "legal_not_configured" }, 503);
	if (!seller) {
		if (env.AUTH_IDENTITY_ENABLED === "true") {
			const compatibility = await env.orderak_db.prepare("SELECT 1 found FROM sellers WHERE phone=?")
				.bind(verifiedPhone).first();
			if (compatibility) return jsonResponse({ error: "identity_not_ready" }, 503);
		}
		return jsonResponse({ ok: true, exists: false });
	}
	// The same refusal completePhoneAuth() makes (auth-v2.ts). These are two
	// entry points to one device-secret provisioning, and only one of them
	// checked: a suspended or banned account could still be handed a working
	// credential here, then be refused by every route that used it.
	if (String(seller.status ?? "active") !== "active") {
		return jsonResponse({ error: "account_restricted", status: seller.status }, 403);
	}

	await syncVerifiedFirebaseIdentity(env, String(seller.id), firebaseIdentity.uid, verifiedPhone);
	seller.firebase_uid = firebaseIdentity.uid;

	// Logging back into an already-authorized device is available on every plan.
	// Only adding a genuinely new device is a paid feature.
	if (await authSeller(env, verifiedPhone, deviceSecret, clientIpOf(request))) {
		return jsonResponse({ ok: true, exists: true, store: fullStore(env, seller) });
	}
	const provisioned = await provisionDeviceSecret(env, seller, verifiedPhone, deviceSecret);
	if (!provisioned.ok) return provisioned.response;
	return jsonResponse({ ok: true, exists: true, store: fullStore(env, seller) });
}

async function logoutSeller(request: Request, env: Env, url: URL): Promise<Response> {
	const { phone, secret } = readCreds(request, url);
	const seller = await authSeller(env, phone, secret, clientIpOf(request));
	if (!seller) return jsonResponse({ error: "auth" }, 401);
	const revoked = await revokeSellerCredential(env, String(seller.id), secret);
	// The credential this proof was issued against no longer exists, so neither
	// should the proof. Without this a step-up token survives sign-out for the
	// rest of its ten-minute window.
	if (revoked) await revokeRecentAuthProofsStatement(env, String(seller.id)).run();
	return revoked ? jsonResponse({ ok: true }) : jsonResponse({ error: "auth" }, 401);
}
