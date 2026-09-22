import { beforeEach, describe, expect, it } from "vitest";
import { BASE, SELF, authHeaders, createSchema, env, registerStore, seedProduct, setProductStock, type Registered } from "./helpers";

/**
 * Products as a resource, addressed one at a time by their public code.
 *
 * WHAT THIS REPLACES
 *   `POST /api/v1/products/sync` mirrors the whole catalogue: the device sends
 *   what it holds and the server deletes whatever the payload omits. Every
 *   safety property of that endpoint is a guard bolted on afterwards — a
 *   download-before-push baseline, a version check, a bulk-deletion prompt —
 *   and all three exist to answer one question the shape cannot answer on its
 *   own: does absence mean "deleted" or "this device has not looked yet"?
 *
 *   These routes never ask it. A create says create, a delete says delete, and a
 *   device that has forgotten something says nothing at all.
 *
 * WHAT IS ASSERTED HERE RATHER THAN ASSUMED
 *   The tenant boundary (a store cannot reach another store's product by any
 *   field it can put in a request), the write fence (a fenced tenant is refused
 *   rather than written to), stock compare-and-set, and — the one with no
 *   predecessor in the mirror's suite — that a rejected write leaves the stock
 *   ledger untouched.
 */

beforeEach(createSchema);

async function storeIdOf(r: Registered): Promise<string> {
	const row = await env.orderak_db.prepare("SELECT id FROM sellers WHERE phone=?").bind(r.phone).first<{ id: string }>();
	return String(row!.id);
}

async function productCount(r: Registered): Promise<number> {
	const row = await env.orderak_db
		.prepare("SELECT COUNT(*) AS c FROM products WHERE store_id=?")
		.bind(await storeIdOf(r)).first<{ c: number }>();
	return Number(row?.c ?? 0);
}

async function movementCount(r: Registered): Promise<number> {
	const row = await env.orderak_db
		.prepare("SELECT COUNT(*) AS c FROM stock_movements WHERE store_id=?")
		.bind(await storeIdOf(r)).first<{ c: number }>();
	return Number(row?.c ?? 0);
}

async function createCategory(r: Registered, name: string): Promise<string> {
	const res = await SELF.fetch(`${BASE}/api/v1/categories`, {
		method: "POST", headers: authHeaders(r), body: JSON.stringify({ name }),
	});
	const body = (await res.json()) as { category?: { category_code: string } };
	return String(body.category!.category_code);
}

describe("product CRUD", () => {
	it("creates a product and returns it in the shape the pull uses", async () => {
		const r = await registerStore();
		const product = await seedProduct(r, { name: "Mango Juice", price: { amount_minor: 2500, currency: "EGP" } });

		expect(product.product_code).toMatch(/^p-/);
		expect(product.name).toBe("Mango Juice");
		expect(product.price).toEqual({ amount_minor: 2500, currency: "EGP" });
		expect(product.stock).toBe(0);
		expect(product.stock_version).toBe(0);

		// The pull and the write must describe the same row identically, or a
		// client that reads one and writes the other drifts.
		const pulled = await SELF.fetch(`${BASE}/api/v1/products`, { headers: authHeaders(r) });
		const body = (await pulled.json()) as { products: Record<string, unknown>[] };
		expect(body.products).toHaveLength(1);
		expect(body.products[0]).toEqual(product);
	});

	it("starts a new product at zero stock and records no opening movement", async () => {
		// Stock is server-owned. A create that accepted a stock figure would be a
		// device asserting inventory it cannot know, and the ledger would carry an
		// opening balance nobody counted.
		const r = await registerStore();
		const product = await seedProduct(r, { stock: 99 });
		expect(product.stock).toBe(0);
		expect(await movementCount(r)).toBe(0);
	});

	it("replaces metadata on PUT and never touches stock", async () => {
		const r = await registerStore();
		const created = await seedProduct(r, { description: "cold" });
		const stocked = await setProductStock(r, String(created.product_code), 12, 0);
		expect(stocked.stock).toBe(12);

		const res = await SELF.fetch(`${BASE}/api/v1/products/${created.product_code}`, {
			method: "PUT", headers: authHeaders(r),
			body: JSON.stringify({ name: "Renamed", price: { amount_minor: 700, currency: "EGP" }, available: false }),
		});
		expect(res.status).toBe(200);
		const body = (await res.json()) as { product: Record<string, unknown> };

		expect(body.product.name).toBe("Renamed");
		expect(body.product.available).toBe(false);
		// Omitted means cleared: PUT is a replacement, not a partial update.
		expect(body.product.description).toBeNull();
		// Untouched, and the revision did not move either.
		expect(body.product.stock).toBe(12);
		expect(body.product.stock_version).toBe(stocked.stock_version);
	});

	it("carries a description through create, pull and replace", async () => {
		// The test next door proves an OMITTED description is cleared, which is
		// the PUT-is-a-replacement rule. Nothing proved the opposite: that a
		// description the seller typed survives being written, read back and
		// written again. A field that only has a test for its disappearance is a
		// field whose persistence nobody checked.
		const r = await registerStore();
		const text = "قماش كريب، مقاسات من S لـ XL";
		const created = await seedProduct(r, { description: text });
		expect(created.description).toBe(text);

		// The pull is what the device actually reads, and it has to agree.
		const pulled = await SELF.fetch(`${BASE}/api/v1/products`, { headers: authHeaders(r) });
		const body = (await pulled.json()) as { products: Record<string, unknown>[] };
		expect(body.products[0].description).toBe(text);

		// Supplied again on PUT, it stays — this is the half that distinguishes
		// "replacement clears what you omit" from "replacement loses the field".
		const kept = "قماش كريب، مقاس واحد";
		const res = await SELF.fetch(`${BASE}/api/v1/products/${created.product_code}`, {
			method: "PUT", headers: authHeaders(r),
			body: JSON.stringify({
				name: created.name,
				price: created.price,
				description: kept,
			}),
		});
		expect(res.status).toBe(200);
		expect(((await res.json()) as { product: Record<string, unknown> }).product.description).toBe(kept);

		const after = await SELF.fetch(`${BASE}/api/v1/products`, { headers: authHeaders(r) });
		const afterBody = (await after.json()) as { products: Record<string, unknown>[] };
		expect(afterBody.products[0].description).toBe(kept);
	});

	it("deletes a product without disturbing its ledger history", async () => {
		const r = await registerStore();
		const created = await seedProduct(r);
		await setProductStock(r, String(created.product_code), 5, 0);
		expect(await movementCount(r)).toBe(1);

		const res = await SELF.fetch(`${BASE}/api/v1/products/${created.product_code}`, {
			method: "DELETE", headers: authHeaders(r),
		});
		expect(res.status).toBe(200);
		expect(await productCount(r)).toBe(0);

		// The movement carries its own copy of the product's identity precisely so
		// a later deletion cannot rewrite history (migration 052).
		expect(await movementCount(r)).toBe(1);
		const row = await env.orderak_db
			.prepare("SELECT product_code FROM stock_movements WHERE store_id=?")
			.bind(await storeIdOf(r)).first<{ product_code: string }>();
		expect(row?.product_code).toBe(created.product_code);
	});

	it("answers 404 for a product code that is not this store's", async () => {
		const r = await registerStore();
		const res = await SELF.fetch(`${BASE}/api/v1/products/p-NOPE1234`, {
			method: "PUT", headers: authHeaders(r),
			body: JSON.stringify({ name: "x", price: { amount_minor: 1, currency: "EGP" } }),
		});
		expect(res.status).toBe(404);
	});
});

describe("product CRUD: idempotency", () => {
	it("returns the same product when a create is retried with one client_request_id", async () => {
		// The failure this prevents: the server commits, the response is lost, the
		// seller taps retry, and a second product appears. The mirror converged on
		// a replay because it was keyed by identity; a create does not.
		const r = await registerStore();
		const key = "req-abc-123";
		const first = await seedProduct(r, { client_request_id: key, name: "Once" });
		const second = await seedProduct(r, { client_request_id: key, name: "Once" });

		expect(second.product_code).toBe(first.product_code);
		expect(await productCount(r)).toBe(1);
	});

	it("treats different keys as different products", async () => {
		const r = await registerStore();
		await seedProduct(r, { client_request_id: "one" });
		await seedProduct(r, { client_request_id: "two" });
		expect(await productCount(r)).toBe(2);
	});

	it("does not deduplicate creates that carry no key", async () => {
		// NULLs are distinct in the index, deliberately: a caller that sends no key
		// has not asked for deduplication and must not silently get it.
		const r = await registerStore();
		await seedProduct(r);
		await seedProduct(r);
		expect(await productCount(r)).toBe(2);
	});
});

describe("product CRUD: stock compare-and-set", () => {
	it("refuses a stale revision and reports the authoritative pair", async () => {
		const r = await registerStore();
		const created = await seedProduct(r);
		const after = await setProductStock(r, String(created.product_code), 10, 0);
		expect(after.stock_version).toBe(1);

		const stale = await SELF.fetch(`${BASE}/api/v1/products/${created.product_code}/stock`, {
			method: "PATCH", headers: authHeaders(r),
			body: JSON.stringify({ stock: 3, expected_stock_version: 0 }),
		});
		expect(stale.status).toBe(409);
		const body = (await stale.json()) as Record<string, unknown>;
		expect(body.code).toBe("stale_stock");
		// Carried so the client can rebase without a full catalogue read.
		expect(body.stock).toBe(10);
		expect(body.stock_version).toBe(1);
	});

	it("writes no ledger row when a stale adjustment is refused", async () => {
		// The refusal must be total. A rejected write that still moved the ledger
		// would leave the ledger describing inventory that never changed.
		const r = await registerStore();
		const created = await seedProduct(r);
		await setProductStock(r, String(created.product_code), 10, 0);
		expect(await movementCount(r)).toBe(1);

		await SELF.fetch(`${BASE}/api/v1/products/${created.product_code}/stock`, {
			method: "PATCH", headers: authHeaders(r),
			body: JSON.stringify({ stock: 3, expected_stock_version: 0 }),
		});
		expect(await movementCount(r)).toBe(1);
	});

	it("requires expected_stock_version rather than defaulting it", async () => {
		// Optional is how last-write-wins returns: a caller with no opinion about
		// what it is overwriting would erase a buyer's decrement.
		const r = await registerStore();
		const created = await seedProduct(r);
		const res = await SELF.fetch(`${BASE}/api/v1/products/${created.product_code}/stock`, {
			method: "PATCH", headers: authHeaders(r), body: JSON.stringify({ stock: 3 }),
		});
		expect(res.status).toBe(400);
		expect(((await res.json()) as Record<string, unknown>).code).toBe("expected_stock_version_required");
	});

	it("records no movement when the adjustment changes nothing", async () => {
		const r = await registerStore();
		const created = await seedProduct(r);
		await setProductStock(r, String(created.product_code), 4, 0);
		await setProductStock(r, String(created.product_code), 4, 1);
		expect(await movementCount(r)).toBe(1);
	});
});

describe("product CRUD: discounts", () => {
	it("stores a percentage discount as basis points", async () => {
		const r = await registerStore();
		const product = await seedProduct(r, { discount_type: "PERCENTAGE", discount_value: 750 });
		expect(product.discount_type).toBe("PERCENTAGE");
		expect(product.discount_value).toBe(750);
	});

	it("refuses half a discount", async () => {
		const r = await registerStore();
		const res = await SELF.fetch(`${BASE}/api/v1/products`, {
			method: "POST", headers: authHeaders(r),
			body: JSON.stringify({
				name: "Half", price: { amount_minor: 100, currency: "EGP" }, discount_type: "PERCENTAGE",
			}),
		});
		expect(res.status).toBe(400);
		expect(((await res.json()) as Record<string, unknown>).code).toBe("discount_incomplete");
	});

	it("refuses a percentage above one hundred", async () => {
		const r = await registerStore();
		const res = await SELF.fetch(`${BASE}/api/v1/products`, {
			method: "POST", headers: authHeaders(r),
			body: JSON.stringify({
				name: "Free", price: { amount_minor: 100, currency: "EGP" },
				discount_type: "PERCENTAGE", discount_value: 10001,
			}),
		});
		expect(res.status).toBe(400);
	});

	it("refuses a discount type it cannot interpret", async () => {
		const r = await registerStore();
		const res = await SELF.fetch(`${BASE}/api/v1/products`, {
			method: "POST", headers: authHeaders(r),
			body: JSON.stringify({
				name: "Odd", price: { amount_minor: 100, currency: "EGP" },
				discount_type: "BOGOF", discount_value: 1,
			}),
		});
		expect(res.status).toBe(400);
		expect(((await res.json()) as Record<string, unknown>).code).toBe("discount_type_unknown");
	});
});

describe("cross-store isolation: product CRUD", () => {
	async function twoStores(): Promise<{ a: Registered; b: Registered; aCode: string }> {
		const a = await registerStore();
		const b = await registerStore();
		const product = await seedProduct(a, { name: "A's product" });
		return { a, b, aCode: String(product.product_code) };
	}

	it("creates in the credential's store however the body is addressed", async () => {
		// Successor to the mirror suite's "body store_id is ignored".
		const { a, b } = await twoStores();
		const before = await productCount(a);
		await seedProduct(b, { store_id: await storeIdOf(a), seller_id: await storeIdOf(a), name: "B's" });
		expect(await productCount(a)).toBe(before);
		expect(await productCount(b)).toBe(1);
	});

	it("refuses to edit another store's product", async () => {
		// Structurally stronger than the mirror's foreign-remote_uuid case: there
		// is no identity field in the request at all, so the only way to name a
		// product is a code that must belong to the caller's store.
		const { b, aCode, a } = await twoStores();
		const res = await SELF.fetch(`${BASE}/api/v1/products/${aCode}`, {
			method: "PUT", headers: authHeaders(b),
			body: JSON.stringify({ name: "hijacked", price: { amount_minor: 1, currency: "EGP" } }),
		});
		expect(res.status).toBe(404);
		const row = await env.orderak_db
			.prepare("SELECT name FROM products WHERE product_code=?").bind(aCode).first<{ name: string }>();
		expect(row?.name).toBe("A's product");
	});

	it("refuses to delete another store's product", async () => {
		const { b, aCode, a } = await twoStores();
		const res = await SELF.fetch(`${BASE}/api/v1/products/${aCode}`, {
			method: "DELETE", headers: authHeaders(b),
		});
		expect(res.status).toBe(404);
		expect(await productCount(a)).toBe(1);
	});

	it("refuses another store's category code instead of silently filing under none", async () => {
		const { a, b } = await twoStores();
		const aCategory = await createCategory(a, "A's shelf");
		const res = await SELF.fetch(`${BASE}/api/v1/products`, {
			method: "POST", headers: authHeaders(b),
			body: JSON.stringify({
				name: "B's", price: { amount_minor: 100, currency: "EGP" }, category_code: aCategory,
			}),
		});
		expect(res.status).toBe(400);
		expect(((await res.json()) as Record<string, unknown>).code).toBe("unknown_category_code");
		// And nothing was created for B as a side effect of the rejection.
		expect(await productCount(b)).toBe(0);
	});

	it("leaves no stock movement in another store's ledger", async () => {
		// No predecessor in the mirror's suite, which never checked the ledger —
		// and the ledger is financial state.
		const { a, b, aCode } = await twoStores();
		const res = await SELF.fetch(`${BASE}/api/v1/products/${aCode}/stock`, {
			method: "PATCH", headers: authHeaders(b),
			body: JSON.stringify({ stock: 999, expected_stock_version: 0 }),
		});
		expect(res.status).toBe(404);
		expect(await movementCount(a)).toBe(0);
	});

	it("leaves A's catalogue byte-identical after every write B can make", async () => {
		// The property the mirror suite's "an empty mirror deletes A's products"
		// was actually protecting, stated directly.
		const { a, b, aCode } = await twoStores();
		const before = await env.orderak_db
			.prepare("SELECT product_code, name, price_minor, stock FROM products WHERE store_id=? ORDER BY product_code")
			.bind(await storeIdOf(a)).all();

		const headers = authHeaders(b);
		await SELF.fetch(`${BASE}/api/v1/products/${aCode}`, {
			method: "PUT", headers, body: JSON.stringify({ name: "x", price: { amount_minor: 1, currency: "EGP" } }),
		});
		await SELF.fetch(`${BASE}/api/v1/products/${aCode}`, { method: "DELETE", headers });
		await SELF.fetch(`${BASE}/api/v1/products/${aCode}/stock`, {
			method: "PATCH", headers, body: JSON.stringify({ stock: 1, expected_stock_version: 0 }),
		});

		const after = await env.orderak_db
			.prepare("SELECT product_code, name, price_minor, stock FROM products WHERE store_id=? ORDER BY product_code")
			.bind(await storeIdOf(a)).all();
		expect(after.results).toEqual(before.results);
	});
});

describe("product CRUD: tenant write fence", () => {
	/**
	 * Every mutating product route must refuse a fenced tenant.
	 *
	 * `tenantMutation` in api-store.ts is a hand-maintained list of paths, and a
	 * route missing from it does not fail loudly — it writes to a tenant that is
	 * fenced or mid-copy. `customers.ts` PATCH is unfenced today for exactly that
	 * reason, so this asserts the whole set rather than trusting the list.
	 */
	async function fence(r: Registered): Promise<void> {
		await env.orderak_db
			.prepare("UPDATE organization_routing SET migration_state='write_fenced' WHERE organization_id=(SELECT organization_id FROM organization_stores WHERE store_id=?)")
			.bind(await storeIdOf(r)).run();
	}

	it("refuses create, replace, stock and delete while the tenant is fenced", async () => {
		const r = await registerStore();
		const created = await seedProduct(r);
		const code = String(created.product_code);
		await fence(r);

		const headers = authHeaders(r);
		const calls: Array<[string, RequestInit]> = [
			[`${BASE}/api/v1/products`, { method: "POST", headers, body: JSON.stringify({ name: "n", price: { amount_minor: 1, currency: "EGP" } }) }],
			[`${BASE}/api/v1/products/${code}`, { method: "PUT", headers, body: JSON.stringify({ name: "n", price: { amount_minor: 1, currency: "EGP" } }) }],
			[`${BASE}/api/v1/products/${code}/stock`, { method: "PATCH", headers, body: JSON.stringify({ stock: 1, expected_stock_version: 0 }) }],
			[`${BASE}/api/v1/products/${code}`, { method: "DELETE", headers }],
		];
		for (const [url, init] of calls) {
			const res = await SELF.fetch(url, init);
			expect(res.status, `${init.method} ${url} must be fenced`).toBe(503);
		}
	});

	it("still allows reads while fenced", async () => {
		// A fence stops writes, not a seller looking at their own shop.
		const r = await registerStore();
		await seedProduct(r);
		await fence(r);
		const res = await SELF.fetch(`${BASE}/api/v1/products`, { headers: authHeaders(r) });
		expect(res.status).toBe(200);
	});
});

describe("the removed mirror", () => {
	beforeEach(createSchema);

	it("answers a legacy mirror push without writing anything", async () => {
		// What an app built before the cutover actually experiences now.
		//
		// This is pinned because the answer is not the obvious one and the
		// difference is operational. `/api/v1/products/sync` still matches
		// `isStoreRoute` through `startsWith("/api/v1/products/")`, so it is
		// recognised, authenticated and fenced before dispatch reaches it — and
		// dispatch then reads "sync" as a product code that serves PUT and
		// DELETE. A legacy POST therefore lands on 405, not the 404 anyone
		// watching for stragglers would think to filter on.
		//
		// A monitor looking for 404s on this path would see silence and read it
		// as "no old clients left", which is the exact shape of wrongness #108
		// existed to prevent: a signal nobody emits looks like a signal nobody
		// triggers.
		const r = await registerStore();
		const before = await seedProduct(r);

		const res = await SELF.fetch(`${BASE}/api/v1/products/sync`, {
			method: "POST",
			headers: authHeaders(r),
			// The shape the mirror took, including the empty list that used to
			// mean "delete this seller's entire catalogue".
			body: JSON.stringify({ products: [], baseline_version: 0 }),
		});

		expect(res.status).toBe(405);

		// The half that matters more than the status code: an old client cannot
		// reach the behaviour, so the catalogue is untouched.
		const pull = (await (await SELF.fetch(`${BASE}/api/v1/products`, {
			headers: authHeaders(r),
		})).json()) as { products: { product_code: string }[] };
		expect(pull.products).toHaveLength(1);
		expect(pull.products[0].product_code).toBe(before.product_code);
	});

	it("does not resurrect the endpoint under any other method", async () => {
		const r = await registerStore();
		await seedProduct(r);

		for (const method of ["PUT", "DELETE", "PATCH"]) {
			const res = await SELF.fetch(`${BASE}/api/v1/products/sync`, {
				method,
				headers: authHeaders(r),
				body: method === "DELETE" ? undefined : JSON.stringify({ products: [] }),
			});
			// PUT and DELETE are real verbs on a product code, so they reach a
			// handler and answer 404 for a product called "sync"; PATCH is not.
			// None of them is a mirror, which is the whole assertion.
			expect([404, 405]).toContain(res.status);
		}

		const pull = (await (await SELF.fetch(`${BASE}/api/v1/products`, {
			headers: authHeaders(r),
		})).json()) as { products: unknown[] };
		expect(pull.products).toHaveLength(1);
	});
});
