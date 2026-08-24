import { env } from "cloudflare:test";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { authSeller, hashSecret } from "../src/platform/http/shared";
import {
	backfillStableIdentities,
	findSellerByVerifiedIdentity,
	identityReadiness,
} from "../src/domains/identity/identity";
import { handlePhoneChangeRoutes } from "../src/domains/identity/phone-change";
import { requireTenantWrite, resolveTenantContext, TenantWriteFencedError } from "../src/platform/tenancy/tenant-routing";
import { createSchema } from "./helpers";

const BASE = "https://orderak.app";

function token(authTime: number, name: string): string {
	const payload = btoa(JSON.stringify({ auth_time: authTime })).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/g, "");
	return `${name}.${payload}.signature`;
}

describe("stable identity and tenant routing", () => {
	beforeEach(async () => {
		vi.restoreAllMocks();
		await createSchema();
	});

	it("converges a partial, repeated backfill and quarantines malformed sellers", async () => {
		await env.orderak_db.batch([
			env.orderak_db.prepare(
				"INSERT INTO sellers(id,store_code,store_name,phone,firebase_uid,secret,status) VALUES('valid','VALID001','Valid','+201001112222','uid-valid','x','active')",
			),
			env.orderak_db.prepare(
				"INSERT INTO sellers(id,store_code,store_name,phone,firebase_uid,secret,status) VALUES('bad','BAD00001','Bad','not-a-phone','uid-bad','x','active')",
			),
		]);
		expect(await backfillStableIdentities(env, 1)).toMatchObject({ scanned: 1 });
		const second = await backfillStableIdentities(env, 10);
		expect(second.migrated).toBe(1);
		expect(second.issues).toBe(1);
		await backfillStableIdentities(env, 10);
		const identities = await env.orderak_db.prepare(
			"SELECT COUNT(*) count FROM seller_auth_identities WHERE seller_id='valid' AND status='active'",
		).first<{ count: number }>();
		const issue = await env.orderak_db.prepare(
			"SELECT issue_code,occurrence_count FROM identity_migration_issues WHERE seller_id='bad'",
		).first<{ issue_code: string; occurrence_count: number }>();
		expect(Number(identities?.count)).toBe(1);
		expect(issue?.issue_code).toBe("invalid_phone_e164");
		expect(Number(issue?.occurrence_count)).toBeGreaterThanOrEqual(1);
		expect((await identityReadiness(env)).ready).toBe(false);
	});

	it("can disable V2 reads without losing the compatibility projection", async () => {
		const secret = await hashSecret("device");
		await env.orderak_db.batch([
			env.orderak_db.prepare(
				"INSERT INTO sellers(id,store_code,store_name,phone,firebase_uid,secret) VALUES('seller-v2','SELLERV2','V2','+201001112222','uid-v2',?)",
			).bind(secret),
			env.orderak_db.prepare(
				"INSERT INTO seller_auth_identities(id,seller_id,provider,provider_subject,verified_phone_e164,status) VALUES('identity-v2','seller-v2','firebase_phone','uid-v2','+201001112222','active')",
			),
		]);
		const enabled = { ...env, AUTH_IDENTITY_ENABLED: "true" } as TestEnv;
		const disabled = { ...env, AUTH_IDENTITY_ENABLED: "false" } as TestEnv;
		expect((await findSellerByVerifiedIdentity(enabled, "uid-v2", "+201001112222"))?.id).toBe("seller-v2");
		expect((await findSellerByVerifiedIdentity(disabled, "different-uid", "+201001112222"))?.id).toBe("seller-v2");
	});

	it("routes the primary shard and rejects writes during a write fence", async () => {
		await env.orderak_db.batch([
			env.orderak_db.prepare("INSERT INTO sellers(id,store_code,store_name,phone,secret) VALUES('route-store','ROUTE001','Route','+201001112222','x')"),
			env.orderak_db.prepare("INSERT INTO organizations(id,name,owner_store_id) VALUES('route-org','Route','route-store')"),
			env.orderak_db.prepare("INSERT INTO organization_routing(organization_id,migration_state) VALUES('route-org','write_fenced')"),
		]);
		const context = await resolveTenantContext(env, "route-org");
		expect(context.shardKey).toBe("primary");
		expect(() => requireTenantWrite(context)).toThrow(TenantWriteFencedError);
	});

	it("keeps phone change disabled by default", async () => {
		const disabled = { ...env, PHONE_CHANGE_ENABLED: "false" } as TestEnv;
		const response = await handlePhoneChangeRoutes(
			new Request(`${BASE}/api/v1/auth/phone-change/challenges`, { method: "POST" }),
			disabled,
			new URL(`${BASE}/api/v1/auth/phone-change/challenges`),
		);
		expect(response?.status).toBe(503);
		expect(await response?.json()).toMatchObject({ code: "phone_change_disabled" });
	});

	it("changes the identity without replacing organization or billing ownership and rejects replay", async () => {
		const oldPhone = "+201001112222";
		const newPhone = "+201009998888";
		const oldSecret = "old-device";
		const enabled = { ...env, PHONE_CHANGE_ENABLED: "true", FIREBASE_WEB_API_KEY: "test-key" } as TestEnv;
		await env.orderak_db.batch([
			env.orderak_db.prepare(
				"INSERT INTO sellers(id,store_code,store_name,phone,firebase_uid,secret) VALUES('seller-phone','PHONE001','Phone',?,'uid-old',?)",
			).bind(oldPhone, await hashSecret(oldSecret)),
			env.orderak_db.prepare(
				"INSERT INTO seller_auth_identities(id,seller_id,provider,provider_subject,verified_phone_e164,status) VALUES('identity-old','seller-phone','firebase_phone','uid-old',?,'active')",
			).bind(oldPhone),
			env.orderak_db.prepare("INSERT INTO organizations(id,name,owner_store_id,play_account_hash) VALUES('org-phone','Phone','seller-phone','play-hash')"),
			env.orderak_db.prepare("INSERT INTO organization_stores(organization_id,store_id,is_primary) VALUES('org-phone','seller-phone',1)"),
			env.orderak_db.prepare("INSERT INTO organization_routing(organization_id) VALUES('org-phone')"),
			env.orderak_db.prepare("INSERT INTO seller_devices(seller_id,secret_hash) VALUES('seller-phone','another-device')"),
		]);
		vi.stubGlobal("fetch", vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
			const idToken = String(JSON.parse(String(init?.body ?? "{}"))?.idToken ?? "");
			const next = idToken.startsWith("new")
				? { localId: "uid-new", phoneNumber: newPhone }
				: { localId: "uid-old", phoneNumber: oldPhone };
			return Response.json({ users: [next] });
		}));
		const authTime = Math.floor(Date.now() / 1000);
		const challengeResponse = await handlePhoneChangeRoutes(new Request(
			`${BASE}/api/v1/auth/phone-change/challenges`, {
				method: "POST",
				headers: { "content-type": "application/json", "x-orderak-phone": oldPhone, "x-orderak-secret": oldSecret },
				body: JSON.stringify({ new_phone: newPhone, id_token: token(authTime, "old") }),
			},
		), enabled, new URL(`${BASE}/api/v1/auth/phone-change/challenges`));
		expect(challengeResponse?.status).toBe(200);
		const challenge = await challengeResponse!.json<{ challenge_id: string; challenge_token: string }>();
		const completionRequest = () => new Request(`${BASE}/api/v1/auth/phone-change/complete`, {
			method: "POST",
			headers: { "content-type": "application/json", "x-orderak-phone": oldPhone, "x-orderak-secret": oldSecret },
			body: JSON.stringify({
				...challenge,
				id_token: token(authTime, "new"),
				replacement_device_secret: "replacement-device-0000-1111",
			}),
		});
		const completed = await handlePhoneChangeRoutes(completionRequest(), enabled, new URL(`${BASE}/api/v1/auth/phone-change/complete`));
		expect(completed?.status).toBe(200);
		expect(await authSeller(enabled, oldPhone, oldSecret)).toBeNull();
		expect(await authSeller(enabled, newPhone, "replacement-device-0000-1111")).not.toBeNull();
		const ownership = await env.orderak_db.prepare(
			"SELECT owner_store_id,play_account_hash FROM organizations WHERE id='org-phone'",
		).first<{ owner_store_id: string; play_account_hash: string }>();
		expect(ownership).toEqual({ owner_store_id: "seller-phone", play_account_hash: "play-hash" });
		const devices = await env.orderak_db.prepare("SELECT COUNT(*) count FROM seller_devices WHERE seller_id='seller-phone'")
			.first<{ count: number }>();
		expect(Number(devices?.count)).toBe(0);

		const replay = await handlePhoneChangeRoutes(completionRequest(), enabled, new URL(`${BASE}/api/v1/auth/phone-change/complete`));
		expect(replay?.status).toBe(409);
		expect(await replay?.json()).toMatchObject({ code: "replayed_challenge" });
	});
});
