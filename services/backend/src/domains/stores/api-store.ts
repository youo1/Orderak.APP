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
//   GET  /api/v1/products                  pull the store's catalog (pull before mirror push)
//   POST /api/v1/products/sync              mirror products (returns codes)
//   POST /api/v1/media/upload               upload logo/cover/product image
//
// Internal UUIDs are never returned to the client. The app references stores by
// public_identifier and categories/products by their immutable codes.
// ============================================================

import { jsonResponse, methodNotAllowed, readCreds, authSeller, hashSecret, checkRateLimit, revokeSellerCredential, type AuthenticatedSeller } from "../../platform/http/shared";
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
import { requireTenantWrite, resolveTenantContextForStore, TenantWriteFencedError } from "../../platform/tenancy/tenant-routing";
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
function identityBlock(store: Row): Record<string, unknown> {
	const pid = String(store.public_identifier);
	return {
		store_name: store.store_name,
		slug: store.slug,
		country_code: store.country_code,
		store_code: store.store_code,
		public_identifier: pid,
		store_url: storeUrl(pid),
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
		p === "/api/v1/products/sync" ||
		p === "/api/v1/media/upload";
	if (!isStoreRoute) return null;

	const { phone, secret } = readCreds(request, url);
	const store = authenticatedSeller !== undefined ? authenticatedSeller : await authSeller(env, phone, secret);
	if (!store) return jsonResponse({ error: "auth" }, 401);
	const tenantMutation = method !== "GET" && (
		p === "/api/v1/store" || p === "/api/v1/categories" || p.startsWith("/api/v1/categories/")
		|| p === "/api/v1/products/sync" || p === "/api/v1/media/upload"
	);
	if (tenantMutation) {
		try {
			requireTenantWrite(await resolveTenantContextForStore(env, String(store.id)));
		} catch (error) {
			if (error instanceof TenantWriteFencedError) {
				return jsonResponse({ error: "tenant_write_fenced", retryable: true }, 503, { "retry-after": String(error.retryAfterSeconds) });
			}
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
		if (method === "GET") return jsonResponse({ ok: true, store: fullStore(store) });
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

	// ---- POST /api/v1/products/sync ----
	if (p === "/api/v1/products/sync" && method === "POST") {
		return syncProducts(request, env, store);
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

	if (p === "/api/v1/products") return methodNotAllowed("GET");
	if (p === "/api/v1/products/sync") return methodNotAllowed("POST");
	return methodNotAllowed("POST"); // /api/v1/media/upload
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
		if (!(await authSeller(env, phone, secret))) {
			return jsonResponse({ error: "auth" }, 401);
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
		return jsonResponse({ ok: true, ...identityBlock(store!) });
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

	try {
		await env.orderak_db
			.prepare(
				`UPDATE sellers SET store_name = ?, instapay = ?, vfcash = ?, slug = ?, secret = ?,
				   store_code = ?, country_code = ?, public_identifier = ?, updated_at = datetime('now')
				 WHERE id = ?`,
			)
			.bind(
				storeName,
				body.instapay ?? store.instapay,
				body.vfcash ?? store.vfcash,
				newSlug,
				secretHash,
				storeCode,
				countryCode,
				publicId,
				store.id,
			)
			.run();
	} catch {
		return jsonResponse({ error: "slug_taken", message: t(lang, "slug.taken") }, 409);
	}

	if (env.ENTITLEMENTS_ENABLED === "true") await ensureOrganizationForStore(env, String(store.id), storeName, lang);
	if (firebaseIdentity) await syncVerifiedFirebaseIdentity(env, String(store.id), firebaseIdentity.uid, phone);
	return jsonResponse({
		ok: true,
		...identityBlock({ store_name: storeName, slug: newSlug, store_code: storeCode, country_code: countryCode, public_identifier: publicId }),
	});
}

// ---- Store Information ------------------------------------------------------

// Full Store Information object (editable fields + read-only identity block).
export function fullStore(store: Row): Record<string, unknown> {
	return {
		...identityBlock(store),
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
	return jsonResponse({ ok: true, store: fullStore(updated) });
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
	const insert = (candidateSlug: string | null) => env.ENTITLEMENTS_ENABLED === "true"
		? env.orderak_db.prepare(
			`INSERT INTO categories (id, store_id, category_code, name, slug, sort_order)
			 SELECT ?,?,?,?,?,? WHERE ? IS NULL OR (
			   SELECT COUNT(*) FROM categories c
			   WHERE c.store_id IN (SELECT store_id FROM organization_stores WHERE organization_id=(
			     SELECT organization_id FROM organization_stores WHERE store_id=?
			   ))
			 ) < ?`,
		).bind(id, store.id, code, name, candidateSlug, sortOrder, limit, store.id, limit)
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
 * The store's catalogue version — the baseline a device must hold before it may
 * overwrite or delete anything. See migrations/050_catalog_baseline_version.sql.
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
			        c.category_code
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
		products: (results ?? []).map((r: Row) => ({
			app_id: Number(r.app_id),
			product_code: String(r.product_code),
			name: r.name,
			slug: r.slug ?? null,
			description: r.description ?? null,
			// Money travels as an object so the client can render it (ADR-009).
			price: { amount_minor: Number(r.price_minor), currency: String(r.currency || DEFAULT_CURRENCY) },
			stock: Number(r.stock),
			stock_version: Number(r.stock_version ?? 0),
			available: r.available === 1,
			image_url: r.image_url ?? null,
			category_code: r.category_code ?? null,
		})),
	});
}

// ---- Product sync ----------------------------------------------------------

/**
 * When a mirror deletes most of a catalogue, ask the caller to say it meant to.
 *
 * The threshold is a fraction rather than a count because "deleting 20 products"
 * means nothing without knowing whether the store had 21 or 2,000. The floor
 * exists so a seller with three products is not asked to confirm deleting two of
 * them, which is ordinary tidying and would train them to confirm reflexively —
 * and a prompt people click through protects nothing.
 */
const BULK_DELETE_MIN_CATALOG = 10;
const BULK_DELETE_FRACTION = 0.5;


async function syncProducts(request: Request, env: Env, store: Row): Promise<Response> {
	// This endpoint is a MIRROR: anything the submitted list omits is deleted at
	// the end of this function, and an empty list deletes the entire catalog.
	// That makes the difference between "the seller has no products" and "this
	// request did not say" the difference between a correct write and total data
	// loss, so the two must never collapse into the same value.
	//
	// They used to. The body was parsed with `.catch(() => ({}))` and `products`
	// was defaulted with `Array.isArray(...) ? ... : []`, so a truncated upload,
	// a proxy that mangled the body, or a client that renamed the field all
	// arrived here as an empty mirror and returned 200 after wiping the store.
	// Neither failure is something a caller can distinguish from success.
	//
	// An explicitly empty `products: []` is still honoured — a seller who
	// deletes their last product has an empty catalog, and SyncRepository.kt
	// sends exactly that. Only the *absence* of the field is now an error.
	let body: Row;
	try {
		body = (await request.json()) as Row;
	} catch {
		return jsonResponse({ error: "invalid_json" }, 400);
	}
	if (body === null || typeof body !== "object" || Array.isArray(body)) {
		return jsonResponse({ error: "invalid_json" }, 400);
	}
	if (!Array.isArray(body.products)) {
		return jsonResponse({
			error: "products_required",
			message: "products must be an array. Omitting it is rejected because this endpoint mirrors the catalog and would otherwise delete it.",
		}, 400);
	}
	const requested = body.products as Row[];
	const limit = await getPlanLimit(env, String(store.id), "max_products");
	if (limit !== null) {
		const validRequestedCount = requested.filter((product) => Number.isFinite(Number(product.app_id))).length;
		let currentUsage = 0;
		let projectedUsage = validRequestedCount;
		if (env.ENTITLEMENTS_ENABLED === "true") {
			const usage = await env.orderak_db.prepare(
				`SELECT
				   (SELECT COUNT(*) FROM products current_store WHERE current_store.store_id=?) AS store_count,
				   COUNT(p.id) AS organization_count
				 FROM organization_stores os
				 LEFT JOIN products p ON p.store_id=os.store_id
				 WHERE os.organization_id=(SELECT organization_id FROM organization_stores WHERE store_id=?)`,
			).bind(store.id, store.id).first<{ store_count: number; organization_count: number }>();
			const currentStoreCount = Number(usage?.store_count ?? 0);
			currentUsage = Number(usage?.organization_count ?? currentStoreCount);
			projectedUsage = currentUsage - currentStoreCount + validRequestedCount;
		} else {
			const usage = await env.orderak_db.prepare("SELECT COUNT(*) AS c FROM products WHERE store_id=?")
				.bind(store.id).first<{ c: number }>();
			currentUsage = Number(usage?.c ?? 0);
			projectedUsage = validRequestedCount;
		}

		// Downgrades block growth, never maintenance. Sellers who are already
		// above the new limit may edit or delete existing products as long as the
		// submitted mirror does not increase organization-wide usage.
		if (projectedUsage > limit && projectedUsage > currentUsage) {
			if (env.ENTITLEMENTS_ENABLED === "true") {
				return entitlementLimitReached(await resolveEntitlements(env, String(store.id)), "max_products");
			}
			return limitReached("max_products", limit, currentUsage);
		}
	}
	const list = requested;
	const storeId = String(store.id);

	// Existing identity and stock revisions. Stock is optimistic-concurrency
	// controlled separately from the catalog metadata upsert so a stale Android
	// mirror can never restore inventory consumed by a newer buyer order.
	const { results: existingRows } = (await env.orderak_db
		.prepare("SELECT id, app_id, product_code, stock, stock_version FROM products WHERE store_id = ?")
		.bind(storeId)
		.all()) as { results: Row[] };
	type ExistingProduct = { id: string; productCode: string; stock: number; stockVersion: number };
	const existing = new Map<number, ExistingProduct>();
	for (const r of existingRows ?? []) existing.set(Number(r.app_id), {
		id: String(r.id), productCode: String(r.product_code), stock: Number(r.stock), stockVersion: Number(r.stock_version ?? 0),
	});

	const { results: catRows } = (await env.orderak_db
		.prepare("SELECT id, category_code FROM categories WHERE store_id = ?")
		.bind(storeId)
		.all()) as { results: Row[] };
	const catByCode = new Map<string, string>();
	for (const c of catRows ?? []) catByCode.set(String(c.category_code), String(c.id));

	const records: Array<{
		id: string; categoryId: string | null; productCode: string; appId: number; name: string;
		slug: string | null; description: string | null; price: number; currency: string; stock: number;
		available: number; imageUrl: string | null; categoryCode: string | null;
		existed: boolean; stockDirty: boolean; expectedStockVersion: number | null;
	}> = [];
	const seenAppIds = new Set<number>();
	const generatedCodes = new Set([...existing.values()].map((item) => item.productCode));

	for (const raw of list) {
		const appId = Number(raw.app_id);
		if (!Number.isFinite(appId)) continue;
		if (seenAppIds.has(appId)) return jsonResponse({ error: "duplicate_app_id", app_id: appId }, 400);
		seenAppIds.add(appId);
		const name = String(raw.name ?? "").slice(0, 80);
		const rawPrice = (raw.price ?? {}) as { amount_minor?: unknown; currency?: unknown };
		const price = Math.max(0, Math.floor(Number(rawPrice.amount_minor) || 0));
		// An amount is meaningless without its currency (ADR-009), and the client
		// has always sent one — `MoneyDto(priceMinor, currency)` in
		// SyncRepository.kt. It was read as far as `amount_minor` and the currency
		// dropped on the floor, so every row landed on the column default.
		//
		// Rejected rather than defaulted when it is not a currency this deployment
		// accepts. Defaulting is how 15000 fils becomes 150.00 EGP: a plausible
		// number, silently wrong by a factor of ten, and undetectable afterwards
		// because nothing recorded what was meant.
		const currency = rawPrice.currency == null ? DEFAULT_CURRENCY : String(rawPrice.currency).toUpperCase();
		if (!(ENABLED_CURRENCIES as readonly string[]).includes(currency)) {
			return jsonResponse({
				error: "currency_not_enabled",
				app_id: appId,
				currency,
				enabled: [...ENABLED_CURRENCIES],
			}, 400);
		}
		const stock = Math.max(0, Math.floor(Number(raw.stock) || 0));
		const available = raw.available ? 1 : 0;
		const description = raw.description != null ? String(raw.description).slice(0, 500) : null;
		const imageUrl = raw.image_url != null ? String(raw.image_url).slice(0, 500) : null;
		const slug = name ? slugify(name) || null : null;
		const categoryCode = raw.category_code != null ? String(raw.category_code) : null;
		const categoryId = categoryCode ? catByCode.get(categoryCode) ?? null : null;

		const previous = existing.get(appId);
		let productCode = previous?.productCode;
		if (!productCode) {
			if (requested.length <= 20) productCode = await uniqueResourceCode(env, "p");
			else do productCode = newResourceCode("p", 8); while (generatedCodes.has(productCode));
			generatedCodes.add(productCode);
		}
		records.push({
			id: previous?.id ?? newUuid(), categoryId, productCode, appId, name, slug, description,
			price, currency, stock, available, imageUrl, categoryCode, existed: previous != null,
			stockDirty: raw.stock_dirty === true,
			expectedStockVersion: raw.expected_stock_version != null && Number.isSafeInteger(Number(raw.expected_stock_version))
				? Number(raw.expected_stock_version) : null,
		});
	}

	// What this push would do to what is already there. Computed before anything
	// is written, because the baseline rule below depends on both answers.
	const removedCodes = [...existing.entries()].filter(([appId]) => !seenAppIds.has(appId)).map(([, item]) => item.productCode);
	const wipesEverything = records.length === 0 && existing.size > 0;
	const deletionCount = wipesEverything ? existing.size : removedCodes.length;
	const modifiesExisting = records.some((record) => record.existed);

	// A device may only overwrite or delete what it has proved it has seen.
	//
	// Absence is not evidence of deletion. A device with an empty database sends
	// the same payload as a seller who deleted their last product, and a device
	// that has been offline since Tuesday sends the same payload as a seller who
	// reverted every edit made since. Neither is distinguishable here, so the
	// question is answered earlier: does this device hold the catalogue as it
	// currently stands?
	//
	// A purely additive push is exempt. A device adding products it invented
	// cannot destroy anything it has not seen, and requiring a baseline there
	// would break the first sync of a brand-new store for no gain.
	const currentVersion = await catalogVersion(env, storeId);
	const claimedBaseline = body.baseline_version != null && Number.isSafeInteger(Number(body.baseline_version))
		? Number(body.baseline_version)
		: null;
	if (deletionCount > 0 || modifiesExisting) {
		if (claimedBaseline === null) {
			return jsonResponse({
				error: "catalog_baseline_required",
				message: "This push would modify or delete products. Send baseline_version from GET /api/v1/products first.",
				catalog_version: currentVersion,
			}, 409);
		}
		if (claimedBaseline !== currentVersion) {
			return jsonResponse({
				error: "stale_catalog",
				message: "The catalog changed since this device last downloaded it. Download again, merge, and retry.",
				catalog_version: currentVersion,
				baseline_version: claimedBaseline,
			}, 409);
		}
	}

	// A current baseline proves the device has seen what it is deleting; it does
	// not prove the seller meant to. Deleting most of a catalogue in one push is
	// rare enough as an intention and common enough as a defect that it is worth
	// making the caller say so explicitly.
	if (deletionCount > 0 && existing.size >= BULK_DELETE_MIN_CATALOG
		&& deletionCount >= existing.size * BULK_DELETE_FRACTION && body.confirm_deletion !== true) {
		return jsonResponse({
			error: "bulk_deletion_unconfirmed",
			message: "This push deletes most of the catalog. Re-send with confirm_deletion: true if that is intended.",
			deleting: deletionCount,
			of: existing.size,
		}, 409);
	}

	// Keep every statement below D1's bound-parameter ceiling. Each chunk is one
	// upsert query, so a 2,000-product catalog does not consume 2,000 queries.
	//
	// SYNC_CHUNK_ROWS × the column count must stay under 100. Adding `currency`
	// took the row from 12 bindings to 13, and 8 × 13 = 104 would have exceeded
	// the ceiling — the failure mode being a runtime D1 error on any catalog
	// larger than seven products, which no existing test would have caught.
	const SYNC_COLUMNS = 13;
	const SYNC_CHUNK_ROWS = Math.floor(100 / SYNC_COLUMNS); // 7
	const stmts: D1PreparedStatement[] = [];
	for (let offset = 0; offset < records.length; offset += SYNC_CHUNK_ROWS) {
		const chunk = records.slice(offset, offset + SYNC_CHUNK_ROWS);
		const values = chunk.map(() => `(${Array(SYNC_COLUMNS).fill("?").join(",")})`).join(",");
		const bindings = chunk.flatMap((record) => [
			record.id, storeId, record.categoryId, record.productCode, record.appId, record.name,
			record.slug, record.description, record.price, record.currency, record.stock, record.available, record.imageUrl,
		]);
		stmts.push(env.orderak_db.prepare(
			// `stock` is bound on INSERT and deliberately absent from DO UPDATE: a
			// new product's stock comes from the device that invented it, and an
			// existing product's stock moves only through the compare-and-set
			// below or a buyer's order.
			`INSERT INTO products (id,store_id,category_id,product_code,app_id,name,slug,description,price_minor,currency,stock,available,image_url)
			 VALUES ${values}
			 ON CONFLICT(store_id,app_id) DO UPDATE SET
			 category_id=excluded.category_id,name=excluded.name,slug=excluded.slug,description=excluded.description,
			 price_minor=excluded.price_minor,currency=excluded.currency,available=excluded.available,
			 image_url=excluded.image_url,updated_at=datetime('now')`,
		).bind(...bindings));
	}
	// A product arrives holding stock, and those units have to come from
	// somewhere or the ledger can never reconcile for it. The mirror's INSERT
	// takes the figure straight from the device that invented the product, which
	// makes this its opening balance in the literal sense: the count it started
	// with, before anything moved it.
	//
	// Only for products this push creates. An existing product's stock is not
	// touched by the upsert — it moves through an order or the adjustment below.
	for (const record of records) {
		if (record.existed || record.stock === 0) continue;
		stmts.push(env.orderak_db.prepare(
			`INSERT INTO stock_movements (
			   id, store_id, product_id, product_code, delta, balance_after,
			   cause, cause_id, actor, reconstructed
			 ) VALUES (lower(hex(randomblob(16))), ?, ?, ?, ?, ?, 'OPENING_BALANCE', NULL, 'seller', 0)`,
		).bind(storeId, record.id, record.productCode, record.stock, record.stock));
	}

	for (let offset = 0; offset < removedCodes.length; offset += 90) {
		const chunk = removedCodes.slice(offset, offset + 90);
		stmts.push(env.orderak_db.prepare(`DELETE FROM products WHERE store_id=? AND product_code IN (${chunk.map(() => "?").join(",")})`)
			.bind(storeId, ...chunk));
	}
	if (!records.length) stmts.push(env.orderak_db.prepare("DELETE FROM products WHERE store_id=?").bind(storeId));

	// Stock joins the same batch rather than following it in a second one.
	//
	// It used to run afterwards, in its own batch. Two batches are two
	// transactions, so a failure between them left the metadata writes and the
	// deletions committed with the stock statements never attempted, and nothing
	// recorded that half the push had landed. One batch is one transaction: all
	// of it, or none.
	//
	// This does NOT make a stale stock revision reject the push, and it is not
	// meant to. A conflicting revision changes zero rows rather than raising, so
	// the rest still commits and the response reports the conflict — which is the
	// contract the client is built on: applySync() takes the authoritative state
	// for the rows that landed and keeps local intent for the ones that did not.
	// Partial application of STOCK is deliberate. Partial application of the
	// batch was not.
	const stockRecords = records.filter((record) => record.existed && record.stockDirty);
	const versionedStock = stockRecords.filter((record) => record.expectedStockVersion != null);
	const stockOffset = stmts.length;
	for (const record of versionedStock) {
		stmts.push(env.orderak_db.prepare(
			`UPDATE products SET stock=?,stock_version=stock_version+1,updated_at=datetime('now')
			 WHERE store_id=? AND app_id=? AND stock_version=?`,
		).bind(record.stock, storeId, record.appId, record.expectedStockVersion));
	}

	// The seller setting a figure themselves is the one stock movement made in
	// application code rather than by a trigger, and until now the only one that
	// left no trace at all: the compare-and-set above bumps stock_version and
	// writes nothing else, so afterwards a seller correcting a count and an order
	// that went missing are the same event.
	//
	// Conditional on the update having applied, not on having been attempted. A
	// stale revision matches no rows, and a ledger row written anyway would
	// record a movement that did not happen — which is worse than the silence it
	// replaces, because reconciliation would then believe it.
	for (const record of versionedStock) {
		const previous = existing.get(record.appId);
		if (!previous) continue;
		const delta = record.stock - previous.stock;
		if (delta === 0) continue;
		stmts.push(env.orderak_db.prepare(
			`INSERT INTO stock_movements (
			   id, store_id, product_id, product_code, delta, balance_after,
			   cause, cause_id, actor, reconstructed
			 )
			 SELECT lower(hex(randomblob(16))), p.store_id, p.id, p.product_code, ?, p.stock,
			        'MANUAL_ADJUSTMENT', NULL, 'seller', 0
			 FROM products p
			 WHERE p.store_id=? AND p.app_id=? AND p.stock_version=? AND p.stock=?`,
		// Both halves are needed. The version alone is not proof the update
		// applied: an order's trigger bumps it too, so a push whose stale
		// revision was refused can still find the row sitting at expected+1 and
		// record a movement that never happened. Requiring the new stock as well
		// distinguishes "this statement wrote it" from "it happens to look like
		// this", and within one batch nothing else can move it in between.
		).bind(delta, storeId, record.appId, Number(record.expectedStockVersion) + 1, record.stock));
	}

	// Every accepted push moves the version, so the next device to send this
	// baseline back is told to download again. In the same batch: a version that
	// could be bumped without the write landing, or the reverse, is worse than
	// no version at all.
	stmts.push(env.orderak_db
		.prepare("UPDATE sellers SET catalog_version = catalog_version + 1, updated_at = datetime('now') WHERE id = ?")
		.bind(storeId));

	const batchResults = await env.orderak_db.batch(stmts);

	let conflicts = stockRecords.filter((record) => record.expectedStockVersion == null).map((record) => record.appId);
	conflicts = conflicts.concat(versionedStock
		.filter((_, index) => Number(batchResults[stockOffset + index]?.meta?.changes ?? 0) !== 1)
		.map((record) => record.appId));

	// An empty mirror against a non-empty catalog is legitimate — a seller can
	// delete their last product — but it is also what a client-side database
	// loss looks like from here, and the two are indistinguishable at this
	// layer. Record it so the difference can be established afterwards from the
	// audit trail rather than guessed at from a support ticket.
	if (!records.length && existing.size > 0) {
		await auditDb(env, null, "catalog.mirror_emptied", {
			entity: "store",
			entity_id: storeId,
			actor_type: "seller",
			actor_id: storeId,
			deleted_product_count: existing.size,
		}, request);
	}

	const { results: syncedRows } = (await env.orderak_db.prepare(
		`SELECT p.id AS remote_uuid,p.app_id,p.product_code,p.stock,p.stock_version,c.category_code
		 FROM products p LEFT JOIN categories c ON c.id=p.category_id
		 WHERE p.store_id=?`,
	).bind(storeId).all()) as { results: Row[] };
	const mapping = (syncedRows ?? []).map((row) => ({
		app_id: Number(row.app_id), product_code: String(row.product_code),
		remote_uuid: String(row.remote_uuid), category_code: row.category_code == null ? null : String(row.category_code),
		stock: Number(row.stock), stock_version: Number(row.stock_version ?? 0),
	}));
	await refreshProductTranslations(env, storeId);
	// The push moved the version, so the baseline the device just used is spent.
	// Returning the new one saves a round trip and, more to the point, keeps the
	// device current: a client that pushed successfully and then kept its old
	// baseline would be refused on its very next edit for no reason it could see.
	const nextVersion = currentVersion + 1;
	if (conflicts.length) {
		return jsonResponse({ ok: false, error: "stale_stock", conflicts, products: mapping, catalog_version: nextVersion }, 409);
	}
	return jsonResponse({ ok: true, count: mapping.length, products: mapping, catalog_version: nextVersion });
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
	await syncVerifiedFirebaseIdentity(env, String(seller.id), firebaseIdentity.uid, verifiedPhone);
	seller.firebase_uid = firebaseIdentity.uid;

	// Logging back into an already-authorized device is available on every plan.
	// Only adding a genuinely new device is a paid feature.
	if (await authSeller(env, verifiedPhone, deviceSecret)) {
		return jsonResponse({ ok: true, exists: true, store: fullStore(seller) });
	}
	const provisioned = await provisionDeviceSecret(env, seller, verifiedPhone, deviceSecret);
	if (!provisioned.ok) return provisioned.response;
	return jsonResponse({ ok: true, exists: true, store: fullStore(seller) });
}

async function logoutSeller(request: Request, env: Env, url: URL): Promise<Response> {
	const { phone, secret } = readCreds(request, url);
	const seller = await authSeller(env, phone, secret);
	if (!seller) return jsonResponse({ error: "auth" }, 401);
	const revoked = await revokeSellerCredential(env, String(seller.id), secret);
	// The credential this proof was issued against no longer exists, so neither
	// should the proof. Without this a step-up token survives sign-out for the
	// rest of its ten-minute window.
	if (revoked) await revokeRecentAuthProofsStatement(env, String(seller.id)).run();
	return revoked ? jsonResponse({ ok: true }) : jsonResponse({ error: "auth" }, 401);
}
