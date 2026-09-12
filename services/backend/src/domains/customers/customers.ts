import { jsonResponse } from "../../platform/http/shared";
import { normalizeBuyerPhone, isPrivacySentinel } from "../identity/phone";
import { EDITABLE_CUSTOMER_PROFILES, entitlementAllows } from "../commerce/entitlements";

/**
 * Customers a seller can edit.
 *
 * A buyer used to be two denormalised columns on `orders`, aggregated on the
 * device into a list with nothing to press. The catalogue sold "editable
 * customer profiles" at paid1 while the app had nowhere to put an edit — the
 * finding that put the behaviour axis into the evidence verifier. This is the
 * row that edit goes into.
 *
 * Identity is `store_id` + the canonically normalised phone (I-6). What that
 * normalisation cannot resolve is preserved and flagged rather than guessed at;
 * see phone.ts for why three outcomes and not two.
 */

type Row = Record<string, unknown>;

export interface CustomerRecord {
	customer_key: string;
	phone_e164: string | null;
	phone_raw: string;
	phone_status: string;
	name: string | null;
	alt_contact: string | null;
	note: string | null;
	orders_count: number;
	total_minor: number;
	last_order_at: string | null;
	created_at: string;
	updated_at: string;
}

const MAX_NAME = 120;
const MAX_ALT_CONTACT = 120;
const MAX_NOTE = 2000;

function text(value: unknown, max: number): string | null {
	if (value === null) return null;
	if (typeof value !== "string") return null;
	const trimmed = value.trim();
	return trimmed === "" ? null : trimmed.slice(0, max);
}

/**
 * Record the customer behind an order, without overwriting what a seller wrote.
 *
 * Called from the order path so a customer exists the moment their first order
 * does, rather than appearing only after a backfill. `name` is filled in from
 * the order when the row has none — a seller who has typed a name has said
 * something the storefront's checkout field has not, and an order arriving must
 * not quietly replace it.
 */
export async function recordCustomerFromOrder(
	env: Env,
	storeId: string,
	buyerPhone: string,
	buyerName: string | null,
	region: string | null,
): Promise<void> {
	// A privacy sentinel is not a customer. Creating a row for `deleted:<hash>`
	// would rebuild a record of the person whose record was just erased.
	if (isPrivacySentinel(buyerPhone)) return;

	const normalized = normalizeBuyerPhone(buyerPhone, region);
	if (normalized.outcome === "sentinel") return;

	const name = text(buyerName, MAX_NAME);
	await env.orderak_db.prepare(
		`INSERT INTO customers (store_id, customer_key, phone_e164, phone_raw, phone_status, name)
		 VALUES (?, ?, ?, ?, ?, ?)
		 ON CONFLICT(store_id, customer_key) DO UPDATE SET
		   name = COALESCE(customers.name, excluded.name),
		   updated_at = datetime('now')`,
	).bind(
		storeId,
		normalized.key,
		normalized.e164,
		normalized.raw,
		normalized.outcome === "valid" ? "valid" : normalized.outcome,
		name,
	).run();
}

/**
 * The seller's customers, with the order totals the list shows.
 *
 * Totals are computed from `orders` rather than stored on the row: a stored
 * counter is a second source of truth for something the orders table already
 * knows exactly, and the two would drift on the first cancellation.
 *
 * The join is on `phone_raw`, because that is what the order carries. A
 * customer whose orders arrived under two different spellings therefore needs a
 * row per spelling until the backfill merges them — which it does only for
 * values it could resolve.
 */
export async function listCustomers(env: Env, storeId: string): Promise<CustomerRecord[]> {
	const { results } = await env.orderak_db.prepare(
		`SELECT c.customer_key, c.phone_e164, c.phone_raw, c.phone_status,
		        c.name, c.alt_contact, c.note, c.created_at, c.updated_at,
		        COALESCE(o.orders_count, 0) AS orders_count,
		        COALESCE(o.total_minor, 0) AS total_minor,
		        o.last_order_at
		   FROM customers c
		   LEFT JOIN (
		     SELECT store_id, buyer_phone,
		            COUNT(*) AS orders_count,
		            SUM(total_minor) AS total_minor,
		            MAX(created_at) AS last_order_at
		       FROM orders
		      WHERE store_id = ?
		      GROUP BY store_id, buyer_phone
		   ) o ON o.store_id = c.store_id AND o.buyer_phone = c.phone_raw
		  WHERE c.store_id = ?
		  ORDER BY o.last_order_at DESC NULLS LAST, c.updated_at DESC`,
	).bind(storeId, storeId).all<Row>();

	return (results ?? []).map(toRecord);
}

export async function getCustomer(env: Env, storeId: string, key: string): Promise<CustomerRecord | null> {
	const rows = await listCustomers(env, storeId);
	return rows.find((row) => row.customer_key === key) ?? null;
}

function toRecord(row: Row): CustomerRecord {
	return {
		customer_key: String(row.customer_key),
		phone_e164: row.phone_e164 == null ? null : String(row.phone_e164),
		phone_raw: String(row.phone_raw),
		phone_status: String(row.phone_status),
		name: row.name == null ? null : String(row.name),
		alt_contact: row.alt_contact == null ? null : String(row.alt_contact),
		note: row.note == null ? null : String(row.note),
		orders_count: Number(row.orders_count ?? 0),
		total_minor: Number(row.total_minor ?? 0),
		last_order_at: row.last_order_at == null ? null : String(row.last_order_at),
		created_at: String(row.created_at),
		updated_at: String(row.updated_at),
	};
}

/**
 * Apply a seller's edit.
 *
 * The phone is not editable and is not accepted here. It is the identity: an
 * edit that changed it would silently be a different customer, taking the order
 * history with it and leaving no way to tell that had happened. Correcting a
 * mistyped number is a different operation from editing a customer, and the app
 * does not offer it rather than offering it wrongly.
 */
export async function updateCustomer(
	env: Env,
	storeId: string,
	key: string,
	body: Row,
): Promise<Response> {
	// The plan boundary, checked here rather than only on the device.
	//
	// The catalogue has sold editable customer profiles as a paid feature since
	// migration 025 — `customers_crm.editable_customer_profiles` is in
	// LEGACY_PAID_ONLY_KEYS — and the app gates the editor on it. The API did
	// not, so a free-plan seller could not reach the edit through the app and
	// could reach it through the API, which is the wrong way round for a rule a
	// plan is sold on. CustomerDetailsScreen's own comment asserted "the server
	// is the authority on whether an edit is accepted"; this is what makes that
	// sentence true rather than aspirational.
	//
	// Before the read and before the field validation, so a seller without the
	// entitlement is told about the plan rather than about their payload — and
	// so the refusal cannot be used to probe which customer keys exist.
	if (!(await entitlementAllows(env, storeId, EDITABLE_CUSTOMER_PROFILES))) {
		return jsonResponse({
			error: "plan_feature_unavailable",
			entitlement_key: EDITABLE_CUSTOMER_PROFILES,
			message: "Editing customer details is not included in this plan.",
		}, 403);
	}

	for (const field of ["phone", "phone_e164", "phone_raw", "customer_key", "store_id"]) {
		if (field in body) {
			return jsonResponse({
				error: "phone_not_editable",
				message: "A customer's phone is their identity. Changing it would be a different customer, not an edit.",
			}, 400);
		}
	}

	const existing = await env.orderak_db
		.prepare("SELECT customer_key FROM customers WHERE store_id=? AND customer_key=?")
		.bind(storeId, key)
		.first<Row>();
	if (!existing) return jsonResponse({ error: "not_found" }, 404);

	const hasName = "name" in body;
	const hasAlt = "alt_contact" in body;
	const hasNote = "note" in body;
	if (!hasName && !hasAlt && !hasNote) {
		return jsonResponse({ error: "no_fields", message: "Send at least one of name, alt_contact or note." }, 400);
	}

	await env.orderak_db.prepare(
		`UPDATE customers SET
		   name        = CASE WHEN ?1 THEN ?2 ELSE name END,
		   alt_contact = CASE WHEN ?3 THEN ?4 ELSE alt_contact END,
		   note        = CASE WHEN ?5 THEN ?6 ELSE note END,
		   updated_at  = datetime('now')
		 WHERE store_id = ?7 AND customer_key = ?8`,
	).bind(
		hasName ? 1 : 0, text(body.name, MAX_NAME),
		hasAlt ? 1 : 0, text(body.alt_contact, MAX_ALT_CONTACT),
		hasNote ? 1 : 0, text(body.note, MAX_NOTE),
		storeId, key,
	).run();

	const updated = await getCustomer(env, storeId, key);
	return jsonResponse({ ok: true, customer: updated });
}

/**
 * Seller-scoped customer routes.
 *
 * The store comes from the credential in every case and never from a path
 * parameter or the body — the same rule the rest of the seller API follows, and
 * the one the cross-store isolation suite exists to keep.
 */
export async function handleCustomerRoutes(
	request: Request,
	env: Env,
	url: URL,
	store: Row,
): Promise<Response | null> {
	const path = url.pathname;
	if (!path.startsWith("/api/v1/customers")) return null;
	const storeId = String(store.id);

	if (path === "/api/v1/customers") {
		if (request.method !== "GET") return null;
		return jsonResponse({ ok: true, customers: await listCustomers(env, storeId) });
	}

	const key = decodeURIComponent(path.slice("/api/v1/customers/".length));
	if (!key || key.includes("/")) return null;

	if (request.method === "GET") {
		const customer = await getCustomer(env, storeId, key);
		if (!customer) return jsonResponse({ error: "not_found" }, 404);
		return jsonResponse({ ok: true, customer });
	}
	if (request.method === "PATCH") {
		let body: Row;
		try {
			body = (await request.json()) as Row;
		} catch {
			return jsonResponse({ error: "invalid_json" }, 400);
		}
		if (body === null || typeof body !== "object" || Array.isArray(body)) {
			return jsonResponse({ error: "invalid_json" }, 400);
		}
		return updateCustomer(env, storeId, key, body);
	}
	return null;
}
