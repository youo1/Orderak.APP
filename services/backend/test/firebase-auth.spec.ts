import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { env } from "cloudflare:test";
import { handleStoreRoutes, verifyFirebasePhone } from "../src/domains/stores/api-store";
import { authSeller, rateLimiterStub } from "../src/platform/http/shared";
import { BASE, createSchema } from "./helpers";

const PHONE = "+201001112222";
let testEnv: TestEnv;
let lookupResponses: Array<() => Promise<Response>>;

function freshFirebaseToken(): string {
	const payload = btoa(JSON.stringify({ auth_time: Math.floor(Date.now() / 1000) }))
		.replaceAll("+", "-")
		.replaceAll("/", "_")
		.replace(/=+$/, "");
	return `header.${payload}.signature`;
}

function mockLookup(data: unknown, status = 200, times = 1) {
	const source = data as { users?: Record<string, unknown>[] };
	const responseData = Array.isArray(source?.users)
		? { ...source, users: source.users.map((user) => ({ localId: "firebase-uid", ...user })) }
		: data;
	for (let i = 0; i < times; i++) {
		lookupResponses.push(async () => new Response(JSON.stringify(responseData), {
			status,
			headers: { "content-type": "application/json" },
		}));
	}
}

function mockLookupError(error: Error) {
	lookupResponses.push(async () => { throw error; });
}

async function restore(overrides: Record<string, unknown> = {}, ip = "203.0.113.10") {
	const request = new Request(`${BASE}/api/v1/auth/session`, {
		method: "POST",
		headers: {
			"content-type": "application/json",
			"accept-language": "en",
			"cf-connecting-ip": ip,
		},
		body: JSON.stringify({
			id_token: freshFirebaseToken(),
			phone: PHONE,
			device_secret: "device-secret",
			terms_accepted: true,
			marketing_consent: false,
			app_version: "1.0.0",
			...overrides,
		}),
	});
	const response = await handleStoreRoutes(request, testEnv, new URL(request.url));
	if (!response) throw new Error("auth session route was not handled");
	return response;
}

async function register() {
	const request = new Request(`${BASE}/api/v1/register`, {
		method: "POST",
		headers: { "content-type": "application/json", "cf-connecting-ip": "203.0.113.20" },
		body: JSON.stringify({
			id_token: freshFirebaseToken(),
			phone: PHONE,
			secret: "device-secret",
			store_name: "Consent Test Store",
		}),
	});
	const response = await handleStoreRoutes(request, testEnv, new URL(request.url));
	if (!response) throw new Error("register route was not handled");
	return response;
}

beforeEach(async () => {
	await createSchema();
	testEnv = Object.create(env) as TestEnv;
	testEnv.FIREBASE_WEB_API_KEY = "test-key";
	lookupResponses = [];
	vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL) => {
		const url = String(input);
		if (!url.startsWith("https://identitytoolkit.googleapis.com/v1/accounts:lookup")) {
			throw new Error(`unexpected_fetch:${url}`);
		}
		const response = lookupResponses.shift();
		if (!response) throw new Error("unexpected_firebase_lookup");
		return response();
	}));
});

afterEach(() => {
	expect(lookupResponses).toHaveLength(0);
	vi.unstubAllGlobals();
});

describe("verifyFirebasePhone", () => {
	it("accepts only a matching verified phone", async () => {
		mockLookup({ users: [{ localId: "firebase-uid", phoneNumber: PHONE }] });
		await expect(verifyFirebasePhone(testEnv, "token", PHONE)).resolves.toEqual({ uid: "firebase-uid", phone: PHONE });
	});

	it("rejects phone mismatch and missing phone claims", async () => {
		mockLookup({ users: [{ phoneNumber: "+201009998888" }] });
		await expect(verifyFirebasePhone(testEnv, "token", PHONE)).resolves.toBeNull();
		mockLookup({ users: [{}] });
		await expect(verifyFirebasePhone(testEnv, "token", PHONE)).resolves.toBeNull();
	});

	it("fails closed on non-2xx and fetch errors", async () => {
		mockLookup({ error: "invalid" }, 401);
		await expect(verifyFirebasePhone(testEnv, "token", PHONE)).resolves.toBeNull();
		mockLookupError(new Error("network unavailable"));
		await expect(verifyFirebasePhone(testEnv, "token", PHONE)).resolves.toBeNull();
	});

	it("fails closed when the Firebase key is missing", async () => {
		testEnv.FIREBASE_WEB_API_KEY = undefined;
		await expect(verifyFirebasePhone(testEnv, "token", PHONE)).resolves.toBeNull();
	});
});

describe("POST /api/v1/auth/session", () => {
	it("records the published legal versions after Firebase verification", async () => {
		mockLookup({ users: [{ phoneNumber: PHONE }] });
		const response = await restore({ marketing_consent: true });
		expect(response.status).toBe(200);
		expect(await response.json()).toMatchObject({ ok: true, exists: false });

		const row = await env.orderak_db.prepare(
			"SELECT terms_version,privacy_version,locale,marketing_consent,app_version FROM legal_acceptances WHERE phone_e164=?",
		).bind(PHONE).first<Record<string, unknown>>();
		expect(row).toMatchObject({
			terms_version: 1,
			privacy_version: 1,
			locale: "en",
			marketing_consent: 1,
			app_version: "1.0.0",
		});
	});

	it("requires affirmative terms acceptance", async () => {
		mockLookup({ users: [{ phoneNumber: PHONE }] });
		const response = await restore({ terms_accepted: false });
		expect(response.status).toBe(400);
		expect(await response.json()).toMatchObject({ code: "legal_acceptance_required" });
	});

	it("rejects an invalid Firebase token", async () => {
		mockLookup({ users: [{ phoneNumber: "+201009998888" }] });
		const response = await restore();
		expect(response.status).toBe(401);
		expect(await response.json()).toMatchObject({ code: "auth" });
	});

	it("creates independent phone and IP rate-limit buckets", async () => {
		mockLookup({ users: [{ phoneNumber: PHONE }] });
		const response = await restore({}, "203.0.113.44");
		expect(response.status).toBe(200);
		// Each bucket is its own Durable Object instance, so both must have been
		// counted independently rather than sharing one counter.
		const namespace = env.RATE_LIMITER;
		const counted = async (bucket: string) =>
			(await rateLimiterStub(env, bucket))!.peek();
		// The original asserted both bucket rows existed; the equivalent now is
		// that both instances hold a counter. Exact values are left alone because
		// earlier tests in this file share the same buckets.
		expect(await counted("session:ip:203.0.113.44")).not.toBeNull();
		expect(await counted(`session:phone:${PHONE}`)).not.toBeNull();
	});

	it("replaces the authorized device after verified OTP on a single-device plan", async () => {
		mockLookup({ users: [{ phoneNumber: PHONE }] }, 200, 3);
		expect((await restore()).status).toBe(200);
		expect((await register()).status).toBe(200);

		const response = await restore({ device_secret: "replacement-device" });
		expect(response.status).toBe(200);
		expect(await response.json()).toMatchObject({ ok: true, exists: true });
		expect(await authSeller(testEnv, PHONE, "replacement-device")).not.toBeNull();
		expect(await authSeller(testEnv, PHONE, "device-secret")).toBeNull();
		const devices = await env.orderak_db.prepare(
			"SELECT COUNT(*) AS count FROM seller_devices WHERE seller_id=(SELECT id FROM sellers WHERE phone=?)",
		).bind(PHONE).first<{ count: number }>();
		expect(Number(devices?.count)).toBe(0);
	});

	it("keeps existing devices when the plan allows multiple devices", async () => {
		mockLookup({ users: [{ phoneNumber: PHONE }] }, 200, 3);
		expect((await restore()).status).toBe(200);
		expect((await register()).status).toBe(200);
		await env.orderak_db.prepare(
			"INSERT INTO plans(id,name,active,multi_device_enabled) VALUES('free','Free',1,1)",
		).run();

		const response = await restore({ device_secret: "second-device" });
		expect(response.status).toBe(200);
		expect(await authSeller(testEnv, PHONE, "device-secret")).not.toBeNull();
		expect(await authSeller(testEnv, PHONE, "second-device")).not.toBeNull();
	});
});

describe("POST /api/v1/register", () => {
	it("requires a recorded legal acceptance before creating an account", async () => {
		mockLookup({ users: [{ phoneNumber: PHONE }] }, 200, 3);
		const blocked = await register();
		expect(blocked.status).toBe(400);
		expect(await blocked.json()).toMatchObject({ code: "legal_acceptance_required" });

		const session = await restore();
		expect(session.status).toBe(200);
		const created = await register();
		expect(created.status).toBe(200);
		expect(await created.json()).toMatchObject({ ok: true });
		const foundation = await env.orderak_db.prepare(
			`SELECT s.id seller_id,i.provider_subject,os.organization_id,o.play_account_hash,r.shard_key
			 FROM sellers s
			 JOIN seller_auth_identities i ON i.seller_id=s.id AND i.status='active'
			 JOIN organization_stores os ON os.store_id=s.id
			 JOIN organizations o ON o.id=os.organization_id
			 JOIN organization_routing r ON r.organization_id=o.id
			 WHERE s.phone=?`,
		).bind(PHONE).first<Record<string, unknown>>();
		expect(foundation).toMatchObject({ provider_subject: "firebase-uid", shard_key: "primary" });
		expect(foundation?.play_account_hash).toBeTruthy();
	});
});
