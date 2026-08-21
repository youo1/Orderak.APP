import { jsonResponse } from "../../platform/http/shared";
import { Hono } from "hono";
import type { AdminEnv } from "./admin-context";
import { auditDb } from "./admin-auth";
import { retryDeletionRequest, processDeletionRequests } from "../identity/deletion";
import { runRetentionCleanup } from "../identity/retention";
import { reconcileGooglePlayPurchases, requeuePlayVerificationJob } from "../../integrations/google-play/google-play";
import { consumeActionAuthorization } from "./admin-control-plane";
import { backfillOrganizationRouting, backfillStableIdentities, identityReadiness } from "../identity/identity";

type Row = Record<string, unknown>;

async function readBody(request: Request): Promise<Row> {
	return request.json<Row>().catch(() => ({} as Row));
}

function textValue(value: unknown, max: number): string {
	return String(value ?? "").trim().slice(0, max);
}

async function settingBoolean(env: AdminWorkerEnv, key: string, fallback: boolean): Promise<boolean> {
	const row = await env.orderak_db.prepare("SELECT value_json FROM settings WHERE key=?").bind(key).first<{ value_json: string }>();
	if (!row) return fallback;
	try { return JSON.parse(row.value_json) === true; } catch { return fallback; }
}

/**
 * Operations routes, mounted by admin.ts.
 *
 * Handler bodies are unchanged; each route destructures the original locals
 * from the Hono context. Where a block previously served several methods
 * behind one shared gate() call, the gate is now distributed to each route
 * with the same permission it resolved to.
 */
export const operationsApp = new Hono<AdminEnv>();
const op = operationsApp;
const B = "/api/admin/v1";

op.get(`${B}/runtime-config`, async (c) => {
		const env = c.env, gate = c.get("gate");
			const denied = gate("settings:view"); if (denied) return denied;
			const aiControl = await settingBoolean(env, "ai_enabled", true);
			const billingControl = await settingBoolean(env, "billing_enabled", true);
			return jsonResponse({ ok: true, controls: {
				ai: { deployment_gate: env.AI_ASSISTANT_ENABLED === "true", admin_enabled: aiControl, effective: env.AI_ASSISTANT_ENABLED === "true" && aiControl },
				billing: { deployment_gate: env.BILLING_ENABLED === "true", admin_enabled: billingControl, effective: env.BILLING_ENABLED === "true" && billingControl },
				google_play_lifecycle: { deployment_gate: env.GOOGLE_PLAY_LIFECYCLE_ENABLED === "true", effective: env.GOOGLE_PLAY_LIFECYCLE_ENABLED === "true" },
				entitlements_v2: { deployment_gate: env.ENTITLEMENTS_ENABLED === "true", effective: env.ENTITLEMENTS_ENABLED === "true" },
			} });
});

op.patch(`${B}/runtime-config`, async (c) => {
		const request = c.req.raw, env = c.env, admin = c.get("admin"), gate = c.get("gate");
		const denied = gate("settings:manage"); if (denied) return denied;
			const body = await readBody(request);
			const statements: D1PreparedStatement[] = [];
			for (const [field, key] of [["ai_enabled", "ai_enabled"], ["billing_enabled", "billing_enabled"]] as const) {
				if (typeof body[field] === "boolean") statements.push(env.orderak_db.prepare(
					"INSERT INTO settings(key,value_json,updated_by,updated_at) VALUES(?,?,?,datetime('now')) ON CONFLICT(key) DO UPDATE SET value_json=excluded.value_json,updated_by=excluded.updated_by,updated_at=datetime('now')",
				).bind(key, JSON.stringify(body[field]), admin.sub));
			}
			if (!statements.length) return jsonResponse({ error: "no_supported_controls" }, 400);
			if (statements.length) await env.orderak_db.batch(statements);
			await auditDb(env, admin, "runtime_config.updated", { ai_enabled: body.ai_enabled, billing_enabled: body.billing_enabled }, request);
			return jsonResponse({ ok: true });
});

op.get(`${B}/subscriptions`, async (c) => {
		const env = c.env, url = new URL(c.req.url), gate = c.get("gate");
		const denied = gate("subscriptions:view"); if (denied) return denied;
		const limit = Math.min(500, Math.max(1, Number(url.searchParams.get("limit")) || 100));
		const { results } = await env.orderak_db.prepare(
			`SELECT s.id,s.seller_id,se.store_name,se.store_code,se.public_identifier,s.plan_id,s.status,s.gateway,
			 s.amount_minor,s.current_period_end,s.created_at,s.updated_at,
			 os.organization_id,orgs.status AS organization_status,orgs.plan_revision_id,
			 orgs.pending_revision_id,orgs.pending_effective_at,orgs.source AS subscription_source,
			 pr.version AS plan_version,sp.plan_key AS governed_plan_key,
			 (SELECT COALESCE(SUM(used),0) FROM entitlement_usage_counters eu WHERE eu.organization_id=os.organization_id) AS total_metered_usage
			 FROM subscriptions s JOIN sellers se ON se.id=s.seller_id
			 LEFT JOIN organization_stores os ON os.store_id=s.seller_id
			 LEFT JOIN organization_subscriptions orgs ON orgs.organization_id=os.organization_id
			 LEFT JOIN plan_revisions pr ON pr.id=orgs.plan_revision_id
			 LEFT JOIN subscription_plans sp ON sp.id=pr.plan_id
			 ORDER BY s.id DESC LIMIT ?`,
		).bind(limit).all();
		return jsonResponse({ ok: true, subscriptions: results ?? [] });
	});

op.get(`${B}/billing/health`, async (c) => {
		const env = c.env, gate = c.get("gate");
		const denied = gate("subscriptions:view"); if (denied) return denied;
		const mappings = await env.orderak_db.prepare(
			"SELECT COUNT(*) total,SUM(CASE WHEN active=1 THEN 1 ELSE 0 END) active,MAX(last_synced_at) last_synced_at FROM play_product_mappings",
		).first();
		const { results: purchases } = await env.orderak_db.prepare(
			"SELECT state,COUNT(*) count,MAX(last_verified_at) last_verified_at FROM play_purchases GROUP BY state ORDER BY state",
		).all();
		const events = await env.orderak_db.prepare(
			"SELECT COUNT(*) total,SUM(CASE WHEN status='failed' THEN 1 ELSE 0 END) failed,MAX(processed_at) last_processed_at FROM play_billing_events",
		).first();
		const jobs = await env.orderak_db.prepare(
			`SELECT COUNT(*) total,
			 SUM(CASE WHEN status IN ('queued','processing','retrying','applied_ack_pending') THEN 1 ELSE 0 END) backlog,
			 SUM(CASE WHEN status='dead_lettered' THEN 1 ELSE 0 END) dead_lettered,
			 MIN(CASE WHEN status IN ('queued','processing','retrying','applied_ack_pending') THEN created_at END) oldest_pending_at,
			 SUM(CASE WHEN dispatched_at IS NULL AND status IN ('queued','retrying','applied_ack_pending') THEN 1 ELSE 0 END) undispatched
			 FROM play_verification_jobs`,
		).first();
		const claimDurations = await env.orderak_db.prepare(
			`WITH durations AS (
			  SELECT MAX(0,(julianday(COALESCE(completed_at,updated_at))-julianday(claim_started_at))*86400000.0) duration_ms
			  FROM play_verification_jobs WHERE claim_started_at IS NOT NULL
			), ranked AS (
			  SELECT duration_ms,ROW_NUMBER() OVER (ORDER BY duration_ms) rn,COUNT(*) OVER () total FROM durations
			)
			SELECT COUNT(*) samples,ROUND(AVG(duration_ms)) average_ms,ROUND(MAX(duration_ms)) maximum_ms,
			 ROUND(MIN(CASE WHEN rn>=total*0.50 THEN duration_ms END)) p50_ms,
			 ROUND(MIN(CASE WHEN rn>=total*0.95 THEN duration_ms END)) p95_ms,
			 SUM(CASE WHEN duration_ms>?*1000 THEN 1 ELSE 0 END) exceeded_lease
			FROM ranked`,
		).bind(120).first();
		const reclaims = await env.orderak_db.prepare(
			`SELECT SUM(lease_reclaim_count) total_reclaims,
			 SUM(CASE WHEN lease_reclaim_count>0 THEN 1 ELSE 0 END) jobs_reclaimed,
			 MAX(last_lease_reclaimed_at) last_reclaimed_at FROM play_verification_jobs`,
		).first();
		const { results: circuits } = await env.orderak_db.prepare(
			"SELECT provider,state,failure_count,cooldown_until,cooldown_seconds,updated_at FROM provider_circuit_state ORDER BY provider",
		).all();
		return jsonResponse({
			ok: true,
			flags: {
				acquisition: env.BILLING_ENABLED === "true",
				lifecycle: env.GOOGLE_PLAY_LIFECYCLE_ENABLED === "true",
			},
			mappings: mappings ?? {},
			purchases: purchases ?? [],
			rtdn: events ?? {},
			verification_jobs: jobs ?? {},
			claim_leases: { lease_seconds: 120, durations: claimDurations ?? {}, reclaims: reclaims ?? {} },
			provider_circuits: circuits ?? [],
		});
	});

op.get(`${B}/billing/verifications`, async (c) => {
		const env = c.env, url = new URL(c.req.url), gate = c.get("gate");
		const denied = gate("subscriptions:view"); if (denied) return denied;
		const limit = Math.min(200, Math.max(1, Number(url.searchParams.get("limit")) || 100));
		const status = textValue(url.searchParams.get("status"), 40);
		const base = `SELECT id,organization_id,seller_id,source,message_id,status,attempt_count,
		 verification_generation,purchase_status,error_code,next_attempt_at,dispatched_at,last_attempt_at,
		 claim_started_at,claim_expires_at,lease_reclaim_count,last_lease_reclaimed_at,requeued_from_job_id,
		 completed_at,created_at,updated_at FROM play_verification_jobs`;
		const statement = status
			? env.orderak_db.prepare(`${base} WHERE status=? ORDER BY created_at DESC LIMIT ?`).bind(status, limit)
			: env.orderak_db.prepare(`${base} ORDER BY created_at DESC LIMIT ?`).bind(limit);
		const { results } = await statement.all();
		return jsonResponse({ ok: true, verifications: results ?? [] });
	});

op.get(`${B}/billing/verifications/:jobId{[0-9a-fA-F-]+}`, async (c) => {
		const env = c.env, gate = c.get("gate");
		const jobId = c.req.param("jobId");
		const denied = gate("subscriptions:view"); if (denied) return denied;
		const row = await env.orderak_db.prepare(
			`SELECT id,organization_id,seller_id,source,message_id,event_time,status,attempt_count,
			 verification_generation,purchase_status,error_code,next_attempt_at,dispatched_at,last_attempt_at,
			 claim_started_at,claim_expires_at,lease_reclaim_count,last_lease_reclaimed_at,requeued_from_job_id,
			 completed_at,created_at,updated_at FROM play_verification_jobs WHERE id=?`,
		).bind(jobId).first();
		return row ? jsonResponse({ ok: true, verification: row }) : jsonResponse({ error: "not_found" }, 404);
	});

op.get(`${B}/identity/readiness`, async (c) => {
		const env = c.env, gate = c.get("gate");
		const denied = gate("operations:view"); if (denied) return denied;
		return jsonResponse({ ok: true, ...(await identityReadiness(env)) });
	});

op.post(`${B}/identity/backfill`, async (c) => {
		const request = c.req.raw, env = c.env, admin = c.get("admin"), gate = c.get("gate");
		const denied = gate("operations:run"); if (denied) return denied;
		const body = await readBody(request);
		const limit = Math.min(500, Math.max(1, Number(body.limit) || 100));
		const result = await backfillStableIdentities(env, limit);
		const routes_migrated = await backfillOrganizationRouting(env, limit);
		await auditDb(env, admin, "identity.backfill_batch", { entity: "seller_auth_identities", ...result, routes_migrated }, request);
		return jsonResponse({ ok: true, ...result, routes_migrated, readiness: await identityReadiness(env) });
	});

op.post(`${B}/billing/verifications/:jobId{[0-9a-fA-F-]+}/retry`, async (c) => {
		const request = c.req.raw, env = c.env, admin = c.get("admin"), gate = c.get("gate");
		const denied = gate("subscriptions:manage"); if (denied) return denied;
		const id = c.req.param("jobId");
		const body = await readBody(request);
		const reason = textValue(body.reason, 1000);
		if (!reason) return jsonResponse({ error: "reason_required" }, 400);
		if (!await consumeActionAuthorization(request, env, admin, "billing.verification_retry", id)) {
			return jsonResponse({ error: "fresh_action_authorization_required" }, 403);
		}
		const newId = await requeuePlayVerificationJob(env, id);
		if (!newId) return jsonResponse({ error: "verification_not_dead_lettered" }, 409);
		await auditDb(env, admin, "billing.verification_requeued", {
			entity: "play_verification_job",
			entity_id: id,
			new_verification_id: newId,
			reason,
		}, request);
		return jsonResponse({ ok: true, verification_id: newId }, 202);
	});

op.get(`${B}/stores/:storeId`, async (c) => {
		const env = c.env, gate = c.get("gate");
		const storeId = decodeURIComponent(c.req.param("storeId"));
			const denied = gate("sellers:view"); if (denied) return denied;
			const store = await env.orderak_db.prepare(
				`SELECT s.id,s.store_code,s.public_identifier,s.country_code,s.store_name,s.slug,s.status,
				 s.phone,s.email,s.created_at,s.updated_at,s.primary_device_id,s.primary_device_label,
				 s.primary_device_platform,s.primary_device_app_version,s.primary_device_last_used_at,
				 CASE WHEN length(trim(COALESCE(s.secret,'')))>0 THEN 1 ELSE 0 END has_primary_device,
				 (SELECT COUNT(*) FROM products WHERE store_id=s.id) product_count,
				 (SELECT COUNT(*) FROM categories WHERE store_id=s.id) category_count,
				 (SELECT COUNT(*) FROM orders WHERE store_id=s.id) order_count
				 FROM sellers s WHERE s.id=?`,
			).bind(storeId).first<Row>();
			if (!store) return jsonResponse({ error: "not_found" }, 404);
			const hasPrimaryDevice = Number(store.has_primary_device ?? 0) === 1;
			delete store.has_primary_device;
			const subscription = gate("subscriptions:view") ? null : await env.orderak_db.prepare(
				`SELECT s.id,s.plan_id,s.status,s.gateway,s.amount_minor,s.current_period_end,
				 os.organization_id,orgs.status AS organization_status,orgs.plan_revision_id,
				 orgs.pending_revision_id,orgs.pending_effective_at,orgs.source AS subscription_source,
				 pr.version AS plan_version,sp.plan_key AS governed_plan_key
				 FROM subscriptions s LEFT JOIN organization_stores os ON os.store_id=s.seller_id
				 LEFT JOIN organization_subscriptions orgs ON orgs.organization_id=os.organization_id
				 LEFT JOIN plan_revisions pr ON pr.id=orgs.plan_revision_id
				 LEFT JOIN subscription_plans sp ON sp.id=pr.plan_id
				 WHERE s.seller_id=? ORDER BY s.id DESC LIMIT 1`,
			).bind(storeId).first();
			const deletion = gate("deletions:view") ? null : await env.orderak_db.prepare("SELECT * FROM deletion_requests WHERE phone_e164=? ORDER BY requested_at DESC LIMIT 1").bind(store.phone).first();
			const devices = gate("devices:view") ? [] : (await env.orderak_db.prepare(
				"SELECT rowid AS row_id,device_id,device_label,platform,app_version,created_at,last_used_at FROM seller_devices WHERE seller_id=?",
			).bind(storeId).all()).results ?? [];
			const primaryDevice = hasPrimaryDevice
				? [{
					row_id: 0,
					device_id: store.primary_device_id ?? "primary",
					device_label: store.primary_device_label ?? "Primary device",
					platform: store.primary_device_platform ?? null,
					app_version: store.primary_device_app_version ?? null,
					created_at: store.created_at,
					last_used_at: store.primary_device_last_used_at ?? null,
				}]
				: [];
			return jsonResponse({
				ok: true,
				store,
				subscription: subscription ?? null,
				deletion: deletion ?? null,
				devices: gate("devices:view") ? [] : [...primaryDevice, ...devices],
			});
});

op.patch(`${B}/stores/:storeId`, async (c) => {
		const request = c.req.raw, env = c.env, admin = c.get("admin"), gate = c.get("gate");
		const storeId = decodeURIComponent(c.req.param("storeId"));
		const denied = gate("sellers:manage"); if (denied) return denied;
			const body = await readBody(request);
			const status = String(body.status ?? "");
			if (!["active", "suspended", "banned"].includes(status)) return jsonResponse({ error: "invalid_status" }, 400);
			const reason = textValue(body.reason, 500);
			if (!reason) return jsonResponse({ error: "reason_required" }, 400);
			const result = await env.orderak_db.prepare("UPDATE sellers SET status=? WHERE id=?").bind(status, storeId).run();
			if (!result.meta.changes) return jsonResponse({ error: "not_found" }, 404);
			await auditDb(env, admin, "seller.status_changed", { entity: "seller", entity_id: storeId, status, reason }, request);
			return jsonResponse({ ok: true, status });
});

op.get(`${B}/deletion-requests`, async (c) => {
		const env = c.env, url = new URL(c.req.url), gate = c.get("gate");
		const denied = gate("deletions:view"); if (denied) return denied;
		const status = url.searchParams.get("status");
		const stmt = status
			? env.orderak_db.prepare("SELECT * FROM deletion_requests WHERE status=? ORDER BY requested_at DESC LIMIT 200").bind(status)
			: env.orderak_db.prepare("SELECT * FROM deletion_requests ORDER BY requested_at DESC LIMIT 200");
		const { results } = await stmt.all();
		return jsonResponse({ ok: true, requests: results ?? [] });
	});

op.post(`${B}/deletion-requests/:id/:action{verify|retry}`, async (c) => {
		const request = c.req.raw, env = c.env, admin = c.get("admin"), gate = c.get("gate");
		const denied = gate("deletions:manage"); if (denied) return denied;
		const id = decodeURIComponent(c.req.param("id"));
		if (c.req.param("action") === "verify") {
			const body = await readBody(request);
			const notes = textValue(body.notes, 1000);
			if (!notes) return jsonResponse({ error: "verification_notes_required" }, 400);
			const result = await env.orderak_db.prepare(
				"UPDATE deletion_requests SET status='verified',verified_at=datetime('now'),notes=? WHERE id=? AND status='pending'",
			).bind(notes, id).run();
			if (!result.meta.changes) return jsonResponse({ error: "invalid_transition" }, 409);
			await auditDb(env, admin, "deletion.verified", { entity: "deletion_request", entity_id: id, notes }, request);
			return jsonResponse({ ok: true });
		}
		const result = await retryDeletionRequest(env, id);
		await auditDb(env, admin, "deletion.retry", { entity: "deletion_request", entity_id: id, result }, request);
		return result === "not_found" ? jsonResponse({ error: result }, 404)
			: result === "not_due" ? jsonResponse({ error: result }, 409)
			: jsonResponse({ ok: true, result });
	});

op.get(`${B}/support/tickets`, async (c) => {
		const env = c.env, gate = c.get("gate");
		const denied = gate("support:view"); if (denied) return denied;
		const { results } = await env.orderak_db.prepare(
			`SELECT t.*,s.store_name,s.store_code,u.email AS assigned_email FROM support_tickets t
			 LEFT JOIN sellers s ON s.id=t.seller_id LEFT JOIN admin_users u ON u.id=t.assigned_to
			 ORDER BY CASE t.status WHEN 'open' THEN 0 WHEN 'pending' THEN 1 ELSE 2 END,t.updated_at DESC LIMIT 200`,
		).all();
		return jsonResponse({ ok: true, tickets: results ?? [] });
	});

op.get(`${B}/support/tickets/:id{[0-9]+}`, async (c) => {
		const env = c.env, gate = c.get("gate");
		const denied = gate("support:view"); if (denied) return denied;
		const id = Number(c.req.param("id"));
			const ticket = await env.orderak_db.prepare("SELECT * FROM support_tickets WHERE id=?").bind(id).first();
			if (!ticket) return jsonResponse({ error: "not_found" }, 404);
			const { results } = await env.orderak_db.prepare("SELECT * FROM support_messages WHERE ticket_id=? ORDER BY id").bind(id).all();
			return jsonResponse({ ok: true, ticket, messages: results ?? [] });
});

op.patch(`${B}/support/tickets/:id{[0-9]+}`, async (c) => {
		const request = c.req.raw, env = c.env, admin = c.get("admin"), gate = c.get("gate");
		const denied = gate("support:manage"); if (denied) return denied;
		const id = Number(c.req.param("id"));
		const body = await readBody(request);
			const status = ["open", "pending", "closed"].includes(String(body.status)) ? String(body.status) : "open";
			const priority = ["low", "normal", "high"].includes(String(body.priority)) ? String(body.priority) : "normal";
			const assigned = body.assigned_to == null ? null : Number(body.assigned_to);
			const result = await env.orderak_db.prepare("UPDATE support_tickets SET status=?,priority=?,assigned_to=?,updated_at=datetime('now') WHERE id=?").bind(status, priority, assigned, id).run();
			if (!result.meta.changes) return jsonResponse({ error: "not_found" }, 404);
			await auditDb(env, admin, "support.ticket_updated", { entity: "support_ticket", entity_id: id, status, priority, assigned_to: assigned }, request);
			return jsonResponse({ ok: true });
});

op.post(`${B}/support/tickets/:id{[0-9]+}`, async (c) => {
		const request = c.req.raw, env = c.env, admin = c.get("admin"), gate = c.get("gate");
		const denied = gate("support:manage"); if (denied) return denied;
		const id = Number(c.req.param("id"));
		const body = await readBody(request);
			const message = textValue(body.message, 4000);
			if (!message) return jsonResponse({ error: "message_required" }, 400);
			const ticket = await env.orderak_db.prepare("SELECT id FROM support_tickets WHERE id=?").bind(id).first();
			if (!ticket) return jsonResponse({ error: "not_found" }, 404);
			await env.orderak_db.batch([
				env.orderak_db.prepare("INSERT INTO support_messages(ticket_id,sender,body) VALUES(?,'admin',?)").bind(id, message),
				env.orderak_db.prepare("UPDATE support_tickets SET status='pending',assigned_to=?,updated_at=datetime('now') WHERE id=?").bind(admin.sub, id),
			]);
			await auditDb(env, admin, "support.reply", { entity: "support_ticket", entity_id: id }, request);
			return jsonResponse({ ok: true }, 201);
});

op.get(`${B}/announcements`, async (c) => {
		const env = c.env, gate = c.get("gate");
		const denied = gate("announcements:view"); if (denied) return denied;
			const { results } = await env.orderak_db.prepare("SELECT * FROM announcements ORDER BY id DESC LIMIT 200").all();
			return jsonResponse({ ok: true, announcements: results ?? [] });
});

op.post(`${B}/announcements`, async (c) => {
		const request = c.req.raw, env = c.env, admin = c.get("admin"), gate = c.get("gate");
		const denied = gate("announcements:manage"); if (denied) return denied;
			const body = await readBody(request);
			const title = textValue(body.title_i18n, 1000), message = textValue(body.body_i18n, 4000);
			if (!title || !message) return jsonResponse({ error: "title_and_body_required" }, 400);
			const row = await env.orderak_db.prepare(
				"INSERT INTO announcements(title_i18n,body_i18n,target_plan,starts_at,ends_at,active,created_by) VALUES(?,?,?,?,?,?,?) RETURNING id",
			).bind(title, message, textValue(body.target_plan, 50) || "all", body.starts_at || null, body.ends_at || null, body.active === false ? 0 : 1, admin.sub).first();
			await auditDb(env, admin, "announcement.created", { entity: "announcement", entity_id: (row as Row)?.id }, request);
			return jsonResponse({ ok: true, id: (row as Row)?.id }, 201);
});

op.on(["PATCH", "DELETE"], `${B}/announcements/:id{[0-9]+}`, async (c) => {
		const request = c.req.raw, env = c.env, admin = c.get("admin"), gate = c.get("gate"), method = c.req.method;
		const denied = gate("announcements:manage"); if (denied) return denied;
		const id = Number(c.req.param("id"));
		if (method === "DELETE") {
			const result = await env.orderak_db.prepare("UPDATE announcements SET active=0 WHERE id=?").bind(id).run();
			if (!result.meta.changes) return jsonResponse({ error: "not_found" }, 404);
		} else {
			const body = await readBody(request);
			const title = textValue(body.title_i18n, 1000), message = textValue(body.body_i18n, 4000);
			if (!title || !message) return jsonResponse({ error: "title_and_body_required" }, 400);
			const result = await env.orderak_db.prepare(
				"UPDATE announcements SET title_i18n=?,body_i18n=?,target_plan=?,starts_at=?,ends_at=?,active=? WHERE id=?",
			).bind(title, message, textValue(body.target_plan, 50) || "all", body.starts_at || null, body.ends_at || null, body.active === false ? 0 : 1, id).run();
			if (!result.meta.changes) return jsonResponse({ error: "not_found" }, 404);
		}
		await auditDb(env, admin, `announcement.${method === "DELETE" ? "disabled" : "updated"}`, { entity: "announcement", entity_id: id }, request);
		return jsonResponse({ ok: true });
	});

op.get(`${B}/product-translations`, async (c) => {
		const env = c.env, url = new URL(c.req.url), gate = c.get("gate");
		const denied = gate("translations:view"); if (denied) return denied;
		const status = url.searchParams.get("status");
		const select = `SELECT pt.*,p.product_code,p.name source_product_name,s.store_name,
			CASE WHEN pt.source_name<>p.name OR COALESCE(pt.source_description,'')<>COALESCE(p.description,'')
			THEN 'stale' ELSE pt.translation_status END AS effective_status
			FROM product_translations pt JOIN products p ON p.id=pt.product_id JOIN sellers s ON s.id=p.store_id`;
		const stmt = status
			? env.orderak_db.prepare(`${select} WHERE (CASE WHEN pt.source_name<>p.name OR COALESCE(pt.source_description,'')<>COALESCE(p.description,'') THEN 'stale' ELSE pt.translation_status END)=? ORDER BY pt.updated_at DESC LIMIT 200`).bind(status)
			: env.orderak_db.prepare(`${select} ORDER BY pt.updated_at DESC LIMIT 200`);
		const { results } = await stmt.all();
		return jsonResponse({ ok: true, translations: results ?? [] });
	});

op.patch(`${B}/product-translations/:code/:lang{ar|en}`, async (c) => {
		const request = c.req.raw, env = c.env;
		const admin = c.get("admin"), gate = c.get("gate");
		const productCode = decodeURIComponent(c.req.param("code"));
		const lang = c.req.param("lang");
		const denied = gate("translations:manage"); if (denied) return denied;
		const body = await readBody(request);
		const status = String(body.status);
		if (!["reviewed", "rejected"].includes(status)) return jsonResponse({ error: "invalid_status" }, 400);
		const result = await env.orderak_db.prepare(
			`UPDATE product_translations SET translation_status=?,reviewed_at=datetime('now'),
			 reviewed_by_type='admin',reviewed_by_id=?,updated_at=datetime('now')
			 WHERE product_id=(SELECT id FROM products WHERE product_code=? COLLATE NOCASE) AND lang=?`,
		).bind(status, String(admin.sub), productCode, lang).run();
		if (!result.meta.changes) return jsonResponse({ error: "not_found" }, 404);
		await auditDb(env, admin, "translation.reviewed", { entity: "product_translation", entity_id: `${productCode}:${lang}`, status }, request);
		return jsonResponse({ ok: true, status });
});

op.delete(`${B}/stores/:storeId/devices/:deviceId{[0-9]+}`, async (c) => {
		const request = c.req.raw, env = c.env, admin = c.get("admin"), gate = c.get("gate");
		const sellerId = decodeURIComponent(c.req.param("storeId"));
		const deviceRowId = Number(c.req.param("deviceId"));
		const denied = gate("devices:manage"); if (denied) return denied;
		const result = await env.orderak_db.prepare("DELETE FROM seller_devices WHERE seller_id=? AND rowid=?").bind(sellerId, deviceRowId).run();
		if (!result.meta.changes) return jsonResponse({ error: "not_found" }, 404);
		await auditDb(env, admin, "device.revoked", { entity: "seller", entity_id: sellerId, row_id: deviceRowId }, request);
		return jsonResponse({ ok: true });
	});

op.get(`${B}/operations/jobs`, async (c) => {
		const env = c.env, gate = c.get("gate");
		const denied = gate("operations:view"); if (denied) return denied;
		const { results } = await env.orderak_db.prepare(
			"SELECT * FROM operational_job_runs ORDER BY started_at DESC LIMIT 100",
		).all();
		return jsonResponse({ ok: true, runs: results ?? [] });
	});

op.post(`${B}/operations/jobs/:key{retention|deletions|google-play}/run`, async (c) => {
		const request = c.req.raw, env = c.env, admin = c.get("admin"), gate = c.get("gate");
		const denied = gate("operations:run"); if (denied) return denied;
		const key = c.req.param("key");
		const id = crypto.randomUUID();
		await env.orderak_db.prepare("INSERT INTO operational_job_runs(id,job_key,trigger_kind,status,triggered_by) VALUES(?,?,'admin','running',?)").bind(id, key, admin.sub).run();
		try {
			const affectedCount = key === "retention"
				? await runRetentionCleanup(env)
				: key === "deletions"
					? await processDeletionRequests(env)
					: await reconcileGooglePlayPurchases(env);
			await env.orderak_db.prepare("UPDATE operational_job_runs SET status='succeeded',completed_at=datetime('now'),affected_count=? WHERE id=?").bind(affectedCount, id).run();
			await auditDb(env, admin, "operation.run", { entity: "operational_job", entity_id: id, job_key: key }, request);
			return jsonResponse({ ok: true, run_id: id });
		} catch (error) {
			const message = error instanceof Error ? error.message.slice(0, 500) : "unknown";
			await env.orderak_db.prepare("UPDATE operational_job_runs SET status='failed',completed_at=datetime('now'),error_message=? WHERE id=?").bind(message, id).run();
			return jsonResponse({ error: "job_failed", run_id: id }, 500);
		}
	});

