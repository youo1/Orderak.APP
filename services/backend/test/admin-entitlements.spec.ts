import { beforeEach, describe, expect, it } from "vitest";
import { callWorker, createEntitlementSchema, createSchema, env, SELF } from "./helpers";
import { signJwt, type AdminRole } from "../src/domains/identity/auth";
import adminWorker from "../src/entrypoints/admin-worker";

const ADMIN_BASE = "https://admin.orderak.app";

async function adminToken(role: AdminRole): Promise<string> {
	const secret = env.ADMIN_JWT_SECRET || "test-admin-secret";
	return signJwt({ sub: 1, email: `${role}@example.test`, role }, secret);
}
async function adminFetch(path: string, role: AdminRole, init: RequestInit = {}, runtimeEnv: TestEnv = env): Promise<Response> {
	const headers = new Headers(init.headers);
	headers.set("authorization", `Bearer ${await adminToken(role)}`);
	headers.set("content-type", "application/json");
	return callWorker(adminWorker, new Request(`${ADMIN_BASE}${path}`, { ...init, headers }), runtimeEnv);
}

describe("versioned plan admin workflow", () => {
	beforeEach(async () => {
		await createSchema();
		await createEntitlementSchema();
		env.ADMIN_JWT_SECRET = "test-admin-secret";
	});

	it("drafts, locks, validates, and publishes an immutable revision", async () => {
		const created = await adminFetch("/api/admin/v1/plans/p-free/drafts", "owner", { method: "POST" });
		expect(created.status).toBe(201);
		const draft = ((await created.json()) as { draft: { id: string } }).draft;

		const update = await adminFetch(`/api/admin/v1/plan-revisions/${draft.id}`, "owner", {
			method: "PATCH",
			headers: { "if-match": "0" },
			body: JSON.stringify({
				change_type: "additive",
				entitlements: [{ entitlement_key: "max_products", value_mode: "value", int_value: 25, display_value: "25" }],
			}),
		});
		expect(update.status).toBe(200);
		expect(await update.json()).toMatchObject({ ok: true, lock_version: 1 });

		const stale = await adminFetch(`/api/admin/v1/plan-revisions/${draft.id}`, "owner", {
			method: "PATCH", headers: { "if-match": "0" },
			body: JSON.stringify({ entitlements: [{ entitlement_key: "max_products", value_mode: "value", int_value: 30 }] }),
		});
		expect(stale.status).toBe(409);

		const validation = await adminFetch(`/api/admin/v1/plan-revisions/${draft.id}/validate`, "owner", { method: "POST" });
		expect(await validation.json()).toMatchObject({ valid: true, errors: [] });

		expect((await adminFetch(`/api/admin/v1/plan-revisions/${draft.id}/publish`, "finance", { method: "POST" })).status).toBe(403);
		const published = await adminFetch(`/api/admin/v1/plan-revisions/${draft.id}/publish`, "owner", { method: "POST" });
		expect(published.status).toBe(200);
		expect(await published.json()).toMatchObject({ change_type: "additive", rollout: "immediate" });
		expect((await env.orderak_db.prepare("SELECT current_revision_id FROM subscription_plans WHERE id='p-free'").first<{ current_revision_id: string }>())?.current_revision_id).toBe(draft.id);
	});

	it("derives restrictive paid changes and delays subscriber rollout", async () => {
		await env.orderak_db.batch([
			env.orderak_db.prepare("INSERT INTO organizations(id,name,owner_store_id) VALUES('org-paid','Paid org','store-paid')"),
			env.orderak_db.prepare("INSERT INTO billing_verification_heads(organization_id,latest_generation) VALUES('org-paid',1)"),
			env.orderak_db.prepare("INSERT INTO organization_subscriptions(id,organization_id,plan_revision_id,source,status,current_period_end,verification_generation) VALUES('sub-paid','org-paid','r-1','google_play','active',datetime('now','+10 days'),1)"),
		]);
		const created = await adminFetch("/api/admin/v1/plans/p-1/drafts", "owner", { method: "POST" });
		const draft = ((await created.json()) as { draft: { id: string } }).draft;
		const update = await adminFetch(`/api/admin/v1/plan-revisions/${draft.id}`, "owner", {
			method: "PATCH",
			headers: { "if-match": "0" },
			body: JSON.stringify({
				change_type: "additive",
				entitlements: [{ entitlement_key: "max_products", value_mode: "value", int_value: 100, display_value: "100" }],
			}),
		});
		expect(update.status).toBe(200);
		const impact = await adminFetch(`/api/admin/v1/plan-revisions/${draft.id}/impact`, "owner");
		expect(await impact.json()).toMatchObject({ change_type: "restrictive", requires_notice: true });
		const published = await adminFetch(`/api/admin/v1/plan-revisions/${draft.id}/publish`, "owner", { method: "POST" });
		expect(await published.json()).toMatchObject({ change_type: "restrictive", rollout: "renewal" });
		const subscription = await env.orderak_db.prepare("SELECT plan_revision_id,pending_revision_id FROM organization_subscriptions WHERE id='sub-paid'")
			.first<{ plan_revision_id: string; pending_revision_id: string }>();
		expect(subscription).toEqual({ plan_revision_id: "r-1", pending_revision_id: draft.id });
	});

	it("keeps the subscription Test Lab staging-only, expiring, audited, and resettable", async () => {
		await env.orderak_db.prepare(
			"INSERT INTO organizations(id,name,owner_store_id,status) VALUES('org-lab','Lab org','store-lab','active')",
		).run();
		const path = "/api/admin/v1/test-lab/organizations/org-lab/plan";
		const body = JSON.stringify({
			plan_key: "paid2",
			reason: "Validate paid feature visibility",
			expires_at: new Date(Date.now() + 60 * 60 * 1_000).toISOString(),
		});
		expect((await adminFetch(path, "owner", { method: "POST", body })).status).toBe(404);
		const stagingEnv = { ...env, DEPLOYMENT_ENVIRONMENT: "staging" } as TestEnv;
		const applied = await adminFetch(path, "owner", { method: "POST", body }, stagingEnv);
		expect(applied.status).toBe(201);
		expect(await applied.json()).toMatchObject({ plan_key: "paid2", override_count: 6 });
		const active = await env.orderak_db.prepare(
			`SELECT COUNT(*) AS c FROM organization_entitlement_overrides
			 WHERE organization_id='org-lab' AND revoked_at IS NULL
			 AND expires_at IS NOT NULL AND reason LIKE '[TEST_LAB:paid2]%'`,
		).first<{ c: number }>();
		expect(active?.c).toBe(6);
		const reset = await adminFetch(path, "owner", { method: "DELETE" }, stagingEnv);
		expect(await reset.json()).toMatchObject({ ok: true, revoked_count: 6 });
		const audit = await env.orderak_db.prepare(
			"SELECT action FROM admin_audit WHERE action='admin.test_lab_plan_reset' ORDER BY id DESC LIMIT 1",
		).first<{ action: string }>();
		expect(audit?.action).toBe("admin.test_lab_plan_reset");
	});
});
