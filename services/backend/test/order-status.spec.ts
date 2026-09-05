import { describe, expect, it, beforeEach } from "vitest";
import { BASE, SELF, authHeaders, createSchema, env, registerStore } from "./helpers";
import type { Registered } from "./helpers";

/** Registered exposes the public identifiers, not the internal row id. */
async function storeIdOf(seller: Registered): Promise<string> {
	const row = await env.orderak_db.prepare("SELECT id FROM sellers WHERE phone = ?").bind(seller.phone).first<{ id: string }>();
	if (!row) throw new Error(`no seller row for ${seller.phone}`);
	return row.id;
}

async function seedProduct(storeId: string, id: string, stock: number): Promise<void> {
	await env.orderak_db
		.prepare(
			`INSERT INTO products(id, store_id, product_code, name, price_minor, currency, stock, available)
			 VALUES(?, ?, ?, 'Cola', 7500, 'EGP', ?, 1)`,
		)
		.bind(id, storeId, `P-${id}`, stock)
		.run();
}

/**
 * Seeds an order and lets the claim trigger take the stock, the same way a real
 * order does. Going through `order_items` rather than writing `products.stock`
 * directly matters: the release path is only correct if it undoes what
 * `trg_order_items_claim_stock` actually did.
 */
async function seedOrder(storeId: string, orderId: string, productId: string, qty: number, status = "NEW", orderNo = 1): Promise<void> {
	await env.orderak_db
		.prepare(
			`INSERT INTO orders(id, order_no, store_id, buyer_phone, status, pay_method, total_minor, currency)
			 VALUES(?, ?, ?, '+201000000000', ?, 'COD', 15000, 'EGP')`,
		)
		.bind(orderId, orderNo, storeId, status)
		.run();
	await env.orderak_db
		.prepare(
			`INSERT INTO order_items(id, order_id, product_id, product_name, qty, price_minor)
			 VALUES(?, ?, ?, 'Cola', ?, 7500)`,
		)
		.bind(`item-${orderId}`, orderId, productId, qty)
		.run();
}

const stockOf = async (productId: string): Promise<number> => {
	const row = await env.orderak_db.prepare("SELECT stock FROM products WHERE id = ?").bind(productId).first<{ stock: number }>();
	return Number(row?.stock);
};

/** Orders are addressed by their per-store order_no, which is what the app holds. */
const patchStatus = (seller: Registered, orderNo: number, status: string) =>
	SELF.fetch(`${BASE}/api/v1/orders/${orderNo}/status`, {
		method: "PATCH",
		headers: { ...authHeaders(seller), "content-type": "application/json" },
		body: JSON.stringify({ status }),
	});

/**
 * Order status used to exist only on the seller's phone.
 *
 * `OrderStatus.kt` defines the pipeline and OrderDetailsScreen renders a button
 * for the next state, but `OrderRepository.markPaid` and `.cancel` wrote to Room
 * and stopped: no route accepted a status change. The server held every order at
 * NEW, and a reinstall replayed a pipeline the seller had already worked.
 *
 * The cancel half leaked stock. Placing an order decrements it through a
 * trigger; cancelling restored it in Room only, so the units left the catalog
 * and never came back. The stock tests below are the ones that were missing.
 */
describe("order status transitions", () => {
	beforeEach(async () => {
		await createSchema();
	});

	it("advances one step and reports that it changed", async () => {
		const seller = await registerStore({ phone: "+201500009101" });
		const storeId = await storeIdOf(seller);
		await seedProduct(storeId, "prod-a", 10);
		await seedOrder(storeId, "order-a", "prod-a", 2);

		const response = await patchStatus(seller, 1, "CONFIRMED");
		expect(response.status).toBe(200);
		expect(await response.json()).toMatchObject({ ok: true, status: "CONFIRMED", changed: true });

		const row = await env.orderak_db
			.prepare("SELECT status, status_changed_at FROM orders WHERE id = 'order-a'")
			.first<{ status: string; status_changed_at: string | null }>();
		expect(row?.status).toBe("CONFIRMED");
		expect(row?.status_changed_at).toBeTruthy();
	});

	it("accepts NEW to PAID, which is a second forward path and not a skipped step", async () => {
		// A buyer can pay through InstaPay or Vodafone Cash before the seller has
		// confirmed anything. OrderDetailsScreen renders the payment card on NEW,
		// and the OCR proof flow calls markPaid straight from there. While the
		// forward table held one target per state this answered 409, and because
		// every Android caller discards the result the seller was shown "payment
		// verified" on an order the server had left at NEW.
		const seller = await registerStore({ phone: "+201500009111" });
		const storeId = await storeIdOf(seller);
		await seedProduct(storeId, "prod-j", 10);
		await seedOrder(storeId, "order-j", "prod-j", 1);

		const response = await patchStatus(seller, 1, "PAID");
		expect(response.status).toBe(200);
		expect(await response.json()).toMatchObject({ ok: true, status: "PAID", changed: true });

		const row = await env.orderak_db.prepare("SELECT status FROM orders WHERE id = 'order-j'").first<{ status: string }>();
		expect(row?.status).toBe("PAID");
	});

	it("lists both forward targets when it refuses a transition out of NEW", async () => {
		const seller = await registerStore({ phone: "+201500009112" });
		const storeId = await storeIdOf(seller);
		await seedProduct(storeId, "prod-k", 10);
		await seedOrder(storeId, "order-k", "prod-k", 1);

		const response = await patchStatus(seller, 1, "DONE");
		expect(response.status).toBe(409);
		// The client shows the seller what it could have asked for, so the list has
		// to carry every legal target rather than only the first one.
		expect(await response.json()).toMatchObject({
			code: "invalid_transition",
			allowed: ["CONFIRMED", "PAID", "CANCELLED"],
		});
	});

	it("refuses a skipped step instead of applying it", async () => {
		const seller = await registerStore({ phone: "+201500009102" });
		const storeId = await storeIdOf(seller);
		await seedProduct(storeId, "prod-b", 10);
		await seedOrder(storeId, "order-b", "prod-b", 1);

		// NEW to SHIPPED skips CONFIRMED and PAID.
		const response = await patchStatus(seller, 1, "SHIPPED");
		expect(response.status).toBe(409);
		// jsonResponse projects { error } into RFC 7807, so the machine-readable name
		// arrives as `code`; `from` and `to` ride along as problem extensions.
		expect(await response.json()).toMatchObject({ code: "invalid_transition", from: "NEW", to: "SHIPPED" });

		const row = await env.orderak_db.prepare("SELECT status FROM orders WHERE id = 'order-b'").first<{ status: string }>();
		expect(row?.status).toBe("NEW");
	});

	it("treats a repeat of the current status as success, not a conflict", async () => {
		const seller = await registerStore({ phone: "+201500009103" });
		const storeId = await storeIdOf(seller);
		await seedProduct(storeId, "prod-c", 10);
		await seedOrder(storeId, "order-c", "prod-c", 1);

		expect((await patchStatus(seller, 1, "CONFIRMED")).status).toBe(200);
		// A client retrying a dropped response must converge, not be told it erred.
		const again = await patchStatus(seller, 1, "CONFIRMED");
		expect(again.status).toBe(200);
		expect(await again.json()).toMatchObject({ status: "CONFIRMED", changed: false });
	});

	it("refuses to move an order out of a terminal state", async () => {
		const seller = await registerStore({ phone: "+201500009104" });
		const storeId = await storeIdOf(seller);
		await seedProduct(storeId, "prod-d", 10);
		await seedOrder(storeId, "order-d", "prod-d", 1, "DONE");

		expect((await patchStatus(seller, 1, "CANCELLED")).status).toBe(409);
		expect((await patchStatus(seller, 1, "SHIPPED")).status).toBe(409);
	});

	it("scopes order_no to the calling store", async () => {
		// Both stores own an order numbered 1. order_no is unique per store, not
		// globally, so a lookup that forgot the store_id predicate would find the
		// wrong row and still look like it worked — which is exactly why this test
		// gives the stranger an order of their own rather than none.
		const owner = await registerStore({ phone: "+201500009105" });
		const stranger = await registerStore({ phone: "+201500009106" });
		const ownerStore = await storeIdOf(owner);
		const strangerStore = await storeIdOf(stranger);
		await seedProduct(ownerStore, "prod-e", 10);
		await seedOrder(ownerStore, "order-e", "prod-e", 1);
		await seedProduct(strangerStore, "prod-e2", 10);
		await seedOrder(strangerStore, "order-e2", "prod-e2", 1);

		const response = await patchStatus(stranger, 1, "CONFIRMED");
		expect(response.status).toBe(200);

		// The stranger moved their own order and left the owner's untouched.
		const theirs = await env.orderak_db.prepare("SELECT status FROM orders WHERE id = 'order-e2'").first<{ status: string }>();
		const owners = await env.orderak_db.prepare("SELECT status FROM orders WHERE id = 'order-e'").first<{ status: string }>();
		expect(theirs?.status).toBe("CONFIRMED");
		expect(owners?.status).toBe("NEW");
	});

	it("reports an order number the calling store does not have as not found", async () => {
		const seller = await registerStore({ phone: "+201500009110" });
		const storeId = await storeIdOf(seller);
		await seedProduct(storeId, "prod-i", 5);
		await seedOrder(storeId, "order-i", "prod-i", 1);

		// 404, not 403: the difference would confirm the number exists elsewhere.
		expect((await patchStatus(seller, 999, "CONFIRMED")).status).toBe(404);
	});

	it("returns the reserved stock when an order is cancelled", async () => {
		const seller = await registerStore({ phone: "+201500009107" });
		const storeId = await storeIdOf(seller);
		await seedProduct(storeId, "prod-f", 10);
		await seedOrder(storeId, "order-f", "prod-f", 3);

		// The claim trigger already took it.
		expect(await stockOf("prod-f")).toBe(7);

		const response = await patchStatus(seller, 1, "CANCELLED");
		expect(response.status).toBe(200);
		expect(await stockOf("prod-f")).toBe(10);
	});

	it("does not return the stock twice when a cancellation is repeated", async () => {
		const seller = await registerStore({ phone: "+201500009108" });
		const storeId = await storeIdOf(seller);
		await seedProduct(storeId, "prod-g", 10);
		await seedOrder(storeId, "order-g", "prod-g", 4);
		expect(await stockOf("prod-g")).toBe(6);

		expect((await patchStatus(seller, 1, "CANCELLED")).status).toBe(200);
		expect(await stockOf("prod-g")).toBe(10);

		// The trigger is guarded on the transition, not on the value, so a second
		// request restores nothing. Without that guard a retry would invent stock.
		const again = await patchStatus(seller, 1, "CANCELLED");
		expect(again.status).toBe(200);
		expect(await again.json()).toMatchObject({ changed: false });
		expect(await stockOf("prod-g")).toBe(10);
	});

	it("rejects a body with no status", async () => {
		const seller = await registerStore({ phone: "+201500009109" });
		const storeId = await storeIdOf(seller);
		await seedProduct(storeId, "prod-h", 5);
		await seedOrder(storeId, "order-h", "prod-h", 1);

		const response = await SELF.fetch(`${BASE}/api/v1/orders/1/status`, {
			method: "PATCH",
			headers: { ...authHeaders(seller), "content-type": "application/json" },
			body: JSON.stringify({}),
		});
		expect(response.status).toBe(400);
		expect(await response.json()).toMatchObject({ code: "status_required" });
	});

	it("requires authentication", async () => {
		const response = await SELF.fetch(`${BASE}/api/v1/orders/1/status`, {
			method: "PATCH",
			headers: { "content-type": "application/json" },
			body: JSON.stringify({ status: "CONFIRMED" }),
		});
		expect(response.status).toBe(401);
	});
});

/**
 * Orders the seller records by hand.
 *
 * Until POST /api/v1/orders existed, these were written to Room and posted
 * nowhere: absent from the account, from a second device, from a reinstall and
 * from the monthly plan count. The route shares createOrder() with the
 * storefront, so what is worth testing here is that sharing it did not lose
 * anything — the limit, the idempotency, the stock movement and the isolation
 * all have to hold for this caller too.
 */
describe("POST /api/v1/orders", () => {
	beforeEach(createSchema);

	const key = (suffix: string) => `manual-order-${suffix}`;

	async function seed(r: Registered, appId = 1, stock = 10): Promise<string> {
		const res = await SELF.fetch(`${BASE}/api/v1/products/sync`, {
			method: "POST",
			headers: authHeaders(r),
			body: JSON.stringify({
				products: [{
					app_id: appId, name: "Cola", price: { amount_minor: 1500, currency: "EGP" },
					stock, available: true,
				}],
			}),
		});
		return ((await res.json()) as { products: { product_code: string }[] }).products[0].product_code;
	}

	async function create(r: Registered, body: Record<string, unknown>): Promise<Response> {
		return SELF.fetch(`${BASE}/api/v1/orders`, {
			method: "POST", headers: authHeaders(r), body: JSON.stringify(body),
		});
	}

	it("writes the order to the account and allocates the next order number", async () => {
		const r = await registerStore();
		const code = await seed(r);
		const res = await create(r, {
			idempotency_key: key("first"),
			buyer_phone: "01000000000",
			buyer_name: "Walk-in",
			items: [{ product_code: code, qty: 2 }],
			pay_method: "COD",
		});
		expect(res.status).toBe(200);
		expect(await res.json()).toMatchObject({ ok: true, order_no: 1, total_minor: 3000, currency: "EGP" });

		// The proof that matters: it is readable from the account, which is what
		// a second device does on its next sync.
		const pulled = (await (await SELF.fetch(`${BASE}/api/v1/orders?since=0`, { headers: authHeaders(r) })).json()) as {
			orders: { order_no: number; buyer_name: string }[];
		};
		expect(pulled.orders).toHaveLength(1);
		expect(pulled.orders[0]).toMatchObject({ order_no: 1, buyer_name: "Walk-in" });
	});

	it("records where the order came from", async () => {
		const r = await registerStore();
		const code = await seed(r);
		await create(r, {
			idempotency_key: key("origin"), buyer_phone: "01000000000",
			items: [{ product_code: code, qty: 1 }],
		});
		const seller = await env.orderak_db.prepare("SELECT id FROM sellers WHERE phone=?").bind(r.phone).first<{ id: string }>();
		const row = await env.orderak_db.prepare("SELECT origin FROM orders WHERE store_id=?").bind(seller!.id).first<{ origin: string }>();
		expect(row?.origin).toBe("manual");
	});

	it("moves stock exactly once", async () => {
		const r = await registerStore();
		const code = await seed(r, 1, 10);
		await create(r, {
			idempotency_key: key("stock"), buyer_phone: "01000000000",
			items: [{ product_code: code, qty: 3 }],
		});
		const seller = await env.orderak_db.prepare("SELECT id FROM sellers WHERE phone=?").bind(r.phone).first<{ id: string }>();
		const product = await env.orderak_db.prepare("SELECT stock FROM products WHERE store_id=? AND product_code=?")
			.bind(seller!.id, code).first<{ stock: number }>();
		expect(product?.stock).toBe(7);
	});

	it("returns the existing order when the same key is sent twice", async () => {
		const r = await registerStore();
		const code = await seed(r);
		const body = {
			idempotency_key: key("replay"), buyer_phone: "01000000000",
			items: [{ product_code: code, qty: 1 }],
		};
		const first = (await (await create(r, body)).json()) as { order_no: number };
		const second = await create(r, body);
		expect(second.status).toBe(200);
		expect(await second.json()).toMatchObject({ order_no: first.order_no, replayed: true });

		const seller = await env.orderak_db.prepare("SELECT id FROM sellers WHERE phone=?").bind(r.phone).first<{ id: string }>();
		const count = await env.orderak_db.prepare("SELECT COUNT(*) AS c FROM orders WHERE store_id=?")
			.bind(seller!.id).first<{ c: number }>();
		expect(count?.c).toBe(1);

		// A replay must not take stock a second time. This is the assertion that
		// makes the retry safe, and the reason the client owns the key.
		const product = await env.orderak_db.prepare("SELECT stock FROM products WHERE store_id=? AND product_code=?")
			.bind(seller!.id, code).first<{ stock: number }>();
		expect(product?.stock).toBe(9);
	});

	it("requires an idempotency key rather than inventing one", async () => {
		// The storefront mints a key when a browser sends none. Doing that here
		// would turn every retry of a queued offline order into a new order.
		const r = await registerStore();
		const code = await seed(r);
		const res = await create(r, { buyer_phone: "01000000000", items: [{ product_code: code, qty: 1 }] });
		expect(res.status).toBe(400);
		expect(await res.json()).toMatchObject({ code: "idempotency_key_required" });
	});

	it("counts against the monthly limit and refuses at it", async () => {
		const r = await registerStore();
		const code = await seed(r, 1, 50);
		const seller = await env.orderak_db.prepare("SELECT id FROM sellers WHERE phone=?").bind(r.phone).first<{ id: string }>();
		await env.orderak_db.batch([
			env.orderak_db.prepare("INSERT INTO plans(id,name,active,max_orders_per_month) VALUES('two','Two',1,2)"),
			env.orderak_db.prepare("INSERT INTO subscriptions(seller_id,plan_id,status) VALUES(?,'two','active')").bind(seller!.id),
		]);
		for (const n of [1, 2]) {
			const res = await create(r, {
				idempotency_key: key(`limit-${n}`), buyer_phone: "01000000000",
				items: [{ product_code: code, qty: 1 }],
			});
			expect(res.status).toBe(200);
		}
		const refused = await create(r, {
			idempotency_key: key("limit-3"), buyer_phone: "01000000000",
			items: [{ product_code: code, qty: 1 }],
		});
		expect(refused.status).toBe(409);
		expect(await refused.json()).toMatchObject({ code: "plan_limit_reached", limit: 2 });
	});

	it("refuses a product belonging to another store", async () => {
		const mine = await registerStore();
		const theirs = await registerStore({ store_name: "Other Shop" });
		const theirCode = await seed(theirs);
		const res = await create(mine, {
			idempotency_key: key("cross-store"), buyer_phone: "01000000000",
			items: [{ product_code: theirCode, qty: 1 }],
		});
		expect(res.status).toBe(400);
		expect(await res.json()).toMatchObject({ code: "products" });
	});

	it("leaves no order behind when the stock claim fails", async () => {
		// The order header and every line are one D1 batch, and the stock trigger
		// aborts the insert when a line asks for more than exists. If the batch
		// were not atomic this would leave a header with no items, or items that
		// took stock for an order nobody can see.
		const r = await registerStore();
		const code = await seed(r, 1, 2);
		const res = await create(r, {
			idempotency_key: key("oversell"), buyer_phone: "01000000000",
			items: [{ product_code: code, qty: 5 }],
		});
		expect(res.status).toBe(409);

		const seller = await env.orderak_db.prepare("SELECT id FROM sellers WHERE phone=?").bind(r.phone).first<{ id: string }>();
		const orders = await env.orderak_db.prepare("SELECT COUNT(*) AS c FROM orders WHERE store_id=?")
			.bind(seller!.id).first<{ c: number }>();
		expect(orders?.c).toBe(0);
		const product = await env.orderak_db.prepare("SELECT stock FROM products WHERE store_id=? AND product_code=?")
			.bind(seller!.id, code).first<{ stock: number }>();
		expect(product?.stock).toBe(2);
	});

	it("requires authentication", async () => {
		const res = await SELF.fetch(`${BASE}/api/v1/orders`, {
			method: "POST",
			headers: { "content-type": "application/json" },
			body: JSON.stringify({ idempotency_key: key("noauth"), buyer_phone: "01000000000", items: [] }),
		});
		expect(res.status).toBe(401);
	});

	it("can be advanced through its pipeline like any other order", async () => {
		// The point of writing it to the server: the status route addresses orders
		// by order_no, and a manual order now has one.
		const r = await registerStore();
		const code = await seed(r);
		const created = (await (await create(r, {
			idempotency_key: key("status"), buyer_phone: "01000000000",
			items: [{ product_code: code, qty: 1 }],
		})).json()) as { order_no: number };

		const advanced = await SELF.fetch(`${BASE}/api/v1/orders/${created.order_no}/status`, {
			method: "PATCH", headers: authHeaders(r), body: JSON.stringify({ status: "CONFIRMED" }),
		});
		expect(advanced.status).toBe(200);
		expect(await advanced.json()).toMatchObject({ status: "CONFIRMED" });
	});
});
