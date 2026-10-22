import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createExecutionContext, env } from "cloudflare:test";
import { handleAuthV2Routes } from "../src/domains/identity/auth-v2";
import { createSchema } from "./helpers";

const PHONE = "+201001234567";
const DEVICE_SECRET = "device-secret-with-enough-entropy";
let testEnv: TestEnv;

// 062_age_confirmation_evidence.sql does not exist on the unchanged tree, so
// this glob matches nothing until the migration is added. A glob over a
// not-yet-existing path is valid (it just matches zero files); it is not a
// build error, which is what lets this test fail cleanly before the change
// instead of refusing to compile.
const MIGRATION_062 = import.meta.glob("../migrations/062_age_confirmation_evidence.sql", {
	query: "?raw",
	import: "default",
	eager: true,
}) as Record<string, string>;

function freshFirebaseToken(): string {
	const payload = btoa(JSON.stringify({ auth_time: Math.floor(Date.now() / 1000) }))
		.replaceAll("+", "-")
		.replaceAll("/", "_")
		.replace(/=+$/, "");
	return `header.${payload}.signature`;
}

async function route(
	path: string,
	body: Record<string, unknown>,
	headers: Record<string, string> = {},
): Promise<Response> {
	const request = new Request(`https://api.orderak.app${path}`, {
		method: "POST",
		headers: { "content-type": "application/json", "cf-connecting-ip": "203.0.113.70", ...headers },
		body: JSON.stringify(body),
	});
	const response = await handleAuthV2Routes(request, testEnv, new URL(request.url), createExecutionContext());
	if (!response) throw new Error(`route_not_handled:${path}`);
	return response;
}

async function beginOnboarding(): Promise<string> {
	const response = await route("/api/v1/auth/phone/complete", {
		id_token: freshFirebaseToken(),
		phone: PHONE,
		device_secret: DEVICE_SECRET,
	});
	expect(response.status).toBe(200);
	const body = await response.json<Record<string, unknown>>();
	return String(body.onboarding_token);
}

async function evidenceFor(phone: string) {
	return env.orderak_db.prepare(
		`SELECT a.source, a.statement_text, a.terms_version, a.confirmed_at
		 FROM age_confirmation_evidence a JOIN sellers s ON s.id = a.seller_id
		 WHERE s.phone = ?`,
	).bind(phone).first<Record<string, unknown>>();
}

async function sessionTermsVersion(phone: string): Promise<number | null> {
	const row = await env.orderak_db.prepare(
		"SELECT terms_version FROM onboarding_sessions WHERE phone_e164=?",
	).bind(phone).first<{ terms_version: number | null }>();
	return row?.terms_version ?? null;
}

beforeEach(async () => {
	await createSchema();
	testEnv = Object.create(env) as TestEnv;
	testEnv.FIREBASE_WEB_API_KEY = "test-key";
	testEnv.ONBOARDING_ENABLED = "true";
	testEnv.STATIC_CITY_CATALOG_ENABLED = "true";
	vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL) => {
		const url = String(input);
		if (!url.startsWith("https://identitytoolkit.googleapis.com/v1/accounts:lookup")) {
			throw new Error(`unexpected_fetch:${url}`);
		}
		return Response.json({ users: [{ localId: "firebase-v2-user", phoneNumber: PHONE }] });
	}));
});

afterEach(() => {
	vi.unstubAllGlobals();
});

describe("R3a — age confirmation replaces birth year (D-13)", () => {
	it("records an explicit confirmation with the canonical statement and never stores a sent birth year", async () => {
		const onboardingToken = await beginOnboarding();
		const account = await route("/api/v1/onboarding/account", {
			full_name: "Ayman Seller",
			age_confirmed: true,
			birth_year: 1990, // a new-shape request must not persist this either
			terms_accepted: true,
			app_version: "3.0.0",
		}, { authorization: `Bearer ${onboardingToken}` });
		expect(account.status).toBe(200);

		const complete = await route("/api/v1/onboarding/complete", {
			device_secret: DEVICE_SECRET,
			store_name: "Confirmed Shop",
			country_iso: "EG",
		}, { authorization: `Bearer ${onboardingToken}` });
		expect(complete.status).toBe(200);
		const completeBody = await complete.json<Record<string, unknown>>();
		expect(completeBody.store_url).toBeTruthy();

		const expectedTermsVersion = await sessionTermsVersion(PHONE);
		expect(expectedTermsVersion).not.toBeNull();

		const evidence = await evidenceFor(PHONE);
		expect(evidence).toMatchObject({
			source: "android_onboarding_v2",
			statement_text: "عمري ١٨ عامًا أو أكثر",
			terms_version: expectedTermsVersion,
		});
		expect(evidence?.confirmed_at).toBeTruthy();

		const stored = await env.orderak_db.prepare(
			`SELECT p.birth_year profile_birth_year
			 FROM sellers s JOIN seller_profiles p ON p.seller_id = s.id
			 WHERE s.phone = ?`,
		).bind(PHONE).first<{ profile_birth_year: number | null }>();
		expect(stored?.profile_birth_year).toBeNull();
	});

	it("completes setup for an old-shape request (birth_year, no confirmation) without storing the sent year, logging legacy evidence with a NULL statement", async () => {
		const onboardingToken = await beginOnboarding();
		const account = await route("/api/v1/onboarding/account", {
			full_name: "Legacy Seller",
			birth_year: 1988,
			terms_accepted: true,
			app_version: "2.0.0",
		}, { authorization: `Bearer ${onboardingToken}` });
		expect(account.status).toBe(200);

		const complete = await route("/api/v1/onboarding/complete", {
			device_secret: DEVICE_SECRET,
			store_name: "Legacy Shop",
			business_category: "fashion",
			country_iso: "EG",
			city_name: "Cairo",
		}, { authorization: `Bearer ${onboardingToken}` });
		expect(complete.status).toBe(200);

		const expectedTermsVersion = await sessionTermsVersion(PHONE);
		expect(expectedTermsVersion).not.toBeNull();

		const evidence = await evidenceFor(PHONE);
		expect(evidence).toMatchObject({
			source: "android_onboarding_v2_legacy_birth_year",
			statement_text: null,
			terms_version: expectedTermsVersion,
		});
		expect(evidence?.confirmed_at).toBeTruthy();

		const stored = await env.orderak_db.prepare(
			`SELECT o.birth_year session_birth_year, p.birth_year profile_birth_year
			 FROM onboarding_sessions o
			 JOIN sellers s ON s.phone = o.phone_e164
			 JOIN seller_profiles p ON p.seller_id = s.id
			 WHERE o.phone_e164 = ?`,
		).bind(PHONE).first<{ session_birth_year: number | null; profile_birth_year: number | null }>();
		expect(stored?.session_birth_year).toBeNull();
		expect(stored?.profile_birth_year).toBeNull();
	});

	it("rejects a missing confirmation that is not a valid legacy birth year with a stable error code", async () => {
		const onboardingToken = await beginOnboarding();
		for (const body of [
			{ full_name: "No Confirmation", terms_accepted: true },
			{ full_name: "False Confirmation", age_confirmed: false, terms_accepted: true },
			{ full_name: "Non Boolean", age_confirmed: "true", terms_accepted: true },
			{ full_name: "Invalid Legacy Year", birth_year: 1899, terms_accepted: true },
		]) {
			const response = await route("/api/v1/onboarding/account", body, { authorization: `Bearer ${onboardingToken}` });
			expect(response.status).toBe(400);
			expect(await response.json()).toMatchObject({ code: "age_confirmation_required" });
		}
	});
});

describe("R3a — age-confirmation evidence migration is additive", () => {
	it("adds the evidence table without touching birth-year columns or dropping anything", () => {
		const files = Object.values(MIGRATION_062);
		expect(files).toHaveLength(1);
		const sql = files[0];
		expect(sql).toMatch(/CREATE TABLE\s+age_confirmation_evidence/i);
		expect(sql.toLowerCase()).toContain("seller_id");
		expect(sql.toLowerCase()).toContain("source");
		expect(sql.toLowerCase()).toContain("statement_text");
		expect(sql.toLowerCase()).toContain("terms_version");
		expect(sql).not.toMatch(/drop\s+column/i);
		expect(sql).not.toMatch(/birth_year/i);
	});
});
