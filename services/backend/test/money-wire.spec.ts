import { describe, expect, it, beforeEach } from "vitest";
import { BASE, SELF, authHeaders, createSchema, env, registerStore, seedProduct } from "./helpers";
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
	it("round-trips a product price through the write that owns it", async () => {
		const seller = await registerStore({ phone: "+201500009001" });

		await seedProduct(seller, { name: "Cola", price: { amount_minor: 1500, currency: "EGP" } });

		const stored = await env.orderak_db
			.prepare("SELECT price_minor, currency FROM products WHERE store_id = ?")
			.bind(await storeIdOf(seller))
			.first<{ price_minor: number; currency: string }>();

		// The assertion that was missing: the amount actually landed.
		expect(stored?.price_minor).toBe(1500);
		expect(stored?.currency).toBe("EGP");
	});

	it("refuses a bare integer price on the write that owns it", async () => {
		const seller = await registerStore({ phone: "+201500009004" });

		// The pre-ADR-009 shape, sent to the product write. It is refused rather
		// than read as a missing price and stored as 0 — which is what the mirror
		// below still does, and what the comment there said should become a 400
		// once request validation landed. These routes are that validation.
		const res = await SELF.fetch(`${BASE}/api/v1/products`, {
			method: "POST",
			headers: authHeaders(seller),
			body: JSON.stringify({ name: "Water", price_minor: 500, available: true }),
		});
		expect(res.status).toBe(400);
		expect(((await res.json()) as { code: string }).code).toBe("price_required");

		const none = await env.orderak_db
			.prepare("SELECT COUNT(*) AS c FROM products WHERE store_id = ?")
			.bind(await storeIdOf(seller))
			.first<{ c: number }>();
		// Refused means nothing was written, not written-then-corrected.
		expect(Number(none?.c)).toBe(0);
	});

	it("stores zero for a bare integer price through the mirror, as it always has", async () => {
		const seller = await registerStore({ phone: "+201500009002" });

		await SELF.fetch(`${BASE}/api/v1/products/sync`, {
			method: "POST",
			headers: authHeaders(seller),
			// Unchanged on purpose. The mirror is served until every device has
			// moved to the product routes, and changing what it does to a payload
			// a shipped app might still send would be a breaking change made for
			// tidiness. This expectation dies with the endpoint, not before it.
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
