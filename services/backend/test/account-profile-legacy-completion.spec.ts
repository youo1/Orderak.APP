import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createExecutionContext, env } from "cloudflare:test";
import { handleAuthV2Routes } from "../src/domains/identity/auth-v2";
import { createSchema } from "./helpers";

const PHONE = "+201001239500";
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
		headers: { "content-type": "application/json", "cf-connecting-ip": "203.0.113.91", ...headers },
		body: JSON.stringify(body),
	});
	const response = await handleAuthV2Routes(request, testEnv, new URL(request.url), createExecutionContext());
	if (!response) throw new Error(`route_not_handled:${path}`);
	return response;
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

describe("Legacy account_saved completion survives the birth-year migration (D-13 option A)", () => {
	it("completes a session the migration already stamped with the legacy source and a nulled birth year", async () => {
		const started = await route("/api/v1/auth/phone/complete", {
			id_token: freshFirebaseToken(),
			phone: PHONE,
			device_secret: DEVICE_SECRET,
		});
		expect(started.status).toBe(200);
		const onboardingToken = String((await started.json<Record<string, unknown>>()).onboarding_token);
		const auth = { authorization: `Bearer ${onboardingToken}` };

		const account = await route("/api/v1/onboarding/account", {
			full_name: "Migrated Seller",
			birth_year: 1985,
			terms_accepted: true,
			app_version: "2.0.0",
		}, auth);
		expect(account.status).toBe(200);

		// Simulate what migration 063 must do to a pre-existing row: stamp the
		// legacy source marker first, then null the stored year — exactly the
		// order the migration is required to follow so this draft is never
		// stranded mid-setup with account_step_required.
		await env.orderak_db.prepare(
			`UPDATE onboarding_sessions SET age_confirmation_source='android_onboarding_v2_legacy_birth_year',birth_year=NULL WHERE phone_e164=?`,
		).bind(PHONE).run();

		const completed = await route("/api/v1/onboarding/complete", {
			device_secret: DEVICE_SECRET,
			store_name: "Migrated Shop",
			country_iso: "EG",
		}, auth);
		expect(completed.status).toBe(200);

		const evidence = await env.orderak_db.prepare(
			`SELECT l.age_confirmation_source source, l.age_confirmation_statement_text statement_text,
			        p.birth_year profile_birth_year
			 FROM sellers s JOIN legal_acceptances l ON l.seller_id=s.id
			 JOIN seller_profiles p ON p.seller_id=s.id WHERE s.phone=?`,
		).bind(PHONE).first<Record<string, unknown>>();
		expect(evidence).toMatchObject({
			source: "android_onboarding_v2_legacy_birth_year",
			statement_text: null,
			profile_birth_year: null,
		});
	});
});
