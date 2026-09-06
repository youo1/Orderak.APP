import { beforeEach, describe, expect, it } from "vitest";
import { BASE, SELF, authHeaders, createSchema, env, registerStore, type Registered } from "./helpers";
import { legacySnapshot, resolveEntitlementsForClient } from "../src/domains/commerce/entitlements";
import { LEGACY_FEATURE_ENTITLEMENTS, LEGACY_LIMIT_ENTITLEMENTS, LEGACY_LIMIT_KEYS } from "../src/domains/commerce/legacy-entitlements";
import { loadPlanConfig } from "../src/platform/config/config";
import catalog from "../../../docs/product/orderak-plan-catalog.json";

/**
 * The entitlement snapshot with the policy engine switched off.
 *
 * `ENTITLEMENTS_ENABLED` is false in staging and in production, and it always
 * has been, so this is not a fallback path — it is the only path any seller has
 * ever been served. Until work item 03a it served nothing: /api/v1/entitlements
 * answered 503 and the piggybacked plan config carried no map, so the app's
 * gates all read "not built" and its usage meters drew nothing.
 *
 * What these tests hold in place is that the client cannot tell which engine
 * answered (I-4). Not that the values match — the engine is a richer policy
 * source and is allowed to decide differently — but that the SHAPE and the KEY
 * SET are the same, so no client code has to branch, and none can.
 */

const engineOff = () => ({ ...env, ENTITLEMENTS_ENABLED: "false" }) as TestEnv;

type CatalogFeature = { key: string; implementation_status: string; value_type: string };
const catalogFeatures = (catalog as { features: CatalogFeature[] }).features;

async function storeIdOf(r: Registered): Promise<string> {
	const row = await env.orderak_db.prepare("SELECT id FROM sellers WHERE phone=?").bind(r.phone).first<{ id: string }>();
	return String(row!.id);
}

beforeEach(createSchema);

describe("legacy entitlement projection", () => {
	it("names every limit the app draws a meter for", async () => {
		const r = await registerStore({ phone: "+201500003001" });
		const snapshot = await legacySnapshot(engineOff(), await storeIdOf(r));

		for (const key of LEGACY_LIMIT_KEYS) {
			expect(snapshot.entitlements[key], `missing limit ${key}`).toBeTruthy();
			expect(snapshot.entitlements[key].value_type).toBe("integer");
		}
		// The free plan's numbers, from plan-limits.ts rather than a second copy.
		expect(snapshot.entitlements.max_products.value).toBe(20);
		expect(snapshot.entitlements.max_categories.value).toBe(5);
		expect(snapshot.entitlements.max_orders_per_month.value).toBe(50);
	});

	it("counts usage, because a limit without a numerator draws no meter", async () => {
		// Both meter call sites drop a row whose `used` is null. A snapshot that
		// named every limit and counted none of them would have looked complete
		// and still rendered an empty card.
		const r = await registerStore({ phone: "+201500003002" });
		const storeId = await storeIdOf(r);
		await env.orderak_db.batch([
			env.orderak_db.prepare("INSERT INTO products(id,store_id,product_code,app_id,name) VALUES('p1',?,'p-AAA001',1,'Cola')").bind(storeId),
			env.orderak_db.prepare("INSERT INTO products(id,store_id,product_code,app_id,name) VALUES('p2',?,'p-AAA002',2,'Juice')").bind(storeId),
			env.orderak_db.prepare("INSERT INTO categories(id,store_id,category_code,name) VALUES('c1',?,'c-AAAAAA','Drinks')").bind(storeId),
		]);

		const snapshot = await legacySnapshot(engineOff(), storeId);
		expect(snapshot.entitlements.max_products.used).toBe(2);
		expect(snapshot.entitlements.max_products.remaining).toBe(18);
		expect(snapshot.entitlements.max_categories.used).toBe(1);
		// The device the seller is holding counts as one.
		expect(snapshot.entitlements.max_concurrent_devices.used).toBe(1);

		// At least one row survives the filter both meters apply: a numerator, and
		// a finite limit. This is the assertion that says a meter renders.
		const renderable = Object.values(snapshot.entitlements).filter(
			(item) => item.used !== null && item.mode === "value" && typeof item.value === "number",
		);
		expect(renderable.length).toBeGreaterThan(0);
	});

	it("does not report a usage figure it did not measure", async () => {
		// Nothing counts AI requests per store in the legacy model. Zero would be
		// a claim the seller has used none; null draws no meter and claims nothing.
		const r = await registerStore({ phone: "+201500003003" });
		const snapshot = await legacySnapshot(engineOff(), await storeIdOf(r));
		expect(snapshot.entitlements.max_ai_requests_per_month.used).toBeNull();
		expect(snapshot.entitlements.max_ai_requests_per_month.remaining).toBeNull();
		// The limit itself is still stated — the app needs it to explain a refusal.
		expect(snapshot.entitlements.max_ai_requests_per_month.value).toBe(20);
	});

	it("names every implemented feature, because an absent key reads as unbuilt", async () => {
		const r = await registerStore({ phone: "+201500003004" });
		const snapshot = await legacySnapshot(engineOff(), await storeIdOf(r));

		for (const feature of LEGACY_FEATURE_ENTITLEMENTS) {
			const entry = snapshot.entitlements[feature.key];
			expect(entry, `missing feature ${feature.key}`).toBeTruthy();
			expect(entry.implementation_status).toBe("implemented");
		}
		expect(snapshot.entitlements["orders_fulfilment.order_history"].available).toBe(true);
		expect(snapshot.entitlements["products_catalog.product_creation_and_editing"].available).toBe(true);
	});

	it("never names a feature the app has not built", async () => {
		// The resolver refuses to upsell anything whose status is not
		// "implemented", so a key that leaked in here with that status would be
		// sold rather than hidden.
		//
		// editable_customer_profiles used to be asserted absent here: migration
		// 047 marked it implemented in D1 while the screen had no editor. Work
		// item 11 shipped the editor, so it is now present — and gated, which the
		// paid-only test below covers. The general rule is what remains.
		const r = await registerStore({ phone: "+201500003005" });
		const snapshot = await legacySnapshot(engineOff(), await storeIdOf(r));

		// The rule is not that a planned key may never appear — the engine sends
		// planned keys too, and the key sets have to match. The rule is that
		// nothing may be CALLED implemented that the catalogue calls planned,
		// because that status is what turns a hidden feature into an upsell.
		const status = new Map(catalogFeatures.map((f) => [f.key, f.implementation_status]));
		for (const [key, item] of Object.entries(snapshot.entitlements)) {
			const catalogued = status.get(key);
			expect(catalogued, `${key} is not in the source catalogue at all`).toBeTruthy();
			if (item.implementation_status === "implemented") {
				expect(catalogued, `${key} is ${catalogued} in the catalogue`).toBe("implemented");
			}
		}
	});

	it("keeps the customer editor closed on free and open on a paid plan", async () => {
		// The catalogue's plan revisions put this at `disabled` on free and
		// `Included` on all three paid tiers, and the legacy plans table has no
		// column that says so — the gate is the plan row existing at all. A free
		// seller who saw it available would be offered an editor the plan
		// comparison sells at paid1.
		const r = await registerStore({ phone: "+201500003105" });
		const storeId = await storeIdOf(r);

		const free = await legacySnapshot(engineOff(), storeId);
		const freeItem = free.entitlements["customers_crm.editable_customer_profiles"];
		expect(freeItem, "the key must be present, or the resolver reads it as NotBuilt").toBeTruthy();
		expect(freeItem.available).toBe(false);
		expect(freeItem.implementation_status).toBe("implemented");

		await env.orderak_db.batch([
			env.orderak_db.prepare("INSERT INTO plans(id,name,active,multi_device_enabled,max_products) VALUES('crm','CRM',1,0,200)"),
			env.orderak_db.prepare("INSERT INTO subscriptions(seller_id,plan_id,status) VALUES(?,'crm','active')").bind(storeId),
		]);
		const paid = await legacySnapshot(engineOff(), storeId);
		expect(paid.entitlements["customers_crm.editable_customer_profiles"].available).toBe(true);
	});

	it("honours the one feature the legacy plan row actually gates", async () => {
		const r = await registerStore({ phone: "+201500003006" });
		const storeId = await storeIdOf(r);
		const free = await legacySnapshot(engineOff(), storeId);
		expect(free.entitlements["team_security.multiple_owner_devices"].available).toBe(false);
		expect(free.entitlements.max_concurrent_devices.value).toBe(1);

		await env.orderak_db.batch([
			env.orderak_db.prepare("INSERT INTO plans(id,name,active,multi_device_enabled,max_products) VALUES('multi','Multi',1,1,200)"),
			env.orderak_db.prepare("INSERT INTO subscriptions(seller_id,plan_id,status) VALUES(?,'multi','active')").bind(storeId),
		]);
		const paid = await legacySnapshot(engineOff(), storeId);
		expect(paid.entitlements["team_security.multiple_owner_devices"].available).toBe(true);
		expect(paid.entitlements.max_concurrent_devices.value).toBe(2);
		expect(paid.entitlements.max_products.value).toBe(200);
	});

	it("changes its ETag when usage changes, so a 304 cannot serve a stale count", async () => {
		const r = await registerStore({ phone: "+201500003007" });
		const storeId = await storeIdOf(r);
		const before = await legacySnapshot(engineOff(), storeId);
		await env.orderak_db.prepare("INSERT INTO products(id,store_id,product_code,app_id,name) VALUES('p9',?,'p-BBB001',9,'New')")
			.bind(storeId).run();
		const after = await legacySnapshot(engineOff(), storeId);
		expect(after.etag).not.toBe(before.etag);
	});
});

describe("the entitlements route with the engine off", () => {
	it("answers with a snapshot instead of refusing", async () => {
		// It used to answer 503 entitlements_v2_disabled here, in both
		// environments, for every seller that has ever existed.
		const r = await registerStore({ phone: "+201500003010" });
		const res = await SELF.fetch(`${BASE}/api/v1/entitlements?projection=android-v1`, { headers: authHeaders(r) });
		expect(res.status).toBe(200);

		const body = (await res.json()) as { ok: boolean; entitlements: Record<string, unknown> };
		expect(body.ok).toBe(true);
		expect(Object.keys(body.entitlements).length).toBeGreaterThan(0);
		expect(body.entitlements.max_products).toBeTruthy();
	});

	it("still serves an ETag and a 304", async () => {
		const r = await registerStore({ phone: "+201500003011" });
		const first = await SELF.fetch(`${BASE}/api/v1/entitlements?projection=android-v1`, { headers: authHeaders(r) });
		const etag = first.headers.get("etag");
		expect(etag).toBeTruthy();

		const second = await SELF.fetch(`${BASE}/api/v1/entitlements?projection=android-v1`, {
			headers: { ...authHeaders(r), "if-none-match": etag! },
		});
		expect(second.status).toBe(304);
	});

	it("refuses an unauthenticated caller, as it did before", async () => {
		const res = await SELF.fetch(`${BASE}/api/v1/entitlements`, {
			headers: { "x-orderak-phone": "+201500003012", "x-orderak-secret": "wrong" },
		});
		expect(res.status).toBe(401);
	});
});

describe("the piggybacked plan config", () => {
	it("carries the map as well as the flat blocks", async () => {
		// The flat limits/features blocks are what installed builds read; the map
		// is what every gate and meter reads. Sending one without the other breaks
		// one of the two, so both go.
		const r = await registerStore({ phone: "+201500003020" });
		const config = await loadPlanConfig(engineOff(), await storeIdOf(r));

		expect(config.limits).toBeTruthy();
		expect(config.features).toBeTruthy();
		const entitlements = config.entitlements as Record<string, { value: unknown }>;
		expect(entitlements).toBeTruthy();
		expect(entitlements.max_products.value).toBe(20);
	});

	it("carries it for a subscribed seller too, not only the free default", async () => {
		const r = await registerStore({ phone: "+201500003021" });
		const storeId = await storeIdOf(r);
		await env.orderak_db.batch([
			env.orderak_db.prepare("INSERT INTO plans(id,name,active,max_products,max_categories) VALUES('grow','Growth',1,200,20)"),
			env.orderak_db.prepare("INSERT INTO subscriptions(seller_id,plan_id,status) VALUES(?,'grow','active')").bind(storeId),
		]);
		const config = await loadPlanConfig(engineOff(), storeId);
		const entitlements = config.entitlements as Record<string, { value: unknown }>;
		expect(entitlements.max_products.value).toBe(200);
		expect((config.limits as { max_products: number }).max_products).toBe(200);
	});
});

describe("one shape, whichever engine answers", () => {
	it("routes by the flag and not by what the data happens to contain", async () => {
		const r = await registerStore({ phone: "+201500003030" });
		const storeId = await storeIdOf(r);
		const viaHelper = await resolveEntitlementsForClient(engineOff(), storeId);
		const direct = await legacySnapshot(engineOff(), storeId);
		expect(Object.keys(viaHelper.entitlements).sort()).toEqual(Object.keys(direct.entitlements).sort());
	});

	it("gives every entitlement the full field set the engine gives", async () => {
		// The client deserialises one type. A field the legacy side omits would
		// silently take the DTO's default, which for `available` is false — an
		// omission that reads as a denial.
		const r = await registerStore({ phone: "+201500003031" });
		const snapshot = await legacySnapshot(engineOff(), await storeIdOf(r));
		const required = [
			"key", "category", "name", "description", "value_type", "unit", "reset_period",
			"implementation_status", "admin_configurable", "mode", "value", "display_value",
			"available", "used", "remaining", "reset_at", "custom_required",
		];
		for (const [key, item] of Object.entries(snapshot.entitlements)) {
			for (const field of required) {
				expect(Object.hasOwn(item, field), `${key} has no ${field}`).toBe(true);
			}
		}
	});

	it("carries the plan identity fields the client reads", async () => {
		const r = await registerStore({ phone: "+201500003032" });
		const snapshot = await legacySnapshot(engineOff(), await storeIdOf(r));
		expect(snapshot.ok).toBe(true);
		expect(snapshot.schema_version).toBe(1);
		expect(snapshot.plan_key).toBe("free");
		expect(snapshot.plan_revision_id).toBe("legacy:free");
		expect(snapshot.etag).toBeTruthy();
	});
});

describe("the registry against the source catalogue", () => {
	/**
	 * The registry is a hand-held list, so it can drift. Reading
	 * entitlement_definitions instead would trade that risk for a worse one — a
	 * legacy path that stops working when catalogue rows are missing, which is
	 * the one thing it exists in order not to do. This test is the trade.
	 */
	it("names exactly the catalogue's implemented features", () => {
		const limitAndAdsKeys = new Set<string>([...LEGACY_LIMIT_KEYS, "show_ads"]);
		const expected = catalogFeatures
			.filter((f) => f.implementation_status === "implemented" && !limitAndAdsKeys.has(f.key))
			.map((f) => f.key)
			.sort();
		const actual = LEGACY_FEATURE_ENTITLEMENTS.map((f) => f.key).sort();
		expect(actual).toEqual(expected);
	});

	it("gives each one the catalogue's own value type", () => {
		const types = new Map(catalogFeatures.map((f) => [f.key, f.value_type]));
		for (const feature of LEGACY_FEATURE_ENTITLEMENTS) {
			expect(feature.value_type, `${feature.key}`).toBe(types.get(feature.key));
		}
	});

	it("gives each limit the catalogue's own implementation status", () => {
		const byKey = new Map(catalogFeatures.map((f) => [f.key, f]));
		for (const limit of LEGACY_LIMIT_ENTITLEMENTS) {
			expect(byKey.get(limit.key), `${limit.key} is not in the catalogue`).toBeTruthy();
			expect(byKey.get(limit.key)!.implementation_status, limit.key).toBe(limit.implementation_status);
		}
		// Five are real. The sixth is max_team_members, which the app draws and
		// nothing enforces — the distinction this list exists to keep.
		expect(LEGACY_LIMIT_ENTITLEMENTS.filter((l) => l.implementation_status === "implemented")).toHaveLength(5);
	});
});
