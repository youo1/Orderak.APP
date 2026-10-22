import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SELF, BASE, env, createSchema, registerStore, authHeaders } from "./helpers";

beforeEach(async () => {
	await createSchema();
});

afterEach(() => {
	vi.unstubAllGlobals();
});

async function sellerCityCategory(phone: string) {
	return env.orderak_db.prepare(
		`SELECT business_category, business_category_id, business_subcategory_id,
		        city_catalog_id, city_catalog_version, city_name
		 FROM sellers WHERE phone = ?`,
	).bind(phone).first<Record<string, unknown>>();
}

describe("PUT /api/v1/store — R3a city and legacy-category updates (D-05/D-13 follow-on)", () => {
	it("sets only the legacy business_category key, leaving taxonomy IDs NULL, while a taxonomy selection still stores its IDs", async () => {
		const r = await registerStore();

		const legacy = await SELF.fetch(`${BASE}/api/v1/store`, {
			method: "PUT",
			headers: authHeaders(r),
			body: JSON.stringify({ business_category: "fashion" }),
		});
		expect(legacy.status).toBe(200);
		expect(await sellerCityCategory(r.phone)).toMatchObject({
			business_category: "fashion",
			business_category_id: null,
			business_subcategory_id: null,
		});

		const taxonomy = await SELF.fetch(`${BASE}/api/v1/store`, {
			method: "PUT",
			headers: authHeaders(r),
			body: JSON.stringify({ business_category_id: "fashion", business_subcategory_id: "fashion_clothing" }),
		});
		expect(taxonomy.status).toBe(200);
		expect(await sellerCityCategory(r.phone)).toMatchObject({
			business_category_id: "fashion",
			business_subcategory_id: "fashion_clothing",
		});
	});

	it("sets a typed city name, rejects one shorter than the minimum length, and rejects an unknown catalogue city id", async () => {
		const r = await registerStore();

		const named = await SELF.fetch(`${BASE}/api/v1/store`, {
			method: "PUT",
			headers: authHeaders(r),
			body: JSON.stringify({ city_name: "Alexandria" }),
		});
		expect(named.status).toBe(200);
		expect(await sellerCityCategory(r.phone)).toMatchObject({
			city_name: "Alexandria",
			city_catalog_id: null,
		});

		const tooShort = await SELF.fetch(`${BASE}/api/v1/store`, {
			method: "PUT",
			headers: authHeaders(r),
			body: JSON.stringify({ city_name: "A" }),
		});
		expect(tooShort.status).toBe(400);
		expect(await tooShort.json()).toMatchObject({ code: "invalid_city" });

		const unknownCatalog = await SELF.fetch(`${BASE}/api/v1/store`, {
			method: "PUT",
			headers: authHeaders(r),
			body: JSON.stringify({ city_catalog_id: 999999999 }),
		});
		expect(unknownCatalog.status).toBe(400);
		expect(await unknownCatalog.json()).toMatchObject({ code: "invalid_city" });
	});

	it("clears a stale catalogue city id and version when a typed name replaces it", async () => {
		const r = await registerStore();
		await env.orderak_db.prepare(
			"UPDATE sellers SET city_catalog_id=?, city_catalog_version=?, city_name=? WHERE phone=?",
		).bind(42, "v-test", "Stale City", r.phone).run();

		const res = await SELF.fetch(`${BASE}/api/v1/store`, {
			method: "PUT",
			headers: authHeaders(r),
			body: JSON.stringify({ city_name: "Fresh City" }),
		});
		expect(res.status).toBe(200);
		expect(await sellerCityCategory(r.phone)).toMatchObject({
			city_name: "Fresh City",
			city_catalog_id: null,
			city_catalog_version: null,
		});
	});
});
