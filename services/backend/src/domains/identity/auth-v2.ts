import {
	generateAuthenticationOptions,
	generateRegistrationOptions,
	verifyAuthenticationResponse,
	verifyRegistrationResponse,
	type AuthenticationResponseJSON,
	type AuthenticatorTransportFuture,
	type RegistrationResponseJSON,
	type WebAuthnCredential,
} from "@simplewebauthn/server";
import {
	getCountryCallingCode,
	parsePhoneNumberFromString,
	type CountryCode,
} from "libphonenumber-js";
import { randomToken, sha256Hex } from "./auth";
import { fullStore, verifyFirebasePhone } from "../stores/api-store";
import { getEmailService } from "../../integrations/email/emailService";
import {
	buildPublicIdentifier,
	cleanSlug,
	newAccountFoundationStatements,
	newUuid,
	normalizeCountryIso,
	slugIsFree,
	slugSuggestions,
	slugify,
	storeUrl,
	syncVerifiedFirebaseIdentity,
	uniqueSlug,
	uniqueStoreCode,
} from "./identity";
import { pickLocale } from "../../platform/localization/i18n";
import { provisionDeviceSecret } from "./seller-session";
import {
	authSeller,
	checkRateLimit,
	constantTimeEqual,
	hashSecret,
	jsonResponse,
	readCreds,
	verifyStoredSecret,
} from "../../platform/http/shared";

type Row = Record<string, unknown>;

const ONBOARDING_ROLLING_MINUTES = 30;
const ONBOARDING_ABSOLUTE_HOURS = 24;
const WEBAUTHN_CHALLENGE_MINUTES = 5;
const RECENT_AUTH_MINUTES = 10;
const EMAIL_TOKEN_HOURS = 24;
const PRODUCTION_RP_ID = "orderak.app";
const RP_NAME = "Orderak";
const CATEGORY_KEYS = new Set(["fashion", "electronics", "food", "beauty", "services", "other"]);

interface OnboardingRow {
	id: string;
	token_hash: string;
	phone_e164: string;
	firebase_uid: string;
	device_secret_hash: string;
	phone_country_iso: string | null;
	locale: string;
	status: "phone_verified" | "account_saved" | "completed" | "expired";
	full_name: string | null;
	birth_year: number | null;
	email_private: string | null;
	terms_version: number | null;
	privacy_version: number | null;
	terms_accepted_at: string | null;
	app_version: string | null;
	completed_seller_id: string | null;
	idempotency_key: string | null;
	city_catalog_id: number | null;
	city_catalog_version: string | null;
	city_name: string | null;
	expires_at: string;
	absolute_expires_at: string;
}

interface ChallengeRow {
	id: string;
	challenge_hash: string;
	ceremony: "registration" | "authentication";
	seller_id: string | null;
	webauthn_user_id: string | null;
	expires_at: string;
	consumed_at: string | null;
}

interface PasskeyRow {
	id: string;
	seller_id: string;
	credential_id: string;
	credential_public_key: ArrayBuffer;
	webauthn_user_id: string;
	counter: number;
	aaguid: string | null;
	transports_json: string;
	device_type: string;
	backed_up: number;
	label: string | null;
	status: string;
}

export interface OnboardingGeoContext {
	id: string;
	countryIso: string;
	status: OnboardingRow["status"];
}

export async function handleAuthV2Routes(
	request: Request,
	env: PublicWorkerEnv,
	url: URL,
	ctx: ExecutionContext,
): Promise<Response | null> {
	const path = url.pathname;
	const method = request.method;

	if (path === "/api/v1/auth/phone/complete" && method === "POST") {
		return featureEnabled(env, "ONBOARDING_ENABLED")
			? completePhoneAuth(request, env, url)
			: featureDisabled("onboarding_v2");
	}
	if (path === "/api/v1/onboarding/account" && method === "POST") {
		return featureEnabled(env, "ONBOARDING_ENABLED")
			? saveOnboardingAccount(request, env, url)
			: featureDisabled("onboarding_v2");
	}
	if (path === "/api/v1/onboarding/complete" && method === "POST") {
		return featureEnabled(env, "ONBOARDING_ENABLED")
			? completeOnboarding(request, env, url, ctx)
			: featureDisabled("onboarding_v2");
	}
	if (path === "/api/v1/onboarding/slug/check" && method === "GET") {
		return featureEnabled(env, "ONBOARDING_ENABLED")
			? checkOnboardingSlug(request, env, url)
			: featureDisabled("onboarding_v2");
	}
	if (path === "/api/v1/auth/passkeys/registration/options" && method === "POST") {
		return featureEnabled(env, "PASSKEY_ENABLED")
			? passkeyRegistrationOptions(request, env)
			: featureDisabled("passkeys");
	}
	if (path === "/api/v1/auth/passkeys/registration/complete" && method === "POST") {
		return featureEnabled(env, "PASSKEY_ENABLED")
			? passkeyRegistrationComplete(request, env)
			: featureDisabled("passkeys");
	}
	if (path === "/api/v1/auth/passkeys/authentication/options" && method === "POST") {
		return featureEnabled(env, "PASSKEY_ENABLED")
			? passkeyAuthenticationOptions(request, env)
			: featureDisabled("passkeys");
	}
	if (path === "/api/v1/auth/passkeys/authentication/complete" && method === "POST") {
		return featureEnabled(env, "PASSKEY_ENABLED")
			? passkeyAuthenticationComplete(request, env)
			: featureDisabled("passkeys");
	}
	if (path === "/api/v1/auth/passkeys" && method === "GET") {
		return featureEnabled(env, "PASSKEY_ENABLED")
			? listPasskeys(request, env, url)
			: featureDisabled("passkeys");
	}
	const passkeyId = path.match(/^\/api\/v1\/auth\/passkeys\/([^/]+)$/)?.[1];
	if (passkeyId && (method === "PATCH" || method === "DELETE")) {
		return featureEnabled(env, "PASSKEY_ENABLED")
			? mutatePasskey(request, env, url, decodeURIComponent(passkeyId))
			: featureDisabled("passkeys");
	}
	if (path === "/api/v1/account/email/verification/resend" && method === "POST") {
		return featureEnabled(env, "ONBOARDING_ENABLED")
			? resendEmailVerification(request, env, url, ctx)
			: featureDisabled("onboarding_v2");
	}
	return null;
}

async function checkOnboardingSlug(request: Request, env: PublicWorkerEnv, url: URL): Promise<Response> {
	const session = await requireOnboardingSession(request, env);
	if (session instanceof Response) return session;
	const raw = (url.searchParams.get("slug") ?? "").trim();
	const slug = cleanSlug(raw);
	const valid = Boolean(slug) && slug === raw.toLowerCase();
	const available = valid && await slugIsFree(env, slug);
	return jsonResponse({
		ok: true,
		valid,
		available,
		reserved: valid && !available,
		suggestions: valid && !available ? await slugSuggestions(env, slug) : [],
	});
}

export async function handleEmailVerification(
	request: Request,
	env: PublicWorkerEnv,
	url: URL,
): Promise<Response | null> {
	if (request.method !== "GET" || url.pathname !== "/verify-email") return null;
	const token = url.searchParams.get("token") ?? "";
	if (!token) return verificationPage(false);
	const tokenHash = await sha256Hex(token);
	// The trigger in migration 033 applies the verified timestamp to the
	// matching private profile in the same atomic statement. RETURNING means a
	// replay (including a concurrent replay) cannot report success.
	const consumed = await env.orderak_db.prepare(
		`UPDATE email_verification_tokens SET used_at=datetime('now')
		 WHERE token_hash=? AND used_at IS NULL AND expires_at>datetime('now')
		 RETURNING id`,
	).bind(tokenHash).first<{ id: string }>();
	if (!consumed) return verificationPage(false);
	return verificationPage(true);
}

export function assetLinksResponse(env: PublicWorkerEnv): Response {
	const fingerprints = String(env.ANDROID_RELEASE_SHA256_CERT_FINGERPRINTS ?? "")
		.split(",")
		.map((value) => value.trim().toUpperCase())
		.filter((value) => /^([0-9A-F]{2}:){31}[0-9A-F]{2}$/.test(value));
	if (!fingerprints.length) {
		return jsonResponse({ error: "asset_links_not_configured" }, 503, {
			"cache-control": "no-store",
		});
	}
	return Response.json([
		{
			relation: ["delegate_permission/common.handle_all_urls", "delegate_permission/common.get_login_creds"],
			target: {
				namespace: "android_app",
				package_name: "app.orderak.seller",
				sha256_cert_fingerprints: fingerprints,
			},
		},
	], {
		headers: {
			"cache-control": "public, max-age=300",
			"content-type": "application/json; charset=utf-8",
		},
	});
}

async function completePhoneAuth(request: Request, env: PublicWorkerEnv, url: URL): Promise<Response> {
	const body = await readObject(request);
	const idToken = string(body.id_token, 10_000);
	const phone = string(body.phone, 32);
	const deviceSecret = string(body.device_secret, 200);
	if (!idToken || !validE164(phone) || deviceSecret.length < 20) {
		return jsonResponse({ error: "auth" }, 401);
	}
	if (!(await allowPreAuthAttempt(env, request, "phone-complete", phone, 10, 100, 60))) {
		return jsonResponse({ error: "rate_limited" }, 429);
	}
	const identity = await verifyFirebasePhone(env, idToken, phone);
	if (!identity || !freshFirebaseProof(identity.authTime)) {
		return jsonResponse({ error: identity ? "auth_stale" : "auth" }, 401);
	}
	const phoneCountryIso = validatedPhoneCountryIso(phone, body.phone_country_iso);
	if (!phoneCountryIso) return jsonResponse({ error: "invalid_phone_country" }, 400);

	let seller = await env.orderak_db.prepare(
		`SELECT s.* FROM seller_auth_identities i JOIN sellers s ON s.id=i.seller_id
		 WHERE i.provider='firebase_phone' AND i.status='active'
		   AND i.provider_subject=? AND i.verified_phone_e164=?`,
	).bind(identity.uid, phone).first<Row>();
	if (!seller) {
		seller = await env.orderak_db.prepare("SELECT * FROM sellers WHERE phone=?")
			.bind(phone).first<Row>();
	}

	if (seller) {
		if (String(seller.status ?? "active") !== "active") {
			return jsonResponse({ error: "account_restricted", status: seller.status }, 403);
		}
		await syncVerifiedFirebaseIdentity(env, String(seller.id), identity.uid, phone);
		const provisioned = await provisionDeviceSecret(env, seller, phone, deviceSecret);
		if (!provisioned.ok) return provisioned.response;
		const recent = await issueRecentAuth(env, String(seller.id), "otp");
		return jsonResponse({
			ok: true,
			exists: true,
			phone,
			store: fullStore(seller),
			recent_auth_token: recent.token,
			recent_auth_expires_at: recent.expiresAt,
			passkey_registration_available: featureEnabled(env, "PASSKEY_ENABLED"),
		});
	}

	const token = randomToken();
	const tokenHash = await sha256Hex(token);
	const deviceSecretHash = await hashSecret(deviceSecret);
	const sessionId = newUuid();
	const locale = pickLocale(request, url);
	await env.orderak_db.batch([
		env.orderak_db.prepare(
			`UPDATE onboarding_sessions SET status='expired',updated_at=datetime('now')
			 WHERE phone_e164=? AND status IN ('phone_verified','account_saved')`,
		).bind(phone),
		env.orderak_db.prepare(
			`INSERT INTO onboarding_sessions(
			 id,token_hash,phone_e164,firebase_uid,device_secret_hash,phone_country_iso,
			 locale,status,expires_at,absolute_expires_at)
			 VALUES(?,?,?,?,?,?,?,'phone_verified',datetime('now',?),datetime('now',?))`,
		).bind(
			sessionId,
			tokenHash,
			phone,
			identity.uid,
			deviceSecretHash,
			phoneCountryIso,
			locale,
			`+${ONBOARDING_ROLLING_MINUTES} minutes`,
			`+${ONBOARDING_ABSOLUTE_HOURS} hours`,
		),
	]);
	const row = await env.orderak_db.prepare(
		"SELECT expires_at,absolute_expires_at FROM onboarding_sessions WHERE id=?",
	).bind(sessionId).first<{ expires_at: string; absolute_expires_at: string }>();
	return jsonResponse({
		ok: true,
		exists: false,
		onboarding_token: token,
		expires_at: row?.expires_at,
		absolute_expires_at: row?.absolute_expires_at,
		passkey_invite: featureEnabled(env, "PASSKEY_ENABLED"),
	});
}

async function saveOnboardingAccount(request: Request, env: PublicWorkerEnv, url: URL): Promise<Response> {
	const session = await requireOnboardingSession(request, env);
	if (session instanceof Response) return session;
	if (session.status === "completed") return jsonResponse({ ok: true, completed: true });

	const body = await readObject(request);
	const fullName = string(body.full_name, 80).replace(/\s+/g, " ").trim();
	const email = normalizeEmail(body.email);
	const birthYear = validBirthYear(body.birth_year);
	if (fullName.length < 3) return jsonResponse({ error: "invalid_full_name" }, 400);
	if (body.email != null && body.email !== "" && !email) {
		return jsonResponse({ error: "invalid_email" }, 400);
	}
	if (body.terms_accepted !== true) {
		return jsonResponse({ error: "legal_acceptance_required" }, 400);
	}
	if (birthYear == null) return jsonResponse({ error: "invalid_birth_year" }, 400);
	if (email) {
		const existing = await env.orderak_db.prepare(
			"SELECT seller_id FROM seller_profiles WHERE lower(email_private)=lower(?)",
		).bind(email).first();
		if (existing) return jsonResponse({ error: "email_in_use" }, 409);
	}
	const locale = pickLocale(request, url);
	const [terms, privacy] = await Promise.all([
		currentLegalVersion(env, "terms", locale),
		currentLegalVersion(env, "privacy", locale),
	]);
	if (!terms || !privacy) return jsonResponse({ error: "legal_not_configured" }, 503);

	await env.orderak_db.prepare(
		`UPDATE onboarding_sessions SET status='account_saved',full_name=?,birth_year=?,email_private=?,
		 terms_version=?,privacy_version=?,terms_accepted_at=datetime('now'),app_version=?,
		 locale=?,expires_at=CASE
		   WHEN datetime('now',?)<absolute_expires_at THEN datetime('now',?)
		   ELSE absolute_expires_at END,updated_at=datetime('now')
		 WHERE id=? AND status IN ('phone_verified','account_saved')`,
	).bind(
		fullName,
		birthYear,
		email,
		Number(terms.version),
		Number(privacy.version),
		string(body.app_version, 40) || null,
		locale,
		`+${ONBOARDING_ROLLING_MINUTES} minutes`,
		`+${ONBOARDING_ROLLING_MINUTES} minutes`,
		session.id,
	).run();
	return jsonResponse({ ok: true, step: 2 });
}

async function completeOnboarding(
	request: Request,
	env: PublicWorkerEnv,
	url: URL,
	ctx: ExecutionContext,
): Promise<Response> {
	const session = await requireOnboardingSession(request, env, true);
	if (session instanceof Response) return session;
	const body = await readObject(request);
	const deviceSecret = string(body.device_secret, 200);
	if (!deviceSecret || !(await verifyStoredSecret(deviceSecret, session.device_secret_hash))) {
		return jsonResponse({ error: "auth" }, 401);
	}
	if (session.status === "completed" && session.completed_seller_id) {
		const existing = await env.orderak_db.prepare("SELECT * FROM sellers WHERE id=?")
			.bind(session.completed_seller_id).first<Row>();
		if (!existing) return jsonResponse({ error: "onboarding_inconsistent" }, 503);
		const recent = await issueRecentAuth(env, String(existing.id), "otp");
		return jsonResponse({
			ok: true,
			exists: true,
			phone: existing.phone,
			store: fullStore(existing),
			idempotent: true,
			recent_auth_token: recent.token,
			recent_auth_expires_at: recent.expiresAt,
			passkey_registration_available: featureEnabled(env, "PASSKEY_ENABLED"),
		});
	}
	if (
		session.status !== "account_saved"
		|| !session.full_name
		|| session.birth_year == null
		|| !session.terms_accepted_at
	) {
		return jsonResponse({ error: "account_step_required" }, 409);
	}

	const storeName = string(body.store_name, 60).replace(/\s+/g, " ").trim();
	const requestedCategoryId = string(body.business_category_id, 80);
	const requestedSubcategoryId = string(body.business_subcategory_id, 80);
	const legacyCategory = string(body.business_category, 30);
	const sessionCountryIso = normalizeCountryIso(session.phone_country_iso);
	const requestCountryIso = normalizeCountryIso(body.country_iso);
	const countryIso = sessionCountryIso !== "XX" ? sessionCountryIso : requestCountryIso;
	const cityNameInput = string(body.city_name, 100).replace(/\s+/g, " ").trim();
	const cityGeonameId = positiveInteger(body.city_geoname_id);
	const cityCatalogId = positiveInteger(body.city_catalog_id);
	if (storeName.length < 2) return jsonResponse({ error: "invalid_store_name" }, 400);
	if (countryIso === "XX") return jsonResponse({ error: "invalid_country" }, 400);
	if (
		sessionCountryIso !== "XX"
		&& requestCountryIso !== "XX"
		&& requestCountryIso !== sessionCountryIso
	) {
		return jsonResponse({ error: "country_mismatch" }, 400);
	}

	const taxonomy = requestedCategoryId
		? requestedSubcategoryId
			? await activeTaxonomySelection(env, requestedCategoryId, requestedSubcategoryId)
			: await activeCategorySelection(env, requestedCategoryId)
		: null;
	if (requestedSubcategoryId && !requestedCategoryId) {
		return jsonResponse({ error: "invalid_business_category" }, 400);
	}
	if (requestedCategoryId && !taxonomy) {
		return jsonResponse({ error: "invalid_business_category" }, 400);
	}
	if (!taxonomy && !CATEGORY_KEYS.has(legacyCategory)) {
		return jsonResponse({ error: "invalid_business_category" }, 400);
	}
	const category = taxonomy?.category_key ?? legacyCategory;

	let cityName = cityNameInput;
	let verifiedCityCatalogId: number | null = null;
	let verifiedCityCatalogVersion: string | null = null;
	if (cityCatalogId != null) {
		const catalogCity = await env.orderak_geo.withSession("first-unconstrained").prepare(
			`SELECT c.name,c.native_name,c.version
			 FROM city_catalog c
			 JOIN city_catalog_versions v ON v.version=c.version AND v.active=1
			 WHERE c.source_city_id=? AND c.country_iso=? LIMIT 1`,
		).bind(cityCatalogId, countryIso).first<{
			name: string;
			native_name: string | null;
			version: string;
		}>();
		if (!catalogCity) return jsonResponse({ error: "invalid_city" }, 400);
		verifiedCityCatalogId = cityCatalogId;
		verifiedCityCatalogVersion = catalogCity.version;
		cityName = session.city_catalog_id === cityCatalogId && session.city_name
			? session.city_name
			: catalogCity.name;
	} else if (cityGeonameId != null) {
		const city = await env.orderak_db.prepare(
			"SELECT name FROM geo_cities WHERE geoname_id=? AND country_iso=?",
		).bind(cityGeonameId, countryIso).first<{ name: string }>();
		if (!city) return jsonResponse({ error: "invalid_city" }, 400);
		cityName = city.name;
	}
	if (cityName.length < 2) return jsonResponse({ error: "invalid_city" }, 400);

	const rawSlug = string(body.slug, 60);
	const manualSlug = cleanSlug(rawSlug);
	if (rawSlug && !manualSlug) return jsonResponse({ error: "invalid_slug" }, 400);
	if (manualSlug && !(await slugIsFree(env, manualSlug))) {
		return jsonResponse({ error: "slug_taken", suggestions: await slugSuggestions(env, manualSlug) }, 409);
	}
	const slug = await uniqueSlug(env, manualSlug || slugify(storeName));
	const storeCode = await uniqueStoreCode(env);
	const sellerId = newUuid();
	const organizationId = newUuid();
	const memberId = newUuid();
	const publicIdentifier = buildPublicIdentifier(countryIso, slug, storeCode);
	const idempotencyKey = string(
		request.headers.get("idempotency-key") ?? request.headers.get("x-idempotency-key") ?? body.idempotency_key,
		100,
	) || session.id;
	const emailToken = session.email_private ? randomToken() : null;
	const emailTokenHash = emailToken ? await sha256Hex(emailToken) : null;
	const foundation = await newAccountFoundationStatements(env, {
		sellerId,
		organizationId,
		memberId,
		phone: session.phone_e164,
		firebaseUid: session.firebase_uid,
		storeName,
		locale: session.locale,
	});
	const sellerInsert = env.orderak_db.prepare(
		`INSERT INTO sellers(
		 id,phone,firebase_uid,store_name,slug,secret,store_code,country_code,public_identifier,
		 business_category,city_geoname_id,city_name,city_catalog_id,city_catalog_version,
		 business_category_id,business_subcategory_id,business_taxonomy_version)
		 VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
	).bind(
		sellerId,
		session.phone_e164,
		session.firebase_uid,
		storeName,
		slug,
		session.device_secret_hash,
		storeCode,
		countryIso,
		publicIdentifier,
		category,
		cityGeonameId,
		cityName,
		verifiedCityCatalogId,
		verifiedCityCatalogVersion,
		taxonomy?.category_id ?? null,
		taxonomy?.subcategory_id ?? null,
		taxonomy?.version_id ?? null,
	);
	const statements: D1PreparedStatement[] = [
		sellerInsert,
		...foundation,
		env.orderak_db.prepare(
			`INSERT INTO seller_profiles(seller_id,full_name,birth_year,email_private) VALUES(?,?,?,?)`,
		).bind(sellerId, session.full_name, session.birth_year, session.email_private),
		env.orderak_db.prepare(
			`INSERT INTO legal_acceptances(
			 id,seller_id,phone_e164,terms_version,privacy_version,locale,source,app_version,marketing_consent,accepted_at)
			 VALUES(?,?,?,?,?,?, 'android_onboarding_v2', ?,0,?)`,
		).bind(
			newUuid(),
			sellerId,
			session.phone_e164,
			session.terms_version,
			session.privacy_version,
			session.locale,
			session.app_version,
			session.terms_accepted_at,
		),
		env.orderak_db.prepare(
			`UPDATE onboarding_sessions SET status='completed',completed_seller_id=?,idempotency_key=?,
			 updated_at=datetime('now') WHERE id=? AND status='account_saved'`,
		).bind(sellerId, idempotencyKey, session.id),
	];
	if (session.email_private && emailTokenHash) {
		statements.push(env.orderak_db.prepare(
			`INSERT INTO email_verification_tokens(id,seller_id,email,token_hash,expires_at)
			 VALUES(?,?,?,?,datetime('now',?))`,
		).bind(newUuid(), sellerId, session.email_private, emailTokenHash, `+${EMAIL_TOKEN_HOURS} hours`));
	}

	try {
		await env.orderak_db.batch(statements);
	} catch (error) {
		const completed = await env.orderak_db.prepare(
			"SELECT completed_seller_id FROM onboarding_sessions WHERE id=? AND status='completed'",
		).bind(session.id).first<{ completed_seller_id: string }>();
		if (completed?.completed_seller_id) {
			const existing = await env.orderak_db.prepare("SELECT * FROM sellers WHERE id=?")
				.bind(completed.completed_seller_id).first<Row>();
			if (existing) {
				const recent = await issueRecentAuth(env, String(existing.id), "otp");
				return jsonResponse({
					ok: true,
					exists: true,
					phone: existing.phone,
					store: fullStore(existing),
					idempotent: true,
					recent_auth_token: recent.token,
					recent_auth_expires_at: recent.expiresAt,
					passkey_registration_available: featureEnabled(env, "PASSKEY_ENABLED"),
				});
			}
		}
		console.error(JSON.stringify({ signal: "onboarding_complete_failed", reason: safeError(error) }));
		return jsonResponse({ error: "onboarding_complete_failed" }, 409);
	}

	if (session.email_private && emailToken) {
		ctx.waitUntil(
			sendVerificationEmail(
				env,
				ctx,
				session.email_private,
				session.full_name,
				emailToken,
				session.locale,
			).then(() => undefined).catch((error) => {
				console.error(JSON.stringify({
					signal: "account_email_verification_dispatch_failed",
					reason: safeError(error),
				}));
			}),
		);
	}
	const recent = await issueRecentAuth(env, sellerId, "otp");
	const store = {
		id: sellerId,
		phone: session.phone_e164,
		store_name: storeName,
		slug,
		store_code: storeCode,
		country_code: countryIso,
		public_identifier: publicIdentifier,
		business_category: category,
		business_category_id: taxonomy?.category_id ?? null,
		business_subcategory_id: taxonomy?.subcategory_id ?? null,
		business_taxonomy_version: taxonomy?.version_id ?? null,
		city_geoname_id: cityGeonameId,
		city_catalog_id: verifiedCityCatalogId,
		city_catalog_version: verifiedCityCatalogVersion,
		city_name: cityName,
	};
	return jsonResponse({
		ok: true,
		exists: true,
		store: fullStore(store),
		store_url: storeUrl(publicIdentifier),
		recent_auth_token: recent.token,
		recent_auth_expires_at: recent.expiresAt,
		email_verification_pending: Boolean(session.email_private),
		passkey_registration_available: featureEnabled(env, "PASSKEY_ENABLED"),
	});
}

async function passkeyRegistrationOptions(request: Request, env: PublicWorkerEnv): Promise<Response> {
	const auth = await requireSeller(request, env);
	if (auth instanceof Response) return auth;
	const recent = await requireRecentAuth(request, env, String(auth.seller.id));
	if (recent instanceof Response) return recent;
	const origins = expectedOrigins(env);
	if (!origins.length) return jsonResponse({ error: "passkey_origin_not_configured" }, 503);

	const existing = await env.orderak_db.prepare(
		`SELECT credential_id,transports_json FROM passkey_credentials
		 WHERE seller_id=? AND status='active'`,
	).bind(auth.seller.id).all<{ credential_id: string; transports_json: string }>();
	const userBytes = Uint8Array.from(new TextEncoder().encode(String(auth.seller.id)));
	const options = await generateRegistrationOptions({
		rpName: RP_NAME,
		rpID: rpId(env),
		userName: auth.phone,
		userID: userBytes,
		userDisplayName: String(auth.seller.store_name ?? auth.phone),
		attestationType: "none",
		timeout: 60_000,
		excludeCredentials: (existing.results ?? []).map((item) => ({
			id: item.credential_id,
			transports: transports(item.transports_json),
		})),
		authenticatorSelection: {
			residentKey: "required",
			userVerification: "required",
		},
		supportedAlgorithmIDs: [-7, -257],
	});
	const challengeId = newUuid();
	await env.orderak_db.prepare(
		`INSERT INTO webauthn_challenges(
		 id,challenge_hash,ceremony,seller_id,webauthn_user_id,expires_at)
		 VALUES(?,?,'registration',?,?,datetime('now',?))`,
	).bind(
		challengeId,
		await sha256Hex(options.challenge),
		auth.seller.id,
		options.user.id,
		`+${WEBAUTHN_CHALLENGE_MINUTES} minutes`,
	).run();
	return jsonResponse({ ok: true, challenge_id: challengeId, options_json: JSON.stringify(options) });
}

async function passkeyRegistrationComplete(request: Request, env: PublicWorkerEnv): Promise<Response> {
	const auth = await requireSeller(request, env);
	if (auth instanceof Response) return auth;
	const recent = await requireRecentAuth(request, env, String(auth.seller.id));
	if (recent instanceof Response) return recent;
	const body = await readObject(request);
	const challengeId = string(body.challenge_id, 100);
	const response = registrationResponse(body.response);
	if (!challengeId || !response) return jsonResponse({ error: "invalid_passkey_response" }, 400);
	const challenge = await loadAndConsumeChallenge(env, challengeId, "registration", String(auth.seller.id));
	if (challenge instanceof Response) return challenge;

	try {
		const verification = await verifyRegistrationResponse({
			response,
			expectedChallenge: expectedChallenge(challenge.challenge_hash),
			expectedOrigin: expectedOrigins(env),
			expectedRPID: rpId(env),
			requireUserPresence: true,
			requireUserVerification: true,
			supportedAlgorithmIDs: [-7, -257],
		});
		if (!verification.verified || !verification.registrationInfo.userVerified) {
			return jsonResponse({ error: "passkey_verification_failed" }, 401);
		}
		const info = verification.registrationInfo;
		const id = newUuid();
		await env.orderak_db.prepare(
			`INSERT INTO passkey_credentials(
			 id,seller_id,credential_id,credential_public_key,webauthn_user_id,counter,aaguid,
			 transports_json,device_type,backed_up,label)
			 VALUES(?,?,?,?,?,?,?,?,?,?,?)`,
		).bind(
			id,
			auth.seller.id,
			info.credential.id,
			info.credential.publicKey,
			challenge.webauthn_user_id,
			info.credential.counter,
			info.aaguid,
			JSON.stringify(response.response.transports ?? []),
			info.credentialDeviceType,
			info.credentialBackedUp ? 1 : 0,
			string(body.label, 60) || null,
		).run();
		return jsonResponse({ ok: true, id });
	} catch (error) {
		console.error(JSON.stringify({ signal: "passkey_registration_rejected", reason: safeError(error) }));
		return jsonResponse({ error: "passkey_verification_failed" }, 401);
	}
}

async function passkeyAuthenticationOptions(request: Request, env: PublicWorkerEnv): Promise<Response> {
	if (!(await allowAnonymousPasskeyAttempt(env, request))) {
		return jsonResponse({ error: "rate_limited" }, 429);
	}
	if (!expectedOrigins(env).length) return jsonResponse({ error: "passkey_origin_not_configured" }, 503);
	const options = await generateAuthenticationOptions({
		rpID: rpId(env),
		timeout: 60_000,
		userVerification: "required",
	});
	const challengeId = newUuid();
	await env.orderak_db.prepare(
		`INSERT INTO webauthn_challenges(id,challenge_hash,ceremony,expires_at)
		 VALUES(?,?,'authentication',datetime('now',?))`,
	).bind(challengeId, await sha256Hex(options.challenge), `+${WEBAUTHN_CHALLENGE_MINUTES} minutes`).run();
	return jsonResponse({ ok: true, challenge_id: challengeId, options_json: JSON.stringify(options) });
}

async function passkeyAuthenticationComplete(request: Request, env: PublicWorkerEnv): Promise<Response> {
	if (!(await allowAnonymousPasskeyAttempt(env, request))) {
		return jsonResponse({ error: "rate_limited" }, 429);
	}
	const body = await readObject(request);
	const challengeId = string(body.challenge_id, 100);
	const response = authenticationResponse(body.response);
	const deviceSecret = string(body.device_secret, 200);
	if (!challengeId || !response || deviceSecret.length < 20) {
		return jsonResponse({ error: "invalid_passkey_response" }, 400);
	}
	const challenge = await loadAndConsumeChallenge(env, challengeId, "authentication", null);
	if (challenge instanceof Response) return challenge;
	const stored = await env.orderak_db.prepare(
		`SELECT p.*,s.phone,s.status account_status,s.store_name,s.slug,s.store_code,s.country_code,
		        s.public_identifier,s.business_category,s.city_geoname_id,s.city_catalog_id,
		        s.city_catalog_version,s.city_name
		 FROM passkey_credentials p JOIN sellers s ON s.id=p.seller_id
		 WHERE p.credential_id=? AND p.status='active'`,
	).bind(response.id).first<PasskeyRow & Row>();
	if (!stored) return jsonResponse({ error: "passkey_not_found" }, 401);
	if (String(stored.account_status) !== "active") {
		return jsonResponse({ error: "account_restricted", status: stored.account_status }, 403);
	}
	if (
		response.response.userHandle != null
		&& response.response.userHandle !== stored.webauthn_user_id
	) {
		return jsonResponse({ error: "passkey_verification_failed" }, 401);
	}

	const credential: WebAuthnCredential = {
		id: stored.credential_id,
		publicKey: Uint8Array.from(new Uint8Array(stored.credential_public_key)),
		counter: Number(stored.counter),
		transports: transports(stored.transports_json),
	};
	try {
		const verification = await verifyAuthenticationResponse({
			response,
			expectedChallenge: expectedChallenge(challenge.challenge_hash),
			expectedOrigin: expectedOrigins(env),
			expectedRPID: rpId(env),
			credential,
			requireUserVerification: true,
		});
		if (!verification.verified || !verification.authenticationInfo.userVerified) {
			return jsonResponse({ error: "passkey_verification_failed" }, 401);
		}
		const seller = await env.orderak_db.prepare("SELECT * FROM sellers WHERE id=?")
			.bind(stored.seller_id).first<Row>();
		if (!seller) return jsonResponse({ error: "auth" }, 401);
		const provisioned = await provisionDeviceSecret(
			env,
			seller,
			String(stored.phone),
			deviceSecret,
		);
		if (!provisioned.ok) return provisioned.response;
		await env.orderak_db.prepare(
			`UPDATE passkey_credentials SET counter=?,device_type=?,backed_up=?,
			 last_used_at=datetime('now'),updated_at=datetime('now') WHERE id=?`,
		).bind(
			verification.authenticationInfo.newCounter,
			verification.authenticationInfo.credentialDeviceType,
			verification.authenticationInfo.credentialBackedUp ? 1 : 0,
			stored.id,
		).run();
		const recent = await issueRecentAuth(env, stored.seller_id, "passkey");
		return jsonResponse({
			ok: true,
			exists: true,
			phone: stored.phone,
			store: fullStore(seller),
			recent_auth_token: recent.token,
			recent_auth_expires_at: recent.expiresAt,
		});
	} catch (error) {
		console.error(JSON.stringify({ signal: "passkey_authentication_rejected", reason: safeError(error) }));
		return jsonResponse({ error: "passkey_verification_failed" }, 401);
	}
}

async function listPasskeys(request: Request, env: PublicWorkerEnv, url: URL): Promise<Response> {
	const auth = await requireSeller(request, env, url);
	if (auth instanceof Response) return auth;
	const { results } = await env.orderak_db.prepare(
		`SELECT id,label,device_type,backed_up,created_at,last_used_at
		 FROM passkey_credentials WHERE seller_id=? AND status='active'
		 ORDER BY created_at DESC`,
	).bind(auth.seller.id).all<Row>();
	return jsonResponse({ ok: true, passkeys: results ?? [] });
}

async function mutatePasskey(
	request: Request,
	env: PublicWorkerEnv,
	url: URL,
	passkeyId: string,
): Promise<Response> {
	const auth = await requireSeller(request, env, url);
	if (auth instanceof Response) return auth;
	const recent = await requireRecentAuth(request, env, String(auth.seller.id));
	if (recent instanceof Response) return recent;
	const owned = await env.orderak_db.prepare(
		"SELECT id FROM passkey_credentials WHERE id=? AND seller_id=? AND status='active'",
	).bind(passkeyId, auth.seller.id).first();
	if (!owned) return jsonResponse({ error: "passkey_not_found" }, 404);

	if (request.method === "DELETE") {
		await env.orderak_db.prepare(
			`UPDATE passkey_credentials SET status='revoked',revoked_at=datetime('now'),
			 updated_at=datetime('now') WHERE id=? AND seller_id=?`,
		).bind(passkeyId, auth.seller.id).run();
		return jsonResponse({ ok: true });
	}
	const body = await readObject(request);
	const label = string(body.label, 60).trim();
	if (!label) return jsonResponse({ error: "invalid_label" }, 400);
	await env.orderak_db.prepare(
		"UPDATE passkey_credentials SET label=?,updated_at=datetime('now') WHERE id=? AND seller_id=?",
	).bind(label, passkeyId, auth.seller.id).run();
	return jsonResponse({ ok: true });
}

async function resendEmailVerification(
	request: Request,
	env: PublicWorkerEnv,
	url: URL,
	ctx: ExecutionContext,
): Promise<Response> {
	const auth = await requireSeller(request, env, url);
	if (auth instanceof Response) return auth;
	const recent = await requireRecentAuth(request, env, String(auth.seller.id));
	if (recent instanceof Response) return recent;
	const profile = await env.orderak_db.prepare(
		"SELECT full_name,email_private,email_verified_at FROM seller_profiles WHERE seller_id=?",
	).bind(auth.seller.id).first<{ full_name: string; email_private: string | null; email_verified_at: string | null }>();
	if (!profile?.email_private) return jsonResponse({ error: "email_not_configured" }, 409);
	if (profile.email_verified_at) return jsonResponse({ ok: true, already_verified: true });
	const recentCount = await env.orderak_db.prepare(
		`SELECT COUNT(*) count FROM email_verification_tokens
		 WHERE seller_id=? AND kind='resend' AND created_at>datetime('now','-1 hour')`,
	).bind(auth.seller.id).first<{ count: number }>();
	if (Number(recentCount?.count ?? 0) >= 3) return jsonResponse({ error: "rate_limited" }, 429);

	const token = randomToken();
	await env.orderak_db.prepare(
		`INSERT INTO email_verification_tokens(id,seller_id,email,token_hash,kind,expires_at)
		 VALUES(?,?,?,?,'resend',datetime('now',?))`,
	).bind(
		newUuid(),
		auth.seller.id,
		profile.email_private,
		await sha256Hex(token),
		`+${EMAIL_TOKEN_HOURS} hours`,
	).run();
	await sendVerificationEmail(env, ctx, profile.email_private, profile.full_name, token, pickLocale(request, url));
	return jsonResponse({ ok: true });
}

async function requireSeller(
	request: Request,
	env: PublicWorkerEnv,
	url = new URL(request.url),
): Promise<{ seller: Row; phone: string; secret: string } | Response> {
	const { phone, secret } = readCreds(request, url);
	const seller = await authSeller(env, phone, secret);
	if (!seller) return jsonResponse({ error: "auth" }, 401);
	if (String(seller.status ?? "active") !== "active") {
		return jsonResponse({ error: "account_restricted", status: seller.status }, 403);
	}
	return { seller, phone, secret };
}

async function requireOnboardingSession(
	request: Request,
	env: PublicWorkerEnv,
	allowCompleted = false,
): Promise<OnboardingRow | Response> {
	const token = bearerToken(request);
	if (!token) return jsonResponse({ error: "onboarding_auth" }, 401);
	const row = await env.orderak_db.prepare(
		"SELECT * FROM onboarding_sessions WHERE token_hash=?",
	).bind(await sha256Hex(token)).first<OnboardingRow>();
	if (!row) return jsonResponse({ error: "onboarding_auth" }, 401);
	if (row.status === "expired" || expired(row.expires_at) || expired(row.absolute_expires_at)) {
		await env.orderak_db.prepare(
			"UPDATE onboarding_sessions SET status='expired',updated_at=datetime('now') WHERE id=? AND status!='completed'",
		).bind(row.id).run();
		return jsonResponse({ error: "onboarding_expired", retry_with: "otp" }, 401);
	}
	if (row.status === "completed" && allowCompleted) return row;
	return row;
}

export async function requireOnboardingGeoContext(
	request: Request,
	env: PublicWorkerEnv,
): Promise<OnboardingGeoContext | Response> {
	const session = await requireOnboardingSession(request, env);
	if (session instanceof Response) return session;
	const countryIso = normalizeCountryIso(session.phone_country_iso);
	if (countryIso === "XX") {
		return jsonResponse({ error: "phone_country_unavailable" }, 409);
	}
	return {
		id: session.id,
		countryIso,
		status: session.status,
	};
}

async function requireRecentAuth(
	request: Request,
	env: PublicWorkerEnv,
	sellerId: string,
): Promise<{ method: string } | Response> {
	// A proof is valid for its whole window, not for a single call, and that is
	// deliberate: registering a passkey is a two-request ceremony (options, then
	// complete) and both requests are gated by this function, so a proof burned
	// on first use would make passkey registration impossible.
	//
	// `consumed_at` is therefore a revocation marker rather than a use counter —
	// see revokeRecentAuthProofs(), which stamps it when the account's
	// authentication state changes underneath an outstanding proof.
	const token = request.headers.get("x-orderak-recent-auth")?.trim() ?? "";
	if (!token) return jsonResponse({ error: "recent_auth_required" }, 401);
	const row = await env.orderak_db.prepare(
		`SELECT method FROM recent_auth_proofs
		 WHERE token_hash=? AND seller_id=? AND consumed_at IS NULL AND expires_at>datetime('now')`,
	).bind(await sha256Hex(token), sellerId).first<{ method: string }>();
	return row ?? jsonResponse({ error: "recent_auth_required" }, 401);
}

/**
 * Invalidate every outstanding step-up proof for a seller.
 *
 * A proof says "this person completed an SMS or passkey challenge in the last
 * ten minutes", and it is handed out once and reused for that window. Nothing
 * ever wrote `consumed_at`, so the column and the `consumed_at IS NULL`
 * predicate guarding every protected operation had no effect at all: a proof
 * outlived the credentials that produced it. Changing the phone number on an
 * account deletes every device secret, and an attacker mid-window kept a valid
 * proof for operations like registering a passkey.
 *
 * Called wherever the authentication state a proof was issued against stops
 * being true. Returns a statement so callers can include it in the same D1
 * batch as the change itself — the revocation must not be able to succeed while
 * the change rolls back, or the reverse.
 */
export function revokeRecentAuthProofsStatement(env: Env, sellerId: string): D1PreparedStatement {
	return env.orderak_db.prepare(
		"UPDATE recent_auth_proofs SET consumed_at=datetime('now') WHERE seller_id=? AND consumed_at IS NULL",
	).bind(sellerId);
}

async function issueRecentAuth(
	env: PublicWorkerEnv,
	sellerId: string,
	method: "otp" | "passkey",
): Promise<{ token: string; expiresAt: string }> {
	const token = randomToken();
	const id = newUuid();
	await env.orderak_db.prepare(
		`INSERT INTO recent_auth_proofs(id,token_hash,seller_id,method,expires_at)
		 VALUES(?,?,?,?,datetime('now',?))`,
	).bind(id, await sha256Hex(token), sellerId, method, `+${RECENT_AUTH_MINUTES} minutes`).run();
	const row = await env.orderak_db.prepare("SELECT expires_at FROM recent_auth_proofs WHERE id=?")
		.bind(id).first<{ expires_at: string }>();
	return { token, expiresAt: row?.expires_at ?? "" };
}

async function loadAndConsumeChallenge(
	env: PublicWorkerEnv,
	id: string,
	ceremony: "registration" | "authentication",
	sellerId: string | null,
): Promise<ChallengeRow | Response> {
	const row = await env.orderak_db.prepare(
		"SELECT * FROM webauthn_challenges WHERE id=? AND ceremony=?",
	).bind(id, ceremony).first<ChallengeRow>();
	if (!row || expired(row.expires_at)) {
		return jsonResponse({ error: "passkey_challenge_expired" }, 401);
	}
	if (row.consumed_at) {
		return jsonResponse({ error: "passkey_challenge_replayed" }, 401);
	}
	if (sellerId != null && row.seller_id !== sellerId) {
		return jsonResponse({ error: "passkey_challenge_mismatch" }, 401);
	}
	const consumed = await env.orderak_db.prepare(
		"UPDATE webauthn_challenges SET consumed_at=datetime('now') WHERE id=? AND consumed_at IS NULL",
	).bind(id).run();
	if (Number(consumed.meta.changes ?? 0) !== 1) {
		return jsonResponse({ error: "passkey_challenge_replayed" }, 401);
	}
	return row;
}

function expectedChallenge(hash: string): (challenge: string) => Promise<boolean> {
	return async (challenge) => constantTimeEqual(await sha256Hex(challenge), hash);
}

function expectedOrigins(env: PublicWorkerEnv): string[] {
	const configured = String(env.WEBAUTHN_ANDROID_ORIGINS ?? "")
		.split(",")
		.map((value) => value.trim())
		.filter((value) => /^android:apk-key-hash:[A-Za-z0-9_-]{43}$/.test(value));
	const allowedWebOrigin = rpId(env) === "staging.orderak.app"
		? "https://staging.orderak.app"
		: "https://orderak.app";
	if (env.WEBAUTHN_WEB_ORIGIN === allowedWebOrigin) configured.push(env.WEBAUTHN_WEB_ORIGIN);
	return [...new Set(configured)];
}

function rpId(env: PublicWorkerEnv): string {
	const configured = String(env.WEBAUTHN_RP_ID ?? "").trim().toLowerCase();
	return configured === "staging.orderak.app" ? configured : PRODUCTION_RP_ID;
}

function registrationResponse(value: unknown): RegistrationResponseJSON | null {
	if (!isObject(value) || typeof value.id !== "string" || typeof value.rawId !== "string" || value.type !== "public-key") {
		return null;
	}
	if (!isObject(value.response) || typeof value.response.clientDataJSON !== "string" || typeof value.response.attestationObject !== "string") {
		return null;
	}
	return {
		id: value.id,
		rawId: value.rawId,
		type: "public-key",
		clientExtensionResults: isObject(value.clientExtensionResults) ? value.clientExtensionResults : {},
		authenticatorAttachment: value.authenticatorAttachment === "platform" || value.authenticatorAttachment === "cross-platform"
			? value.authenticatorAttachment
			: undefined,
		response: {
			clientDataJSON: value.response.clientDataJSON,
			attestationObject: value.response.attestationObject,
			authenticatorData: typeof value.response.authenticatorData === "string" ? value.response.authenticatorData : undefined,
			publicKey: typeof value.response.publicKey === "string" ? value.response.publicKey : undefined,
			publicKeyAlgorithm: typeof value.response.publicKeyAlgorithm === "number" ? value.response.publicKeyAlgorithm : undefined,
			transports: Array.isArray(value.response.transports)
				? value.response.transports.filter((item): item is AuthenticatorTransportFuture => typeof item === "string")
				: undefined,
		},
	};
}

function authenticationResponse(value: unknown): AuthenticationResponseJSON | null {
	if (!isObject(value) || typeof value.id !== "string" || typeof value.rawId !== "string" || value.type !== "public-key") {
		return null;
	}
	if (
		!isObject(value.response)
		|| typeof value.response.clientDataJSON !== "string"
		|| typeof value.response.authenticatorData !== "string"
		|| typeof value.response.signature !== "string"
	) return null;
	return {
		id: value.id,
		rawId: value.rawId,
		type: "public-key",
		clientExtensionResults: isObject(value.clientExtensionResults) ? value.clientExtensionResults : {},
		authenticatorAttachment: value.authenticatorAttachment === "platform" || value.authenticatorAttachment === "cross-platform"
			? value.authenticatorAttachment
			: undefined,
		response: {
			clientDataJSON: value.response.clientDataJSON,
			authenticatorData: value.response.authenticatorData,
			signature: value.response.signature,
			userHandle: typeof value.response.userHandle === "string" ? value.response.userHandle : undefined,
		},
	};
}

function transports(json: string): AuthenticatorTransportFuture[] | undefined {
	try {
		const parsed: unknown = JSON.parse(json);
		if (!Array.isArray(parsed)) return undefined;
		return parsed.filter((item): item is AuthenticatorTransportFuture => typeof item === "string");
	} catch {
		return undefined;
	}
}

async function sendVerificationEmail(
	env: PublicWorkerEnv,
	ctx: ExecutionContext,
	email: string,
	name: string,
	token: string,
	locale: string,
): Promise<void> {
	await getEmailService(env, ctx).send(
		"account_email_verification",
		email,
		{
			name,
			verify_url: `https://orderak.app/verify-email?token=${encodeURIComponent(token)}`,
			expires_hours: String(EMAIL_TOKEN_HOURS),
		},
		locale,
		{ privateRecipient: true },
	);
}

async function currentLegalVersion(env: PublicWorkerEnv, slug: "terms" | "privacy", locale: string) {
	return env.orderak_db.prepare(
		`SELECT version,lang FROM content_page_versions
		 WHERE slug=? AND status='published'
		 ORDER BY CASE WHEN lang=? THEN 0 WHEN lang='en' THEN 1 ELSE 2 END,version DESC LIMIT 1`,
	).bind(slug, locale).first<{ version: number; lang: string }>();
}

async function allowPreAuthAttempt(
	env: PublicWorkerEnv,
	request: Request,
	prefix: string,
	phone: string,
	phoneLimit: number,
	ipLimit: number,
	windowSeconds: number,
): Promise<boolean> {
	const ip = request.headers.get("cf-connecting-ip")?.trim() || "unknown";
	const [phoneAllowed, ipAllowed] = await Promise.all([
		checkRateLimit(env, `${prefix}:phone:${phone}`, phoneLimit, windowSeconds),
		checkRateLimit(env, `${prefix}:ip:${ip}`, ipLimit, windowSeconds),
	]);
	return phoneAllowed && ipAllowed;
}

async function allowAnonymousPasskeyAttempt(env: PublicWorkerEnv, request: Request): Promise<boolean> {
	const ip = request.headers.get("cf-connecting-ip")?.trim() || "unknown";
	return checkRateLimit(env, `passkey:ip:${ip}`, 60, 60);
}

function featureEnabled(
	env: PublicWorkerEnv,
	key:
		| "PASSKEY_ENABLED"
		| "ONBOARDING_ENABLED"
		| "BUSINESS_TAXONOMY_ENABLED",
): boolean {
	return env[key] === "true";
}

function featureDisabled(feature: string): Response {
	return jsonResponse({ error: "feature_disabled", feature }, 503);
}

async function readObject(request: Request): Promise<Row> {
	try {
		const value: unknown = await request.json();
		return isObject(value) ? value : {};
	} catch {
		return {};
	}
}

function isObject(value: unknown): value is Row {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function string(value: unknown, max: number): string {
	return typeof value === "string" ? value.trim().slice(0, max) : "";
}

function validE164(value: string): boolean {
	return /^\+[1-9]\d{6,14}$/.test(value);
}

function validatedPhoneCountryIso(phone: string, requestedValue: unknown): string | null {
	const parsed = parsePhoneNumberFromString(phone);
	if (!parsed?.isValid()) return null;
	const requested = string(requestedValue, 2).toUpperCase();
	if (!requested) return parsed.country ?? null;
	if (!/^[A-Z]{2}$/.test(requested)) return null;
	try {
		const country = requested as CountryCode;
		if (getCountryCallingCode(country) !== parsed.countryCallingCode) return null;
		return requested;
	} catch {
		return null;
	}
}

async function activeTaxonomySelection(
	env: PublicWorkerEnv,
	categoryId: string,
	subcategoryId: string,
): Promise<{
	category_id: string;
	category_key: string;
	subcategory_id: string;
	version_id: number;
} | null> {
	return env.orderak_db.prepare(
		`SELECT c.id category_id,c.key category_key,s.id subcategory_id,c.version_id
		 FROM business_categories c
		 JOIN business_subcategories s
		   ON s.category_id=c.id AND s.version_id=c.version_id
		 JOIN business_taxonomy_versions v
		   ON v.id=c.version_id AND v.status='active'
		 WHERE c.id=? AND s.id=? AND c.active=1 AND s.active=1`,
	).bind(categoryId, subcategoryId).first<{
		category_id: string;
		category_key: string;
		subcategory_id: string;
		version_id: number;
	}>();
}

async function activeCategorySelection(
	env: PublicWorkerEnv,
	categoryId: string,
): Promise<{
	category_id: string;
	category_key: string;
	subcategory_id: null;
	version_id: number;
} | null> {
	const row = await env.orderak_db.prepare(
		`SELECT c.id category_id,c.key category_key,c.version_id
		 FROM business_categories c
		 JOIN business_taxonomy_versions v ON v.id=c.version_id AND v.status='active'
		 WHERE c.id=? AND c.active=1 LIMIT 1`,
	).bind(categoryId).first<{
		category_id: string;
		category_key: string;
		version_id: number;
	}>();
	return row ? { ...row, subcategory_id: null } : null;
}

function normalizeEmail(value: unknown): string | null {
	const email = string(value, 254).toLowerCase();
	if (!email) return null;
	return /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email) ? email : null;
}

function positiveInteger(value: unknown): number | null {
	const number = Number(value);
	return Number.isSafeInteger(number) && number > 0 ? number : null;
}

function validBirthYear(value: unknown): number | null {
	return typeof value === "number"
		&& Number.isSafeInteger(value)
		&& value >= 1900
		&& value <= new Date().getUTCFullYear()
		? value
		: null;
}

function bearerToken(request: Request): string {
	const authorization = request.headers.get("authorization") ?? "";
	return authorization.startsWith("Bearer ") ? authorization.slice(7).trim() : "";
}

function freshFirebaseProof(authTime: number | undefined): boolean {
	if (authTime == null) return false;
	const age = Math.floor(Date.now() / 1000) - authTime;
	return age >= 0 && age <= 5 * 60;
}

function expired(sqliteDate: string): boolean {
	const normalized = sqliteDate.includes("T") ? sqliteDate : sqliteDate.replace(" ", "T") + "Z";
	return Date.parse(normalized) <= Date.now();
}

function safeError(error: unknown): string {
	return (error instanceof Error ? error.message : "unknown").slice(0, 120);
}

function verificationPage(success: boolean): Response {
	const title = success ? "Email verified" : "Verification link is invalid or expired";
	const body = success
		? "Your private account email is now verified. You can return to the Orderak app."
		: "Request a new verification link from Account settings in the Orderak app.";
	return new Response(
		`<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width">
		 <title>${title}</title><body style="font-family:system-ui;max-width:560px;margin:15vh auto;padding:24px">
		 <h1>${title}</h1><p>${body}</p><a href="https://orderak.app">Orderak</a></body></html>`,
		{
			status: success ? 200 : 400,
			headers: {
				"content-type": "text/html; charset=utf-8",
				"cache-control": "no-store",
				"content-security-policy": "default-src 'none'; style-src 'unsafe-inline'; base-uri 'none'; frame-ancestors 'none'",
			},
		},
	);
}
