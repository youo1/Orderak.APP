import { beforeEach, describe, expect, it } from "vitest";
import { createEntitlementSchema, createSchema, env } from "./helpers";
import {
	ensureOrganizationForStore,
	projectEntitlementsForAndroid,
	reserveUsage,
	resolveEntitlements,
} from "../src/domains/commerce/entitlements";

const v2 = () => ({ ...env, ENTITLEMENTS_ENABLED: "true" }) as TestEnv;

describe("versioned entitlement policy engine", () => {
	beforeEach(async () => {
		await createSchema();
		await createEntitlementSchema();
		await env.orderak_db.prepare(
			"INSERT OR REPLACE INTO sellers(id,store_code,store_name,phone,secret) VALUES('seller-1','S1','Test','+201000000001','sha256$invalid')",
		).run();
		await ensureOrganizationForStore(v2(), "seller-1", "Test", "en");
	});

	it("resolves the Free plan and numeric device cap", async () => {
		const result = await resolveEntitlements(v2(), "seller-1");
		expect(result.plan_key).toBe("free");
		expect(result.entitlements.max_products.value).toBe(20);
		expect(result.entitlements.max_concurrent_devices.value).toBe(1);
		expect(result.entitlements.show_ads.value).toBe(true);
	});

	it("applies active organization overrides", async () => {
		const snapshot = await resolveEntitlements(v2(), "seller-1");
		await env.orderak_db.prepare(`INSERT INTO organization_entitlement_overrides
		 (id,organization_id,entitlement_key,value_mode,int_value,reason,created_by) VALUES('o1',?,'max_products','value',35,'contract',1)`)
			.bind(snapshot.organization_id).run();
		const updated = await resolveEntitlements(v2(), "seller-1");
		expect(updated.entitlements.max_products.value).toBe(35);
	});

	it("changes the snapshot ETag when client-visible usage changes", async () => {
		const initial = await resolveEntitlements(v2(), "seller-1");
		const unchanged = await resolveEntitlements(v2(), "seller-1");
		expect(unchanged.etag).toBe(initial.etag);

		await env.orderak_db.prepare(
			`INSERT INTO products(id,store_id,product_code,app_id,name)
			 VALUES('product-1','seller-1','p-ONE',1,'One')`,
		).run();
		const updated = await resolveEntitlements(v2(), "seller-1");
		expect(updated.entitlements.max_products.used).toBe(1);
		expect(updated.entitlements.max_products.remaining).toBe(19);
		expect(updated.etag).not.toBe(initial.etag);
	});

	it("keeps the Android projection implemented-only and under 10 KB", async () => {
		const full = await resolveEntitlements(v2(), "seller-1");
		const withPlanned = {
			...full,
			entitlements: {
				...full.entitlements,
				"future.test": {
					...full.entitlements.max_products,
					key: "future.test",
					implementation_status: "planned" as const,
				},
			},
		};
		const projected = await projectEntitlementsForAndroid(withPlanned);

		expect(projected.entitlements["future.test"]).toBeUndefined();
		expect(Object.keys(projected.entitlements).length).toBeLessThan(Object.keys(withPlanned.entitlements).length);
		expect(Object.values(projected.entitlements).every((item) => item.implementation_status === "implemented")).toBe(true);
		expect(projected.entitlements.max_products).toBeDefined();
		expect(new TextEncoder().encode(JSON.stringify(projected)).byteLength).toBeLessThan(10_000);
	});

	it("enforces monthly usage atomically and idempotently", async () => {
		expect((await reserveUsage(v2(), "seller-1", "max_ai_requests_per_month", 1, "a")).allowed).toBe(true);
		const again = await reserveUsage(v2(), "seller-1", "max_ai_requests_per_month", 1, "a");
		expect(again.allowed).toBe(true);
		expect(again.idempotent).toBe(true);
		expect((await reserveUsage(v2(), "seller-1", "max_ai_requests_per_month", 1, "b")).allowed).toBe(true);
		expect((await reserveUsage(v2(), "seller-1", "max_ai_requests_per_month", 1, "c")).allowed).toBe(false);
		const rejectedRetry = await reserveUsage(v2(), "seller-1", "max_ai_requests_per_month", 1, "c");
		expect(rejectedRetry.allowed).toBe(false);
		expect(rejectedRetry.idempotent).toBe(true);
	});
});
