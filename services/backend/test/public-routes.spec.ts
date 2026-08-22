import { describe, it, expect, beforeEach } from "vitest";
import { SELF, env, createSchema, registerStore, authHeaders, type Registered } from "./helpers";

const SITE = "https://orderak.app";

async function seedProduct(r: Registered, appId = 1, name = "Cola"): Promise<string> {
	const res = await SELF.fetch("https://api.orderak.app/api/v1/products/sync", {
		method: "POST",
		headers: authHeaders(r),
		body: JSON.stringify({ products: [{ app_id: appId, name, price: { amount_minor: 1500, currency: "EGP" }, stock: 10, available: true }] }),
	});
	const body = (await res.json()) as { products: { product_code: string }[] };
	return body.products[0].product_code;
}

async function createCategory(r: Registered, name = "Drinks"): Promise<string> {
	const res = await SELF.fetch("https://api.orderak.app/api/v1/categories", {
		method: "POST",
		headers: authHeaders(r),
		body: JSON.stringify({ name }),
	});
	const body = (await res.json()) as { category: { category_code: string } };
	return body.category.category_code;
}

beforeEach(async () => {
	await createSchema();
});

describe("public store page", () => {
	it("renders SEO metadata and never leaks phone or internal id", async () => {
		const r = await registerStore({ store_name: "Fresh Market" });
		await seedProduct(r);
		const row = (await env.orderak_db
			.prepare("SELECT id, phone FROM sellers WHERE public_identifier = ?")
			.bind(r.public_identifier)
			.first()) as { id: string; phone: string };

		const res = await SELF.fetch(`${SITE}/${r.public_identifier}`);
		expect(res.status).toBe(200);
		const html = await res.text();

		expect(html).toContain("Fresh Market");
		expect(html).toContain(`<link rel="canonical" href="${SITE}/${r.public_identifier}">`);
		expect(html).toContain('property="og:title"');
		expect(html).toContain('name="robots"');
		// Security: no phone digits and no internal UUID in the public HTML.
		expect(html).not.toContain(row.phone.replace(/\D/g, ""));
		expect(html).not.toContain(row.id);
	});

	it("detects the browser language and renders cached product translations", async () => {
		const r = await registerStore({ store_name: "متجر" });
		await seedProduct(r, 1, "قميص قطن");
		const product = await env.orderak_db.prepare(
			"SELECT p.id, p.name, COALESCE(p.description,'') description FROM products p JOIN sellers s ON s.id=p.store_id WHERE s.public_identifier=?",
		).bind(r.public_identifier).first<{ id: string; name: string; description: string }>();
		expect(product).toBeTruthy();
		await env.orderak_db.prepare(
			`INSERT INTO product_translations
			 (product_id,lang,name,description,source_name,source_description,detected_language)
			 VALUES (?,?,?,?,?,?,?)`,
		).bind(product!.id, "en", "Cotton shirt", null, product!.name, product!.description, "ar").run();

		const res = await SELF.fetch(`${SITE}/${r.public_identifier}`, {
			headers: { "accept-language": "en-US,en;q=0.9,ar;q=0.8" },
		});
		const html = await res.text();
		expect(res.headers.get("content-language")).toBe("en");
		expect(res.headers.get("vary")).toBe("Accept-Language");
		expect(html).toContain('<html lang="en" dir="ltr">');
		expect(html).toContain("Cotton shirt");
		expect(html).toContain("Confirm order");
		expect(html).not.toContain("قميص قطن");
	});

	it("never injects store payment values into executable HTML", async () => {
		const payload = `</b><img src=x onerror=alert(1)>`;
		const r = await registerStore({ instapay: payload, vfcash: payload });
		await seedProduct(r);
		const html = await (await SELF.fetch(`${SITE}/${r.public_identifier}`)).text();
		expect(html).not.toContain(payload);
		expect(html).not.toContain("innerHTML");
		expect(html).not.toContain('value="FAWRY"');
	});
});

describe("public checkout integrity", () => {
	it("rejects carts above the bounded D1 parameter budget", async () => {
		const store = await registerStore();
		const code = await seedProduct(store);
		const response = await SELF.fetch(`${SITE}/${store.public_identifier}`, {
			method: "POST",
			headers: { "content-type": "application/json", "idempotency-key": "checkout-too-many-items" },
			body: JSON.stringify({
				items: Array.from({ length: 51 }, () => ({ product_code: code, qty: 1 })),
				buyer_phone: "01012345678",
				pay_method: "COD",
			}),
		});
		expect(response.status).toBe(400);
	});

	// The monthly quota was a SELECT COUNT followed later by an INSERT. Two
	// buyers arriving together both read a count under the limit and both orders
	// were written, so a store on the free plan could exceed its allowance by as
	// many orders as arrived at once. The count now lives in the insert itself.
	it("does not let concurrent orders exceed the monthly quota", async () => {
		const r = await registerStore();
		const code = await seedProduct(r);
		const seller = await env.orderak_db.prepare("SELECT id FROM sellers WHERE phone=?").bind(r.phone).first<{ id: string }>();
		// Free plan allows 50 orders a month; fill it to one remaining.
		const filler = [];
		for (let index = 0; index < 49; index += 1) {
			filler.push(env.orderak_db.prepare(
				"INSERT INTO orders(id,order_no,store_id,buyer_phone,pay_method,total_minor,currency,status) VALUES(?,?,?,'01000000000','COD',100,'EGP','NEW')",
			).bind(`filler-${index}`, index + 1, seller!.id));
		}
		await env.orderak_db.batch(filler);

		const place = (key: string) => SELF.fetch(`${SITE}/${r.public_identifier}`, {
			method: "POST",
			headers: { "content-type": "application/json", "idempotency-key": key },
			body: JSON.stringify({ items: [{ product_code: code, qty: 1 }], buyer_phone: "01012345678", pay_method: "COD" }),
		});
		const [a, b] = await Promise.all([place("quota-race-a"), place("quota-race-b")]);

		const statuses = [a.status, b.status].sort();
		expect(statuses).toEqual([200, 409]);
		const total = await env.orderak_db.prepare("SELECT COUNT(*) AS c FROM orders WHERE store_id=?")
			.bind(seller!.id).first<{ c: number }>();
		expect(total?.c).toBe(50);
	});

	it("replays an idempotent order once and rejects overselling", async () => {
		const r = await registerStore();
		const code = await seedProduct(r);
		const body = JSON.stringify({ items: [{ product_code: code, qty: 7 }], buyer_phone: "01012345678", pay_method: "COD" });
		const place = () => SELF.fetch(`${SITE}/${r.public_identifier}`, {
			method: "POST",
			headers: { "content-type": "application/json", "idempotency-key": "checkout-test-0001" },
			body,
		});
		const first = await place();
		expect(first.status).toBe(200);
		const firstBody = await first.json() as { order_no: number };
		const replay = await place();
		expect(replay.status).toBe(200);
		expect(await replay.json()).toMatchObject({ order_no: firstBody.order_no });

		const oversell = await SELF.fetch(`${SITE}/${r.public_identifier}`, {
			method: "POST",
			headers: { "content-type": "application/json", "idempotency-key": "checkout-test-0002" },
			body: JSON.stringify({ items: [{ product_code: code, qty: 4 }], buyer_phone: "01012345678", pay_method: "COD" }),
		});
		expect(oversell.status).toBe(409);
		expect(await oversell.json()).toMatchObject({ code: "stock_changed" });
		const state = await env.orderak_db.prepare(
			"SELECT p.stock,(SELECT COUNT(*) FROM orders o WHERE o.store_id=p.store_id) orders_count FROM products p WHERE p.product_code=?",
		).bind(code).first<Record<string, unknown>>();
		expect(state).toMatchObject({ stock: 3, orders_count: 1 });
	});
});

describe("product + category pages", () => {
	it("serves a shareable product page with JSON-LD", async () => {
		const r = await registerStore();
		const code = await seedProduct(r, 1, "Iced Coffee");
		const res = await SELF.fetch(`${SITE}/${r.public_identifier}/p/${code}`);
		expect(res.status).toBe(200);
		const html = await res.text();
		expect(html).toContain("Iced Coffee");
		expect(html).toContain('application/ld+json');
		expect(html).toContain(`${SITE}/${r.public_identifier}/p/${code}`);
	});

	it("serves a category page", async () => {
		const r = await registerStore();
		const code = await createCategory(r, "Snacks");
		const res = await SELF.fetch(`${SITE}/${r.public_identifier}/c/${code}`);
		expect(res.status).toBe(200);
		expect(await res.text()).toContain("Snacks");
	});
});

describe("ownership validation", () => {
	it("404s when a product is accessed under a store that doesn't own it", async () => {
		const a = await registerStore({ store_name: "Store A" });
		const b = await registerStore({ store_name: "Store B" });
		const bCode = await seedProduct(b, 1, "B-Only");

		const ok = await SELF.fetch(`${SITE}/${b.public_identifier}/p/${bCode}`);
		expect(ok.status).toBe(200);

		const cross = await SELF.fetch(`${SITE}/${a.public_identifier}/p/${bCode}`);
		expect(cross.status).toBe(404);
	});
});

describe("legacy redirects", () => {
	it("301s /c/{identifier} to the canonical /{public_identifier}", async () => {
		const r = await registerStore();
		const res = await SELF.fetch(`${SITE}/c/${r.public_identifier}`, { redirect: "manual" });
		expect(res.status).toBe(301);
		expect(res.headers.get("location")).toBe(`${SITE}/${r.public_identifier}`);
	});

	it("301s a bare store_code alias to the canonical identifier", async () => {
		const r = await registerStore();
		const res = await SELF.fetch(`${SITE}/${r.store_code}`, { redirect: "manual" });
		expect(res.status).toBe(301);
		expect(res.headers.get("location")).toBe(`${SITE}/${r.public_identifier}`);
	});
});

describe("account deletion resource", () => {
	it("serves the public form and records a 90-day deletion request", async () => {
		const page = await SELF.fetch(`${SITE}/delete-account`, {
			headers: { "accept-language": "en" },
		});
		expect(page.status).toBe(200);
		expect(await page.text()).toContain("Delete your Orderak account");

		const form = new FormData();
		form.set("phone", "+201001234567");
		form.set("email", "seller@example.com");
		const submitted = await SELF.fetch(`${SITE}/delete-account`, {
			method: "POST",
			headers: { "accept-language": "en", "cf-connecting-ip": "203.0.113.60" },
			body: form,
		});
		expect(submitted.status).toBe(200);
		expect(await submitted.text()).toContain("Your request was received");

		const row = await env.orderak_db.prepare(
			"SELECT phone_e164,email,status,deadline_at FROM deletion_requests WHERE phone_e164=?",
		).bind("+201001234567").first<Record<string, unknown>>();
		expect(row).toMatchObject({ phone_e164: "+201001234567", email: "seller@example.com", status: "pending" });
		expect(Date.parse(String(row?.deadline_at))).toBeGreaterThan(Date.now() + 89 * 24 * 60 * 60 * 1000);
	});
});
