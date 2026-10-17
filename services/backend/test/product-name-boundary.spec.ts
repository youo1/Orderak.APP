import { beforeEach, describe, expect, it } from "vitest";
import { BASE, SELF, authHeaders, createSchema, registerStore, seedProduct } from "./helpers";

/**
 * The valid side of the product-name rule must not move: an exactly 80-character
 * name is stored whole, surrounding ordinary spaces are trimmed, and the slug
 * still derives from the stored name.
 */

beforeEach(createSchema);

const PRICE = { amount_minor: 600, currency: "EGP" };

describe("product name validation: accepted names", () => {
	it("accepts an exactly 80-character name on create without truncation", async () => {
		const r = await registerStore();
		const name = "a".repeat(80);
		const product = await seedProduct(r, { name });
		expect(product.name).toBe(name);
		expect(String(product.name)).toHaveLength(80);

		const pulled = await SELF.fetch(`${BASE}/api/v1/products`, { headers: authHeaders(r) });
		const body = (await pulled.json()) as { products: Record<string, unknown>[] };
		expect(body.products[0].name).toBe(name);
	});

	it("accepts an 80-character name surrounded by spaces, trimmed", async () => {
		const r = await registerStore();
		const name = "b".repeat(80);
		const product = await seedProduct(r, { name: `   ${name}   ` });
		expect(product.name).toBe(name);
	});

	it("trims surrounding ordinary spaces on create and derives the slug from the trimmed name", async () => {
		const r = await registerStore();
		const product = await seedProduct(r, { name: "   Mango Juice   " });
		expect(product.name).toBe("Mango Juice");
		const plain = await seedProduct(r, { name: "Mango Juice" });
		expect(product.slug).toBe(plain.slug);
	});

	it("accepts an 80-character name and trims spaces on replace", async () => {
		const r = await registerStore();
		const created = await seedProduct(r, { name: "Original" });
		const code = String(created.product_code);

		const long = "c".repeat(80);
		const first = await SELF.fetch(`${BASE}/api/v1/products/${code}`, {
			method: "PUT", headers: authHeaders(r),
			body: JSON.stringify({ name: long, price: PRICE }),
		});
		expect(first.status).toBe(200);
		expect(((await first.json()) as { product: Record<string, unknown> }).product.name).toBe(long);

		const second = await SELF.fetch(`${BASE}/api/v1/products/${code}`, {
			method: "PUT", headers: authHeaders(r),
			body: JSON.stringify({ name: "  Renamed  ", price: PRICE }),
		});
		expect(second.status).toBe(200);
		expect(((await second.json()) as { product: Record<string, unknown> }).product.name).toBe("Renamed");
	});

	it("accepts a non-Latin name", async () => {
		const r = await registerStore();
		const product = await seedProduct(r, { name: "عصير مانجو" });
		expect(product.name).toBe("عصير مانجو");
	});

	it("still answers 404 before validating the name of a product that is not this store's", async () => {
		const r = await registerStore();
		const res = await SELF.fetch(`${BASE}/api/v1/products/p-NOPE1234`, {
			method: "PUT", headers: authHeaders(r),
			body: JSON.stringify({ name: "   ", price: PRICE }),
		});
		expect(res.status).toBe(404);
	});
});
