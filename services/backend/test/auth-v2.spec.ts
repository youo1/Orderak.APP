import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createExecutionContext, env } from "cloudflare:test";
import { assetLinksResponse, handleAuthV2Routes, handleEmailVerification } from "../src/domains/identity/auth-v2";
import { sha256Hex } from "../src/domains/identity/auth";
import { publicSiteUrl, storeUrl } from "../src/domains/identity/identity";
import { BASE, createSchema } from "./helpers";

const PHONE = "+201001234567";
const DEVICE_SECRET = "device-secret-with-enough-entropy";
let testEnv: TestEnv;
// The Firebase lookup stub echoes the phone number of the test that is
// currently onboarding. Each added test uses its own E.164 number so the
// per-phone rate-limit Durable Object is not exhausted for later tests.
let firebasePhone = PHONE;

function freshFirebaseToken(): string {
	const payload = btoa(JSON.stringify({ auth_time: Math.floor(Date.now() / 1000) }))
		.replaceAll("+", "-")
		.replaceAll("/", "_")
		.replace(/=+$/, "");
	return `header.${payload}.signature`;
}

function firebaseTokenAt(authTime: number): string {
	const payload = btoa(JSON.stringify({ auth_time: authTime }))
		.replaceAll("+", "-")
		.replaceAll("/", "_")
		.replace(/=+$/, "");
	return `header.${payload}.signature`;
}

function fakeAuthenticationResponse(id = "unknown-credential", userHandle?: string) {
	return {
		id,
		rawId: id,
		type: "public-key",
		clientExtensionResults: {},
		response: {
			clientDataJSON: "e30",
			authenticatorData: "AA",
			signature: "AA",
			...(userHandle == null ? {} : { userHandle }),
		},
	};
}

async function route(
	path: string,
	body: Record<string, unknown>,
	headers: Record<string, string> = {},
): Promise<Response> {
	const request = new Request(`${BASE}${path}`, {
		method: "POST",
		headers: { "content-type": "application/json", "cf-connecting-ip": "203.0.113.60", ...headers },
		body: JSON.stringify(body),
	});
	const response = await handleAuthV2Routes(request, testEnv, new URL(request.url), createExecutionContext());
	if (!response) throw new Error(`route_not_handled:${path}`);
	return response;
}

async function beginOnboarding(phone = PHONE): Promise<string> {
	firebasePhone = phone;
	const response = await route("/api/v1/auth/phone/complete", {
		id_token: freshFirebaseToken(),
		phone,
		device_secret: DEVICE_SECRET,
	});
	expect(response.status).toBe(200);
	const body = await response.json<Record<string, unknown>>();
	expect(body).toMatchObject({ ok: true, exists: false });
	return String(body.onboarding_token);
}

beforeEach(async () => {
	await createSchema();
	firebasePhone = PHONE;
	testEnv = Object.create(env) as TestEnv;
	testEnv.FIREBASE_WEB_API_KEY = "test-key";
	testEnv.ONBOARDING_ENABLED = "true";
	testEnv.PASSKEY_ENABLED = "true";
	testEnv.STATIC_CITY_CATALOG_ENABLED = "true";
	testEnv.WEBAUTHN_ANDROID_ORIGINS = `android:apk-key-hash:${"A".repeat(43)}`;
	vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL) => {
		const url = String(input);
		if (!url.startsWith("https://identitytoolkit.googleapis.com/v1/accounts:lookup")) {
			throw new Error(`unexpected_fetch:${url}`);
		}
		return Response.json({ users: [{ localId: "firebase-v2-user", phoneNumber: firebasePhone }] });
	}));
});

afterEach(() => {
	vi.unstubAllGlobals();
});

describe("Auth and onboarding V2", () => {
	it("defers legal acceptance until account details and completes atomically", async () => {
		const onboardingToken = await beginOnboarding();
		const before = await env.orderak_db.prepare(
			"SELECT COUNT(*) count FROM legal_acceptances WHERE phone_e164=?",
		).bind(PHONE).first<{ count: number }>();
		expect(Number(before?.count)).toBe(0);

		const account = await route("/api/v1/onboarding/account", {
			full_name: "Ayman Seller",
			age_confirmed: true,
			email: "owner@example.com",
			terms_accepted: true,
			app_version: "2.0.0",
		}, { authorization: `Bearer ${onboardingToken}` });
		expect(account.status).toBe(200);

		const completed = await route("/api/v1/onboarding/complete", {
			device_secret: DEVICE_SECRET,
			store_name: "Global Fashion",
			slug: "global-fashion",
			business_category: "fashion",
			country_iso: "EG",
			city_name: "Cairo",
		}, {
			authorization: `Bearer ${onboardingToken}`,
			"idempotency-key": "onboarding-test-1",
		});
		expect(completed.status).toBe(200);
		const payload = await completed.json<Record<string, unknown>>();
		expect(payload).toMatchObject({ ok: true, exists: true, email_verification_pending: true });
		expect(JSON.stringify(payload)).not.toContain("owner@example.com");
		const recentAuth = String(payload.recent_auth_token);

		const foundation = await env.orderak_db.prepare(
			`SELECT s.business_category,s.city_name,p.full_name,p.birth_year,p.email_private,l.source,
			        l.age_confirmation_source,l.age_confirmation_statement_text,
			        l.age_confirmation_terms_version,l.age_confirmation_confirmed_at
			 FROM sellers s JOIN seller_profiles p ON p.seller_id=s.id
			 JOIN legal_acceptances l ON l.seller_id=s.id WHERE s.phone=?`,
		).bind(PHONE).first<Record<string, unknown>>();
		expect(foundation).toMatchObject({
			business_category: "fashion",
			city_name: "Cairo",
			full_name: "Ayman Seller",
			birth_year: null,
			email_private: "owner@example.com",
			source: "android_onboarding_v2",
			age_confirmation_source: "android_onboarding_v2",
			age_confirmation_statement_text: "عمري ١٨ عامًا أو أكثر",
		});
		expect(foundation?.age_confirmation_terms_version).toBeTruthy();
		expect(foundation?.age_confirmation_confirmed_at).toBeTruthy();

		const resendHeaders = {
			"x-orderak-phone": PHONE,
			"x-orderak-secret": DEVICE_SECRET,
			"x-orderak-recent-auth": recentAuth,
		};
		for (let attempt = 0; attempt < 3; attempt++) {
			const resend = await route("/api/v1/account/email/verification/resend", {}, resendHeaders);
			expect(resend.status).toBe(200);
		}
		const fourthResend = await route("/api/v1/account/email/verification/resend", {}, resendHeaders);
		expect(fourthResend.status).toBe(429);
		expect(await fourthResend.json()).toMatchObject({ code: "rate_limited" });

		const replay = await route("/api/v1/onboarding/complete", {
			device_secret: DEVICE_SECRET,
			store_name: "Ignored",
			business_category: "other",
			country_iso: "EG",
			city_name: "Giza",
		}, { authorization: `Bearer ${onboardingToken}` });
		expect(replay.status).toBe(200);
		expect(await replay.json()).toMatchObject({ ok: true, idempotent: true });
		const evidenceCount = await env.orderak_db.prepare(
			"SELECT COUNT(*) count FROM legal_acceptances WHERE phone_e164=?",
		).bind(PHONE).first<{ count: number }>();
		expect(Number(evidenceCount?.count)).toBe(1);
	});

	it("requires only a global category during onboarding and rejects invalid supplied pairs", async () => {
		testEnv.BUSINESS_TAXONOMY_ENABLED = "true";
		const onboardingToken = await beginOnboarding();
		await route("/api/v1/onboarding/account", {
			full_name: "Taxonomy Seller",
			birth_year: 1991,
			terms_accepted: true,
			app_version: "2.0.0",
		}, { authorization: `Bearer ${onboardingToken}` });

		const invalid = await route("/api/v1/onboarding/complete", {
			device_secret: DEVICE_SECRET,
			store_name: "Taxonomy Shop",
			slug: "taxonomy-shop",
			business_category: "fashion",
			business_category_id: "fashion",
			business_subcategory_id: "not_in_category",
			country_iso: "EG",
			city_name: "Cairo",
		}, { authorization: `Bearer ${onboardingToken}` });
		expect(invalid.status).toBe(400);
		expect(await invalid.json()).toMatchObject({ code: "invalid_business_category" });

		const valid = await route("/api/v1/onboarding/complete", {
			device_secret: DEVICE_SECRET,
			store_name: "Taxonomy Shop",
			slug: "taxonomy-shop",
			business_category: "fashion",
			business_category_id: "fashion",
			country_iso: "EG",
			city_name: "Cairo",
		}, { authorization: `Bearer ${onboardingToken}` });
		expect(valid.status).toBe(200);
		expect(await valid.json()).toMatchObject({
			ok: true,
			store: {
				business_category_id: "fashion",
				business_subcategory_id: null,
			},
		});
	});

	it("requires explicit legal acceptance and preserves the draft session", async () => {
		const onboardingToken = await beginOnboarding();
		const response = await route("/api/v1/onboarding/account", {
			full_name: "Ayman Seller",
			birth_year: 1988,
			terms_accepted: false,
		}, { authorization: `Bearer ${onboardingToken}` });
		expect(response.status).toBe(400);
		expect(await response.json()).toMatchObject({ code: "legal_acceptance_required" });
		const session = await env.orderak_db.prepare(
			"SELECT status FROM onboarding_sessions WHERE phone_e164=?",
		).bind(PHONE).first<{ status: string }>();
		expect(session?.status).toBe("phone_verified");
	});

	it("requires affirmative age confirmation or a valid legacy birth year", async () => {
		const onboardingToken = await beginOnboarding();
		const headers = { authorization: `Bearer ${onboardingToken}` };
		for (const body of [
			{ full_name: "Ayman Seller", terms_accepted: true, app_version: "2.0.0" },
			{ full_name: "Ayman Seller", age_confirmed: false, terms_accepted: true },
			{ full_name: "Ayman Seller", age_confirmed: "true", terms_accepted: true },
			{ full_name: "Ayman Seller", birth_year: 1899, terms_accepted: true },
		]) {
			const response = await route("/api/v1/onboarding/account", body, headers);
			expect(response.status).toBe(400);
			expect(await response.json()).toMatchObject({ code: "age_confirmation_required" });
		}
		const session = await env.orderak_db.prepare(
			"SELECT status,birth_year,age_confirmation_source FROM onboarding_sessions WHERE phone_e164=?",
		).bind(PHONE).first<{ status: string; birth_year: number | null; age_confirmation_source: string | null }>();
		expect(session).toEqual({
			status: "phone_verified",
			birth_year: null,
			age_confirmation_source: null,
		});

		// An installed client that sends only a valid birth year is still accepted,
		// but the year is never persisted and the evidence statement stays NULL.
		const legacy = await route("/api/v1/onboarding/account", {
			full_name: "Legacy Seller",
			birth_year: 1990,
			terms_accepted: true,
			app_version: "2.0.0",
		}, headers);
		expect(legacy.status).toBe(200);
		const legacySession = await env.orderak_db.prepare(
			"SELECT birth_year,age_confirmation_source FROM onboarding_sessions WHERE phone_e164=?",
		).bind(PHONE).first<{ birth_year: number | null; age_confirmation_source: string | null }>();
		expect(legacySession).toEqual({
			birth_year: null,
			age_confirmation_source: "android_onboarding_v2_legacy_birth_year",
		});
	});

	it("creates a minimal store with optional category and city persisted as NULL", async () => {
		const phone = "+201001234571";
		const onboardingToken = await beginOnboarding(phone);
		await route("/api/v1/onboarding/account", {
			full_name: "Minimal Seller",
			age_confirmed: true,
			terms_accepted: true,
		}, { authorization: `Bearer ${onboardingToken}` });
		const completed = await route("/api/v1/onboarding/complete", {
			device_secret: DEVICE_SECRET,
			store_name: "Owner Only Shop",
			country_iso: "EG",
		}, { authorization: `Bearer ${onboardingToken}` });
		expect(completed.status).toBe(200);
		const body = await completed.json<Record<string, unknown>>();
		expect(body.store_url).toBeTruthy();
		const row = await env.orderak_db.prepare(
			`SELECT business_category,business_category_id,business_subcategory_id,
			        city_geoname_id,city_catalog_id,city_catalog_version,city_name
			 FROM sellers WHERE phone=?`,
		).bind(phone).first<Record<string, unknown>>();
		expect(row).toEqual({
			business_category: null,
			business_category_id: null,
			business_subcategory_id: null,
			city_geoname_id: null,
			city_catalog_id: null,
			city_catalog_version: null,
			city_name: null,
		});
	});

	it("validates category and city independently when only one is supplied", async () => {
		const phone = "+201001234572";
		const onboardingToken = await beginOnboarding(phone);
		await route("/api/v1/onboarding/account", {
			full_name: "Partial Seller",
			age_confirmed: true,
			terms_accepted: true,
		}, { authorization: `Bearer ${onboardingToken}` });

		const badCity = await route("/api/v1/onboarding/complete", {
			device_secret: DEVICE_SECRET,
			store_name: "Partial Shop",
			country_iso: "EG",
			city_name: "A",
		}, { authorization: `Bearer ${onboardingToken}` });
		expect(badCity.status).toBe(400);
		expect(await badCity.json()).toMatchObject({ code: "invalid_city" });

		// A supplied empty or whitespace-only name is not the same as omitting
		// the optional city: it must not be silently dropped.
		for (const cityName of ["", "   "]) {
			const blankCity = await route("/api/v1/onboarding/complete", {
				device_secret: DEVICE_SECRET,
				store_name: "Partial Shop",
				country_iso: "EG",
				city_name: cityName,
			}, { authorization: `Bearer ${onboardingToken}` });
			expect(blankCity.status).toBe(400);
			expect(await blankCity.json()).toMatchObject({ code: "invalid_city" });
		}

		const badCategory = await route("/api/v1/onboarding/complete", {
			device_secret: DEVICE_SECRET,
			store_name: "Partial Shop",
			country_iso: "EG",
			business_category: "not_a_real_category",
		}, { authorization: `Bearer ${onboardingToken}` });
		expect(badCategory.status).toBe(400);
		expect(await badCategory.json()).toMatchObject({ code: "invalid_business_category" });
	});

	it("records legacy birth-year evidence with a NULL statement and no stored year", async () => {
		const phone = "+201001234573";
		const onboardingToken = await beginOnboarding(phone);
		await route("/api/v1/onboarding/account", {
			full_name: "Legacy Seller",
			birth_year: 1988,
			terms_accepted: true,
			app_version: "2.0.0",
		}, { authorization: `Bearer ${onboardingToken}` });
		const completed = await route("/api/v1/onboarding/complete", {
			device_secret: DEVICE_SECRET,
			store_name: "Legacy Shop",
			business_category: "fashion",
			country_iso: "EG",
			city_name: "Cairo",
		}, { authorization: `Bearer ${onboardingToken}` });
		expect(completed.status).toBe(200);

		const evidence = await env.orderak_db.prepare(
			`SELECT l.age_confirmation_source source,l.age_confirmation_statement_text statement_text,
			        l.age_confirmation_terms_version terms_version,l.age_confirmation_confirmed_at confirmed_at,
			        o.birth_year session_birth_year,p.birth_year profile_birth_year
			 FROM sellers s JOIN legal_acceptances l ON l.seller_id=s.id
			 JOIN onboarding_sessions o ON o.phone_e164=s.phone
			 JOIN seller_profiles p ON p.seller_id=s.id WHERE s.phone=?`,
		).bind(phone).first<Record<string, unknown>>();
		expect(evidence).toMatchObject({
			source: "android_onboarding_v2_legacy_birth_year",
			statement_text: null,
			session_birth_year: null,
			profile_birth_year: null,
		});
		expect(evidence?.terms_version).toBeTruthy();
		expect(evidence?.confirmed_at).toBeTruthy();
	});

	it("completes a pre-deploy account_saved session as legacy with a NULL statement", async () => {
		const phone = "+201001234574";
		const onboardingToken = await beginOnboarding(phone);
		await route("/api/v1/onboarding/account", {
			full_name: "Pre-deploy Seller",
			age_confirmed: true,
			terms_accepted: true,
			app_version: "3.0.0",
		}, { authorization: `Bearer ${onboardingToken}` });
		// The previous Worker saved the account step with the birth year on the
		// session and no source marker. Deployment must not strand this draft.
		await env.orderak_db.prepare(
			`UPDATE onboarding_sessions SET age_confirmation_source=NULL,birth_year=1988
			 WHERE phone_e164=?`,
		).bind(phone).run();

		const completed = await route("/api/v1/onboarding/complete", {
			device_secret: DEVICE_SECRET,
			store_name: "Pre-deploy Shop",
			country_iso: "EG",
		}, { authorization: `Bearer ${onboardingToken}` });
		expect(completed.status).toBe(200);

		const evidence = await env.orderak_db.prepare(
			`SELECT l.age_confirmation_source source,l.age_confirmation_statement_text statement_text,
			        l.age_confirmation_terms_version terms_version,l.age_confirmation_confirmed_at confirmed_at,
			        o.birth_year session_birth_year,p.birth_year profile_birth_year
			 FROM sellers s JOIN legal_acceptances l ON l.seller_id=s.id
			 JOIN onboarding_sessions o ON o.phone_e164=s.phone
			 JOIN seller_profiles p ON p.seller_id=s.id WHERE s.phone=?`,
		).bind(phone).first<Record<string, unknown>>();
		expect(evidence).toMatchObject({
			source: "android_onboarding_v2_legacy_birth_year",
			statement_text: null,
			session_birth_year: null,
			profile_birth_year: null,
		});
		expect(evidence?.terms_version).toBeTruthy();
		expect(evidence?.confirmed_at).toBeTruthy();
	});

	it("consumes a private-email verification link exactly once", async () => {
		const rawToken = "single-use-email-verification-token";
		await env.orderak_db.batch([
			env.orderak_db.prepare(
				`INSERT INTO sellers(id,store_code,store_name,phone,secret)
				 VALUES('seller-email','EMAIL001','Email Store',?,'sha256$test')`,
			).bind(PHONE),
			env.orderak_db.prepare(
				`INSERT INTO seller_profiles(seller_id,full_name,birth_year,email_private)
				 VALUES('seller-email','Email Owner',1988,'owner@example.com')`,
			),
			env.orderak_db.prepare(
				`INSERT INTO email_verification_tokens(id,seller_id,email,token_hash,expires_at)
				 VALUES('email-token','seller-email','owner@example.com',?,datetime('now','+24 hours'))`,
			).bind(await sha256Hex(rawToken)),
		]);
		const request = new Request(`${BASE.replace("api.", "")}/verify-email?token=${rawToken}`);
		const first = await handleEmailVerification(request, testEnv, new URL(request.url));
		const replay = await handleEmailVerification(request, testEnv, new URL(request.url));
		expect(first?.status).toBe(200);
		expect(replay?.status).toBe(400);
		const profile = await env.orderak_db.prepare(
			"SELECT email_verified_at FROM seller_profiles WHERE seller_id='seller-email'",
		).first<{ email_verified_at: string | null }>();
		expect(profile?.email_verified_at).toBeTruthy();
	});

	it("returns discoverable authentication options without phone enumeration", async () => {
		const response = await route("/api/v1/auth/passkeys/authentication/options", {});
		expect(response.status).toBe(200);
		const body = await response.json<{ options_json: string; challenge_id: string }>();
		const options = JSON.parse(body.options_json) as Record<string, unknown>;
		expect(options.rpId).toBe("orderak.app");
		expect(options.userVerification).toBe("required");
		expect(options.allowCredentials).toBeUndefined();
		const challenge = String(options.challenge);
		const stored = await env.orderak_db.prepare(
			"SELECT challenge_hash FROM webauthn_challenges WHERE id=?",
		).bind(body.challenge_id).first<{ challenge_hash: string }>();
		expect(stored?.challenge_hash).toBe(await sha256Hex(challenge));
		expect(stored?.challenge_hash).not.toBe(challenge);
	});

	it("rejects expired and replayed passkey challenges", async () => {
		const expiredOptions = await route("/api/v1/auth/passkeys/authentication/options", {});
		const expiredBody = await expiredOptions.json<{ challenge_id: string }>();
		await env.orderak_db.prepare(
			"UPDATE webauthn_challenges SET expires_at=datetime('now','-1 minute') WHERE id=?",
		).bind(expiredBody.challenge_id).run();
		const expiredAttempt = await route("/api/v1/auth/passkeys/authentication/complete", {
			challenge_id: expiredBody.challenge_id,
			response: fakeAuthenticationResponse(),
			device_secret: DEVICE_SECRET,
		});
		expect(expiredAttempt.status).toBe(401);
		expect(await expiredAttempt.json()).toMatchObject({ code: "passkey_challenge_expired" });

		const options = await route("/api/v1/auth/passkeys/authentication/options", {});
		const body = await options.json<{ challenge_id: string }>();
		const first = await route("/api/v1/auth/passkeys/authentication/complete", {
			challenge_id: body.challenge_id,
			response: fakeAuthenticationResponse(),
			device_secret: DEVICE_SECRET,
		});
		expect(first.status).toBe(401);
		expect(await first.json()).toMatchObject({ code: "passkey_not_found" });
		const replay = await route("/api/v1/auth/passkeys/authentication/complete", {
			challenge_id: body.challenge_id,
			response: fakeAuthenticationResponse(),
			device_secret: DEVICE_SECRET,
		});
		expect(replay.status).toBe(401);
		expect(await replay.json()).toMatchObject({ code: "passkey_challenge_replayed" });
	});

	it("fails closed for malformed Android origins and mismatched discoverable user handles", async () => {
		testEnv.WEBAUTHN_ANDROID_ORIGINS = "android:apk-key-hash:not-a-certificate-digest";
		const malformedOrigin = await route("/api/v1/auth/passkeys/authentication/options", {});
		expect(malformedOrigin.status).toBe(503);
		expect(await malformedOrigin.json()).toMatchObject({ code: "passkey_origin_not_configured" });

		testEnv.WEBAUTHN_ANDROID_ORIGINS = `android:apk-key-hash:${"B".repeat(43)}`;
		await env.orderak_db.batch([
			env.orderak_db.prepare(
				`INSERT INTO sellers(id,store_code,store_name,phone,secret,status)
				 VALUES('seller-passkey','PASSKEY1','Passkey Store',?,'sha256$test','active')`,
			).bind(PHONE),
			env.orderak_db.prepare(
				`INSERT INTO passkey_credentials(
				 id,seller_id,credential_id,credential_public_key,webauthn_user_id,
				 counter,transports_json,device_type,backed_up)
				 VALUES('passkey-1','seller-passkey','credential-1',?,'expected-user',0,'[]','singleDevice',0)`,
			).bind(new Uint8Array([1, 2, 3])),
		]);
		const options = await route("/api/v1/auth/passkeys/authentication/options", {});
		const body = await options.json<{ challenge_id: string }>();
		const mismatch = await route("/api/v1/auth/passkeys/authentication/complete", {
			challenge_id: body.challenge_id,
			response: fakeAuthenticationResponse("credential-1", "different-user"),
			device_secret: DEVICE_SECRET,
		});
		expect(mismatch.status).toBe(401);
		expect(await mismatch.json()).toMatchObject({ code: "passkey_verification_failed" });
	});

	it("rejects future Firebase auth_time claims", async () => {
		const response = await route("/api/v1/auth/phone/complete", {
			id_token: firebaseTokenAt(Math.floor(Date.now() / 1000) + 600),
			phone: PHONE,
			device_secret: DEVICE_SECRET,
		});
		expect(response.status).toBe(401);
		expect(await response.json()).toMatchObject({ code: "auth_stale" });
	});

	it("expires the server token without deleting the onboarding draft", async () => {
		const onboardingToken = await beginOnboarding();
		await env.orderak_db.prepare(
			"UPDATE onboarding_sessions SET expires_at=datetime('now','-1 minute') WHERE phone_e164=?",
		).bind(PHONE).run();
		const response = await route("/api/v1/onboarding/account", {
			full_name: "Ayman Seller",
			birth_year: 1988,
			terms_accepted: true,
			app_version: "2.0.0",
		}, { authorization: `Bearer ${onboardingToken}` });
		expect(response.status).toBe(401);
		expect(await response.json()).toMatchObject({ code: "onboarding_expired", retry_with: "otp" });
		const row = await env.orderak_db.prepare(
			"SELECT status,full_name FROM onboarding_sessions WHERE phone_e164=?",
		).bind(PHONE).first<{ status: string; full_name: string | null }>();
		expect(row).toEqual({ status: "expired", full_name: null });
	});
});

describe("Global city search", () => {
	it("returns phone-country-scoped static rows and ODbL attribution", async () => {
		const onboardingToken = await beginOnboarding();
		const request = new Request(`${BASE}/api/v1/geo/cities?country=FR&lang=ar&q=Cai`, {
			headers: {
				"cf-connecting-ip": "203.0.113.61",
				authorization: `Bearer ${onboardingToken}`,
			},
		});
		const { handleGeoRoutes } = await import("../src/domains/catalog/geo");
		const response = await handleGeoRoutes(request, testEnv, new URL(request.url));
		expect(response?.status).toBe(200);
		expect(await response!.json()).toMatchObject({
			ok: true,
			cities: [{ city_id: 1, name: "القاهرة", country_iso: "EG" }],
			attribution: {
				name: "Countries States Cities Database",
				license: "ODbL-1.0",
			},
		});
	});
});

describe("Asset Links statement", () => {
	const FINGERPRINT = `${"AB:".repeat(31)}AB`;

	// A plain object rather than Object.create(testEnv): assigning through the
	// runtime env's prototype chain writes into the shared binding and leaks
	// into the next test. assetLinksResponse reads only these two values.
	function envWith(overrides: Record<string, string>) {
		return { ANDROID_RELEASE_SHA256_CERT_FINGERPRINTS: FINGERPRINT, ...overrides } as unknown as TestEnv;
	}

	async function packageNameFor(overrides: Record<string, string>) {
		const response = assetLinksResponse(envWith(overrides));
		expect(response.status).toBe(200);
		const statement = await response.json<Array<{ target: { package_name: string; sha256_cert_fingerprints: string[] } }>>();
		expect(statement[0].target.sha256_cert_fingerprints).toEqual([FINGERPRINT]);
		return statement[0].target.package_name;
	}

	it("vouches for the configured package so a suffixed build authorises itself", async () => {
		expect(await packageNameFor({ ANDROID_APP_PACKAGE_NAME: "app.orderak.seller.staging" }))
			.toBe("app.orderak.seller.staging");
	});

	it("keeps the production package when the variable is absent or malformed", async () => {
		expect(await packageNameFor({})).toBe("app.orderak.seller");
		// A typo must not publish a statement naming a package nobody controls.
		expect(await packageNameFor({ ANDROID_APP_PACKAGE_NAME: "not a package name" }))
			.toBe("app.orderak.seller");
	});

	it("stays closed when no fingerprint is configured", async () => {
		const response = assetLinksResponse(
			{ ANDROID_APP_PACKAGE_NAME: "app.orderak.seller.staging" } as unknown as TestEnv,
		);
		expect(response.status).toBe(503);
		expect(await response.json()).toMatchObject({ code: "asset_links_not_configured" });
	});
});

describe("Public site origin", () => {
	// Regression: this was a module constant pinned to production, so staging
	// returned store_url/canonical/media links for stores that live only in
	// staging's D1 — and 301'd visitors from staging into a production 404.
	it("uses the deployment's own origin for store links", () => {
		const staging = { PUBLIC_SITE_URL: "https://staging.orderak.app" };
		expect(publicSiteUrl(staging)).toBe("https://staging.orderak.app");
		expect(storeUrl(staging, "EG-ayman-UPU9T9C6")).toBe("https://staging.orderak.app/EG-ayman-UPU9T9C6");
	});

	it("falls back to production when unset, and trims a trailing slash", () => {
		expect(publicSiteUrl({})).toBe("https://orderak.app");
		expect(storeUrl({}, "EG-x-1")).toBe("https://orderak.app/EG-x-1");
		expect(publicSiteUrl({ PUBLIC_SITE_URL: "https://staging.orderak.app/" })).toBe("https://staging.orderak.app");
	});

	it("ignores a value that is not a bare https origin", () => {
		// A path, a non-https scheme or embedded junk must never reach a
		// canonical tag; degrade to production rather than emit it.
		for (const bad of ["http://orderak.app", "https://orderak.app/EG-x", "https://a b", "orderak.app", ""]) {
			expect(publicSiteUrl({ PUBLIC_SITE_URL: bad })).toBe("https://orderak.app");
		}
	});
});
