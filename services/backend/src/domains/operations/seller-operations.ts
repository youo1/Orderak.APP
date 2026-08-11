import { authSeller, jsonResponse, methodNotAllowed, readCreds, type AuthenticatedSeller } from "../../platform/http/shared";
import { pickLocale } from "../../platform/localization/i18n";
import { auditDb } from "../admin/admin-auth";

type Row = Record<string, unknown>;
type SellerOperationMethod = "GET" | "POST" | "PUT" | "DELETE";
type SellerOperationMethods = [SellerOperationMethod, ...SellerOperationMethod[]];

function allowedMethodsFor(path: string): SellerOperationMethods | null {
	if (path === "/api/v1/account/status") return ["GET"];
	if (path === "/api/v1/account/deletion-request") return ["GET"];
	if (path === "/api/v1/support/tickets" || /^\/api\/v1\/support\/tickets\/\d+$/.test(path)) return ["GET", "POST"];
	if (path === "/api/v1/announcements") return ["GET"];
	if (/^\/api\/v1\/announcements\/\d+\/read$/.test(path)) return ["POST"];
	if (path === "/api/v1/catalog/translations") return ["GET"];
	if (/^\/api\/v1\/catalog\/translations\/[^/]+\/(?:ar|en)$/.test(path)) return ["PUT", "DELETE"];
	if (path === "/api/v1/devices") return ["GET"];
	if (/^\/api\/v1\/devices\/\d+$/.test(path)) return ["DELETE"];
	return null;
}

async function readBody(request: Request): Promise<Row> {
	return request.json<Row>().catch(() => ({} as Row));
}

async function sellerFor(
	request: Request,
	env: Env,
	url: URL,
	authenticatedSeller?: AuthenticatedSeller | null,
): Promise<Row | null> {
	if (authenticatedSeller !== undefined) return authenticatedSeller;
	const { phone, secret } = readCreds(request, url);
	return authSeller(env, phone, secret);
}

function boundedText(value: unknown, max: number): string {
	return String(value ?? "").trim().slice(0, max);
}

async function auditSellerOperation(
	env: Env,
	request: Request,
	seller: Row,
	action: string,
	details: Row = {},
): Promise<void> {
	await auditDb(env, null, action, { ...details, actor_type: "seller", actor_id: seller.id }, request);
}

export async function handleSellerOperationRoutes(
	request: Request,
	env: Env,
	url: URL,
	authenticatedSeller?: AuthenticatedSeller | null,
): Promise<Response | null> {
	const path = url.pathname;
	const method = request.method;
	// POST intake remains owned by api-store.ts, which already enforces the
	// protected deletion contract. This module adds the read-only status route.
	if (path === "/api/v1/account/deletion-request" && method !== "GET") return null;

	const allowedMethods = allowedMethodsFor(path);
	if (!allowedMethods) return null;

	const seller = await sellerFor(request, env, url, authenticatedSeller);
	if (!seller) return jsonResponse({ error: "auth" }, 401);

	if (path === "/api/v1/account/status" && method === "GET") {
		return jsonResponse({ ok: true, status: seller.status ?? "active" });
	}

	if (path === "/api/v1/account/deletion-request" && method === "GET") {
		const row = await env.orderak_db.prepare(
			`SELECT id,status,source,requested_at,deadline_at,verified_at,completed_at,notes
			 FROM deletion_requests WHERE phone_e164=? ORDER BY requested_at DESC LIMIT 1`,
		).bind(seller.phone).first();
		return jsonResponse({ ok: true, request: row ?? null });
	}

	if (path === "/api/v1/support/tickets" && method === "GET") {
		const { results } = await env.orderak_db.prepare(
			`SELECT id,subject,status,priority,created_at,updated_at,
			 (SELECT body FROM support_messages WHERE ticket_id=support_tickets.id ORDER BY id DESC LIMIT 1) AS last_message
			 FROM support_tickets WHERE seller_id=? ORDER BY updated_at DESC LIMIT 100`,
		).bind(seller.id).all();
		return jsonResponse({ ok: true, tickets: results ?? [] });
	}

	if (path === "/api/v1/support/tickets" && method === "POST") {
		const body = await readBody(request);
		const subject = boundedText(body.subject, 120);
		const message = boundedText(body.message, 4000);
		if (!subject || !message) return jsonResponse({ error: "subject_and_message_required" }, 400);
		const ticket = await env.orderak_db.prepare(
			"INSERT INTO support_tickets(seller_id,subject) VALUES(?,?) RETURNING id,subject,status,priority,created_at,updated_at",
		).bind(seller.id, subject).first<Row>();
		await env.orderak_db.prepare(
			"INSERT INTO support_messages(ticket_id,sender,body) VALUES(?,'seller',?)",
		).bind(ticket?.id, message).run();
		await auditSellerOperation(env, request, seller, "support.ticket_created", { entity: "support_ticket", entity_id: ticket?.id });
		return jsonResponse({ ok: true, ticket }, 201);
	}

	const ticketMatch = path.match(/^\/api\/v1\/support\/tickets\/(\d+)$/);
	if (ticketMatch) {
		const ticketId = Number(ticketMatch[1]);
		const ticket = await env.orderak_db.prepare(
			"SELECT id,subject,status,priority,created_at,updated_at FROM support_tickets WHERE id=? AND seller_id=?",
		).bind(ticketId, seller.id).first<Row>();
		if (!ticket) return jsonResponse({ error: "not_found" }, 404);
		if (method === "GET") {
			const { results } = await env.orderak_db.prepare(
				"SELECT id,sender,body,created_at FROM support_messages WHERE ticket_id=? ORDER BY id",
			).bind(ticketId).all();
			return jsonResponse({ ok: true, ticket, messages: results ?? [] });
		}
		if (method === "POST") {
			if (ticket.status === "closed") return jsonResponse({ error: "ticket_closed" }, 409);
			const body = await readBody(request);
			const message = boundedText(body.message, 4000);
			if (!message) return jsonResponse({ error: "message_required" }, 400);
			await env.orderak_db.batch([
				env.orderak_db.prepare("INSERT INTO support_messages(ticket_id,sender,body) VALUES(?,'seller',?)").bind(ticketId, message),
				env.orderak_db.prepare("UPDATE support_tickets SET status='open',updated_at=datetime('now') WHERE id=?").bind(ticketId),
			]);
			await auditSellerOperation(env, request, seller, "support.response_added", { entity: "support_ticket", entity_id: ticketId });
			return jsonResponse({ ok: true }, 201);
		}
	}

	if (path === "/api/v1/announcements" && method === "GET") {
		const plan = await env.orderak_db.prepare(
			"SELECT plan_id FROM subscriptions WHERE seller_id=? AND status='active' ORDER BY id DESC LIMIT 1",
		).bind(seller.id).first<{ plan_id: string }>();
		const { results } = await env.orderak_db.prepare(
			`SELECT a.id,a.title_i18n,a.body_i18n,a.starts_at,a.ends_at,
			 CASE WHEN r.read_at IS NULL THEN 0 ELSE 1 END AS is_read
			 FROM announcements a LEFT JOIN announcement_reads r ON r.announcement_id=a.id AND r.seller_id=?
			 WHERE a.active=1 AND a.target_plan IN ('all',?)
			 AND (a.starts_at IS NULL OR a.starts_at<=datetime('now'))
			 AND (a.ends_at IS NULL OR a.ends_at>=datetime('now'))
			 ORDER BY a.id DESC LIMIT 50`,
		).bind(seller.id, plan?.plan_id ?? "free").all();
		return jsonResponse({ ok: true, announcements: (results ?? []).map((row) => ({
			...row,
			is_read: Boolean(row.is_read),
		})) });
	}

	const announcementRead = path.match(/^\/api\/v1\/announcements\/(\d+)\/read$/);
	if (announcementRead && method === "POST") {
		await env.orderak_db.prepare(
			"INSERT OR REPLACE INTO announcement_reads(announcement_id,seller_id,read_at) VALUES(?,?,datetime('now'))",
		).bind(Number(announcementRead[1]), seller.id).run();
		return jsonResponse({ ok: true });
	}

	if (path === "/api/v1/catalog/translations" && method === "GET") {
		const lang = url.searchParams.get("lang");
		const langFilter = lang === "ar" || lang === "en" ? lang : null;
		const { results } = await env.orderak_db.prepare(
			`SELECT p.product_code,p.name AS source_name,p.description AS source_description,l.lang,
			 pt.name,pt.description,CASE WHEN pt.product_id IS NULL THEN 'missing'
			 WHEN pt.source_name<>p.name OR COALESCE(pt.source_description,'')<>COALESCE(p.description,'') THEN 'stale'
			 ELSE COALESCE(pt.translation_status,'missing') END AS translation_status,
			 pt.source_version,pt.provider,pt.model,pt.reviewed_at,pt.updated_at
			 FROM products p CROSS JOIN (SELECT 'ar' AS lang UNION ALL SELECT 'en') l
			 LEFT JOIN product_translations pt ON pt.product_id=p.id AND pt.lang=l.lang
			 WHERE p.store_id=? AND (? IS NULL OR l.lang=?) ORDER BY p.created_at DESC,l.lang`,
		).bind(seller.id, langFilter, langFilter).all();
		return jsonResponse({ ok: true, translations: results ?? [] });
	}

	const translationMatch = path.match(/^\/api\/v1\/catalog\/translations\/([^/]+)\/(ar|en)$/);
	if (translationMatch && (method === "PUT" || method === "DELETE")) {
		const productCode = decodeURIComponent(translationMatch[1]);
		const lang = translationMatch[2];
		const product = await env.orderak_db.prepare(
			"SELECT id,name,description FROM products WHERE store_id=? AND product_code=? COLLATE NOCASE",
		).bind(seller.id, productCode).first<Row>();
		if (!product) return jsonResponse({ error: "not_found" }, 404);
		if (method === "DELETE") {
			await env.orderak_db.prepare(
				`UPDATE product_translations SET translation_status='rejected',reviewed_at=datetime('now'),
				 reviewed_by_type='seller',reviewed_by_id=? WHERE product_id=? AND lang=?`,
			).bind(seller.id, product.id, lang).run();
			await auditSellerOperation(env, request, seller, "translation.rejected", { entity: "product_translation", entity_id: `${productCode}:${lang}` });
			return jsonResponse({ ok: true, status: "rejected" });
		}
		const body = await readBody(request);
		const name = boundedText(body.name, 120);
		const description = boundedText(body.description, 700);
		if (!name) return jsonResponse({ error: "name_required" }, 400);
		await env.orderak_db.prepare(
			`INSERT INTO product_translations(product_id,lang,name,description,source_name,source_description,
			 detected_language,source_locale,source_version,translation_status,provider,model,reviewed_at,
			 reviewed_by_type,reviewed_by_id,updated_at)
			 VALUES(?,?,?,?,?,?,'manual',?,'manual','reviewed','seller','manual',datetime('now'),'seller',?,datetime('now'))
			 ON CONFLICT(product_id,lang) DO UPDATE SET name=excluded.name,description=excluded.description,
			 source_name=excluded.source_name,source_description=excluded.source_description,
			 source_locale=excluded.source_locale,source_version=excluded.source_version,
			 translation_status='reviewed',provider='seller',model='manual',reviewed_at=datetime('now'),
			 reviewed_by_type='seller',reviewed_by_id=excluded.reviewed_by_id,updated_at=datetime('now')`,
		).bind(product.id, lang, name, description || null, product.name, String(product.description ?? ""), pickLocale(request, url), seller.id).run();
		await auditSellerOperation(env, request, seller, "translation.reviewed", { entity: "product_translation", entity_id: `${productCode}:${lang}` });
		return jsonResponse({ ok: true, status: "reviewed" });
	}

	if (path === "/api/v1/devices" && method === "GET") {
		const { results } = await env.orderak_db.prepare(
			`SELECT rowid AS row_id,device_id,device_label,platform,app_version,created_at,last_used_at
			 FROM seller_devices WHERE seller_id=? ORDER BY COALESCE(last_used_at,created_at) DESC`,
		).bind(seller.id).all();
		const primaryDevice = String(seller.secret ?? "").trim()
			? [{
				row_id: 0,
				device_id: seller.primary_device_id ?? "primary",
				device_label: seller.primary_device_label ?? "Primary device",
				platform: seller.primary_device_platform ?? null,
				app_version: seller.primary_device_app_version ?? null,
				created_at: seller.created_at,
				last_used_at: seller.primary_device_last_used_at ?? null,
			}]
			: [];
		return jsonResponse({
			ok: true,
			devices: [...primaryDevice, ...(results ?? [])],
		});
	}

	const deviceMatch = path.match(/^\/api\/v1\/devices\/(\d+)$/);
	if (deviceMatch && method === "DELETE") {
		const rowId = Number(deviceMatch[1]);
		if (rowId === 0) return jsonResponse({ error: "primary_device_cannot_be_revoked" }, 409);
		const result = await env.orderak_db.prepare("DELETE FROM seller_devices WHERE seller_id=? AND rowid=?").bind(seller.id, rowId).run();
		if (!result.meta.changes) return jsonResponse({ error: "not_found" }, 404);
		await auditSellerOperation(env, request, seller, "device.revoked", { entity: "seller_device", entity_id: rowId });
		return jsonResponse({ ok: true });
	}

	return methodNotAllowed(...allowedMethods);
}
