import { beforeEach, describe, expect, it } from "vitest";
import { signJwt, type AdminRole } from "../src/domains/identity/auth";
import { archiveAuditBatch } from "../src/domains/admin/admin-control-plane";
import adminWorker from "../src/entrypoints/admin-worker";
import { authHeaders, callWorker, createSchema, env, registerStore, SELF } from "./helpers";

async function adminFetch(path: string, role: AdminRole, init: RequestInit = {}): Promise<Response> {
	const token = await signJwt({ sub: 1, email: `${role}@example.test`, role }, env.ADMIN_JWT_SECRET || "test-admin-secret");
	const headers = new Headers(init.headers);
	headers.set("authorization", `Bearer ${token}`);
	headers.set("content-type", "application/json");
	return callWorker(adminWorker, new Request(`https://admin.orderak.app${path}`, { ...init, headers }), env);
}

describe("admin control-plane enforcement", () => {
	beforeEach(async () => {
		await createSchema();
		env.BUYER_PRIVACY_PEPPER = "buyer-privacy-test-pepper-at-least-thirty-two-bytes";
		env.ADMIN_AUDIT_SIGNING_KEY = "audit-signature-test-key-at-least-thirty-two-bytes";
	});

	it("requires scoped privacy transitions and re-verifies identity before anonymization", async () => {
		const registered = await registerStore({ phone: "+201511100000" });
		const seller = await env.orderak_db.prepare("SELECT id FROM sellers WHERE phone=?").bind(registered.phone).first<{ id: string }>();
		await env.orderak_db.prepare("INSERT INTO orders(id,store_id,buyer_phone,buyer_name,status,pay_method,total_piasters) VALUES('privacy-order',?,?,?,'NEW','COD',1000)")
			.bind(seller!.id, "+201000000111", "Buyer Name").run();
		expect((await adminFetch("/api/admin/v1/buyer-privacy", "readonly", { method: "POST", body: "{}" })).status).toBe(403);
		const opened = await adminFetch("/api/admin/v1/buyer-privacy", "owner", { method: "POST", body: JSON.stringify({ store_id: seller!.id, buyer_phone: "+201000000111", request_type: "deletion", notes: "verified request intake" }) });
		expect(opened.status).toBe(201);
		const { id } = await opened.json<{ id: string }>();
		for (const status of ["verified", "in_progress"]) expect((await adminFetch(`/api/admin/v1/buyer-privacy/${id}`, "owner", { method: "PATCH", body: JSON.stringify({ status, notes: `move to ${status}` }) })).status).toBe(200);
		expect((await adminFetch(`/api/admin/v1/buyer-privacy/${id}`, "owner", { method: "PATCH", body: JSON.stringify({ status: "completed", buyer_phone: "+201000000999" }) })).status).toBe(403);
		expect((await adminFetch(`/api/admin/v1/buyer-privacy/${id}`, "owner", { method: "PATCH", body: JSON.stringify({ status: "completed", buyer_phone: "+201000000111", notes: "fulfilled" }) })).status).toBe(200);
		expect(await env.orderak_db.prepare("SELECT buyer_name,buyer_phone FROM orders WHERE id='privacy-order'").first()).toMatchObject({ buyer_name: "Deleted customer" });
		expect(String((await env.orderak_db.prepare("SELECT buyer_phone FROM orders WHERE id='privacy-order'").first<{ buyer_phone: string }>())?.buyer_phone)).toMatch(/^deleted:/);
	});

	it("keeps the deployment gate authoritative and percentage evaluation stable", async () => {
		await env.orderak_db.prepare("INSERT INTO feature_flags(flag_key,description,default_value_json,env_gate,runtime_consumer,risk,rollout_seed,status) VALUES('ai.assistant','AI','true','AI_ASSISTANT_ENABLED','chat','high','stable-seed','published')").run();
		await env.orderak_db.prepare("INSERT INTO feature_flag_rules(id,flag_key,priority,scope_type,rollout_basis_points,value_json,active,reason) VALUES('half','ai.assistant',10,'percentage',5000,'true',1,'controlled rollout')").run();
		env.AI_ASSISTANT_ENABLED = "false";
		const gated = await adminFetch("/api/admin/v1/flags/evaluate", "owner", { method: "POST", body: JSON.stringify({ flag_key: "ai.assistant", actor_key: "seller-42" }) });
		expect(await gated.json()).toMatchObject({ value: false, source: "environment:AI_ASSISTANT_ENABLED" });
		env.AI_ASSISTANT_ENABLED = "true";
		const evaluate = async () => (await adminFetch("/api/admin/v1/flags/evaluate", "owner", { method: "POST", body: JSON.stringify({ flag_key: "ai.assistant", actor_key: "seller-42" }) })).json();
		expect(await evaluate()).toEqual(await evaluate());
	});

	it("applies version grace, forced-update, emergency denial, and maintenance decisions", async () => {
		const seller = await registerStore({ phone: "+201511100001" });
		await env.orderak_db.prepare(`INSERT INTO app_version_policies(id,platform,channel,recommended_version_code,minimum_version_code,blocked_version_codes_json,enforce_after,maintenance_mode,active,reason)
		 VALUES('android-global','android','production',110,100,'[105]',datetime('now','+1 day'),0,1,'version test policy')`).run();
		const decision = async (version: number) => {
			const response = await SELF.fetch("https://orderak.app/api/v1/config", { headers: { ...authHeaders(seller), "x-orderak-version-code": String(version) } });
			return (await response.json<{ governance: { version: { status: string } } }>()).governance.version.status;
		};
		expect(await decision(90)).toBe("warning");
		await env.orderak_db.prepare("UPDATE app_version_policies SET enforce_after=datetime('now','-1 minute') WHERE id='android-global'").run();
		expect(await decision(90)).toBe("force_update");
		expect(await decision(105)).toBe("blocked");
		await env.orderak_db.prepare("UPDATE app_version_policies SET maintenance_mode=1 WHERE id='android-global'").run();
		expect(await decision(120)).toBe("maintenance");
	});

	it("writes HMAC-signed hash-chained audit batches to private R2", async () => {
		await env.orderak_db.prepare("INSERT INTO admin_audit(admin_id,action,details_json) VALUES(1,'security.test','{}')").run();
		await archiveAuditBatch(env);
		const checkpoint = await env.orderak_db.prepare("SELECT object_key,content_hash,signature,previous_hash FROM admin_audit_exports").first<{ object_key: string; content_hash: string; signature: string; previous_hash: string | null }>();
		expect(checkpoint?.content_hash).toHaveLength(64);
		expect(checkpoint?.signature).toHaveLength(64);
		expect(checkpoint?.previous_hash).toBeNull();
		const object = await env.orderak_audit!.head(checkpoint!.object_key);
		expect(object?.customMetadata?.sha256).toBe(checkpoint?.content_hash);
		expect(object?.customMetadata?.hmacSha256).toBe(checkpoint?.signature);
	});
});
