// ============================================================
// Account deletion — authenticated request intake + automated fulfillment.
//
//   POST /api/v1/account/deletion-request   (authenticated, in-app)
//   POST /api/admin/v1/process-deletions    (admin-only, trigger)
//
// Daily scheduled() hook calls processDeletionRequests() for zero-touch
// fulfillment of every verified request that has reached its deadline.
//
// See docs/governance/retention-matrix.md §3 and §8 for the full
// deletion sequence and mapping checklist.
// ============================================================

import { getGateway } from "../commerce/payments";

type Row = Record<string, unknown>;

// `handleDeletionRoutes` stood here: a three-parameter exported function that
// used all of none of them and returned null unconditionally, with a comment
// explaining that its routing had moved elsewhere. Nothing in src/, test/ or
// the contracts referenced it. Removed rather than annotated, because a router
// entry point that routes nothing is worse than absent — it invites a future
// caller to wire it up and get silence.
//
// The deletion request path it used to describe is POST
// /api/v1/account/deletion-request, handled in api-store.ts behind the seller
// auth middleware.

// ---- Automated fulfillment -------------------------------------------------

interface DeletionRequest {
	id: string;
	phone_e164: string;
	email: string | null;
	locale: string;
	source: string;
	status: string;
	requested_at: string;
	deadline_at: string;
	verified_at: string | null;
	notes: string | null;
}

/**
 * Requests fetched per query. Fulfilment is almost entirely I/O — an R2 prefix
 * purge, two Firebase calls, one D1 batch — so the page size bounds memory and
 * query cost, not the work the invocation can get through.
 */
const DELETION_PAGE_SIZE = 10;

/**
 * How long one invocation keeps starting new deletions.
 *
 * A scheduled Worker gets fifteen minutes of wall clock. Stopping at ten leaves
 * room for the request in flight to finish and for the backlog signal below to
 * be written, rather than being cut off mid-fulfilment.
 */
const DELETION_TIME_BUDGET_MS = 10 * 60 * 1000;

export async function processDeletionRequests(env: Env): Promise<number> {
	// This used to run one page of ten and stop, once a day. An eleventh request
	// coming due on the same day was not deferred to the next run — it was
	// deferred behind every request that came due after it, because the query
	// orders by deadline and the oldest ten always win. A backlog built silently
	// against a 90-day legal deadline, and nothing anywhere reported it.
	//
	// Now it works through the queue until the queue is empty or the invocation
	// runs out of time, and says so when it stops early.
	const startedAt = Date.now();
	let completed = 0;
	let failed = 0;

	for (;;) {
		let rows: Row[];
		try {
			const { results } = await env.orderak_db
				.prepare(
					`SELECT * FROM deletion_requests
					 WHERE status = 'verified' AND deadline_at <= datetime('now')
					 ORDER BY deadline_at ASC
					 LIMIT ?`,
				)
				.bind(DELETION_PAGE_SIZE)
				.all() as { results: Row[] };
			rows = results ?? [];
		} catch (e) {
			console.error("[deletion] Failed to fetch deletion requests:", e);
			throw e;
		}
		if (!rows.length) break;

		// A request that fails fulfilment keeps status='verified', so it is
		// returned by the next query too. Without this the loop would re-attempt
		// the same failing request forever inside one invocation; tracking how
		// many failed in this pass and stopping when a whole page did lets the
		// working requests through and leaves the rest for the next run.
		let progressed = false;
		for (const row of rows) {
			if (Date.now() - startedAt > DELETION_TIME_BUDGET_MS) break;
			const req = row as unknown as DeletionRequest;
			try {
				await fulfillDeletion(env, req);
				completed += 1;
				progressed = true;
			} catch (e) {
				failed += 1;
				console.error("[deletion] Fulfillment failed for request %s:", req.id, e);
			}
		}
		if (!progressed || Date.now() - startedAt > DELETION_TIME_BUDGET_MS) break;
	}

	// Whatever is still due when this returns is a backlog against a statutory
	// deadline, which is exactly the thing that must not be invisible.
	const remaining = await env.orderak_db
		.prepare("SELECT COUNT(*) AS c FROM deletion_requests WHERE status='verified' AND deadline_at <= datetime('now')")
		.first<{ c: number }>()
		.catch(() => null);
	if (Number(remaining?.c ?? 0) > 0) {
		console.error(JSON.stringify({
			signal: "deletion_backlog",
			remaining: Number(remaining?.c ?? 0),
			completed,
			failed,
		}));
	}
	return completed;
}

// ---- Single-request fulfilment (idempotent) ---------------------------------

async function fulfillDeletion(env: Env, req: DeletionRequest): Promise<void> {
	console.log(`[deletion] Fulfilling request ${req.id}.`);

	// Re-read to guard against concurrent processing.
	const current = (await env.orderak_db
		.prepare("SELECT status FROM deletion_requests WHERE id = ?")
		.bind(req.id)
		.first()) as { status: string } | null;
	if (!current || current.status !== "verified") {
		console.log(`[deletion] ${req.id} already processed (status=${current?.status ?? "missing"}), skipping.`);
		return;
	}

	const seller = (await env.orderak_db
		.prepare("SELECT id, firebase_uid FROM sellers WHERE phone = ?")
		.bind(req.phone_e164)
		.first()) as Row | null;

	const sellerId = seller ? String(seller.id) : null;
	const sellerUuid = sellerId;

	// 1. Cancel external subscriptions. A provider failure must keep the request
	// open: completion is recorded only after every mandatory external cleanup.
	if (sellerId && env.BILLING_ENABLED === "true") {
		const gateway = getGateway(env);
		const subscriptionIds = await listCancelableGatewaySubscriptionIds(env, sellerId);
		for (const subscriptionId of subscriptionIds) {
			await gateway.cancelSubscription(subscriptionId);
		}
	}

	// 2. Delete R2 objects under stores/{uuid}/ (product images, logos, covers,
	//    and any digital product files).
	if (sellerUuid) {
		const prefix = `stores/${sellerUuid}/`;
		let truncated = false;
		let cursor: string | undefined;
		do {
			const list = await env.orderak_media.list({ prefix, cursor, limit: 500 }) as { objects: { key: string }[]; truncated: boolean; cursor?: string };
			const keys = list.objects.map((o: { key: string }) => o.key);
			if (keys.length) await env.orderak_media.delete(keys);
			truncated = list.truncated;
			cursor = list.cursor ?? undefined;
		} while (truncated);
		const remaining = await env.orderak_media.list({ prefix, limit: 1 });
		if (remaining.objects.length) throw new Error("deletion_r2_verification_failed");
	}

	// 3. Remove the Firebase identity while the UID/phone mapping is still
	// available. The operation treats an already-absent user as success, making
	// retries safe, but missing admin credentials fail closed.
	if (sellerId) await deleteFirebaseIdentity(env, String(seller?.firebase_uid ?? ""), req.phone_e164);

	// 4. D1 cleanup transaction.
	const stmts: D1PreparedStatement[] = [];

	if (sellerUuid) {
		const sId = sellerUuid;
		const deidPhone = `deleted:${req.id}`;

		// --- Ads ---
		// Note: ads are system-wide (no seller_id column). We delete the
		// seller's ad_impressions only. Seller-scoped ads would require a
		// separate seller_ads table; if that is added later, deactivate here.
		stmts.push(env.orderak_db.prepare("DELETE FROM ad_impressions WHERE seller_id = ?").bind(sId));

		// --- Orders ---
		stmts.push(
			env.orderak_db
				.prepare(
					`DELETE FROM order_items WHERE order_id IN
					 (SELECT id FROM orders WHERE store_id = ?)`,
				)
				.bind(sId),
		);
		stmts.push(env.orderak_db.prepare("DELETE FROM orders WHERE store_id = ?").bind(sId));

		// --- Product catalog (children before parents) ---
		stmts.push(
			env.orderak_db
				.prepare(
					`DELETE FROM product_translations WHERE product_id IN
					 (SELECT id FROM products WHERE store_id = ?)`,
				)
				.bind(sId),
		);
		// TODO: When product_variants table exists, delete before products:
		//   stmts.push(env.orderak_db.prepare(
		//     "DELETE FROM product_variants WHERE product_id IN (SELECT id FROM products WHERE store_id = ?)"
		//   ).bind(sId));
		// TODO: When product_media table exists, delete before products:
		//   stmts.push(env.orderak_db.prepare(
		//     "DELETE FROM product_media WHERE product_id IN (SELECT id FROM products WHERE store_id = ?)"
		//   ).bind(sId));
		stmts.push(env.orderak_db.prepare("DELETE FROM products WHERE store_id = ?").bind(sId));
		stmts.push(env.orderak_db.prepare("DELETE FROM categories WHERE store_id = ?").bind(sId));

		// --- Coupons & referrals ---
		// Note: coupons table is system-wide (no seller_id). Only coupon_uses
		// is per-seller.
		stmts.push(env.orderak_db.prepare("DELETE FROM coupon_uses WHERE seller_id = ?").bind(sId));
		stmts.push(
			env.orderak_db
				.prepare("DELETE FROM referrals WHERE referrer_id = ? OR referred_id = ?")
				.bind(sId, sId),
		);

		// --- Support ---
		stmts.push(env.orderak_db.prepare("DELETE FROM support_tickets WHERE seller_id = ?").bind(sId));
		stmts.push(env.orderak_db.prepare("DELETE FROM announcement_reads WHERE seller_id = ?").bind(sId));

		// --- Devices ---
		stmts.push(env.orderak_db.prepare("DELETE FROM seller_devices WHERE seller_id = ?").bind(sId));
		stmts.push(env.orderak_db.prepare("DELETE FROM passkey_credentials WHERE seller_id = ?").bind(sId));
		stmts.push(env.orderak_db.prepare("DELETE FROM webauthn_challenges WHERE seller_id = ?").bind(sId));
		stmts.push(env.orderak_db.prepare("DELETE FROM recent_auth_proofs WHERE seller_id = ?").bind(sId));
		stmts.push(env.orderak_db.prepare("DELETE FROM email_verification_tokens WHERE seller_id = ?").bind(sId));
		stmts.push(env.orderak_db.prepare("DELETE FROM seller_profiles WHERE seller_id = ?").bind(sId));
		stmts.push(env.orderak_db.prepare("DELETE FROM seller_auth_identities WHERE seller_id = ?").bind(sId));
		stmts.push(
			env.orderak_db.prepare(
				"DELETE FROM onboarding_sessions WHERE completed_seller_id = ? OR phone_e164 = ?",
			).bind(sId, req.phone_e164),
		);

		// --- Billing: scrub identifiers, cancel subscriptions ---
		stmts.push(
			env.orderak_db
				.prepare(
					"UPDATE payment_events SET seller_id = NULL, raw_json = NULL WHERE seller_id = ?",
				)
				.bind(sId),
		);
		stmts.push(
			env.orderak_db
				.prepare(
					"UPDATE subscriptions SET status = 'canceled', updated_at = datetime('now') WHERE seller_id = ?",
				)
				.bind(sId),
		);
		// TODO: When seller_bank_accounts table exists:
		//   stmts.push(env.orderak_db.prepare(
		//     "DELETE FROM seller_bank_accounts WHERE seller_id = ?"
		//   ).bind(sId));

		// --- Seller row: de-identify instead of deleting ---
		// store_code, referral_code, and status must be retained (de-identified)
		// for 5 years per docs/governance/retention-matrix.md §1.1.
		// The phone UNIQUE constraint is preserved by using a unique
		// deleted:<request-id> value.
		stmts.push(
			env.orderak_db
				.prepare(
					`UPDATE sellers SET
					   phone = ?,
					   store_name = '',
					   slug = NULL,
					   public_identifier = NULL,
					   firebase_uid = NULL,
					   instapay = NULL,
					   vfcash = NULL,
					   secret = NULL,
					   description = NULL,
					   whatsapp = NULL,
					   email = NULL,
					   website = NULL,
					   address = NULL,
					   logo_url = NULL,
					   cover_url = NULL,
					   business_category = NULL,
					   business_category_id = NULL,
					   business_subcategory_id = NULL,
					   business_taxonomy_version = NULL,
					   city_geoname_id = NULL,
					   city_catalog_id = NULL,
					   city_catalog_version = NULL,
					   city_name = NULL,
					   referral_code = ?,
					   store_code = ?,
					   status = 'deleted',
					   updated_at = datetime('now')
					 WHERE id = ?`,
				)
				.bind(deidPhone, deidPhone, deidPhone, sId),
		);
	}

	// --- Legal: de-identify consent records ---
	//
	// Keyed on the PHONE, and deliberately outside the `if (sellerUuid)` block
	// above. It used to be inside it and scoped `WHERE seller_id = ?`, which
	// missed the rows that matter most:
	//
	//   * Acceptances recorded before registration completed. api-store.ts
	//     claims them with `UPDATE ... SET seller_id=? WHERE phone_e164=? AND
	//     seller_id IS NULL` once an account exists, so a signup that was
	//     abandoned between "accepted the terms" and "created the store" leaves
	//     a row with seller_id NULL — holding a phone number, unreachable by a
	//     seller-scoped update, and with no other deletion path anywhere.
	//
	//   * Every acceptance for a phone with no seller row at all, because the
	//     whole block was skipped in that case.
	//
	// docs/governance/retention-matrix.md §2 promises `phone_e164` is replaced
	// with `deleted:<request-id>` on deletion. Matching on the phone is what
	// makes that true for every row rather than for the linked subset.
	//
	// legal_acceptances.ip_address does not exist. The retention matrix used to
	// list it alongside phone_e164 and a TODO here promised to null it "when the
	// column is added"; no migration has ever created it, so the promise was to
	// scrub a field that holds nothing. The matrix has been corrected instead.
	stmts.push(
		env.orderak_db
			.prepare(
				"UPDATE legal_acceptances SET seller_id = NULL, phone_e164 = ? WHERE phone_e164 = ? OR seller_id = ?",
			)
			.bind(`deleted:${req.id}`, req.phone_e164, sellerUuid),
	);

	// Update the deletion request itself: de-identify phone/email, mark completed.
	stmts.push(
		env.orderak_db
			.prepare(
				`UPDATE deletion_requests
				 SET status = 'completed',
				     completed_at = datetime('now'),
				     email = NULL,
				     phone_e164 = ?,
				     notes = ?
				 WHERE id = ?`,
			)
			.bind(
				`deleted:${req.id}`,
				sellerId ? "Automated fulfillment completed." : "Seller record already absent; cleaned up remaining data.",
				req.id,
			),
	);

	try {
		await env.orderak_db.batch(stmts);
	} catch (e) {
		console.error("[deletion] D1 batch failed for request %s:", req.id, e);
		throw e;
	}

	console.log(`[deletion] Completed ${req.id}.`);
}

/**
 * Retry one verified, deadline-due request from the owner operations console.
 * This deliberately reuses the same guarded fulfilment path as the scheduler;
 * it never moves a pending request to verified and never bypasses the deadline.
 */
export async function retryDeletionRequest(env: Env, id: string): Promise<"completed" | "not_due" | "not_found"> {
	const row = await env.orderak_db.prepare(
		"SELECT * FROM deletion_requests WHERE id=?",
	).bind(id).first<Row>();
	if (!row) return "not_found";
	if (row.status !== "verified" || String(row.deadline_at) > new Date().toISOString().replace("T", " ").slice(0, 19)) {
		return "not_due";
	}
	await fulfillDeletion(env, row as unknown as DeletionRequest);
	const after = await env.orderak_db.prepare("SELECT status FROM deletion_requests WHERE id=?").bind(id).first<{ status: string }>();
	return after?.status === "completed" ? "completed" : "not_due";
}

function b64url(bytes: Uint8Array): string {
	let binary = "";
	for (const byte of bytes) binary += String.fromCharCode(byte);
	return btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/g, "");
}

function pemBytes(pem: string): ArrayBuffer {
	const normalized = pem.replaceAll("\\n", "\n").replace(/-----[^-]+-----/g, "").replace(/\s/g, "");
	return Uint8Array.from(atob(normalized), (char) => char.charCodeAt(0)).buffer;
}

/**
 * Firebase admin credentials are bound on the PUBLIC Worker only.
 * FIREBASE_PROJECT_ID is not present in wrangler.admin.jsonc, yet the admin
 * operations runner invokes processDeletionRequests() for
 * POST /api/admin/v1/operations/jobs/deletions/run. Typing it optional states
 * that plainly instead of implying a binding that may not be there.
 *
 * The absence is handled, not ignored: firebaseAdminToken() throws
 * firebase_admin_credentials_missing before any D1 cleanup runs, so an
 * admin-triggered deletion fails closed rather than removing local data while
 * leaving the Firebase identity alive. Making that job work from the admin
 * Worker requires binding the Firebase credentials there.
 */
type FirebaseAdminEnv = Env & { FIREBASE_PROJECT_ID?: string };

async function firebaseAdminToken(env: FirebaseAdminEnv): Promise<string> {
	if (!env.FIREBASE_PROJECT_ID || !env.FIREBASE_SERVICE_ACCOUNT_EMAIL || !env.FIREBASE_SERVICE_ACCOUNT_PRIVATE_KEY) {
		throw new Error("firebase_admin_credentials_missing");
	}
	const now = Math.floor(Date.now() / 1000);
	const encode = (value: object) => b64url(new TextEncoder().encode(JSON.stringify(value)));
	const header = encode({ alg: "RS256", typ: "JWT" });
	const claim = encode({
		iss: env.FIREBASE_SERVICE_ACCOUNT_EMAIL,
		scope: "https://www.googleapis.com/auth/identitytoolkit",
		aud: "https://oauth2.googleapis.com/token",
		iat: now,
		exp: now + 3600,
	});
	const key = await crypto.subtle.importKey(
		"pkcs8",
		pemBytes(env.FIREBASE_SERVICE_ACCOUNT_PRIVATE_KEY),
		{ name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
		false,
		["sign"],
	);
	const unsigned = `${header}.${claim}`;
	const signature = await crypto.subtle.sign("RSASSA-PKCS1-v1_5", key, new TextEncoder().encode(unsigned));
	const response = await fetch("https://oauth2.googleapis.com/token", {
		method: "POST",
		headers: { "content-type": "application/x-www-form-urlencoded" },
		body: new URLSearchParams({
			grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
			assertion: `${unsigned}.${b64url(new Uint8Array(signature))}`,
		}),
	});
	if (!response.ok) throw new Error(`firebase_oauth_${response.status}`);
	const body = await response.json<{ access_token?: string }>();
	if (!body.access_token) throw new Error("firebase_oauth_missing_token");
	return body.access_token;
}

async function deleteFirebaseIdentity(env: FirebaseAdminEnv, knownUid: string, phone: string): Promise<void> {
	const token = await firebaseAdminToken(env);
	const base = `https://identitytoolkit.googleapis.com/v1/projects/${encodeURIComponent(env.FIREBASE_PROJECT_ID!)}`;
	let uid = knownUid;
	if (!uid) {
		const lookup = await fetch(`${base}/accounts:lookup`, {
			method: "POST",
			headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
			body: JSON.stringify({ phoneNumber: [phone] }),
		});
		if (!lookup.ok) throw new Error(`firebase_lookup_${lookup.status}`);
		const body = await lookup.json<{ users?: { localId?: string }[] }>();
		uid = String(body.users?.[0]?.localId ?? "");
		if (!uid) return;
	}
	const deletion = await fetch(`${base}/accounts:delete`, {
		method: "POST",
		headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
		body: JSON.stringify({ localId: uid }),
	});
	if (!deletion.ok) throw new Error(`firebase_delete_${deletion.status}`);
}

async function listCancelableGatewaySubscriptionIds(env: Env, sellerId: string): Promise<string[]> {
	try {
		const { results } = (await env.orderak_db
			.prepare(
				`SELECT gateway_sub_id FROM subscriptions
				 WHERE seller_id = ? AND status IN ('active', 'pending', 'past_due')
				   AND gateway_sub_id IS NOT NULL
				 ORDER BY id DESC`,
			)
			.bind(sellerId)
			.all()) as { results: Array<{ gateway_sub_id: string | null }> };
		return (results ?? [])
			.map((row) => String(row.gateway_sub_id ?? "").trim())
			.filter((value) => value.length > 0);
	} catch (error) {
		const message = String((error as { message?: string })?.message ?? error);
		if (message.includes("no such column: gateway_sub_id")) {
			console.warn("[deletion] subscriptions.gateway_sub_id is unavailable; skipping gateway cancellation.");
			return [];
		}
		throw error;
	}
}
