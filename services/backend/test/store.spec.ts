import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { SELF, BASE, env, createSchema, registerStore, authHeaders } from "./helpers";
import { hashSecret } from "../src/platform/http/shared";
import { processDeletionRequests } from "../src/domains/identity/deletion";

beforeEach(async () => {
	await createSchema();
});

afterEach(() => {
	vi.unstubAllGlobals();
});

async function deletionTestEnv(): Promise<Env> {
	// generateKey() is typed CryptoKey | CryptoKeyPair; RSASSA-PKCS1-v1_5
	// with sign+verify usages always yields a pair.
	const keyPair = (await crypto.subtle.generateKey(
		{
			name: "RSASSA-PKCS1-v1_5",
			modulusLength: 2048,
			publicExponent: new Uint8Array([1, 0, 1]),
			hash: "SHA-256",
		},
		true,
		["sign", "verify"],
	)) as CryptoKeyPair;
	// exportKey() is typed ArrayBuffer | JsonWebKey; "pkcs8" always yields the
	// ArrayBuffer branch.
	const privateKey = new Uint8Array(
		await crypto.subtle.exportKey("pkcs8", keyPair.privateKey) as ArrayBuffer,
	);
	let binary = "";
	for (const byte of privateKey) binary += String.fromCharCode(byte);
	const base64 = btoa(binary).match(/.{1,64}/g)?.join("\n") ?? "";
	return {
		...env,
		orderak_db: env.orderak_db,
		orderak_media: env.orderak_media,
		BILLING_ENABLED: "false",
		FIREBASE_PROJECT_ID: "orderak-test",
		FIREBASE_SERVICE_ACCOUNT_EMAIL: "firebase-test@orderak-test.iam.gserviceaccount.com",
		FIREBASE_SERVICE_ACCOUNT_PRIVATE_KEY:
			`-----BEGIN PRIVATE KEY-----\n${base64}\n-----END PRIVATE KEY-----`,
	} as TestEnv;
}

describe("POST /api/v1/register", () => {
	it("returns ok:true so the app persists the identity", async () => {
		// Regression: a missing ok flag made the app treat register as failed and
		// fall back to sharing a bare slug instead of the public_identifier.
		const res = await SELF.fetch(`${BASE}/api/v1/register`, {
			method: "POST",
			headers: { "content-type": "application/json" },
			body: JSON.stringify({ phone: "+201555000111", secret: "s", store_name: "Ok Store", country_iso: "EG" }),
		});
		const body = (await res.json()) as Record<string, unknown>;
		expect(body.ok).toBe(true);
		expect(body.public_identifier).toBeTruthy();
	});

	it("mints an 8-char store_code, UUID identity and public URL", async () => {
		const r = await registerStore({ store_name: "Fresh Market", country_iso: "EG" });
		expect(r.store_code).toMatch(/^[A-Z0-9]{8}$/);
		expect(r.public_identifier).toMatch(/^EG-fresh-market-[A-Z0-9]{8}$/);
		expect(r.store_url).toBe(`https://orderak.app/${r.public_identifier}`);
		expect(r.store_url).not.toContain("/c/");
		expect(r.store_url).not.toContain(r.phone.replace(/\D/g, ""));
	});

	it("does not let a caller replace an existing store secret", async () => {
		const registered = await registerStore({ phone: "+201555009999", secret: "original-secret" });
		const takeover = await SELF.fetch(`${BASE}/api/v1/register`, {
			method: "POST",
			headers: { "content-type": "application/json" },
			body: JSON.stringify({ phone: registered.phone, secret: "attacker-secret", store_name: "Taken" }),
		});
		expect(takeover.status).toBe(401);
		const originalOwner = await SELF.fetch(`${BASE}/api/v1/store`, { headers: authHeaders(registered) });
		expect(originalOwner.status).toBe(200);
	});
});

describe("PUT /api/v1/store", () => {
	it("regenerates slug + public_identifier on rename but keeps store_code", async () => {
		const r = await registerStore({ store_name: "Fresh Market" });
		const res = await SELF.fetch(`${BASE}/api/v1/store`, {
			method: "PUT",
			headers: authHeaders(r),
			body: JSON.stringify({ store_name: "Green Grocer", description: "Best in town", whatsapp: "0100" }),
		});
		expect(res.status).toBe(200);
		const { store } = (await res.json()) as { store: Record<string, string> };
		expect(store.store_code).toBe(r.store_code); // immutable
		expect(store.slug).toBe("green-grocer"); // tracks the name
		expect(store.public_identifier).toBe(`EG-green-grocer-${r.store_code}`);
		expect(store.store_url).toBe(`https://orderak.app/${store.public_identifier}`);
		expect(store.description).toBe("Best in town");
	});

	it("accepts a custom slug", async () => {
		const r = await registerStore({ store_name: "Fresh Market" });
		const res = await SELF.fetch(`${BASE}/api/v1/store`, {
			method: "PUT",
			headers: authHeaders(r),
			body: JSON.stringify({ slug: "my-shop" }),
		});
		const { store } = (await res.json()) as { store: Record<string, string> };
		expect(store.slug).toBe("my-shop");
		expect(store.public_identifier).toBe(`EG-my-shop-${r.store_code}`);
	});

	it("requires auth", async () => {
		const res = await SELF.fetch(`${BASE}/api/v1/store`, {
			method: "PUT",
			headers: { "content-type": "application/json" },
			body: JSON.stringify({ store_name: "X" }),
		});
		expect(res.status).toBe(401);
	});

	it("rejects phone changes until a separate OTP re-verification flow exists", async () => {
		const r = await registerStore();
		const res = await SELF.fetch(`${BASE}/api/v1/store`, {
			method: "PUT", headers: authHeaders(r), body: JSON.stringify({ phone: "+201099999999" }),
		});
		expect(res.status).toBe(409);
		expect(await res.json()).toMatchObject({ code: "phone_change_requires_reverification" });
		expect(await env.orderak_db.prepare("SELECT phone FROM sellers WHERE phone=?").bind(r.phone).first()).toBeTruthy();
	});

	it("updates a valid business subcategory after onboarding and rejects an invalid pair", async () => {
		const r = await registerStore();
		const updated = await SELF.fetch(`${BASE}/api/v1/store`, {
			method: "PUT",
			headers: authHeaders(r),
			body: JSON.stringify({
				business_category_id: "fashion",
				business_subcategory_id: "fashion_clothing",
			}),
		});
		expect(updated.status).toBe(200);
		expect(await updated.json()).toMatchObject({
			store: {
				business_category_id: "fashion",
				business_subcategory_id: "fashion_clothing",
			},
		});

		const invalid = await SELF.fetch(`${BASE}/api/v1/store`, {
			method: "PUT",
			headers: authHeaders(r),
			body: JSON.stringify({
				business_category_id: "fashion",
				business_subcategory_id: "not_in_category",
			}),
		});
		expect(invalid.status).toBe(400);
		expect(await invalid.json()).toMatchObject({ code: "invalid_business_category" });
	});
});

describe("categories", () => {
	it("creates a category with an immutable code and lists it", async () => {
		const r = await registerStore();
		const created = await SELF.fetch(`${BASE}/api/v1/categories`, {
			method: "POST",
			headers: authHeaders(r),
			body: JSON.stringify({ name: "Drinks" }),
		});
		expect(created.status).toBe(201);
		const { category } = (await created.json()) as { category: Record<string, string> };
		expect(category.category_code).toMatch(/^c-[A-Z0-9]{6}$/);

		const list = await SELF.fetch(`${BASE}/api/v1/categories`, { headers: authHeaders(r) });
		const { categories } = (await list.json()) as { categories: Record<string, string>[] };
		expect(categories.map((c) => c.category_code)).toContain(category.category_code);
	});

	it("enforces the free-plan category limit", async () => {
		const r = await registerStore();
		for (let i = 0; i < 5; i++) {
			const res = await SELF.fetch(`${BASE}/api/v1/categories`, {
				method: "POST", headers: authHeaders(r), body: JSON.stringify({ name: `Category ${i}` }),
			});
			expect(res.status).toBe(201);
		}
		const blocked = await SELF.fetch(`${BASE}/api/v1/categories`, {
			method: "POST", headers: authHeaders(r), body: JSON.stringify({ name: "Too many" }),
		});
		expect(blocked.status).toBe(409);
		expect(await blocked.json()).toMatchObject({ code: "plan_limit_reached", limit_key: "max_categories", limit: 5 });
	});
});

describe("POST /api/v1/account/deletion-request", () => {
	it("records an authenticated request as identity-verified", async () => {
		const r = await registerStore();
		const response = await SELF.fetch(`${BASE}/api/v1/account/deletion-request`, {
			method: "POST",
			headers: authHeaders(r),
			body: "{}",
		});
		expect(response.status).toBe(200);
		expect(await response.json()).toMatchObject({ ok: true, deadline_days: 90 });
		const row = await env.orderak_db.prepare(
			"SELECT phone_e164,status,source,verified_at FROM deletion_requests WHERE phone_e164=?",
		).bind(r.phone).first<Record<string, unknown>>();
		expect(row).toMatchObject({ phone_e164: r.phone, status: "verified", source: "android_authenticated" });
		expect(row?.verified_at).toBeTruthy();
	});

	it("does not process a verified request before its deadline", async () => {
		const r = await registerStore();
		await SELF.fetch(`${BASE}/api/v1/account/deletion-request`, {
			method: "POST", headers: authHeaders(r), body: "{}",
		});

		await processDeletionRequests(env);

		expect(await env.orderak_db.prepare(
			"SELECT status FROM deletion_requests WHERE phone_e164=?",
		).bind(r.phone).first()).toMatchObject({ status: "verified" });
		expect(await env.orderak_db.prepare(
			"SELECT phone FROM sellers WHERE phone=?",
		).bind(r.phone).first()).toMatchObject({ phone: r.phone });
	});

	it("keeps a due request open when mandatory Firebase deletion is not configured", async () => {
		const r = await registerStore();
		await SELF.fetch(`${BASE}/api/v1/account/deletion-request`, {
			method: "POST", headers: authHeaders(r), body: "{}",
		});
		await env.orderak_db.prepare(
			"UPDATE deletion_requests SET deadline_at=datetime('now','-1 minute') WHERE phone_e164=?",
		).bind(r.phone).run();

		await processDeletionRequests(env);

		expect(await env.orderak_db.prepare(
			"SELECT status FROM deletion_requests WHERE phone_e164=?",
		).bind(r.phone).first()).toMatchObject({ status: "verified" });
		expect(await env.orderak_db.prepare(
			"SELECT phone FROM sellers WHERE phone=?",
		).bind(r.phone).first()).toMatchObject({ phone: r.phone });
	});

	it("deletes private birth-year data when a due account deletion completes", async () => {
		const r = await registerStore();
		const seller = await env.orderak_db.prepare(
			"SELECT id FROM sellers WHERE phone=?",
		).bind(r.phone).first<{ id: string }>();
		expect(seller?.id).toBeTruthy();
		await env.orderak_db.batch([
			env.orderak_db.prepare(
				"UPDATE sellers SET firebase_uid='firebase-delete-test' WHERE id=?",
			).bind(seller!.id),
			env.orderak_db.prepare(
				`INSERT INTO seller_profiles(seller_id,full_name,birth_year,email_private)
				 VALUES(?,?,?,?)`,
			).bind(seller!.id, "Private Seller", 1988, "private@example.com"),
			env.orderak_db.prepare(
				`INSERT INTO onboarding_sessions(
				 id,token_hash,phone_e164,firebase_uid,device_secret_hash,status,full_name,
				 birth_year,completed_seller_id,expires_at,absolute_expires_at
				 ) VALUES(?,?,?,?,?,'completed',?,?,?,?,?)`,
			).bind(
				"onboarding-delete-test",
				"token-delete-test",
				r.phone,
				"firebase-delete-test",
				"device-delete-test",
				"Private Seller",
				1988,
				seller!.id,
				"2099-01-01 00:00:00",
				"2099-01-02 00:00:00",
			),
		]);
		await SELF.fetch(`${BASE}/api/v1/account/deletion-request`, {
			method: "POST",
			headers: authHeaders(r),
			body: "{}",
		});
		const deletion = await env.orderak_db.prepare(
			"SELECT id FROM deletion_requests WHERE phone_e164=?",
		).bind(r.phone).first<{ id: string }>();
		await env.orderak_db.prepare(
			"UPDATE deletion_requests SET deadline_at=datetime('now','-1 minute') WHERE id=?",
		).bind(deletion!.id).run();

		vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL) => {
			const url = String(input);
			if (url === "https://oauth2.googleapis.com/token") {
				return Response.json({ access_token: "firebase-admin-test-token" });
			}
			if (url.endsWith("/accounts:delete")) return Response.json({});
			throw new Error(`Unexpected deletion fetch: ${url}`);
		}));

		expect(await processDeletionRequests(await deletionTestEnv())).toBe(1);
		expect(await env.orderak_db.prepare(
			"SELECT birth_year FROM seller_profiles WHERE seller_id=?",
		).bind(seller!.id).first()).toBeNull();
		expect(await env.orderak_db.prepare(
			"SELECT birth_year FROM onboarding_sessions WHERE completed_seller_id=?",
		).bind(seller!.id).first()).toBeNull();
		expect(await env.orderak_db.prepare(
			"SELECT status,phone_e164,email FROM deletion_requests WHERE id=?",
		).bind(deletion!.id).first()).toMatchObject({
			status: "completed",
			phone_e164: `deleted:${deletion!.id}`,
			email: null,
		});
	});

	// retention-matrix.md §2 promises phone_e164 becomes deleted:<request-id> on
	// every consent record for the subject. The update was scoped
	// `WHERE seller_id = ?` and sat inside the `if (sellerUuid)` block, so an
	// acceptance recorded before registration completed — which carries
	// seller_id NULL until api-store.ts claims it — kept its phone number, and a
	// deletion request for a phone with no seller row de-identified nothing at all.
	it("de-identifies consent records for the phone, not only those linked to the seller", async () => {
		const r = await registerStore();
		const seller = await env.orderak_db.prepare("SELECT id FROM sellers WHERE phone=?").bind(r.phone).first<{ id: string }>();
		await env.orderak_db.batch([
			env.orderak_db.prepare(
				`INSERT INTO legal_acceptances(id,seller_id,phone_e164,terms_version,privacy_version,locale,source)
				 VALUES('linked',?,?,1,1,'ar','android_phone_auth')`,
			).bind(seller!.id, r.phone),
			// Same person, same phone, recorded before the account existed.
			env.orderak_db.prepare(
				`INSERT INTO legal_acceptances(id,seller_id,phone_e164,terms_version,privacy_version,locale,source)
				 VALUES('unlinked',NULL,?,1,1,'ar','android_phone_auth')`,
			).bind(r.phone),
			// A different subject must be left completely alone.
			env.orderak_db.prepare(
				`INSERT INTO legal_acceptances(id,seller_id,phone_e164,terms_version,privacy_version,locale,source)
				 VALUES('other',NULL,'+201999999999',1,1,'ar','android_phone_auth')`,
			),
		]);

		await SELF.fetch(`${BASE}/api/v1/account/deletion-request`, { method: "POST", headers: authHeaders(r), body: "{}" });
		const deletion = await env.orderak_db.prepare("SELECT id FROM deletion_requests WHERE phone_e164=?").bind(r.phone).first<{ id: string }>();
		await env.orderak_db.prepare("UPDATE deletion_requests SET deadline_at=datetime('now','-1 minute') WHERE id=?").bind(deletion!.id).run();

		vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL) => {
			const url = String(input);
			if (url === "https://oauth2.googleapis.com/token") return Response.json({ access_token: "firebase-admin-test-token" });
			if (url.endsWith("/accounts:lookup")) return Response.json({ users: [{ localId: "uid-consent-test" }] });
			if (url.endsWith("/accounts:delete")) return Response.json({});
			throw new Error(`Unexpected deletion fetch: ${url}`);
		}));

		expect(await processDeletionRequests(await deletionTestEnv())).toBe(1);

		const rows = await env.orderak_db.prepare("SELECT id,seller_id,phone_e164 FROM legal_acceptances ORDER BY id")
			.all<{ id: string; seller_id: string | null; phone_e164: string }>();
		expect(rows.results).toEqual([
			{ id: "linked", seller_id: null, phone_e164: `deleted:${deletion!.id}` },
			{ id: "other", seller_id: null, phone_e164: "+201999999999" },
			{ id: "unlinked", seller_id: null, phone_e164: `deleted:${deletion!.id}` },
		]);
	});
});

describe("multi-device plan enforcement", () => {
	it("revokes an additional device immediately when the feature is disabled", async () => {
		const r = await registerStore({ secret: "primary-device" });
		const seller = await env.orderak_db.prepare("SELECT id FROM sellers WHERE phone=?").bind(r.phone).first<{ id: string }>();
		await env.orderak_db.prepare("INSERT INTO plans(id,name,active,multi_device_enabled) VALUES('free','Free',1,1)").run();
		await env.orderak_db.prepare("INSERT INTO seller_devices(seller_id,secret_hash) VALUES(?,?)")
			.bind(seller!.id, await hashSecret("second-device")).run();
		const headers = { "x-orderak-phone": r.phone, "x-orderak-secret": "second-device" };

		expect((await SELF.fetch(`${BASE}/api/v1/store`, { headers })).status).toBe(200);
		await env.orderak_db.prepare("UPDATE plans SET multi_device_enabled=0 WHERE id='free'").run();
		expect((await SELF.fetch(`${BASE}/api/v1/store`, { headers })).status).toBe(401);
		// The primary device is never blocked by the multi-device feature.
		expect((await SELF.fetch(`${BASE}/api/v1/store`, { headers: authHeaders(r) })).status).toBe(200);
	});
});

describe("POST /api/v1/products/sync", () => {
	it("requires seller credentials in headers", async () => {
		const r = await registerStore();
		const res = await SELF.fetch(`${BASE}/api/v1/products/sync`, {
			method: "POST",
			headers: { "content-type": "application/json" },
			body: JSON.stringify({ phone: r.phone, secret: r.secret, products: [] }),
		});
		expect(res.status).toBe(401);
	});
	it("assigns product codes and links categories", async () => {
		const r = await registerStore();
		const cat = (await (
			await SELF.fetch(`${BASE}/api/v1/categories`, {
				method: "POST",
				headers: authHeaders(r),
				body: JSON.stringify({ name: "Drinks" }),
			})
		).json()) as { category: { category_code: string } };

		const res = await SELF.fetch(`${BASE}/api/v1/products/sync`, {
			method: "POST",
			headers: authHeaders(r),
			body: JSON.stringify({
				products: [
					{ app_id: 1, name: "Cola", price: { amount_minor: 1500, currency: "EGP" }, stock: 10, available: true, category_code: cat.category.category_code },
				],
			}),
		});
		expect(res.status).toBe(200);
		const body = (await res.json()) as { products: { app_id: number; product_code: string; category_code: string }[] };
		expect(body.products).toHaveLength(1);
		expect(body.products[0].product_code).toMatch(/^p-[A-Z0-9]{6}$/);
		expect(body.products[0].category_code).toBe(cat.category.category_code);
	});

	it("keeps the same product_code across re-syncs (immutable)", async () => {
		const r = await registerStore();
		const first = (await (
			await SELF.fetch(`${BASE}/api/v1/products/sync`, {
				method: "POST",
				headers: authHeaders(r),
				body: JSON.stringify({ products: [{ app_id: 7, name: "Water", price: { amount_minor: 500, currency: "EGP" }, stock: 3, available: true }] }),
			})
		).json()) as { products: { product_code: string }[] };
		const second = (await (
			await SELF.fetch(`${BASE}/api/v1/products/sync`, {
				method: "POST",
				headers: authHeaders(r),
				body: JSON.stringify({ products: [{ app_id: 7, name: "Water Bottle", price: { amount_minor: 600, currency: "EGP" }, stock: 5, available: true }] }),
			})
		).json()) as { products: { product_code: string }[] };
		expect(second.products[0].product_code).toBe(first.products[0].product_code);
	});

	// A mirror endpoint deletes whatever the request omits, so "the field was
	// absent" and "the catalog is empty" must never resolve to the same value.
	// They used to: the body was parsed with `.catch(() => ({}))` and `products`
	// defaulted to `[]`, so a truncated upload returned 200 after wiping the store.
	it("rejects a sync body that omits products instead of wiping the catalog", async () => {
		const r = await registerStore();
		await SELF.fetch(`${BASE}/api/v1/products/sync`, {
			method: "POST", headers: authHeaders(r),
			body: JSON.stringify({ products: [{ app_id: 1, name: "Cola", price: { amount_minor: 1500, currency: "EGP" }, stock: 10, available: true }] }),
		});

		const res = await SELF.fetch(`${BASE}/api/v1/products/sync`, {
			method: "POST", headers: authHeaders(r), body: JSON.stringify({ note: "no products key" }),
		});
		expect(res.status).toBe(400);
		expect(await res.json()).toMatchObject({ code: "products_required" });

		const after = (await (await SELF.fetch(`${BASE}/api/v1/products`, { headers: authHeaders(r) })).json()) as { products: unknown[] };
		expect(after.products).toHaveLength(1);
	});

	it("rejects a malformed sync body instead of wiping the catalog", async () => {
		const r = await registerStore();
		await SELF.fetch(`${BASE}/api/v1/products/sync`, {
			method: "POST", headers: authHeaders(r),
			body: JSON.stringify({ products: [{ app_id: 1, name: "Cola", price: { amount_minor: 1500, currency: "EGP" }, stock: 10, available: true }] }),
		});

		const res = await SELF.fetch(`${BASE}/api/v1/products/sync`, {
			method: "POST", headers: authHeaders(r), body: "{\"products\": [",
		});
		expect(res.status).toBe(400);
		expect(await res.json()).toMatchObject({ code: "invalid_json" });

		const after = (await (await SELF.fetch(`${BASE}/api/v1/products`, { headers: authHeaders(r) })).json()) as { products: unknown[] };
		expect(after.products).toHaveLength(1);
	});

	// The other half of the same contract: an explicitly empty array is a real
	// state a seller can reach, so it must still clear the catalog — and leave a
	// trace, because from here it is indistinguishable from client data loss.
	it("honours an explicitly empty mirror and records that it emptied the catalog", async () => {
		const r = await registerStore();
		await SELF.fetch(`${BASE}/api/v1/products/sync`, {
			method: "POST", headers: authHeaders(r),
			body: JSON.stringify({ products: [{ app_id: 1, name: "Cola", price: { amount_minor: 1500, currency: "EGP" }, stock: 10, available: true }] }),
		});

		const res = await SELF.fetch(`${BASE}/api/v1/products/sync`, {
			method: "POST", headers: authHeaders(r), body: JSON.stringify({ products: [] }),
		});
		expect(res.status).toBe(200);

		const after = (await (await SELF.fetch(`${BASE}/api/v1/products`, { headers: authHeaders(r) })).json()) as { products: unknown[] };
		expect(after.products).toHaveLength(0);
		const audit = await env.orderak_db
			.prepare("SELECT action,details_json FROM admin_audit WHERE action='catalog.mirror_emptied'")
			.first<{ action: string; details_json: string }>();
		expect(audit).not.toBeNull();
		expect(JSON.parse(audit!.details_json)).toMatchObject({ deleted_product_count: 1 });
	});

	// ADR-009: an amount and its currency travel together. Migration 044 added
	// products.currency, the client has always sent one, and nothing read it —
	// the sync dropped it on the way in and every SELECT feeding a response
	// omitted the column on the way out, so a row stored as KWD came back as EGP.
	it("round-trips the currency a product was stored with", async () => {
		const r = await registerStore();
		await SELF.fetch(`${BASE}/api/v1/products/sync`, {
			method: "POST", headers: authHeaders(r),
			body: JSON.stringify({ products: [{ app_id: 1, name: "Dates", price: { amount_minor: 15000, currency: "EGP" }, stock: 1, available: true }] }),
		});
		const seller = await env.orderak_db.prepare("SELECT id FROM sellers WHERE phone=?").bind(r.phone).first<{ id: string }>();
		expect(await env.orderak_db.prepare("SELECT currency FROM products WHERE store_id=?").bind(seller!.id).first())
			.toMatchObject({ currency: "EGP" });

		// A currency the deployment does not accept is refused, not defaulted:
		// silently rewriting KWD to EGP is how 15000 fils becomes 150.00 pounds.
		const rejected = await SELF.fetch(`${BASE}/api/v1/products/sync`, {
			method: "POST", headers: authHeaders(r),
			body: JSON.stringify({ products: [{ app_id: 2, name: "Saffron", price: { amount_minor: 15000, currency: "KWD" }, stock: 1, available: true }] }),
		});
		expect(rejected.status).toBe(400);
		expect(await rejected.json()).toMatchObject({ code: "currency_not_enabled", currency: "KWD" });

		// The stored row is what the read path reports, not a constant.
		await env.orderak_db.prepare("UPDATE products SET currency='KWD' WHERE store_id=?").bind(seller!.id).run();
		const listed = (await (await SELF.fetch(`${BASE}/api/v1/products`, { headers: authHeaders(r) })).json()) as {
			products: { price: { amount_minor: number; currency: string } }[];
		};
		expect(listed.products[0].price).toEqual({ amount_minor: 15000, currency: "KWD" });
	});

	// The upsert binds 13 columns per row and D1 caps a statement at 100 bound
	// parameters, so the chunk size and the column count are load-bearing
	// together. A catalog larger than one chunk is the only thing that proves it.
	it("syncs a catalog larger than one bound-parameter chunk", async () => {
		const r = await registerStore();
		const seller = await env.orderak_db.prepare("SELECT id FROM sellers WHERE phone=?").bind(r.phone).first<{ id: string }>();
		// 30 products also crosses the threshold at which product codes stop being
		// checked against the database one at a time, so both branches run.
		await env.orderak_db.batch([
			env.orderak_db.prepare("INSERT INTO plans(id,name,active,max_products) VALUES('scale','Scale',1,100)"),
			env.orderak_db.prepare("INSERT INTO subscriptions(seller_id,plan_id,status) VALUES(?,'scale','active')").bind(seller!.id),
		]);
		const products = Array.from({ length: 30 }, (_, i) => ({
			app_id: i + 1, name: `Product ${i}`, price: { amount_minor: 100 * (i + 1), currency: "EGP" }, stock: 2, available: true,
		}));
		const res = await SELF.fetch(`${BASE}/api/v1/products/sync`, {
			method: "POST", headers: authHeaders(r), body: JSON.stringify({ products }),
		});
		expect(res.status).toBe(200);
		expect((await res.json() as { products: unknown[] }).products).toHaveLength(30);
	});

	it("uses stock revisions so stale mirrors cannot overwrite newer inventory", async () => {
		const r = await registerStore();
		await SELF.fetch(`${BASE}/api/v1/products/sync`, {
			method: "POST", headers: authHeaders(r),
			body: JSON.stringify({ products: [{ app_id: 1, name: "Water", price: { amount_minor: 500, currency: "EGP" }, stock: 10, available: true }] }),
		});
		const seller = await env.orderak_db.prepare("SELECT id FROM sellers WHERE phone=?").bind(r.phone).first<{ id: string }>();
		await env.orderak_db.prepare("UPDATE products SET stock=7,stock_version=1 WHERE store_id=? AND app_id=1").bind(seller!.id).run();

		const passive = await SELF.fetch(`${BASE}/api/v1/products/sync`, {
			method: "POST", headers: authHeaders(r),
			body: JSON.stringify({ products: [{ app_id: 1, name: "Water", price: { amount_minor: 500, currency: "EGP" }, stock: 99, available: true, stock_dirty: false, expected_stock_version: 0 }] }),
		});
		expect(passive.status).toBe(200);
		expect(await env.orderak_db.prepare("SELECT stock FROM products WHERE store_id=? AND app_id=1").bind(seller!.id).first()).toMatchObject({ stock: 7 });

		const stale = await SELF.fetch(`${BASE}/api/v1/products/sync`, {
			method: "POST", headers: authHeaders(r),
			body: JSON.stringify({ products: [{ app_id: 1, name: "Water", price: { amount_minor: 500, currency: "EGP" }, stock: 99, available: true, stock_dirty: true, expected_stock_version: 0 }] }),
		});
		expect(stale.status).toBe(409);
		expect(await stale.json()).toMatchObject({ code: "stale_stock", conflicts: [1] });
		expect(await env.orderak_db.prepare("SELECT stock,stock_version FROM products WHERE store_id=? AND app_id=1").bind(seller!.id).first()).toMatchObject({ stock: 7, stock_version: 1 });
	});

	it("rejects a product sync above the free-plan limit", async () => {
		const r = await registerStore();
		const products = Array.from({ length: 21 }, (_, i) => ({ app_id: i + 1, name: `Product ${i}`, stock: 1 }));
		const res = await SELF.fetch(`${BASE}/api/v1/products/sync`, {
			method: "POST", headers: authHeaders(r), body: JSON.stringify({ products }),
		});
		expect(res.status).toBe(409);
		expect(await res.json()).toMatchObject({ code: "plan_limit_reached", limit_key: "max_products", limit: 20 });
	});

	it("bulk-upserts and mirrors a paid 2 product catalog", async () => {
		const r = await registerStore();
		const seller = await env.orderak_db.prepare("SELECT id FROM sellers WHERE phone=?").bind(r.phone).first<{ id: string }>();
		await env.orderak_db.batch([
			env.orderak_db.prepare(`INSERT INTO plans(id,name,max_products,max_categories,max_orders_per_month,max_ai_requests_per_month)
			 VALUES('bulk-plan','Paid 2',2000,100,5000,1000)`),
			env.orderak_db.prepare("INSERT INTO subscriptions(seller_id,plan_id,status) VALUES(?,'bulk-plan','active')").bind(seller?.id),
		]);
		const products = Array.from({ length: 200 }, (_, index) => ({
			app_id: index + 1,
			name: `Product ${index + 1}`,
			price: { amount_minor: 100 + index, currency: "EGP" },
			stock: 1,
			available: true,
		}));
		const first = await SELF.fetch(`${BASE}/api/v1/products/sync`, {
			method: "POST", headers: authHeaders(r), body: JSON.stringify({ products }),
		});
		expect(first.status).toBe(200);
		expect((await first.json()) as { count: number }).toMatchObject({ count: 200 });
		const second = await SELF.fetch(`${BASE}/api/v1/products/sync`, {
			method: "POST", headers: authHeaders(r), body: JSON.stringify({ products: products.slice(0, 150) }),
		});
		expect(second.status).toBe(200);
		expect((await env.orderak_db.prepare("SELECT COUNT(*) AS count FROM products WHERE store_id=?").bind(seller?.id).first<{ count: number }>())?.count).toBe(150);
	});

	it("allows a downgraded seller to edit or reduce an over-limit catalog but blocks growth", async () => {
		const r = await registerStore();
		const seller = await env.orderak_db.prepare("SELECT id FROM sellers WHERE phone=?").bind(r.phone).first<{ id: string }>();
		await env.orderak_db.batch([
			env.orderak_db.prepare(`INSERT INTO plans(id,name,max_products,max_categories,max_orders_per_month,max_ai_requests_per_month)
				 VALUES('downgrade-plan','Downgraded',25,100,5000,1000)`),
			env.orderak_db.prepare("INSERT INTO subscriptions(seller_id,plan_id,status) VALUES(?,'downgrade-plan','active')").bind(seller?.id),
		]);
		const products = Array.from({ length: 25 }, (_, index) => ({
			app_id: index + 1,
			name: `Product ${index + 1}`,
			price: { amount_minor: 100, currency: "EGP" },
			stock: 1,
			available: true,
		}));
		expect((await SELF.fetch(`${BASE}/api/v1/products/sync`, {
			method: "POST", headers: authHeaders(r), body: JSON.stringify({ products }),
		})).status).toBe(200);

		await env.orderak_db.prepare("UPDATE plans SET max_products=20 WHERE id='downgrade-plan'").run();
		const edited = products.map((product) => ({ ...product, stock: 2 }));
		expect((await SELF.fetch(`${BASE}/api/v1/products/sync`, {
			method: "POST", headers: authHeaders(r), body: JSON.stringify({ products: edited }),
		})).status).toBe(200);

		expect((await SELF.fetch(`${BASE}/api/v1/products/sync`, {
			method: "POST", headers: authHeaders(r), body: JSON.stringify({ products: edited.slice(0, 24) }),
		})).status).toBe(200);
		const growth = await SELF.fetch(`${BASE}/api/v1/products/sync`, {
			method: "POST", headers: authHeaders(r), body: JSON.stringify({ products: edited }),
		});
		expect(growth.status).toBe(409);
		expect(await growth.json()).toMatchObject({ code: "plan_limit_reached", limit: 20, used: 24 });
	});
});
