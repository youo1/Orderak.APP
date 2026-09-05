import { beforeEach, describe, expect, it } from "vitest";
import { BASE, SELF, authHeaders, createSchema, env, registerStore, type Registered } from "./helpers";

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
 * That endpoint is POST /api/v1/products/sync. It is the only seller-facing
 * route that DELETES, it mirrors rather than patches, and its request body is
 * the largest one a seller can send. If any field in it could name another
 * store's row, a single push would destroy a catalogue that is not the caller's
 * — which is the same failure mode as work item 04's empty-mirror bug, with an
 * attacker instead of an accident.
 *
 * The store is resolved from the credential in every case, never from the body
 * or a path parameter. These tests exist to keep it that way: they are written
 * to fail if a future change ever reads a store identity off the request.
 */

beforeEach(createSchema);

const cola = { name: "Cola", price: { amount_minor: 1500, currency: "EGP" }, stock: 10, available: true };
const juice = { name: "Juice", price: { amount_minor: 2000, currency: "EGP" }, stock: 4, available: true };

type SyncedProduct = { app_id: number; remote_uuid: string; product_code: string };
type Catalog = { catalog_version: number; products: SyncedProduct[] };

async function storeIdOf(r: Registered): Promise<string> {
	const row = await env.orderak_db.prepare("SELECT id FROM sellers WHERE phone=?").bind(r.phone).first<{ id: string }>();
	return String(row!.id);
}

async function push(r: Registered, body: Record<string, unknown>): Promise<Response> {
	return SELF.fetch(`${BASE}/api/v1/products/sync`, {
		method: "POST", headers: authHeaders(r), body: JSON.stringify(body),
	});
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
	await push(a, { products: [{ app_id: 1, ...cola }] });
	await push(b, { products: [{ app_id: 1, ...juice }] });
	const aStore = await storeIdOf(a);
	const bStore = await storeIdOf(b);
	return { a, b, aStore, bStore, aCatalog: await pull(a), aBefore: await snapshot(aStore) };
}

describe("cross-store isolation: the catalogue mirror", () => {
	it("ignores a store_id in the body and writes to the credential's store", async () => {
		const { a, b, aStore, bStore, aBefore } = await twoStores();

		const res = await push(b, { store_id: aStore, seller_id: aStore, products: [{ app_id: 1, ...juice, name: "Juice 1L" }] });
		expect(res.status).toBe(409); // modifies B's own existing product without a baseline

		const withBaseline = await push(b, {
			store_id: aStore,
			baseline_version: (await pull(b)).catalog_version,
			products: [{ app_id: 1, ...juice, name: "Juice 1L" }],
		});
		expect(withBaseline.status).toBe(200);

		expect(await snapshot(aStore)).toEqual(aBefore);
		expect((await snapshot(bStore))[0]).toMatchObject({ name: "Juice 1L" });
	});

	it("treats another store's remote_uuid as a new product of the caller's own", async () => {
		// remote_uuid is the cross-device identity (work item 04, I-8). It is
		// looked up in a map built from the calling store's rows, so a foreign id
		// finds nothing and falls through to "new product" — the same path as a
		// product deleted on the server. The risk this test pins down is a future
		// change that resolves the id globally to "be helpful".
		const { b, aStore, bStore, aCatalog, aBefore } = await twoStores();
		const aProduct = aCatalog.products[0];

		const res = await push(b, {
			baseline_version: (await pull(b)).catalog_version,
			products: [
				{ app_id: 1, remote_uuid: (await pull(b)).products[0].remote_uuid, ...juice },
				{ app_id: 2, remote_uuid: aProduct.remote_uuid, ...cola, name: "Stolen Cola" },
			],
		});
		expect(res.status).toBe(200);

		expect(await snapshot(aStore)).toEqual(aBefore);
		expect((await pull(b)).products).toHaveLength(2);
		// B got a product of its own, under an identity that is not A's.
		const impostor = (await snapshot(bStore)).find((row) => row.name === "Stolen Cola")!;
		expect(impostor).toBeTruthy();
		expect(impostor.id).not.toBe(aProduct.remote_uuid);
		expect(impostor.product_code).not.toBe(aProduct.product_code);
	});

	it("does not let another store's app_id claim a row", async () => {
		// app_id is a per-store Room row id, and both stores allocate 1. Before
		// item 04 it was the match key; if anything ever matches on it without the
		// store predicate, this is where two sellers collide.
		const { aStore, b, bStore, aBefore, aCatalog } = await twoStores();

		const res = await push(b, {
			baseline_version: (await pull(b)).catalog_version,
			products: [{ app_id: aCatalog.products[0].app_id, ...cola, name: "Overwrite attempt" }],
		});
		expect(res.status).toBe(200);

		expect(await snapshot(aStore)).toEqual(aBefore);
		// B rewrote its OWN app_id 1, which is the correct reading of that number.
		const bRows = await snapshot(bStore);
		expect(bRows).toHaveLength(1);
		expect(bRows[0]).toMatchObject({ name: "Overwrite attempt" });
	});

	it("refuses another store's category_code rather than linking across the boundary", async () => {
		const { a, b, aStore, bStore, aBefore } = await twoStores();
		const created = await SELF.fetch(`${BASE}/api/v1/categories`, {
			method: "POST", headers: authHeaders(a), body: JSON.stringify({ name: "Drinks" }),
		});
		const { category } = (await created.json()) as { category: { category_code: string; id: string } };

		const res = await push(b, {
			baseline_version: (await pull(b)).catalog_version,
			products: [{ app_id: 1, ...juice, category_code: category.category_code }],
		});
		expect(res.status).toBe(200);

		// The product exists, uncategorised — never pointed at A's category row.
		const bRows = await snapshot(bStore);
		expect(bRows).toHaveLength(1);
		expect(bRows[0].category_id).toBeNull();
		expect(await snapshot(aStore)).toEqual(aBefore);
	});

	it("cannot delete another store's catalogue with an empty mirror", async () => {
		// The destructive case. B sends the payload that empties a catalogue,
		// carrying every identifier belonging to A that it could plausibly know.
		const { aStore, b, bStore, aBefore, aCatalog } = await twoStores();

		const res = await push(b, {
			store_id: aStore,
			baseline_version: aCatalog.catalog_version,
			confirm_deletion: true,
			products: [],
		});
		expect(res.status).toBe(200);

		expect(await snapshot(aStore)).toEqual(aBefore);
		expect(await snapshot(bStore)).toHaveLength(0); // B emptied its own, as asked
	});

	it("computes the baseline from the caller's store, not from a store it names", async () => {
		// Catalogue versions are per-store integers, so they collide by design.
		// A baseline accepted because it matched ANOTHER store's version would be
		// a stale-device push waved through — item 04's bug B, across a boundary.
		const { a, aStore, b } = await twoStores();
		await push(a, { baseline_version: (await pull(a)).catalog_version, products: [{ app_id: 1, ...cola, name: "Cola 500ml" }] });
		// Captured after A's own edit: what must survive is A's CURRENT state, and
		// the edit is only here to drive the two stores' versions apart.
		const aBefore = await snapshot(aStore);
		const aVersion = (await pull(a)).catalog_version;
		const bVersion = (await pull(b)).catalog_version;
		expect(aVersion).not.toBe(bVersion);

		const res = await push(b, { store_id: aStore, baseline_version: aVersion, products: [{ app_id: 1, ...juice, name: "Renamed" }] });
		expect(res.status).toBe(409);
		// The version it answers with is B's, which is the whole assertion: the
		// baseline was computed from the caller's store and not from the one the
		// body named.
		expect(await res.json()).toMatchObject({ code: "stale_catalog", catalog_version: bVersion });
		expect(await snapshot(aStore)).toEqual(aBefore);
	});
});

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
