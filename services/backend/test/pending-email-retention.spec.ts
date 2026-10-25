import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createExecutionContext, env } from "cloudflare:test";
import { handleAuthV2Routes } from "../src/domains/identity/auth-v2";
import { retentionRuleTables, runRetentionCleanup } from "../src/domains/identity/retention";
import { createSchema } from "./helpers";

// Migration 064 (pending_email_changes) does not exist on the unchanged tree,
// so every insert below throws and this suite fails cleanly before the change
// rather than refusing to compile — retention.ts's exports already exist today.
const PHONE = "+201001239600";
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
		headers: { "content-type": "application/json", "cf-connecting-ip": "203.0.113.95", ...headers },
		body: JSON.stringify(body),
	});
	const response = await handleAuthV2Routes(request, testEnv, new URL(request.url), createExecutionContext());
	if (!response) throw new Error(`route_not_handled:${path}`);
	return response;
}

async function onboardSeller(): Promise<string> {
	const started = await route("/api/v1/auth/phone/complete", {
		id_token: freshFirebaseToken(),
		phone: PHONE,
		device_secret: DEVICE_SECRET,
	});
	expect(started.status).toBe(200);
	const onboardingToken = String((await started.json<Record<string, unknown>>()).onboarding_token);
	const auth = { authorization: `Bearer ${onboardingToken}` };
	await route("/api/v1/onboarding/account", {
		full_name: "Retention Seller",
		age_confirmed: true,
		terms_accepted: true,
	}, auth);
	await route("/api/v1/onboarding/complete", {
		device_secret: DEVICE_SECRET,
		store_name: "Retention Shop",
		country_iso: "EG",
	}, auth);
	const seller = await env.orderak_db.prepare("SELECT id FROM sellers WHERE phone=?").bind(PHONE).first<{ id: string }>();
	return String(seller?.id);
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

describe("pending_email_changes retention (migration 064)", () => {
	it("is named in the cleanup rule inventory, and expired/superseded rows are purged while a fresh row survives", async () => {
		const sellerId = await onboardSeller();
		expect(sellerId).not.toBe("undefined");
		expect(retentionRuleTables()).toContain("pending_email_changes");

		await env.orderak_db.batch([
			env.orderak_db.prepare(
				`INSERT INTO pending_email_changes(id,seller_id,email,token_hash,created_at,expires_at,used_at,superseded_at)
				 VALUES(?,?,?,?,datetime('now','-60 days'),datetime('now','-45 days'),NULL,NULL)`,
			).bind(crypto.randomUUID(), sellerId, "stale-expired@example.com", "hash-expired"),
			env.orderak_db.prepare(
				`INSERT INTO pending_email_changes(id,seller_id,email,token_hash,created_at,expires_at,used_at,superseded_at)
				 VALUES(?,?,?,?,datetime('now','-60 days'),datetime('now','+1 days'),NULL,datetime('now','-45 days'))`,
			).bind(crypto.randomUUID(), sellerId, "stale-superseded@example.com", "hash-superseded"),
			env.orderak_db.prepare(
				`INSERT INTO pending_email_changes(id,seller_id,email,token_hash,created_at,expires_at,used_at,superseded_at)
				 VALUES(?,?,?,?,datetime('now'),datetime('now','+1 days'),NULL,NULL)`,
			).bind(crypto.randomUUID(), sellerId, "fresh@example.com", "hash-fresh"),
		]);

		await runRetentionCleanup(testEnv as unknown as Env);

		const { results } = await env.orderak_db.prepare(
			"SELECT email FROM pending_email_changes WHERE seller_id=? ORDER BY email",
		).bind(sellerId).all<{ email: string }>();
		expect((results ?? []).map((row) => row.email)).toEqual(["fresh@example.com"]);
	});
});
