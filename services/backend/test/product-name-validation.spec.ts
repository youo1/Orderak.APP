import { beforeEach, describe, expect, it } from "vitest";
import { BASE, SELF, authHeaders, createSchema, env, registerStore, seedProduct, type Registered } from "./helpers";

/**
 * Product names must meet the published contract (a string, 1–80 characters
 * after trimming, no U+0000–U+001F controls). Invalid names are refused with
 * `name_required`; they are never coerced or truncated into something valid.
 */

beforeEach(createSchema);

const PRICE = { amount_minor: 600, currency: "EGP" };

const INVALID_NAMES: Array<[string, unknown]> = [
	["a number", 12345],
	["a boolean", true],
	["an array", ["Mango"]],
	["an object", { en: "Mango" }],
	["whitespace only", "   \t  "],
	["81 characters", "n".repeat(81)],
	["81 characters after trimming", `  ${"m".repeat(81)}  `],
	["a U+0000 control", "Mango\u0000Juice"],
	["a U+001F control", "Mango\u001FJuice"],
];

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

async function catalogVersion(r: Registered): Promise<number> {
	const row = await env.orderak_db
		.prepare("SELECT catalog_version FROM sellers WHERE id=?")
		.bind(await storeIdOf(r)).first<{ catalog_version: number }>();
	return Number(row?.catalog_version ?? 0);
}

async function productRow(r: Registered, code: string): Promise<Record<string, unknown> | null> {
	return (await env.orderak_db
		.prepare(
			`SELECT name, slug, description, price_minor, currency, available, image_url,
			        category_id, discount_type, discount_value, stock, stock_version
			 FROM products WHERE store_id=? AND product_code=?`,
		)
		.bind(await storeIdOf(r), code).first()) as Record<string, unknown> | null;
}

describe("product name validation: create", () => {
	for (const [label, name] of INVALID_NAMES) {
		it(`refuses a name that is ${label} and creates nothing`, async () => {
			const r = await registerStore();
			const versionBefore = await catalogVersion(r);

			const res = await SELF.fetch(`${BASE}/api/v1/products`, {
				method: "POST", headers: authHeaders(r),
				body: JSON.stringify({ name, price: PRICE, available: true }),
			});

			expect(res.status).toBe(400);
			const body = (await res.json()) as Record<string, unknown>;
			expect(body.code).toBe("name_required");
			expect(await productCount(r)).toBe(0);
			expect(await catalogVersion(r)).toBe(versionBefore);
		});
	}
});

describe("product name validation: replace", () => {
	for (const [label, name] of INVALID_NAMES) {
		it(`refuses a name that is ${label} and leaves the product untouched`, async () => {
			const r = await registerStore();
			const created = await seedProduct(r, { name: "Mango Juice", description: "cold" });
			const code = String(created.product_code);
			const rowBefore = await productRow(r, code);
			const versionBefore = await catalogVersion(r);

			const res = await SELF.fetch(`${BASE}/api/v1/products/${code}`, {
				method: "PUT", headers: authHeaders(r),
				body: JSON.stringify({ name, price: { amount_minor: 900, currency: "EGP" }, available: false }),
			});

			expect(res.status).toBe(400);
			const body = (await res.json()) as Record<string, unknown>;
			expect(body.code).toBe("name_required");
			expect(await productRow(r, code)).toEqual(rowBefore);
			expect(await catalogVersion(r)).toBe(versionBefore);
			expect(await productCount(r)).toBe(1);
		});
	}
});
