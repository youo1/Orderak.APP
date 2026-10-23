import { describe, it, expect, beforeEach } from "vitest";
import { SELF, BASE, env, createSchema, registerStore, authHeaders } from "./helpers";

beforeEach(async () => {
	await createSchema();
});

describe("R3a — PUT /api/v1/store sets a validated city after setup (D-05)", () => {
	it("accepts a typed city name, clears a stale catalogue reference, and rejects an invalid city", async () => {
		const r = await registerStore({ country_iso: "EG" });

		// Seed a catalogue-sourced city directly, the way setup would have left it,
		// without depending on which rows the test environment's separate geo
		// database happens to carry.
		await env.orderak_db.prepare(
			"UPDATE sellers SET city_catalog_id=?, city_catalog_version=?, city_name=? WHERE phone=?",
		).bind(4242, "catalog-version-test", "Old Catalogue City", r.phone).run();

		const typed = await SELF.fetch(`${BASE}/api/v1/store`, {
			method: "PUT",
			headers: authHeaders(r),
			body: JSON.stringify({ city_name: "New Village" }),
		});
		expect(typed.status).toBe(200);
		const typedBody = (await typed.json()) as { store: Record<string, unknown> };
		expect(typedBody.store.city_name).toBe("New Village");
		// A typed-name selection must not carry an unrelated catalogue ID/version forward.
		expect(typedBody.store.city_catalog_id).toBeNull();
		expect(typedBody.store.city_catalog_version).toBeNull();

		const tooShort = await SELF.fetch(`${BASE}/api/v1/store`, {
			method: "PUT",
			headers: authHeaders(r),
			body: JSON.stringify({ city_name: "A" }),
		});
		expect(tooShort.status).toBe(400);
		expect(await tooShort.json()).toMatchObject({ code: "invalid_city" });

		// A catalogue id with no matching row in any country is refused the same way,
		// independent of which real catalogue rows the test environment seeds.
		const invalidCatalogue = await SELF.fetch(`${BASE}/api/v1/store`, {
			method: "PUT",
			headers: authHeaders(r),
			body: JSON.stringify({ city_catalog_id: 999999999 }),
		});
		expect(invalidCatalogue.status).toBe(400);
		expect(await invalidCatalogue.json()).toMatchObject({ code: "invalid_city" });

		// Neither invalid attempt should have overwritten the last valid value.
		const unchanged = await SELF.fetch(`${BASE}/api/v1/store`, { headers: authHeaders(r) });
		const unchangedBody = (await unchanged.json()) as { store: Record<string, unknown> };
		expect(unchangedBody.store.city_name).toBe("New Village");
	});
});
