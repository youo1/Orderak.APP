import { beforeEach, describe, expect, it } from "vitest";
import { BASE, SELF, authHeaders, createSchema, env, registerStore, type Registered } from "./helpers";
import { normalizeBuyerPhone, validE164, isPrivacySentinel } from "../src/domains/identity/phone";

/**
 * Customers as a resource, and the normalisation that decides who one is.
 *
 * Before this there was no customers table in any migration and no
 * /api/v1/customers among the backend's paths. A buyer was two denormalised
 * columns on `orders`, and the app's customer list was an aggregation computed
 * on the device — which is why CustomerDetailsScreen had no edit control and no
 * save, while the catalogue sold "editable customer profiles" at paid1.
 *
 * The substance is not the CRUD. It is that `01012345678` and `+201012345678`
 * are one person, that a value which cannot be resolved is never guessed at, and
 * that the privacy sentinels in that column survive untouched.
 */

beforeEach(createSchema);

async function storeIdOf(r: Registered): Promise<string> {
	const row = await env.orderak_db.prepare("SELECT id FROM sellers WHERE phone=?").bind(r.phone).first<{ id: string }>();
	return String(row!.id);
}

async function seedProduct(r: Registered): Promise<string> {
	const res = await SELF.fetch(`${BASE}/api/v1/products/sync`, {
		method: "POST", headers: authHeaders(r),
		body: JSON.stringify({
			products: [{ app_id: 1, name: "Cola", price: { amount_minor: 1500, currency: "EGP" }, stock: 50, available: true }],
		}),
	});
	return ((await res.json()) as { products: { product_code: string }[] }).products[0].product_code;
}

/**
 * Put a store on a paid plan.
 *
 * Editing a customer is a paid entitlement — customers_crm.editable_customer_profiles
 * is in LEGACY_PAID_ONLY_KEYS, which legacySnapshot resolves as available only
 * when the seller has an active subscription. The API enforces that now; it did
 * not before, which is why these tests passed on a free store and why the free
 * case below is worth asserting rather than assuming.
 */
async function grantPaidPlan(r: Registered): Promise<void> {
	// The plan row is inserted here rather than relied on from migration 002:
	// createSchema() DELETEs every clearable table after applying the migrations,
	// so the reference data they seed is wiped and never restored. A subscription
	// joined to a plan that is not there resolves to no plan at all.
	const storeId = await storeIdOf(r);
	await env.orderak_db.prepare(
		"INSERT OR IGNORE INTO plans(id,name,price_minor,active) VALUES('starter','Starter',9900,1)",
	).run();
	await env.orderak_db.prepare(
		"INSERT INTO subscriptions(seller_id,plan_id,status) VALUES(?,'starter','active')",
	).bind(storeId).run();
}

let orderSeq = 0;
async function order(r: Registered, code: string, buyerPhone: string, buyerName?: string): Promise<Response> {
	orderSeq += 1;
	return SELF.fetch(`${BASE}/api/v1/orders`, {
		method: "POST", headers: authHeaders(r),
		body: JSON.stringify({
			idempotency_key: `customer-test-${orderSeq}-${Math.random().toString(36).slice(2, 8)}`,
			buyer_phone: buyerPhone,
			...(buyerName ? { buyer_name: buyerName } : {}),
			items: [{ product_code: code, qty: 1 }],
		}),
	});
}

async function listCustomers(r: Registered): Promise<Array<Record<string, unknown>>> {
	const res = await SELF.fetch(`${BASE}/api/v1/customers`, { headers: authHeaders(r) });
	expect(res.status).toBe(200);
	return ((await res.json()) as { customers: Array<Record<string, unknown>> }).customers;
}

// ---------------------------------------------------------------------------

describe("phone normalisation (I-6)", () => {
	it("has one definition of the stored shape", () => {
		// There were two validE164 functions differing by one digit of minimum
		// length, so a phone that signed in through auth-v2 could be flagged
		// invalid_phone_e164 by the readiness check reading the same column.
		expect(validE164("+201012345678")).toBe(true);
		expect(validE164("+20101234")).toBe(true); // 8 digits, the floor
		expect(validE164("+2010123")).toBe(false); // 7, which no real number is
		expect(validE164("201012345678")).toBe(false); // no plus
		expect(validE164("+0201012345")).toBe(false); // leading zero
	});

	it("resolves two spellings of one Egyptian number to the same key", () => {
		const national = normalizeBuyerPhone("01012345678", "EG");
		const international = normalizeBuyerPhone("+201012345678", "EG");
		expect(national.outcome).toBe("valid");
		expect(international.outcome).toBe("valid");
		expect(national.e164).toBe("+201012345678");
		expect(national.key).toBe(international.key);
	});

	it("reads an international number without needing a region", () => {
		const result = normalizeBuyerPhone("+201012345678", null);
		expect(result.outcome).toBe("valid");
		expect(result.e164).toBe("+201012345678");
	});

	it("calls a national number with no country context ambiguous, not valid", () => {
		// The store's country is the only country information the system has
		// about a buyer. Without it there is nothing that says whose number this
		// is, and guessing is how two people become one customer.
		const result = normalizeBuyerPhone("01012345678", null);
		expect(result.outcome).toBe("ambiguous");
		expect(result.e164).toBeNull();
		expect(result.key).toBe("01012345678");
	});

	it("keeps an unresolvable value keyed to itself", () => {
		const first = normalizeBuyerPhone("99999999999", "EG");
		const second = normalizeBuyerPhone("88888888888", "EG");
		expect(first.outcome).not.toBe("valid");
		expect(second.outcome).not.toBe("valid");
		// Two unresolvable values must never collapse onto one key.
		expect(first.key).not.toBe(second.key);
	});

	it("recognises the privacy sentinels rather than treating them as numbers", () => {
		expect(isPrivacySentinel("deleted:a1b2c3d4e5f60718293a")).toBe(true);
		expect(isPrivacySentinel("expired:018f-request")).toBe(true);
		expect(isPrivacySentinel("01012345678")).toBe(false);
		expect(normalizeBuyerPhone("deleted:a1b2c3d4e5f60718293a", "EG").outcome).toBe("sentinel");
	});
});

describe("customers created by orders", () => {
	it("creates one customer for the store the order belongs to", async () => {
		const r = await registerStore({ phone: "+201500004001", country_iso: "EG" });
		const code = await seedProduct(r);
		expect((await order(r, code, "01012345678", "Mariam")).status).toBe(200);

		const customers = await listCustomers(r);
		expect(customers).toHaveLength(1);
		expect(customers[0]).toMatchObject({
			phone_e164: "+201012345678",
			phone_raw: "01012345678",
			phone_status: "valid",
			name: "Mariam",
			orders_count: 1,
		});
	});

	it("treats two spellings of one number as one customer (I-6)", async () => {
        // The end-to-end form of the normalisation test above, and the one that
        // says whether a seller sees one person or two.
		const r = await registerStore({ phone: "+201500004002", country_iso: "EG" });
		const code = await seedProduct(r);
		expect((await order(r, code, "01012345678", "Mariam")).status).toBe(200);
		expect((await order(r, code, "+201012345678")).status).toBe(200);

		const customers = await listCustomers(r);
		expect(customers).toHaveLength(1);
		expect(customers[0].phone_e164).toBe("+201012345678");
	});

	it("keeps an unresolvable value separate rather than merging it", async () => {
		const r = await registerStore({ phone: "+201500004003", country_iso: "EG" });
		const code = await seedProduct(r);
		expect((await order(r, code, "01012345678")).status).toBe(200);
		expect((await order(r, code, "99999999999")).status).toBe(200);

		const customers = await listCustomers(r);
		expect(customers).toHaveLength(2);
		const flagged = customers.find((c) => c.phone_status !== "valid");
		expect(flagged, "the unresolvable value should be flagged").toBeTruthy();
		expect(flagged!.phone_e164).toBeNull();
		expect(flagged!.phone_raw).toBe("99999999999");
	});

	it("does not overwrite a name the seller typed", async () => {
		const r = await registerStore({ phone: "+201500004004", country_iso: "EG" });
		const code = await seedProduct(r);
		await order(r, code, "01012345678", "Mariam");
		await grantPaidPlan(r);

		const key = "+201012345678";
		await SELF.fetch(`${BASE}/api/v1/customers/${encodeURIComponent(key)}`, {
			method: "PATCH", headers: authHeaders(r), body: JSON.stringify({ name: "Mariam Hassan" }),
		});
		// A later order carrying the checkout's name must not replace it.
		await order(r, code, "01012345678", "M");

		const customers = await listCustomers(r);
		expect(customers[0].name).toBe("Mariam Hassan");
	});

	it("creates no customer for a privacy sentinel", async () => {
		// The erasure path writes deleted:<hash> into buyer_phone. Building a
		// customer from one would rebuild a record of the person just erased.
		const r = await registerStore({ phone: "+201500004005", country_iso: "EG" });
		const storeId = await storeIdOf(r);
		const code = await seedProduct(r);
		await order(r, code, "01012345678");
		await env.orderak_db.prepare(
			"UPDATE orders SET buyer_phone='deleted:a1b2c3d4e5f60718293a', buyer_name='Deleted customer' WHERE store_id=?",
		).bind(storeId).run();
		await order(r, code, "01099999999");

		const customers = await listCustomers(r);
		expect(customers.some((c) => String(c.phone_raw).startsWith("deleted:"))).toBe(false);
	});

	it("does not rewrite orders.buyer_phone", async () => {
		// Three admin console queries GROUP BY the raw value and one joins
		// restrictions on its last four characters. Normalising in place would
		// silently split or merge groupings an operator relies on.
		const r = await registerStore({ phone: "+201500004006", country_iso: "EG" });
		const storeId = await storeIdOf(r);
		const code = await seedProduct(r);
		await order(r, code, "01012345678");

		const row = await env.orderak_db.prepare("SELECT buyer_phone FROM orders WHERE store_id=?")
			.bind(storeId).first<{ buyer_phone: string }>();
		expect(row?.buyer_phone).toBe("01012345678");
	});
});

describe("editing a customer", () => {
	const key = "+201012345678";

	async function seeded(phone: string): Promise<Registered> {
		const r = await registerStore({ phone, country_iso: "EG" });
		const code = await seedProduct(r);
		await order(r, code, "01012345678", "Mariam");
		await grantPaidPlan(r);
		return r;
	}

	it("persists the seller's edit", async () => {
		const r = await seeded("+201500004010");
		const res = await SELF.fetch(`${BASE}/api/v1/customers/${encodeURIComponent(key)}`, {
			method: "PATCH", headers: authHeaders(r),
			body: JSON.stringify({ name: "Mariam Hassan", alt_contact: "01199999999", note: "Prefers evening delivery" }),
		});
		expect(res.status).toBe(200);

		const customers = await listCustomers(r);
		expect(customers[0]).toMatchObject({
			name: "Mariam Hassan",
			alt_contact: "01199999999",
			note: "Prefers evening delivery",
		});
	});

	it("refuses to change the phone, because it is the identity", async () => {
		// An edit that changed it would silently be a different customer, taking
		// the order history with it and leaving nothing to say that happened.
		const r = await seeded("+201500004011");
		for (const body of [{ phone: "+201099999999" }, { phone_e164: "+201099999999" }, { customer_key: "x" }]) {
			const res = await SELF.fetch(`${BASE}/api/v1/customers/${encodeURIComponent(key)}`, {
				method: "PATCH", headers: authHeaders(r), body: JSON.stringify(body),
			});
			expect(res.status).toBe(400);
			expect(await res.json()).toMatchObject({ code: "phone_not_editable" });
		}
		expect((await listCustomers(r))[0].phone_e164).toBe(key);
	});

	it("clears a field when sent null, and leaves untouched what it was not sent", async () => {
		const r = await seeded("+201500004012");
		const patch = (body: unknown) => SELF.fetch(`${BASE}/api/v1/customers/${encodeURIComponent(key)}`, {
			method: "PATCH", headers: authHeaders(r), body: JSON.stringify(body),
		});
		await patch({ name: "Mariam Hassan", note: "VIP" });
		await patch({ note: null });

		const customer = (await listCustomers(r))[0];
		expect(customer.note).toBeNull();
		expect(customer.name).toBe("Mariam Hassan");
	});

	it("refuses an empty patch rather than reporting a change it did not make", async () => {
		const r = await seeded("+201500004013");
		const res = await SELF.fetch(`${BASE}/api/v1/customers/${encodeURIComponent(key)}`, {
			method: "PATCH", headers: authHeaders(r), body: JSON.stringify({}),
		});
		expect(res.status).toBe(400);
	});

	it("answers 404 for a customer this store does not have", async () => {
		const r = await seeded("+201500004014");
		const res = await SELF.fetch(`${BASE}/api/v1/customers/${encodeURIComponent("+201099999999")}`, {
			method: "PATCH", headers: authHeaders(r), body: JSON.stringify({ name: "Nobody" }),
		});
		expect(res.status).toBe(404);
	});

	it("refuses a free-plan seller, because the edit is a paid entitlement", async () => {
		// The catalogue has sold customers_crm.editable_customer_profiles at paid1
		// since migration 025 and the app gates its editor on it. The API did not,
		// so the rule held only where the client chose to honour it — which is the
		// wrong way round for something a plan is sold on.
		//
		// Deliberately NOT calling grantPaidPlan: this store is on free.
		const r = await registerStore({ phone: "+201500004016", country_iso: "EG" });
		const code = await seedProduct(r);
		await order(r, code, "01012345678", "Mariam");

		const res = await SELF.fetch(`${BASE}/api/v1/customers/${encodeURIComponent(key)}`, {
			method: "PATCH", headers: authHeaders(r), body: JSON.stringify({ name: "Mariam Hassan" }),
		});
		expect(res.status).toBe(403);
		expect(await res.json()).toMatchObject({
			code: "plan_feature_unavailable",
			entitlement_key: "customers_crm.editable_customer_profiles",
		});

		// And the refusal is a refusal: nothing was written.
		expect((await listCustomers(r))[0].name).toBe("Mariam");
	});

	it("checks the plan before it checks the payload, so the refusal cannot probe for keys", async () => {
		// A free seller PATCHing a customer that does not exist must not be able
		// to tell that apart from one that does. Ordering the entitlement check
		// first is what makes both answer 403.
		const r = await registerStore({ phone: "+201500004017", country_iso: "EG" });
		const code = await seedProduct(r);
		await order(r, code, "01012345678", "Mariam");

		const present = await SELF.fetch(`${BASE}/api/v1/customers/${encodeURIComponent(key)}`, {
			method: "PATCH", headers: authHeaders(r), body: JSON.stringify({ name: "X" }),
		});
		const absent = await SELF.fetch(`${BASE}/api/v1/customers/${encodeURIComponent("+201099999999")}`, {
			method: "PATCH", headers: authHeaders(r), body: JSON.stringify({ name: "X" }),
		});
		expect([present.status, absent.status]).toEqual([403, 403]);
	});

	it("refuses an unauthenticated caller", async () => {
		const res = await SELF.fetch(`${BASE}/api/v1/customers`, {
			headers: { "x-orderak-phone": "+201500004015", "x-orderak-secret": "wrong" },
		});
		expect(res.status).toBe(401);
	});
});

describe("customers are scoped to their store", () => {
	it("never lists or edits another seller's customer", async () => {
		const a = await registerStore({ phone: "+201500004020", country_iso: "EG" });
		const b = await registerStore({ phone: "+201500004021", country_iso: "EG" });
		const codeA = await seedProduct(a);
		await order(a, codeA, "01012345678", "Mariam");
		// b is deliberately entitled to edit. Without this the 404 below would be
		// a 403 from the plan gate, and the test would pass while proving nothing
		// about ownership — which is the thing it exists to prove.
		await grantPaidPlan(b);

		expect(await listCustomers(b)).toHaveLength(0);

		const key = "+201012345678";
		const read = await SELF.fetch(`${BASE}/api/v1/customers/${encodeURIComponent(key)}`, { headers: authHeaders(b) });
		expect(read.status).toBe(404);

		const write = await SELF.fetch(`${BASE}/api/v1/customers/${encodeURIComponent(key)}`, {
			method: "PATCH", headers: authHeaders(b), body: JSON.stringify({ name: "Hijacked" }),
		});
		expect(write.status).toBe(404);
		expect((await listCustomers(a))[0].name).toBe("Mariam");
	});

	it("lets two stores each hold the same number as their own customer", async () => {
		const a = await registerStore({ phone: "+201500004030", country_iso: "EG" });
		const b = await registerStore({ phone: "+201500004031", country_iso: "EG" });
		await order(a, await seedProduct(a), "01012345678", "Mariam");
		await order(b, await seedProduct(b), "01012345678", "M. Hassan");

		expect((await listCustomers(a))[0].name).toBe("Mariam");
		expect((await listCustomers(b))[0].name).toBe("M. Hassan");
	});
});
