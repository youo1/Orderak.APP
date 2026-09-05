import { describe, expect, it, beforeEach } from "vitest";
import { BASE, SELF, authHeaders, createSchema, env, registerStore } from "./helpers";
import type { Registered } from "./helpers";

/**
 * The stock ledger.
 *
 * Server stock is explained entirely by orders the server holds and adjustments
 * the seller made, and anything else is a defect that reconciliation can find.
 * Before this, order-driven movement was attributable only by inference and the
 * seller's own adjustment left no trace of any kind: the mirror's compare-and-set
 * bumped stock_version and wrote nothing, so a seller correcting a count and an
 * order that went missing were the same event afterwards.
 */
describe("stock movements", () => {
	beforeEach(createSchema);

	async function storeIdOf(r: Registered): Promise<string> {
		const row = await env.orderak_db.prepare("SELECT id FROM sellers WHERE phone=?")
			.bind(r.phone).first<{ id: string }>();
		return String(row!.id);
	}

	async function movements(storeId: string): Promise<{ delta: number; cause: string; actor: string; reconstructed: number; balance_after: number | null }[]> {
		const { results } = await env.orderak_db.prepare(
			"SELECT delta,cause,actor,reconstructed,balance_after FROM stock_movements WHERE store_id=? ORDER BY rowid",
		).bind(storeId).all();
		return results as never;
	}

	async function baselineVersion(r: Registered): Promise<number> {
		const res = await SELF.fetch(`${BASE}/api/v1/products`, { headers: authHeaders(r) });
		return ((await res.json()) as { catalog_version: number }).catalog_version;
	}

	async function seed(r: Registered, stock = 10): Promise<string> {
		const res = await SELF.fetch(`${BASE}/api/v1/products/sync`, {
			method: "POST", headers: authHeaders(r),
			body: JSON.stringify({
				products: [{ app_id: 1, name: "Cola", price: { amount_minor: 1500, currency: "EGP" }, stock, available: true }],
			}),
		});
		return ((await res.json()) as { products: { product_code: string }[] }).products[0].product_code;
	}

	async function order(r: Registered, code: string, qty: number, key: string): Promise<number> {
		const res = await SELF.fetch(`${BASE}/api/v1/orders`, {
			method: "POST", headers: authHeaders(r),
			body: JSON.stringify({
				idempotency_key: key, buyer_phone: "01000000000",
				items: [{ product_code: code, qty }],
			}),
		});
		return ((await res.json()) as { order_no: number }).order_no;
	}

	it("records a sale with the order that caused it", async () => {
		const r = await registerStore();
		const code = await seed(r, 10);
		const storeId = await storeIdOf(r);
		await order(r, code, 3, "ledger-sale");

		const rows = (await movements(storeId)).filter((m) => m.cause === "SALE");
		expect(rows).toHaveLength(1);
		expect(rows[0]).toMatchObject({ delta: -3, cause: "SALE", actor: "seller", reconstructed: 0 });
		// The balance after the movement, read inside the statement that made it.
		expect(rows[0].balance_after).toBe(7);

		const withCause = await env.orderak_db.prepare(
			"SELECT cause_id FROM stock_movements WHERE store_id=? AND cause='SALE'",
		).bind(storeId).first<{ cause_id: string }>();
		const orderRow = await env.orderak_db.prepare("SELECT id FROM orders WHERE store_id=?")
			.bind(storeId).first<{ id: string }>();
		expect(withCause?.cause_id).toBe(orderRow?.id);
	});

	it("attributes a storefront sale to the buyer and a recorded one to the seller", async () => {
		// Same movement, different channel. Reporting cannot separate them
		// afterwards unless the row says which.
		const r = await registerStore();
		const code = await seed(r, 20);
		const storeId = await storeIdOf(r);
		await order(r, code, 1, "ledger-actor-manual");

		const store = await env.orderak_db.prepare("SELECT public_identifier FROM sellers WHERE id=?")
			.bind(storeId).first<{ public_identifier: string }>();
		await SELF.fetch(`https://orderak.app/${store!.public_identifier}`, {
			method: "POST",
			headers: { "content-type": "application/json", "idempotency-key": "ledger-actor-buyer" },
			body: JSON.stringify({ buyer_phone: "01000000001", items: [{ product_code: code, qty: 2 }], pay_method: "COD" }),
		});

		const sales = (await movements(storeId)).filter((m) => m.cause === "SALE");
		expect(sales.map((s) => s.actor).sort()).toEqual(["buyer", "seller"]);
	});

	it("records the units a cancellation returns", async () => {
		const r = await registerStore();
		const code = await seed(r, 10);
		const storeId = await storeIdOf(r);
		const orderNo = await order(r, code, 4, "ledger-cancel");

		await SELF.fetch(`${BASE}/api/v1/orders/${orderNo}/status`, {
			method: "PATCH", headers: authHeaders(r), body: JSON.stringify({ status: "CANCELLED" }),
		});

		const rows = await movements(storeId);
		expect(rows.filter((m) => m.cause === "SALE")).toHaveLength(1);
		const returned = rows.filter((m) => m.cause === "SALE_CANCELLED");
		expect(returned).toHaveLength(1);
		expect(returned[0]).toMatchObject({ delta: 4, balance_after: 10 });
	});

	it("does not credit a repeated cancellation twice", async () => {
		const r = await registerStore();
		const code = await seed(r, 10);
		const storeId = await storeIdOf(r);
		const orderNo = await order(r, code, 4, "ledger-cancel-twice");
		for (const _ of [1, 2]) {
			await SELF.fetch(`${BASE}/api/v1/orders/${orderNo}/status`, {
				method: "PATCH", headers: authHeaders(r), body: JSON.stringify({ status: "CANCELLED" }),
			});
		}
		const returned = (await movements(storeId)).filter((m) => m.cause === "SALE_CANCELLED");
		expect(returned).toHaveLength(1);
	});

	it("records the seller setting a figure themselves", async () => {
		// The movement that had no trace at all before this table existed.
		const r = await registerStore();
		const code = await seed(r, 10);
		const storeId = await storeIdOf(r);
		const pulled = (await (await SELF.fetch(`${BASE}/api/v1/products`, { headers: authHeaders(r) })).json()) as {
			products: { app_id: number; stock_version: number }[];
		};
		await SELF.fetch(`${BASE}/api/v1/products/sync`, {
			method: "POST", headers: authHeaders(r),
			body: JSON.stringify({
				baseline_version: await baselineVersion(r),
				products: [{
					app_id: 1, name: "Cola", price: { amount_minor: 1500, currency: "EGP" },
					stock: 25, available: true, stock_dirty: true,
					expected_stock_version: pulled.products[0].stock_version,
				}],
			}),
		});

		const adjustments = (await movements(storeId)).filter((m) => m.cause === "MANUAL_ADJUSTMENT");
		expect(adjustments).toHaveLength(1);
		expect(adjustments[0]).toMatchObject({ delta: 15, actor: "seller", balance_after: 25, reconstructed: 0 });
		expect(code).toBeTruthy();
	});

	it("writes nothing when a stale revision means the adjustment did not apply", async () => {
		// A ledger row for a movement that was refused would be worse than the
		// silence it replaces, because reconciliation would then believe it.
		const r = await registerStore();
		const code = await seed(r, 10);
		const storeId = await storeIdOf(r);
		// Move the revision on first, so that version 0 is genuinely behind. A
		// freshly created product is already at 0, and sending 0 then would be
		// current rather than stale — which is what this test needs to avoid.
		await order(r, code, 1, "ledger-stale-setup");
		const stale = await SELF.fetch(`${BASE}/api/v1/products/sync`, {
			method: "POST", headers: authHeaders(r),
			body: JSON.stringify({
				baseline_version: await baselineVersion(r),
				products: [{
					app_id: 1, name: "Cola", price: { amount_minor: 1500, currency: "EGP" },
					stock: 99, available: true, stock_dirty: true, expected_stock_version: 0,
				}],
			}),
		});
		expect(stale.status).toBe(409);
		expect((await movements(storeId)).filter((m) => m.cause === "MANUAL_ADJUSTMENT")).toHaveLength(0);
	});

	it("sums to the stock the product actually holds", async () => {
		// The property the whole table exists for: every unit is accounted for,
		// so a movement nobody recorded shows up as a difference.
		const r = await registerStore();
		const code = await seed(r, 10);
		const storeId = await storeIdOf(r);
		await order(r, code, 3, "ledger-recon-a");
		const cancelled = await order(r, code, 2, "ledger-recon-b");
		await SELF.fetch(`${BASE}/api/v1/orders/${cancelled}/status`, {
			method: "PATCH", headers: authHeaders(r), body: JSON.stringify({ status: "CANCELLED" }),
		});

		const row = await env.orderak_db.prepare(
			`SELECT p.stock AS stock, COALESCE(SUM(m.delta), 0) AS ledger
			 FROM products p LEFT JOIN stock_movements m ON m.product_id = p.id
			 WHERE p.store_id = ? GROUP BY p.id`,
		).bind(storeId).first<{ stock: number; ledger: number }>();
		expect(row?.ledger).toBe(row?.stock);
	});

	it("leaves no movement behind when the order it belonged to was rolled back", async () => {
		// The trigger writes its row inside the order's own transaction, so an
		// order refused for oversell takes its movement with it.
		const r = await registerStore();
		const code = await seed(r, 2);
		const storeId = await storeIdOf(r);
		const refused = await SELF.fetch(`${BASE}/api/v1/orders`, {
			method: "POST", headers: authHeaders(r),
			body: JSON.stringify({
				idempotency_key: "ledger-oversell", buyer_phone: "01000000000",
				items: [{ product_code: code, qty: 5 }],
			}),
		});
		expect(refused.status).toBe(409);
		// The product's own opening balance stays; what must not exist is a sale.
		expect((await movements(storeId)).filter((m) => m.cause === "SALE")).toHaveLength(0);
	});

	it("is not touched by the retention job", async () => {
		// Inventory is financial state. The audit trail this table replaced
		// deletes rows after two years on a nightly cron, which is most of why a
		// dedicated table exists.
		const r = await registerStore();
		const code = await seed(r, 10);
		const storeId = await storeIdOf(r);
		await order(r, code, 1, "ledger-retention");
		await env.orderak_db.prepare(
			"UPDATE stock_movements SET created_at = datetime('now','-5 years') WHERE store_id = ?",
		).bind(storeId).run();

		const { runRetentionCleanup } = await import("../src/domains/identity/retention");
		await runRetentionCleanup(env as never);

		const remaining = await env.orderak_db.prepare(
			"SELECT COUNT(*) AS c FROM stock_movements WHERE store_id = ?",
		).bind(storeId).first<{ c: number }>();
		expect(remaining?.c).toBeGreaterThan(0);
	});
});
