import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createExecutionContext, env } from "cloudflare:test";
import { handleAuthV2Routes } from "../src/domains/identity/auth-v2";
import { createSchema } from "./helpers";

const PHONE = "+201007654321";
const DEVICE_SECRET = "device-secret-with-enough-entropy";
let testEnv: TestEnv;

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
		headers: { "content-type": "application/json", "cf-connecting-ip": "203.0.113.71", ...headers },
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

// The account step is exercised with a valid legacy birth_year on purpose, so
// this file's tests stay isolated to completeOnboarding's category/city
// optionality — the age-confirmation redesign itself is pinned separately by
// r3a-age-confirmation.spec.ts. A valid birth_year satisfies both today's
// required-birth-year rule and the new legacy-compatibility branch.
async function saveAccountWithLegacyBirthYear(onboardingToken: string): Promise<void> {
	const response = await route("/api/v1/onboarding/account", {
		full_name: "Setup Seller",
		birth_year: 1990,
		terms_accepted: true,
		app_version: "2.0.0",
	}, { authorization: `Bearer ${onboardingToken}` });
	expect(response.status).toBe(200);
}

async function sellerRow(phone: string) {
	return env.orderak_db.prepare(
		`SELECT business_category, business_category_id, business_subcategory_id,
		        city_geoname_id, city_catalog_id, city_catalog_version, city_name
		 FROM sellers WHERE phone = ?`,
	).bind(phone).first<Record<string, unknown>>();
}

beforeEach(async () => {
	await createSchema();
	testEnv = Object.create(env) as TestEnv;
	testEnv.FIREBASE_WEB_API_KEY = "test-key";
	testEnv.ONBOARDING_ENABLED = "true";
	testEnv.BUSINESS_TAXONOMY_ENABLED = "true";
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

describe("R3a — onboarding completes with category and city both optional (D-05)", () => {
	it("creates a store from only a name and owner, with category and city persisted as NULL", async () => {
		const onboardingToken = await beginOnboarding();
		await saveAccountWithLegacyBirthYear(onboardingToken);

		const complete = await route("/api/v1/onboarding/complete", {
			device_secret: DEVICE_SECRET,
			store_name: "Owner Only Shop",
			country_iso: "EG",
		}, { authorization: `Bearer ${onboardingToken}` });
		expect(complete.status).toBe(200);
		const body = await complete.json<Record<string, unknown>>();
		expect(body.store_url).toBeTruthy();

		expect(await sellerRow(PHONE)).toMatchObject({
			business_category: null,
			business_category_id: null,
			business_subcategory_id: null,
			city_geoname_id: null,
			city_catalog_id: null,
			city_catalog_version: null,
			city_name: null,
		});
	});

	it("validates a supplied city and category independently of whether the other is omitted", async () => {
		const onboardingToken = await beginOnboarding();
		await saveAccountWithLegacyBirthYear(onboardingToken);

		const badCity = await route("/api/v1/onboarding/complete", {
			device_secret: DEVICE_SECRET,
			store_name: "Partial Shop",
			country_iso: "EG",
			city_name: "A",
		}, { authorization: `Bearer ${onboardingToken}` });
		expect(badCity.status).toBe(400);
		expect(await badCity.json()).toMatchObject({ code: "invalid_city" });

		const badCategory = await route("/api/v1/onboarding/complete", {
			device_secret: DEVICE_SECRET,
			store_name: "Partial Shop",
			country_iso: "EG",
			business_category: "not_a_real_category",
		}, { authorization: `Bearer ${onboardingToken}` });
		expect(badCategory.status).toBe(400);
		expect(await badCategory.json()).toMatchObject({ code: "invalid_business_category" });
	});
});

describe("R3a — category persistence matches today's rule for a taxonomy selection vs. a legacy key alone", () => {
	it("stores taxonomy IDs and the category key for a business_category_id selection", async () => {
		const onboardingToken = await beginOnboarding();
		await saveAccountWithLegacyBirthYear(onboardingToken);
		const res = await route("/api/v1/onboarding/complete", {
			device_secret: DEVICE_SECRET,
			store_name: "Taxonomy Shop",
			business_category_id: "fashion",
			country_iso: "EG",
		}, { authorization: `Bearer ${onboardingToken}` });
		expect(res.status).toBe(200);
		expect(await sellerRow(PHONE)).toMatchObject({
			business_category: "fashion",
			business_category_id: "fashion",
			business_subcategory_id: null,
		});
	});

	it("stores only the legacy business_category key and leaves taxonomy IDs NULL when no business_category_id is supplied", async () => {
		const onboardingToken = await beginOnboarding();
		await saveAccountWithLegacyBirthYear(onboardingToken);
		const res = await route("/api/v1/onboarding/complete", {
			device_secret: DEVICE_SECRET,
			store_name: "Legacy Key Shop",
			business_category: "fashion",
			country_iso: "EG",
		}, { authorization: `Bearer ${onboardingToken}` });
		expect(res.status).toBe(200);
		expect(await sellerRow(PHONE)).toMatchObject({
			business_category: "fashion",
			business_category_id: null,
			business_subcategory_id: null,
		});
	});
});
