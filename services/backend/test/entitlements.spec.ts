import { beforeEach, describe, expect, it } from "vitest";
import { createEntitlementSchema, createSchema, env } from "./helpers";
import { loadPlanConfig } from "../src/platform/config/config";
import catalog from "../../../docs/product/orderak-plan-catalog.json";
import {
	ensureOrganizationForStore,
	legacySnapshot,
	projectEntitlementsForAndroid,
	reserveUsage,
	resolveEntitlements,
	resolveEntitlementsForClient,
} from "../src/domains/commerce/entitlements";

const v2 = () => ({ ...env, ENTITLEMENTS_ENABLED: "true" }) as TestEnv;
const v1 = () => ({ ...env, ENTITLEMENTS_ENABLED: "false" }) as TestEnv;

type CatalogFeature = {
	key: string; category?: string; name?: string; value_type?: string;
	reset_period?: string; supports_unlimited?: boolean; higher_is_better?: boolean;
	implementation_status: string; admin_configurable?: boolean; core_universal?: boolean;
};

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

	// The precondition for work item 03b, and the whole of I-4.
	//
	// Turning the engine on swaps the source of every gate and meter in the app.
	// What must not change is what the client receives, because the client has no
	// branch on which engine answered and must not need one.
	//
	// This seeds the REAL catalogue rather than the six limit keys the rest of
	// this file uses. That distinction is the entire value of the test: against a
	// six-key fixture the engine and the legacy list trivially disagree, and the
	// disagreement says nothing, because migration 025 seeds 242 definitions in
	// every real environment and the legacy list is the implemented subset of
	// exactly that catalogue.
	describe("against the seeded catalogue, as a real environment has it", () => {
		beforeEach(async () => {
			const features = (catalog as { features: CatalogFeature[] }).features;
			const revision = "r-free";
			for (const f of features) {
				await env.orderak_db.prepare(`INSERT OR REPLACE INTO entitlement_definitions
				 (entitlement_key,category,name,value_type,reset_period,supports_unlimited,higher_is_better,
				  implementation_status,admin_configurable,core_universal,sort_order,active)
				 VALUES(?,?,?,?,?,?,?,?,?,?,?,1)`)
					.bind(f.key, f.category ?? "", f.name ?? f.key, f.value_type ?? "boolean",
						f.reset_period ?? "none", f.supports_unlimited ? 1 : 0, f.higher_is_better ? 1 : 0,
						f.implementation_status, f.admin_configurable ? 1 : 0, f.core_universal ? 1 : 0, 0).run();
				await env.orderak_db.prepare(`INSERT OR REPLACE INTO plan_revision_entitlements
				 (revision_id,entitlement_key,value_mode,bool_value,int_value,display_value)
				 VALUES(?,?,'value',1,NULL,'Included')`).bind(revision, f.key).run();
			}
		});

		it("sends the client the same keys whichever engine answered", async () => {
			// loadPlanConfig is the block that rides on every orders pull, and it is
			// the only place most sellers ever receive plan state.
			const viaEngine = await loadPlanConfig(v2(), "seller-1");
			const viaLegacy = await loadPlanConfig(v1(), "seller-1");

			const engineKeys = Object.keys(viaEngine.entitlements as Record<string, unknown>).sort();
			const legacyKeys = Object.keys(viaLegacy.entitlements as Record<string, unknown>).sort();
			expect(legacyKeys.length).toBeGreaterThan(0);

			// Directed both ways, because which side is missing a key says what to
			// fix: one the engine drops is a feature that would silently vanish; one
			// only the engine sends is payload the client resolves to NotBuilt and
			// never reads.
			expect(legacyKeys.filter((k) => !engineKeys.includes(k)), "keys the engine would drop").toEqual([]);
			expect(engineKeys.filter((k) => !legacyKeys.includes(k)), "keys only the engine sends").toEqual([]);
		});

		it("does not send the planned catalogue to the client", async () => {
			// The regression this guards: the engine reads all 242 definitions, 210
			// of them planned. Sending them raw made the flag change the size of a
			// piggybacked block sevenfold — not a gate bug, since a planned key
			// fails closed on the device, but a client-visible difference that would
			// have surfaced as "sync got slower" and pointed nowhere.
			const viaEngine = await loadPlanConfig(v2(), "seller-1");
			const entitlements = viaEngine.entitlements as Record<string, { implementation_status?: string }>;
			const planned = Object.entries(entitlements)
				.filter(([, item]) => item.implementation_status !== "implemented")
				.map(([key]) => key);
			// max_team_members is the one deliberate exception, and it is a limit
			// rather than a feature: the catalogue calls it planned because nothing
			// enforces a team size, the legacy list sends it anyway so the key sets
			// match, and the app reads it into ConfigLimits. Anything else appearing
			// here is the 210-key catalogue leaking onto the sync.
			expect(planned, "only the documented planned limit may ride on the orders pull")
				.toEqual(["max_team_members"]);
		});
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
