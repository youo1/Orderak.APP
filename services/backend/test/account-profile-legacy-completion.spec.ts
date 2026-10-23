import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createExecutionContext, env } from "cloudflare:test";
import { handleAuthV2Routes } from "../src/domains/identity/auth-v2";
import { createSchema } from "./helpers";

// Migration 063 does not exist on the unchanged tree, so this glob matches
// nothing and the length assertion below fails cleanly before the change,
// rather than refusing to compile.
const MIGRATION_063 = import.meta.glob("../migrations/063_clear_stored_birth_years.sql", {
	query: "?raw",
	import: "default",
	eager: true,
}) as Record<string, string>;

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
	it("runs migration 063 itself against a pre-migration account_saved session, matches its predicate, and still completes the session as legacy", async () => {
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

		// saveOnboardingAccount() never writes onboarding_sessions.birth_year at
		// all (only legal_acceptances.age_confirmation_source), so the column is
		// still NULL here. Setting it directly, together with clearing the source
		// marker the account step just set, recreates exactly the row a prior
		// Worker (before source markers existed) would have left behind:
		// account_saved, a retained birth year, no source.
		await env.orderak_db.prepare(
			`UPDATE onboarding_sessions SET age_confirmation_source=NULL,birth_year=1985 WHERE phone_e164=?`,
		).bind(PHONE).run();

		const preMigration = await env.orderak_db.prepare(
			"SELECT status,birth_year,age_confirmation_source FROM onboarding_sessions WHERE phone_e164=?",
		).bind(PHONE).first<{ status: string; birth_year: number | null; age_confirmation_source: string | null }>();
		expect(preMigration).toEqual({ status: "account_saved", birth_year: 1985, age_confirmation_source: null });

		const files = Object.values(MIGRATION_063);
		expect(files).toHaveLength(1);
		// Run the migration's own SQL against this exact row, rather than
		// hand-simulating its effect, so the migration's predicate is what is
		// actually under test.
		await env.orderak_db.exec(files[0]);

		const postMigration = await env.orderak_db.prepare(
			"SELECT status,birth_year,age_confirmation_source FROM onboarding_sessions WHERE phone_e164=?",
		).bind(PHONE).first<{ status: string; birth_year: number | null; age_confirmation_source: string | null }>();
		expect(postMigration).toEqual({
			status: "account_saved",
			birth_year: null,
			age_confirmation_source: "android_onboarding_v2_legacy_birth_year",
		});

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
