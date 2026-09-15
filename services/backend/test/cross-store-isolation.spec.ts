import { beforeEach, describe, expect, it } from "vitest";
import { BASE, SELF, authHeaders, createSchema, env, registerStore, seedStockedProduct, type Registered } from "./helpers";

/**
 * One seller must never be able to reach another seller's store.
 *
 * Assertions of this kind existed before this file, scattered across the suites
 * that happened to need them — support tickets and translations in
 * operations-coverage.spec.ts, order_no in order-status.spec.ts, a non-owning
 * store's product in public-routes.spec.ts. Scattered is how the gap below
 * survived: every one of those tests was written to prove its own feature
 * worked, so the endpoint nobody was writing a feature test for was the one
 * nobody checked.
 *
 * That endpoint was POST /api/v1/products/sync — the only seller-facing route
 * that DELETED, mirroring rather than patching, with the largest request body a
 * seller could send. If any field in it could name another store's row, one push
 * would destroy a catalogue that was not the caller's.
 *
 * It is gone, and its cases went with it. Their successors live in
 * product-crud.spec.ts, where the boundary is structurally stronger: PUT and
 * DELETE take no identity in the body at all, so the only way to name a product
 * is a code that must belong to the caller's store. One case has no successor
 * and is recorded in production-readiness-gate.md rather than left to be
 * noticed — `baseline_version` ceased to exist with the mirror.
 *
 * The store is resolved from the credential in every case, never from the body
 * or a path parameter. These tests exist to keep it that way: they are written
 * to fail if a future change ever reads a store identity off the request.
 */

beforeEach(createSchema);

const cola = { name: "Cola", price: { amount_minor: 1500, currency: "EGP" }, available: true };
const juice = { name: "Juice", price: { amount_minor: 2000, currency: "EGP" }, available: true };

type SyncedProduct = { app_id: number; remote_uuid: string; product_code: string };
type Catalog = { catalog_version: number; products: SyncedProduct[] };

async function storeIdOf(r: Registered): Promise<string> {
	const row = await env.orderak_db.prepare("SELECT id FROM sellers WHERE phone=?").bind(r.phone).first<{ id: string }>();
	return String(row!.id);
}

async function pull(r: Registered): Promise<Catalog> {
	const res = await SELF.fetch(`${BASE}/api/v1/products`, { headers: authHeaders(r) });
	return (await res.json()) as Catalog;
}

/** Every column a push can write, so "unchanged" means unchanged. */
async function snapshot(storeId: string): Promise<Record<string, unknown>[]> {
	const { results } = await env.orderak_db
		.prepare(`SELECT id, app_id, product_code, name, price_minor, currency, stock, stock_version, available, category_id
		          FROM products WHERE store_id=? ORDER BY product_code`)
		.bind(storeId)
		.all();
	return (results ?? []) as Record<string, unknown>[];
}

/** Two sellers, each holding one product, with A's catalogue captured. */
async function twoStores(): Promise<{
	a: Registered; b: Registered; aStore: string; bStore: string;
	aCatalog: Catalog; aBefore: Record<string, unknown>[];
}> {
	const a = await registerStore({ phone: "+201500002001", store_name: "Store A" });
	const b = await registerStore({ phone: "+201500002002", store_name: "Store B" });
	// Stocked rather than merely created: a product exists at zero stock until
	// the stock route says otherwise, and the order below needs a unit to sell.
	await seedStockedProduct(a, 10, cola);
	await seedStockedProduct(b, 4, juice);
	const aStore = await storeIdOf(a);
	const bStore = await storeIdOf(b);
	return { a, b, aStore, bStore, aCatalog: await pull(a), aBefore: await snapshot(aStore) };
}

describe("cross-store isolation: reads and store-scoped writes", () => {
	it("returns only the calling store's products", async () => {
		const { a, b } = await twoStores();
		expect((await pull(a)).products).toHaveLength(1);
		expect((await pull(b)).products).toHaveLength(1);
		expect((await pull(a)).products[0].remote_uuid).not.toBe((await pull(b)).products[0].remote_uuid);
	});

	it("returns only the calling store's orders", async () => {
		const { a, b, aCatalog } = await twoStores();
		const created = await SELF.fetch(`${BASE}/api/v1/orders`, {
			method: "POST", headers: authHeaders(a),
			body: JSON.stringify({
				idempotency_key: "isolation-order-1",
				buyer_phone: "01000000000",
				items: [{ product_code: aCatalog.products[0].product_code, qty: 1 }],
			}),
		});
		expect(created.status).toBe(200);

		const mine = await SELF.fetch(`${BASE}/api/v1/orders`, { headers: authHeaders(a) });
		const theirs = await SELF.fetch(`${BASE}/api/v1/orders`, { headers: authHeaders(b) });
		expect(((await mine.json()) as { orders: unknown[] }).orders).toHaveLength(1);
		expect(((await theirs.json()) as { orders: unknown[] }).orders).toHaveLength(0);
	});

	it("refuses an order naming another store's product", async () => {
		const { b, aCatalog } = await twoStores();
		const res = await SELF.fetch(`${BASE}/api/v1/orders`, {
			method: "POST", headers: authHeaders(b),
			body: JSON.stringify({
				idempotency_key: "isolation-order-2",
				buyer_phone: "01000000000",
				items: [{ product_code: aCatalog.products[0].product_code, qty: 1 }],
			}),
		});
		expect(res.status).toBeGreaterThanOrEqual(400);
		const { results } = await env.orderak_db.prepare("SELECT id FROM orders").all();
		expect(results ?? []).toHaveLength(0);
	});

	it("does not list or delete another store's category", async () => {
		const { a, b } = await twoStores();
		const created = await SELF.fetch(`${BASE}/api/v1/categories`, {
			method: "POST", headers: authHeaders(a), body: JSON.stringify({ name: "Drinks" }),
		});
		const { category } = (await created.json()) as { category: { category_code: string } };

		const list = await SELF.fetch(`${BASE}/api/v1/categories`, { headers: authHeaders(b) });
		expect(((await list.json()) as { categories: unknown[] }).categories).toHaveLength(0);

		// PUT and DELETE are the only methods this path implements; both must
		// refuse a code the caller does not own, and refuse it as absent.
		const renamed = await SELF.fetch(`${BASE}/api/v1/categories/${category.category_code}`, {
			method: "PUT", headers: authHeaders(b), body: JSON.stringify({ name: "Hijacked" }),
		});
		expect(renamed.status).toBe(404);

		const removed = await SELF.fetch(`${BASE}/api/v1/categories/${category.category_code}`, {
			method: "DELETE", headers: authHeaders(b),
		});
		expect(removed.status).toBe(404);
		expect(await env.orderak_db.prepare("SELECT COUNT(*) c FROM categories").first<{ c: number }>()).toMatchObject({ c: 1 });
	});
});

describe("cross-store isolation: the admin boundary", () => {
	it("does not accept a seller credential on the admin API", async () => {
		// A seller credential is a phone and a secret; an admin session is a
		// different mechanism entirely. Nothing should bridge them, and no admin
		// route should fall back to seller auth when its own check fails.
		const a = await registerStore({ phone: "+201500002050" });
		for (const path of [
			"/api/admin/v1/sellers",
			"/api/admin/v1/stores",
			"/api/admin/v1/buyer-privacy",
			"/api/admin/v1/billing/health",
		]) {
			const res = await SELF.fetch(`${BASE}${path}`, { headers: authHeaders(a) });
			expect([401, 403, 404]).toContain(res.status);
			expect(res.status).not.toBe(200);
		}
	});
});
