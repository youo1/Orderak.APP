import { beforeEach, describe, expect, it } from "vitest";
import { signJwt, type AdminRole } from "../src/domains/identity/auth";
import { SELF, callWorker, createEntitlementSchema, createSchema, env, registerStore } from "./helpers";
import adminWorker from "../src/entrypoints/admin-worker";

async function adminFetch(path: string, role: AdminRole, init: RequestInit = {}): Promise<Response> {
	const token = await signJwt({ sub: 1, email: `${role}@example.test`, role }, env.ADMIN_JWT_SECRET || "test-admin-secret");
	const headers = new Headers(init.headers);
	headers.set("authorization", `Bearer ${token}`);
	headers.set("content-type", "application/json");
	return callWorker(adminWorker, new Request(`https://admin.orderak.app${path}`, { ...init, headers }), env);
}

describe("admin operations coverage", () => {
	beforeEach(async () => {
		await createSchema();
		await createEntitlementSchema();
	});

	it("enforces role permissions and never exposes seller credential hashes", async () => {
		const seller = await registerStore({ phone: "+201500001020" });
		const row = await env.orderak_db.prepare("SELECT id FROM sellers WHERE phone=?").bind(seller.phone).first<{ id: string }>();
		expect((await adminFetch("/api/admin/v1/stores", "support")).status).toBe(200);
		expect((await adminFetch(`/api/admin/v1/stores/${row!.id}`, "readonly", {
			method: "PATCH", body: JSON.stringify({ status: "suspended", reason: "test" }),
		})).status).toBe(403);
		const detail = await adminFetch(`/api/admin/v1/stores/${row!.id}`, "support");
		expect(detail.status).toBe(200);
		const body = await detail.json<{ store: Record<string, unknown>; devices: Array<{ row_id: number }> }>();
		expect(body.store).not.toHaveProperty("secret");
		expect(body.devices[0].row_id).toBe(0);
	});

	it("keeps typed runtime controls owner-only and reports effective state", async () => {
		expect((await adminFetch("/api/admin/v1/runtime-config", "readonly", {
			method: "PATCH", body: JSON.stringify({ ai_enabled: false }),
		})).status).toBe(403);
		const updated = await adminFetch("/api/admin/v1/runtime-config", "owner", {
			method: "PATCH", body: JSON.stringify({ ai_enabled: false, billing_enabled: false }),
		});
		expect(updated.status).toBe(200);
		expect((await adminFetch("/api/admin/v1/runtime-config", "readonly")).status).toBe(403);
		const read = await adminFetch("/api/admin/v1/runtime-config", "owner");
		expect(await read.json()).toMatchObject({ controls: {
			ai: { admin_enabled: false, effective: false },
			billing: { admin_enabled: false, effective: false },
		} });
	});
});
