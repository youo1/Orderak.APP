import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { SELF, BASE, env, createSchema, registerStore, authHeaders, type Registered } from "./helpers";
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

/**
 * Remove a store's organization entirely, dependents first.
 *
 * The foundation statements create four rows together — the organization, the
 * store membership, the owner member and the routing row — and three of them
 * carry a foreign key to the first. Deleting the organization alone fails the
 * constraint, which is itself worth knowing: the "missing organization" state
 * these tests reproduce is one the schema actively prevents from occurring by
 * halves.
 */
async function detachOrganization(storeId: string): Promise<void> {
	const org = await env.orderak_db.prepare("SELECT organization_id FROM organization_stores WHERE store_id=?")
		.bind(storeId).first<{ organization_id: string }>();
	if (!org) return;
	for (const sql of [
		"DELETE FROM organization_members WHERE organization_id=?",
		"DELETE FROM organization_routing WHERE organization_id=?",
		"DELETE FROM organization_subscriptions WHERE organization_id=?",
		"DELETE FROM organization_stores WHERE organization_id=?",
		"DELETE FROM organizations WHERE id=?",
	]) await env.orderak_db.prepare(sql).bind(org.organization_id).run();
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

	it("completes for a seller who has ever opened a support ticket", async () => {
		// The erasure batch deleted support_tickets and never support_messages,
		// whose FOREIGN KEY (ticket_id) REFERENCES support_tickets(id) has no
		// ON DELETE (003_admin.sql:121-128). D1 enforces foreign keys, so the
		// constraint aborted the whole batch — including the statement that marks
		// the request completed. status stayed 'verified', the next run re-selected
		// the same row, and it failed again. Forever: the 90-day statutory deadline
		// could never be met for any seller who had ever contacted support, and the
		// only signal was a deletion_backlog line.
		const r = await registerStore();
		const seller = await env.orderak_db.prepare("SELECT id FROM sellers WHERE phone=?")
			.bind(r.phone).first<{ id: string }>();
		await env.orderak_db.prepare("UPDATE sellers SET firebase_uid='firebase-support-test' WHERE id=?")
			.bind(seller!.id).run();

		const ticket = await env.orderak_db.prepare(
			"INSERT INTO support_tickets(seller_id,subject) VALUES(?,?) RETURNING id",
		).bind(seller!.id, "Cannot upload product photos").first<{ id: number }>();
		await env.orderak_db.prepare(
			"INSERT INTO support_messages(ticket_id,sender,body) VALUES(?,'seller',?)",
		).bind(ticket!.id, "The upload button does nothing on my phone.").run();

		await SELF.fetch(`${BASE}/api/v1/account/deletion-request`, {
			method: "POST", headers: authHeaders(r), body: "{}",
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
			"SELECT status FROM deletion_requests WHERE id=?",
		).bind(deletion!.id).first()).toMatchObject({ status: "completed" });
		// The conversation body is the seller's own words and a support agent's;
		// leaving it behind is the part that makes this a privacy defect and not
		// just a stuck job.
		expect(await env.orderak_db.prepare(
			"SELECT COUNT(*) AS c FROM support_messages WHERE ticket_id=?",
		).bind(ticket!.id).first<{ c: number }>()).toMatchObject({ c: 0 });
		expect(await env.orderak_db.prepare(
			"SELECT COUNT(*) AS c FROM support_tickets WHERE seller_id=?",
		).bind(seller!.id).first<{ c: number }>()).toMatchObject({ c: 0 });
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

	it("keeps the first device signed in when a second device re-registers", async () => {
		// POST /api/v1/register used to rewrite sellers.secret with whatever
		// secret the caller presented. Any authorized device can reach it, so
		// the second phone's own routine sync signed the first phone out —
		// silently, because nothing in the response or the client reports a
		// credential being replaced.
		const first = await registerStore({ secret: "first-device-secret" });
		const seller = await env.orderak_db.prepare("SELECT id FROM sellers WHERE phone=?")
			.bind(first.phone).first<{ id: string }>();
		await env.orderak_db.prepare(
			"INSERT INTO plans(id,name,active,multi_device_enabled) VALUES('free','Free',1,1)",
		).run();
		await env.orderak_db.prepare("INSERT INTO seller_devices(seller_id,secret_hash) VALUES(?,?)")
			.bind(seller!.id, await hashSecret("second-device-secret")).run();
		const secondDevice = { "x-orderak-phone": first.phone, "x-orderak-secret": "second-device-secret" };

		// Exactly what SyncRepository sends on the second device's first sync
		// after a cold start: this account, this device's secret, and a
		// shop-config change to make the re-register fire at all.
		const reRegister = await SELF.fetch(`${BASE}/api/v1/register`, {
			method: "POST",
			headers: { "content-type": "application/json" },
			body: JSON.stringify({
				phone: first.phone,
				secret: "second-device-secret",
				store_name: "Renamed From Second Device",
			}),
		});
		expect(reRegister.status).toBe(200);

		// Both devices still authenticate, and the rename still landed — the
		// write is not being refused, only narrowed.
		expect((await SELF.fetch(`${BASE}/api/v1/store`, { headers: authHeaders(first) })).status).toBe(200);
		expect((await SELF.fetch(`${BASE}/api/v1/store`, { headers: secondDevice })).status).toBe(200);

		const stored = await env.orderak_db.prepare("SELECT secret,store_name FROM sellers WHERE id=?")
			.bind(seller!.id).first<{ secret: string; store_name: string }>();
		expect(stored!.secret).toBe(await hashSecret("first-device-secret"));
		expect(stored!.store_name).toBe("Renamed From Second Device");
	});
});


describe("register applies the fences the credential middleware cannot", () => {
	// /api/v1/register reads its credentials from the BODY, while the account
	// restriction and tenant-write fences live in middleware that engages only
	// on the x-orderak-phone/x-orderak-secret headers. Neither fence had ever
	// run for this route, so a suspended seller could still rename their store,
	// move its slug and public_identifier, and change the payout details the
	// storefront shows to buyers.

	it("refuses a restricted account", async () => {
		const r = await registerStore({ phone: "+201500008001", secret: "restricted-device" });
		await env.orderak_db.prepare("UPDATE sellers SET status='suspended' WHERE phone=?").bind(r.phone).run();

		const res = await SELF.fetch(`${BASE}/api/v1/register`, {
			method: "POST",
			headers: { "content-type": "application/json" },
			body: JSON.stringify({ phone: r.phone, secret: r.secret, store_name: "Renamed While Suspended" }),
		});

		expect(res.status).toBe(403);
		expect((await res.json() as { code: string }).code).toBe("account_restricted");
		const stored = await env.orderak_db.prepare("SELECT store_name FROM sellers WHERE phone=?")
			.bind(r.phone).first<{ store_name: string }>();
		expect(stored!.store_name).not.toBe("Renamed While Suspended");
	});

	it("repairs a missing organization row rather than answering 500", async () => {
		// resolveTenantContextForStore() threw a bare Error for a store with no
		// organization_stores row, and every caller rethrew anything that was not
		// a write fence — so the seller got a 500 on every non-GET request and
		// every buyer of that store got one when ordering. Register is where the
		// row is repaired, so the fence must not block the call that fixes it.
		const r = await registerStore({ phone: "+201500008002", secret: "orphan-device" });
		const seller = await env.orderak_db.prepare("SELECT id FROM sellers WHERE phone=?")
			.bind(r.phone).first<{ id: string }>();
		// The whole organization, not just the membership. Every writer creates
		// the four rows in one batch, so the state a seller can actually be
		// missing is all of it rather than half.
		await detachOrganization(seller!.id);

		const res = await SELF.fetch(`${BASE}/api/v1/register`, {
			method: "POST",
			headers: { "content-type": "application/json" },
			body: JSON.stringify({ phone: r.phone, secret: r.secret, store_name: "Repaired Store" }),
		});

		expect(res.status).toBe(200);
		const repaired = await env.orderak_db.prepare("SELECT organization_id FROM organization_stores WHERE store_id=?")
			.bind(seller!.id).first();
		expect(repaired).toBeTruthy();
	});
});

describe("a store with no organization row", () => {
	it("is refused honestly instead of writing past its limit", async () => {
		// Two fixes meet here, and the order they run in is the point.
		//
		// The category limit counted across the seller's organization, so a NULL
		// organization lookup made the count zero and the limit unenforced. The
		// tenant resolver, separately, threw a bare Error for the same missing
		// row — which every caller rethrew, so the seller got a 500 on every
		// non-GET request.
		//
		// With the resolver typed, the write fence now answers 503 before the
		// insert is reached, so the unbounded path is no longer reachable over
		// HTTP at all. That is the behaviour worth pinning: an honest, retryable
		// refusal, and nothing written. The `c.store_id = ?` floor added to the
		// insert stays as defence in depth for any caller that does not pass
		// through the fence.
		const r = await registerStore({ phone: "+201500008010", secret: "no-org-device" });
		const seller = await env.orderak_db.prepare("SELECT id FROM sellers WHERE phone=?")
			.bind(r.phone).first<{ id: string }>();
		await detachOrganization(seller!.id);

		const blocked = await SELF.fetch(`${BASE}/api/v1/categories`, {
			method: "POST",
			headers: authHeaders(r),
			body: JSON.stringify({ name: "Sixth" }),
		});

		expect(blocked.status).toBe(503);
		expect((await blocked.json() as { code: string }).code).toBe("tenant_unavailable");
		const count = await env.orderak_db.prepare("SELECT COUNT(*) AS c FROM categories WHERE store_id=?")
			.bind(seller!.id).first<{ c: number }>();
		expect(count!.c).toBe(0);
	});
});

