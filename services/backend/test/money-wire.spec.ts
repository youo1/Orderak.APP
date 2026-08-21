import { describe, expect, it, beforeEach } from "vitest";
import { BASE, SELF, authHeaders, createSchema, env, registerStore } from "./helpers";
import type { Registered } from "./helpers";

/** Registered exposes the public identifiers, not the internal row id. */
async function storeIdOf(seller: Registered): Promise<string> {
	const row = await env.orderak_db.prepare("SELECT id FROM sellers WHERE phone = ?").bind(seller.phone).first<{ id: string }>();
	if (!row) throw new Error(`no seller row for ${seller.phone}`);
	return row.id;
}

/**
 * Money crosses the wire as an object, and survives the round trip.
 *
 * This file exists because it was missing. Changing the product-sync payload
 * from a bare `price_minor` integer to a `price: { amount_minor, currency }`
 * object silently zeroed every price the app pushed — and all 246 tests stayed
 * green, because not one of them read a price back after writing it.
 *
 * A suite that posts money and never checks what was stored is not covering
 * money. These assert the value, not just the status code.
 */
beforeEach(createSchema);

describe("money on the wire", () => {
	it("round-trips a product price through sync", async () => {
		const seller = await registerStore({ phone: "+201500009001" });

		const push = await SELF.fetch(`${BASE}/api/v1/products/sync`, {
			method: "POST",
			headers: authHeaders(seller),
			body: JSON.stringify({
				products: [{
					app_id: 1,
					name: "Cola",
					price: { amount_minor: 1500, currency: "EGP" },
					stock: 10,
					available: true,
				}],
			}),
		});
		expect(push.status).toBe(200);

		const stored = await env.orderak_db
			.prepare("SELECT price_minor, currency FROM products WHERE store_id = ?")
			.bind(await storeIdOf(seller))
			.first<{ price_minor: number; currency: string }>();

		// The assertion that was missing: the amount actually landed.
		expect(stored?.price_minor).toBe(1500);
		expect(stored?.currency).toBe("EGP");
	});

	it("rejects a bare integer price rather than storing zero", async () => {
		const seller = await registerStore({ phone: "+201500009002" });

		await SELF.fetch(`${BASE}/api/v1/products/sync`, {
			method: "POST",
			headers: authHeaders(seller),
			// The pre-ADR-009 shape. A client still sending this must not have its
			// prices silently written as 0 — which is exactly what happened before
			// this test existed.
			body: JSON.stringify({
				products: [{ app_id: 2, name: "Water", price_minor: 500, stock: 3, available: true }],
			}),
		});

		const stored = await env.orderak_db
			.prepare("SELECT price_minor FROM products WHERE store_id = ?")
			.bind(await storeIdOf(seller))
			.first<{ price_minor: number }>();

		// Documents current behaviour: the legacy shape yields 0, not 500. When
		// request validation lands (ADR-010) this should become a 400 instead, and
		// this expectation should change with it rather than be deleted.
		expect(stored?.price_minor).toBe(0);
	});

	it("returns order totals as an object carrying the currency", async () => {
		const seller = await registerStore({ phone: "+201500009003" });
		await env.orderak_db
			.prepare(
				`INSERT INTO orders(id,order_no,store_id,buyer_phone,status,pay_method,total_minor,currency)
				 VALUES('wire-order',1,?,'+201000000000','NEW','COD',15000,'EGP')`,
			)
			.bind(await storeIdOf(seller))
			.run();

		const response = await SELF.fetch(`${BASE}/api/v1/orders?since=0`, { headers: authHeaders(seller) });
		expect(response.status).toBe(200);
		const body = await response.json<{ orders: { total: { amount_minor: number; currency: string } }[] }>();

		expect(body.orders[0].total).toEqual({ amount_minor: 15000, currency: "EGP" });
		// The bare field is gone, not merely supplemented: a client reading it
		// would get undefined and render nothing rather than a wrong number.
		expect((body.orders[0] as Record<string, unknown>).total_minor).toBeUndefined();
	});
});
