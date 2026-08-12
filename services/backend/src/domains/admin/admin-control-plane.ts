import { jsonResponse } from "../../platform/http/shared";
import { auditDb, verifyFreshAdminAuth } from "./admin-auth";
import { ALL_ROLES, hashPassword, keyedHash, randomToken, sha256Hex, type AdminClaims, type AdminRole } from "../identity/auth";
import { R2CsvWriter } from "../../platform/storage/r2-csv-writer";
import { Hono } from "hono";
import type { AdminEnv } from "./admin-context";


type Json = Record<string, unknown>;

async function body(request: Request): Promise<Json> {
	return request.json<Json>().catch(() => ({} as Json));
}

function page(url: URL): { limit: number; offset: number } {
	const limit = Math.min(100, Math.max(1, Number(url.searchParams.get("limit") ?? 30)));
	const offset = Math.max(0, Number(url.searchParams.get("offset") ?? 0));
	return { limit, offset };
}

function bool(value: unknown): number {
	return value === true || value === 1 || value === "1" ? 1 : 0;
}

function allowed(value: string, values: readonly string[]): boolean {
	return values.includes(value);
}

/**
 * Control-plane routes, mounted by admin.ts. `admin` and `gate` come from the
 * admin pipeline middleware via the Hono context, so they are no longer
 * threaded through as parameters.
 */
export const controlPlaneApp = new Hono<AdminEnv>();
const cp = controlPlaneApp;
const B = "/api/admin/v1";

cp.get(`${B}/control-plane/dashboard`, (c) => c.get("gate")("dashboard:view") ?? dashboard(c.env));

cp.get(`${B}/capabilities`, (c) => c.get("gate")("capabilities:view") ?? capabilities(c.env));

cp.get(`${B}/store-controls`, (c) => c.get("gate")("capabilities:view") ?? storeControls(c.env, new URL(c.req.url)));
cp.post(`${B}/store-controls`, (c) => c.get("gate")("capabilities:manage") ?? saveStoreControl(c.req.raw, c.env, c.get("admin")));

cp.get(`${B}/flags`, (c) => c.get("gate")("flags:view") ?? flags(c.env));
cp.post(`${B}/flags`, (c) => c.get("gate")("flags:manage") ?? saveFlag(c.req.raw, c.env, c.get("admin")));
cp.post(`${B}/flags/evaluate`, (c) => c.get("gate")("flags:view") ?? simulateFlag(c.req.raw, c.env));
cp.post(`${B}/flag-rules`, (c) => c.get("gate")("flags:manage") ?? saveFlagRule(c.req.raw, c.env, c.get("admin")));
cp.delete(`${B}/flag-rules/:id`, (c) =>
	c.get("gate")("flags:manage") ?? revokeFlagRule(c.env, decodeURIComponent(c.req.param("id")), c.get("admin")));

cp.get(`${B}/app-versions`, (c) => c.get("gate")("versions:view") ?? appVersions(c.env));
cp.post(`${B}/app-versions`, (c) => c.get("gate")("versions:manage") ?? saveAppVersion(c.req.raw, c.env, c.get("admin")));

cp.get(`${B}/buyers`, (c) => c.get("gate")("buyers:view") ?? buyers(c.env, new URL(c.req.url)));
cp.post(`${B}/buyer-restrictions`, (c) => c.get("gate")("buyers:manage") ?? restrictBuyer(c.req.raw, c.env, c.get("admin")));
cp.post(`${B}/buyer-restrictions/:id/revoke`, (c) =>
	c.get("gate")("buyers:manage") ?? revokeBuyerRestriction(c.env, c.req.param("id"), c.get("admin")));
cp.get(`${B}/buyer-privacy`, (c) => c.get("gate")("buyers:view") ?? buyerPrivacy(c.env, new URL(c.req.url)));
cp.post(`${B}/buyer-privacy`, (c) => c.get("gate")("buyers:manage") ?? saveBuyerPrivacy(c.req.raw, c.env, c.get("admin")));
cp.patch(`${B}/buyer-privacy/:id`, (c) =>
	c.get("gate")("buyers:manage") ?? updateBuyerPrivacy(c.req.raw, c.env, c.req.param("id"), c.get("admin")));

cp.get(`${B}/access/admins`, (c) => c.get("gate")("admins:view") ?? administrators(c.env));
cp.get(`${B}/access/invitations`, (c) => c.get("gate")("admins:view") ?? invitations(c.env));
cp.post(`${B}/access/invitations`, (c) => c.get("gate")("admins:manage") ?? createInvitation(c.req.raw, c.env, c.get("admin")));
cp.post(`${B}/access/invitations/:id/revoke`, (c) =>
	c.get("gate")("admins:manage") ?? revokeInvitation(c.env, c.req.param("id"), c.get("admin")));
cp.patch(`${B}/access/admins/:id`, (c) =>
	c.get("gate")("admins:manage") ?? updateAdministrator(c.req.raw, c.env, Number(c.req.param("id")), c.get("admin")));
cp.get(`${B}/access/sessions`, (c) => c.get("gate")("admins:view") ?? sessions(c.env, c.get("admin")));
cp.delete(`${B}/access/sessions/:id`, (c) =>
	c.get("gate")("admins:manage") ?? revokeSession(c.req.raw, c.env, c.req.param("id"), c.get("admin")));

cp.get(`${B}/security`, (c) => c.get("gate")("security:view") ?? securityWorkspace(c.env));
cp.patch(`${B}/security/alerts/:id`, (c) =>
	c.get("gate")("security:manage") ?? updateAlert(c.req.raw, c.env, c.req.param("id"), c.get("admin")));
cp.post(`${B}/action-authorizations`, (c) => c.get("gate")("security:manage") ?? authorizeAction(c.req.raw, c.env, c.get("admin")));

cp.get(`${B}/support-macros`, (c) => c.get("gate")("support:view") ?? supportMacros(c.env));
cp.post(`${B}/support-macros`, (c) => c.get("gate")("support:manage") ?? saveSupportMacro(c.req.raw, c.env, c.get("admin")));
cp.delete(`${B}/support-macros/:id`, (c) =>
	c.get("gate")("support:manage") ?? deleteSupportMacro(c.env, c.req.param("id"), c.get("admin")));

cp.get(`${B}/content-configs`, (c) => c.get("gate")("content:view") ?? contentConfigs(c.env, new URL(c.req.url)));
cp.post(`${B}/content-configs`, (c) => c.get("gate")("content:manage") ?? saveContentConfig(c.req.raw, c.env, c.get("admin")));
cp.post(`${B}/content-configs/:id/publish`, (c) =>
	c.get("gate")("content:manage") ?? publishContentConfig(c.env, c.req.param("id"), c.get("admin")));

cp.get(`${B}/exports`, (c) => c.get("gate")("export:view") ?? exports(c.env, c.get("admin")));
cp.post(`${B}/exports`, (c) => c.get("gate")("export:manage") ?? createExport(c.req.raw, c.env, c.get("admin")));
cp.post(`${B}/exports/:id/download`, (c) =>
	c.get("gate")("export:view") ?? downloadExport(c.req.raw, c.env, c.req.param("id"), c.get("admin")));

async function dashboard(env: AdminWorkerEnv): Promise<Response> {
	const [stores, buyersCount, subscriptions, tickets, deletions, alerts, sessions] = await Promise.all([
		env.orderak_db.prepare("SELECT COUNT(*) total,SUM(status='active') active,SUM(status<>'active') restricted FROM sellers").first(),
		env.orderak_db.prepare("SELECT COUNT(*) total FROM (SELECT store_id,buyer_phone FROM orders GROUP BY store_id,buyer_phone)").first(),
		env.orderak_db.prepare("SELECT COUNT(*) total,SUM(status='active') active,SUM(status='grace') grace FROM organization_subscriptions").first().catch(() => ({ total: 0, active: 0, grace: 0 })),
		env.orderak_db.prepare("SELECT COUNT(*) total,SUM(status='open') open,SUM(priority='high') high FROM support_tickets").first(),
		env.orderak_db.prepare("SELECT COUNT(*) total,SUM(status IN ('pending','verified')) actionable FROM deletion_requests").first().catch(() => ({ total: 0, actionable: 0 })),
		env.orderak_db.prepare("SELECT COUNT(*) total,SUM(status='open') open,SUM(status='open' AND severity='critical') critical FROM security_alerts").first(),
		env.orderak_db.prepare("SELECT COUNT(*) active FROM admin_sessions WHERE revoked_at IS NULL AND expires_at>datetime('now') AND idle_expires_at>datetime('now')").first(),
	]);
	return jsonResponse({ stores, buyers: buyersCount, subscriptions, support: tickets, deletions, security: alerts, sessions, generated_at: new Date().toISOString() });
}

async function capabilities(env: AdminWorkerEnv): Promise<Response> {
	const [rows, controls] = await Promise.all([
		env.orderak_db.prepare("SELECT * FROM capability_definitions WHERE active=1 ORDER BY domain,label").all(),
		env.orderak_db.prepare("SELECT o.*,c.label,c.runtime_consumer FROM store_capability_overrides o JOIN capability_definitions c ON c.capability_key=o.capability_key WHERE o.revoked_at IS NULL AND (o.expires_at IS NULL OR o.expires_at>datetime('now')) ORDER BY o.created_at DESC LIMIT 200").all(),
	]);
	return jsonResponse({ items: rows.results, store_controls: controls.results, precedence: ["environment_gate", "emergency_version", "account_trust", "plan_entitlement", "store_override", "country_version", "percentage", "global_default"] });
}

async function storeControls(env: AdminWorkerEnv, url: URL): Promise<Response> {
	const storeId = url.searchParams.get("store_id");
	const rows = await env.orderak_db.prepare(
		`SELECT o.*,c.label,c.description,c.implementation_status,c.runtime_consumer
		 FROM store_capability_overrides o JOIN capability_definitions c ON c.capability_key=o.capability_key
		 WHERE (? IS NULL OR o.store_id=?) AND o.revoked_at IS NULL ORDER BY o.created_at DESC LIMIT 200`,
	).bind(storeId, storeId).all();
	return jsonResponse({ items: rows.results });
}

async function saveStoreControl(request: Request, env: AdminWorkerEnv, admin: AdminClaims): Promise<Response> {
	const input = await body(request);
	const storeId = String(input.store_id ?? "");
	const key = String(input.capability_key ?? "");
	const reason = String(input.reason ?? "").trim();
	if (!storeId || !key || reason.length < 5) return jsonResponse({ error: "store_capability_and_reason_required" }, 400);
	const capability = await env.orderak_db.prepare("SELECT implementation_status FROM capability_definitions WHERE capability_key=? AND active=1").bind(key).first<{ implementation_status: string }>();
	if (!capability) return jsonResponse({ error: "unknown_capability" }, 404);
	if (capability.implementation_status !== "enforced") return jsonResponse({ error: "capability_not_enforced" }, 409);
	await env.orderak_db.batch([
		env.orderak_db.prepare("UPDATE store_capability_overrides SET revoked_at=datetime('now') WHERE store_id=? AND capability_key=? AND revoked_at IS NULL").bind(storeId, key),
		env.orderak_db.prepare("INSERT INTO store_capability_overrides(id,store_id,capability_key,enabled,reason,expires_at,created_by) VALUES(?,?,?,?,?,?,?)").bind(crypto.randomUUID(), storeId, key, bool(input.enabled), reason, input.expires_at || null, admin.sub),
	]);
	await auditDb(env, admin, "store.capability_override", { entity: "store", entity_id: storeId, capability_key: key, enabled: bool(input.enabled), reason }, request);
	return jsonResponse({ ok: true }, 201);
}

async function flags(env: AdminWorkerEnv): Promise<Response> {
	const [definitions, rules] = await Promise.all([
		env.orderak_db.prepare("SELECT * FROM feature_flags ORDER BY flag_key").all(),
		env.orderak_db.prepare("SELECT * FROM feature_flag_rules WHERE active=1 ORDER BY flag_key,priority,id").all(),
	]);
	return jsonResponse({ items: definitions.results, rules: rules.results });
}

async function saveFlag(request: Request, env: AdminWorkerEnv, admin: AdminClaims): Promise<Response> {
	const input = await body(request);
	const key = String(input.flag_key ?? "").trim();
	const runtime = String(input.runtime_consumer ?? "").trim();
	if (!/^[a-z][a-z0-9_.-]{2,63}$/.test(key) || !runtime) return jsonResponse({ error: "invalid_flag" }, 400);
	await env.orderak_db.prepare(
		`INSERT INTO feature_flags(flag_key,description,value_type,default_value_json,env_gate,runtime_consumer,risk,rollout_seed,status,updated_by)
		 VALUES(?,?,?,?,?,?,?,?,?,?) ON CONFLICT(flag_key) DO UPDATE SET description=excluded.description,value_type=excluded.value_type,
		 default_value_json=excluded.default_value_json,env_gate=excluded.env_gate,runtime_consumer=excluded.runtime_consumer,risk=excluded.risk,
		 status=excluded.status,version=feature_flags.version+1,updated_by=excluded.updated_by,updated_at=datetime('now')`,
	).bind(key, String(input.description ?? ""), String(input.value_type ?? "boolean"), JSON.stringify(input.default_value ?? false), input.env_gate || null, runtime, String(input.risk ?? "medium"), String(input.rollout_seed ?? key), String(input.status ?? "draft"), admin.sub).run();
	await auditDb(env, admin, "flag.saved", { entity: "feature_flag", entity_id: key }, request);
	return jsonResponse({ ok: true });
}

async function saveFlagRule(request: Request, env: AdminWorkerEnv, admin: AdminClaims): Promise<Response> {
	const input = await body(request);
	const flagKey = String(input.flag_key ?? "");
	const scope = String(input.scope_type ?? "global");
	const reason = String(input.reason ?? "").trim();
	if (!flagKey || !allowed(scope, ["global", "country", "app_version", "plan", "seller", "store", "percentage"]) || reason.length < 5) return jsonResponse({ error: "invalid_rule" }, 400);
	const basisPoints = input.rollout_percentage == null ? null : Math.max(0, Math.min(10000, Math.round(Number(input.rollout_percentage) * 100)));
	await env.orderak_db.prepare(
		`INSERT INTO feature_flag_rules(id,flag_key,priority,scope_type,scope_value,min_version_code,max_version_code,rollout_basis_points,value_json,starts_at,ends_at,active,reason,created_by)
		 VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
	).bind(crypto.randomUUID(), flagKey, Number(input.priority ?? 100), scope, input.scope_value || null, input.min_version_code || null, input.max_version_code || null, basisPoints, JSON.stringify(input.value ?? true), input.starts_at || null, input.ends_at || null, 1, reason, admin.sub).run();
	await auditDb(env, admin, "flag.rule_created", { entity: "feature_flag", entity_id: flagKey, scope, reason }, request);
	return jsonResponse({ ok: true }, 201);
}

async function revokeFlagRule(env: AdminWorkerEnv, id: string, admin: AdminClaims): Promise<Response> {
	await env.orderak_db.prepare("UPDATE feature_flag_rules SET active=0 WHERE id=?").bind(id).run();
	await auditDb(env, admin, "flag.rule_revoked", { entity: "feature_flag_rule", entity_id: id });
	return jsonResponse({ ok: true });
}

export interface FlagContext { flagKey: string; actorKey: string; country?: string; appVersion?: number; plan?: string; sellerId?: string; storeId?: string }

export async function evaluateFlag(env: AdminWorkerEnv, context: FlagContext): Promise<{ value: unknown; source: string; envGate: string | null }> {
	const flag = await env.orderak_db.prepare("SELECT * FROM feature_flags WHERE flag_key=? AND status='published'").bind(context.flagKey).first<Record<string, unknown>>();
	if (!flag) return { value: false, source: "missing", envGate: null };
	const envGate = flag.env_gate ? String(flag.env_gate) : null;
	if (envGate && (env as unknown as Record<string, unknown>)[envGate] !== "true") return { value: false, source: `environment:${envGate}`, envGate };
	const result = await env.orderak_db.prepare(
		`SELECT * FROM feature_flag_rules WHERE flag_key=? AND active=1
		 AND (starts_at IS NULL OR starts_at<=datetime('now')) AND (ends_at IS NULL OR ends_at>datetime('now')) ORDER BY priority,id`,
	).bind(context.flagKey).all<Record<string, unknown>>();
	for (const rule of result.results) {
		const scope = String(rule.scope_type);
		const match = scope === "global"
			|| (scope === "country" && rule.scope_value === context.country)
			|| (scope === "plan" && rule.scope_value === context.plan)
			|| (scope === "seller" && rule.scope_value === context.sellerId)
			|| (scope === "store" && rule.scope_value === context.storeId)
			|| (scope === "app_version" && context.appVersion != null && (rule.min_version_code == null || context.appVersion >= Number(rule.min_version_code)) && (rule.max_version_code == null || context.appVersion <= Number(rule.max_version_code)))
			|| (scope === "percentage" && await rolloutBucket(context.actorKey, String(flag.rollout_seed)) < Number(rule.rollout_basis_points ?? 0));
		if (match) return { value: JSON.parse(String(rule.value_json)), source: `rule:${rule.id}`, envGate };
	}
	return { value: JSON.parse(String(flag.default_value_json)), source: "global_default", envGate };
}

async function rolloutBucket(actor: string, seed: string): Promise<number> {
	const hash = await sha256Hex(await keyedHash(actor, seed));
	return Number.parseInt(hash.slice(0, 8), 16) % 10000;
}

async function simulateFlag(request: Request, env: AdminWorkerEnv): Promise<Response> {
	const input = await body(request);
	if (!input.flag_key || !input.actor_key) return jsonResponse({ error: "flag_and_actor_required" }, 400);
	return jsonResponse(await evaluateFlag(env, { flagKey: String(input.flag_key), actorKey: String(input.actor_key), country: input.country ? String(input.country) : undefined, appVersion: input.app_version == null ? undefined : Number(input.app_version), plan: input.plan ? String(input.plan) : undefined, sellerId: input.seller_id ? String(input.seller_id) : undefined, storeId: input.store_id ? String(input.store_id) : undefined }));
}

async function appVersions(env: AdminWorkerEnv): Promise<Response> {
	const result = await env.orderak_db.prepare("SELECT * FROM app_version_policies ORDER BY platform,country_code,updated_at DESC").all();
	return jsonResponse({ items: result.results });
}

async function saveAppVersion(request: Request, env: AdminWorkerEnv, admin: AdminClaims): Promise<Response> {
	const input = await body(request);
	const minimum = input.minimum_version_code == null ? null : Number(input.minimum_version_code);
	const recommended = input.recommended_version_code == null ? null : Number(input.recommended_version_code);
	const reason = String(input.reason ?? "").trim();
	if (reason.length < 5 || (minimum != null && (!Number.isInteger(minimum) || minimum < 1)) || (recommended != null && minimum != null && recommended < minimum)) return jsonResponse({ error: "invalid_version_policy" }, 400);
	const id = String(input.id ?? crypto.randomUUID());
	await env.orderak_db.prepare(
		`INSERT INTO app_version_policies(id,platform,country_code,channel,recommended_version_code,minimum_version_code,blocked_version_codes_json,warning_message_i18n,blocking_message_i18n,store_url,enforce_after,maintenance_mode,active,reason,updated_by)
		 VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET country_code=excluded.country_code,channel=excluded.channel,
		 recommended_version_code=excluded.recommended_version_code,minimum_version_code=excluded.minimum_version_code,blocked_version_codes_json=excluded.blocked_version_codes_json,
		 warning_message_i18n=excluded.warning_message_i18n,blocking_message_i18n=excluded.blocking_message_i18n,store_url=excluded.store_url,enforce_after=excluded.enforce_after,
		 maintenance_mode=excluded.maintenance_mode,active=excluded.active,reason=excluded.reason,updated_by=excluded.updated_by,updated_at=datetime('now')`,
	).bind(id, String(input.platform ?? "android"), input.country_code || null, String(input.channel ?? "production"), recommended, minimum, JSON.stringify(input.blocked_version_codes ?? []), JSON.stringify(input.warning_message ?? {}), JSON.stringify(input.blocking_message ?? {}), input.store_url || null, input.enforce_after || null, bool(input.maintenance_mode), input.active === false ? 0 : 1, reason, admin.sub).run();
	await auditDb(env, admin, "app_version.saved", { entity: "app_version_policy", entity_id: id, reason }, request);
	return jsonResponse({ ok: true, id });
}

export async function effectiveAppVersionPolicy(env: AdminWorkerEnv, platform: string, country: string | null): Promise<Record<string, unknown> | null> {
	return env.orderak_db.prepare(
		`SELECT * FROM app_version_policies WHERE platform=? AND active=1 AND (country_code=? OR country_code IS NULL)
		 ORDER BY CASE WHEN country_code=? THEN 0 ELSE 1 END,updated_at DESC LIMIT 1`,
	).bind(platform, country, country).first<Record<string, unknown>>();
}

async function buyers(env: AdminWorkerEnv, url: URL): Promise<Response> {
	const { limit, offset } = page(url);
	const storeId = url.searchParams.get("store_id");
	const q = `%${url.searchParams.get("q") ?? ""}%`;
	const result = await env.orderak_db.prepare(
		`SELECT o.store_id,s.store_name,o.buyer_phone,MAX(o.buyer_name) buyer_name,COUNT(*) order_count,SUM(o.total_piasters) total_piasters,MAX(o.created_at) last_order_at,
		 MAX(CASE WHEN r.status='blocked' AND r.revoked_at IS NULL AND (r.expires_at IS NULL OR r.expires_at>datetime('now')) THEN 1 ELSE 0 END) restricted
		 FROM orders o JOIN sellers s ON s.id=o.store_id LEFT JOIN buyer_restrictions r ON r.store_id=o.store_id AND r.buyer_phone_last4=substr(o.buyer_phone,-4)
		 WHERE (? IS NULL OR o.store_id=?) AND (o.buyer_name LIKE ? OR o.buyer_phone LIKE ?)
		 GROUP BY o.store_id,o.buyer_phone ORDER BY last_order_at DESC LIMIT ? OFFSET ?`,
	).bind(storeId, storeId, q, q, limit, offset).all<Record<string, unknown>>();
	return jsonResponse({ items: result.results.map((row) => ({ ...row, buyer_phone: maskPhone(String(row.buyer_phone ?? "")) })), limit, offset });
}

function maskPhone(phone: string): string {
	return phone.length <= 4 ? "••••" : `${phone.slice(0, 2)}••••••${phone.slice(-4)}`;
}

async function phoneHash(env: AdminWorkerEnv, phone: string): Promise<string> {
	const pepper = env.BUYER_PRIVACY_PEPPER;
	if (!pepper) throw new Error("admin privacy pepper unavailable");
	return keyedHash(phone.replace(/\D/g, ""), pepper);
}

async function restrictBuyer(request: Request, env: AdminWorkerEnv, admin: AdminClaims): Promise<Response> {
	const input = await body(request);
	const phone = String(input.buyer_phone ?? "");
	const storeId = input.store_id ? String(input.store_id) : null;
	const reason = String(input.reason ?? "").trim();
	if (phone.replace(/\D/g, "").length < 7 || reason.length < 5) return jsonResponse({ error: "phone_and_reason_required" }, 400);
	const id = crypto.randomUUID();
	await env.orderak_db.prepare("INSERT INTO buyer_restrictions(id,store_id,buyer_phone_hash,buyer_phone_last4,scope,status,reason,evidence,expires_at,created_by) VALUES(?,?,?,?,?,'blocked',?,?,?,?)")
		.bind(id, storeId, await phoneHash(env, phone), phone.replace(/\D/g, "").slice(-4), storeId ? "store" : "platform", reason, input.evidence || null, input.expires_at || null, admin.sub).run();
	await auditDb(env, admin, "buyer.restricted", { entity: "buyer", entity_id: id, store_id: storeId, reason }, request);
	return jsonResponse({ ok: true, id }, 201);
}

async function revokeBuyerRestriction(env: AdminWorkerEnv, id: string, admin: AdminClaims): Promise<Response> {
	await env.orderak_db.prepare("UPDATE buyer_restrictions SET revoked_at=datetime('now') WHERE id=? AND revoked_at IS NULL").bind(id).run();
	await auditDb(env, admin, "buyer.restriction_revoked", { entity: "buyer_restriction", entity_id: id });
	return jsonResponse({ ok: true });
}

async function buyerPrivacy(env: AdminWorkerEnv, url: URL): Promise<Response> {
	const { limit, offset } = page(url);
	const rows = await env.orderak_db.prepare("SELECT * FROM buyer_privacy_requests ORDER BY requested_at DESC LIMIT ? OFFSET ?").bind(limit, offset).all();
	return jsonResponse({ items: rows.results, limit, offset });
}

async function saveBuyerPrivacy(request: Request, env: AdminWorkerEnv, admin: AdminClaims): Promise<Response> {
	const input = await body(request);
	const phone = String(input.buyer_phone ?? "");
	const requestType = String(input.request_type ?? "access");
	if (phone.replace(/\D/g, "").length < 7 || !allowed(requestType, ["access", "correction", "deletion", "restriction"])) return jsonResponse({ error: "invalid_privacy_request" }, 400);
	const id = crypto.randomUUID();
	await env.orderak_db.prepare("INSERT INTO buyer_privacy_requests(id,store_id,buyer_phone_hash,buyer_phone_last4,request_type,status,notes,updated_by) VALUES(?,?,?,?,?,'open',?,?)")
		.bind(id, input.store_id || null, await phoneHash(env, phone), phone.replace(/\D/g, "").slice(-4), requestType, input.notes || null, admin.sub).run();
	await auditDb(env, admin, "buyer.privacy_requested", { entity: "buyer_privacy", entity_id: id, request_type: requestType }, request);
	return jsonResponse({ ok: true, id }, 201);
}

async function updateBuyerPrivacy(request: Request, env: AdminWorkerEnv, id: string, admin: AdminClaims): Promise<Response> {
	const input = await body(request);
	const status = String(input.status ?? "");
	if (!allowed(status, ["verified", "in_progress", "completed", "rejected"])) return jsonResponse({ error: "invalid_status" }, 400);
	const row = await env.orderak_db.prepare("SELECT * FROM buyer_privacy_requests WHERE id=?").bind(id).first<Record<string, unknown>>();
	if (!row) return jsonResponse({ error: "not_found" }, 404);
	const current = String(row.status);
	const validTransition = (current === "open" && ["verified", "rejected"].includes(status))
		|| (current === "verified" && ["in_progress", "rejected"].includes(status))
		|| (current === "in_progress" && ["completed", "rejected"].includes(status));
	if (!validTransition) return jsonResponse({ error: "invalid_transition", current_status: current }, 409);
	if (status === "completed" && ["deletion", "correction"].includes(String(row.request_type))) {
		const phone = String(input.buyer_phone ?? "");
		if (phone.replace(/\D/g, "").length < 7 || await phoneHash(env, phone) !== row.buyer_phone_hash) return jsonResponse({ error: "identity_reverification_required" }, 403);
		const storeId = row.store_id == null ? null : String(row.store_id);
		if (row.request_type === "deletion") {
			const anonymized = `deleted:${String(row.buyer_phone_hash).slice(0, 20)}`;
			await env.orderak_db.prepare("UPDATE orders SET buyer_name='Deleted customer',buyer_phone=? WHERE buyer_phone=? AND (? IS NULL OR store_id=?)")
				.bind(anonymized, phone, storeId, storeId).run();
		} else {
			const correctedName = String(input.corrected_name ?? "").trim();
			if (!correctedName) return jsonResponse({ error: "corrected_name_required" }, 400);
			await env.orderak_db.prepare("UPDATE orders SET buyer_name=? WHERE buyer_phone=? AND (? IS NULL OR store_id=?)")
				.bind(correctedName, phone, storeId, storeId).run();
		}
	}
	await env.orderak_db.prepare("UPDATE buyer_privacy_requests SET status=?,notes=COALESCE(?,notes),completed_at=CASE WHEN ? IN ('completed','rejected') THEN datetime('now') ELSE NULL END,updated_by=? WHERE id=?")
		.bind(status, input.notes || null, status, admin.sub, id).run();
	await auditDb(env, admin, "buyer.privacy_transitioned", { entity: "buyer_privacy", entity_id: id, request_type: row.request_type, from_status: current, to_status: status }, request);
	return jsonResponse({ ok: true });
}

async function administrators(env: AdminWorkerEnv): Promise<Response> {
	const rows = await env.orderak_db.prepare("SELECT id,email,name,role,lang,timezone,totp_enabled,mfa_required,active,created_at,last_login_at FROM admin_users ORDER BY active DESC,email").all();
	return jsonResponse({ items: rows.results, roles: ALL_ROLES });
}

async function invitations(env: AdminWorkerEnv): Promise<Response> {
	const rows = await env.orderak_db.prepare("SELECT id,email,name,role,expires_at,created_by,created_at,accepted_at,revoked_at FROM admin_invitations ORDER BY created_at DESC LIMIT 200").all();
	return jsonResponse({ items: rows.results });
}

async function createInvitation(request: Request, env: AdminWorkerEnv, admin: AdminClaims): Promise<Response> {
	const input = await body(request);
	const email = String(input.email ?? "").trim().toLowerCase();
	const role = String(input.role ?? "readonly") as AdminRole;
	if (!email.includes("@") || !ALL_ROLES.includes(role) || role === "owner") return jsonResponse({ error: "invalid_invitation" }, 400);
	const token = randomToken();
	const pepper = env.ADMIN_SESSION_PEPPER;
	if (!pepper) return jsonResponse({ error: "server_misconfigured" }, 500);
	const id = crypto.randomUUID();
	await env.orderak_db.prepare("INSERT INTO admin_invitations(id,email,name,role,token_hash,expires_at,created_by) VALUES(?,?,?,?,?,datetime('now','+24 hours'),?)")
		.bind(id, email, input.name || null, role, await keyedHash(token, pepper), admin.sub).run();
	await auditDb(env, admin, "admin.invited", { entity: "admin_invitation", entity_id: id, email, role }, request);
	// The token is intentionally returned exactly once; the Pages UI may copy it
	// into a separately governed invitation delivery workflow.
	return jsonResponse({ ok: true, id, invitation_token: token, expires_in_seconds: 86400 }, 201);
}

async function revokeInvitation(env: AdminWorkerEnv, id: string, admin: AdminClaims): Promise<Response> {
	await env.orderak_db.prepare("UPDATE admin_invitations SET revoked_at=datetime('now') WHERE id=? AND accepted_at IS NULL AND revoked_at IS NULL").bind(id).run();
	await auditDb(env, admin, "admin.invitation_revoked", { entity: "admin_invitation", entity_id: id });
	return jsonResponse({ ok: true });
}

async function updateAdministrator(request: Request, env: AdminWorkerEnv, id: number, admin: AdminClaims): Promise<Response> {
	const input = await body(request);
	if (id === admin.sub && input.active === false) return jsonResponse({ error: "cannot_deactivate_self" }, 409);
	const target = await env.orderak_db.prepare("SELECT id,role,active FROM admin_users WHERE id=?").bind(id).first<{ id: number; role: string; active: number }>();
	if (!target) return jsonResponse({ error: "not_found" }, 404);
	const role = input.role == null ? target.role : String(input.role);
	const active = input.active == null ? target.active : bool(input.active);
	if (!ALL_ROLES.includes(role as AdminRole)) return jsonResponse({ error: "invalid_role" }, 400);
	if ((target.role === "owner" || role !== target.role || active === 0) && !(await consumeActionAuthorization(request, env, admin, "admin.access_change", String(id)))) return jsonResponse({ error: "fresh_action_authorization_required" }, 403);
	if (target.role === "owner" && active === 0) {
		const owners = await env.orderak_db.prepare("SELECT COUNT(*) c FROM admin_users WHERE role='owner' AND active=1").first<{ c: number }>();
		if ((owners?.c ?? 0) <= 1) return jsonResponse({ error: "last_owner_protected" }, 409);
	}
	await env.orderak_db.batch([
		env.orderak_db.prepare("UPDATE admin_users SET role=?,active=?,updated_at=datetime('now') WHERE id=?").bind(role, active, id),
		...(active ? [] : [env.orderak_db.prepare("UPDATE admin_sessions SET revoked_at=datetime('now'),revoked_by=?,revocation_reason='admin_deactivated' WHERE admin_id=? AND revoked_at IS NULL").bind(admin.sub, id)]),
	]);
	await auditDb(env, admin, "admin.access_changed", { entity: "admin", entity_id: id, role, active }, request);
	return jsonResponse({ ok: true });
}

async function sessions(env: AdminWorkerEnv, admin: AdminClaims): Promise<Response> {
	const rows = await env.orderak_db.prepare(
		`SELECT s.id,s.admin_id,u.email,u.name,s.ip,s.user_agent,s.created_at,s.last_used_at,s.idle_expires_at,s.expires_at,s.revoked_at,s.revocation_reason
		 FROM admin_sessions s JOIN admin_users u ON u.id=s.admin_id WHERE (?='owner' OR s.admin_id=?) ORDER BY s.created_at DESC LIMIT 300`,
	).bind(admin.role, admin.sub).all();
	return jsonResponse({ items: rows.results, current_session_id: admin.sid });
}

async function revokeSession(request: Request, env: AdminWorkerEnv, id: string, admin: AdminClaims): Promise<Response> {
	const row = await env.orderak_db.prepare("SELECT admin_id FROM admin_sessions WHERE id=?").bind(id).first<{ admin_id: number }>();
	if (!row || (admin.role !== "owner" && row.admin_id !== admin.sub)) return jsonResponse({ error: "not_found" }, 404);
	await env.orderak_db.prepare("UPDATE admin_sessions SET revoked_at=datetime('now'),revoked_by=?,revocation_reason='manual_revoke' WHERE id=? AND revoked_at IS NULL").bind(admin.sub, id).run();
	await auditDb(env, admin, "admin.session_revoked", { entity: "admin_session", entity_id: id }, request);
	return jsonResponse({ ok: true });
}

async function securityWorkspace(env: AdminWorkerEnv): Promise<Response> {
	const [alerts, sessionsResult, invites, critical, archive] = await Promise.all([
		env.orderak_db.prepare("SELECT * FROM security_alerts ORDER BY status='open' DESC,last_seen_at DESC LIMIT 200").all(),
		env.orderak_db.prepare("SELECT COUNT(*) total,SUM(revoked_at IS NULL AND expires_at>datetime('now') AND idle_expires_at>datetime('now')) active FROM admin_sessions").first(),
		env.orderak_db.prepare("SELECT COUNT(*) total,SUM(accepted_at IS NULL AND revoked_at IS NULL AND expires_at>datetime('now')) active FROM admin_invitations").first(),
		env.orderak_db.prepare("SELECT * FROM admin_audit WHERE action LIKE '%delete%' OR action LIKE '%suspend%' OR action LIKE '%break_glass%' OR action LIKE '%access%' ORDER BY id DESC LIMIT 50").all(),
		env.orderak_db.prepare("SELECT * FROM admin_audit_exports ORDER BY last_audit_id DESC LIMIT 20").all(),
	]);
	return jsonResponse({ alerts: alerts.results, sessions: sessionsResult, invitations: invites, recent_critical_actions: critical.results, audit_archives: archive.results });
}

async function updateAlert(request: Request, env: AdminWorkerEnv, id: string, admin: AdminClaims): Promise<Response> {
	const input = await body(request);
	const status = String(input.status ?? "acknowledged");
	if (!allowed(status, ["open", "acknowledged", "resolved"])) return jsonResponse({ error: "invalid_status" }, 400);
	await env.orderak_db.prepare(
		`UPDATE security_alerts SET status=?,acknowledged_at=CASE WHEN ?='acknowledged' THEN datetime('now') ELSE acknowledged_at END,
		 acknowledged_by=CASE WHEN ?='acknowledged' THEN ? ELSE acknowledged_by END,resolved_at=CASE WHEN ?='resolved' THEN datetime('now') ELSE NULL END,
		 resolved_by=CASE WHEN ?='resolved' THEN ? ELSE NULL END,resolution_note=? WHERE id=?`,
	).bind(status, status, status, admin.sub, status, status, admin.sub, input.resolution_note || null, id).run();
	await auditDb(env, admin, "security.alert_updated", { entity: "security_alert", entity_id: id, status }, request);
	return jsonResponse({ ok: true });
}

async function authorizeAction(request: Request, env: AdminWorkerEnv, admin: AdminClaims): Promise<Response> {
	if (admin.role !== "owner") return jsonResponse({ error: "owner_required" }, 403);
	const input = await body(request);
	const action = String(input.action ?? "");
	const entityId = input.entity_id == null ? null : String(input.entity_id);
	if (!action || !(await verifyFreshAdminAuth(env, admin, String(input.password ?? ""), String(input.totp_code ?? "")))) {
		await auditDb(env, admin, "admin.action_authorization_failed", { entity_id: entityId, requested_action: action }, request);
		return jsonResponse({ error: "fresh_auth_failed" }, 403);
	}
	const id = crypto.randomUUID();
	const payloadHash = await sha256Hex(String(input.payload_hash ?? "none"));
	await env.orderak_db.prepare("INSERT INTO admin_action_authorizations(id,admin_id,action,entity_id,payload_hash,expires_at,verified_at) VALUES(?,?,?,?,?,datetime('now','+5 minutes'),datetime('now'))")
		.bind(id, admin.sub, action, entityId, payloadHash).run();
	await auditDb(env, admin, "admin.action_authorized", { entity: "action_authorization", entity_id: id, requested_action: action, target_id: entityId }, request);
	return jsonResponse({ ok: true, authorization_id: id, expires_in_seconds: 300 });
}

export async function consumeActionAuthorization(request: Request, env: AdminWorkerEnv, admin: AdminClaims, action: string, entityId: string | null): Promise<boolean> {
	const id = request.headers.get("x-admin-action-authorization") ?? "";
	if (!id) return false;
	const row = await env.orderak_db.prepare("SELECT id FROM admin_action_authorizations WHERE id=? AND admin_id=? AND action=? AND COALESCE(entity_id,'')=COALESCE(?,'') AND verified_at IS NOT NULL AND consumed_at IS NULL AND expires_at>datetime('now')")
		.bind(id, admin.sub, action, entityId).first();
	if (!row) return false;
	await env.orderak_db.prepare("UPDATE admin_action_authorizations SET consumed_at=datetime('now') WHERE id=? AND consumed_at IS NULL").bind(id).run();
	return true;
}

async function supportMacros(env: AdminWorkerEnv): Promise<Response> {
	const rows = await env.orderak_db.prepare("SELECT * FROM support_macros ORDER BY active DESC,category,name").all();
	return jsonResponse({ items: rows.results });
}

async function saveSupportMacro(request: Request, env: AdminWorkerEnv, admin: AdminClaims): Promise<Response> {
	const input = await body(request);
	const name = String(input.name ?? "").trim();
	const macroBody = String(input.body ?? "").trim();
	if (!name || !macroBody) return jsonResponse({ error: "name_and_body_required" }, 400);
	const id = String(input.id ?? crypto.randomUUID());
	await env.orderak_db.prepare("INSERT INTO support_macros(id,name,category,locale,body,active,updated_by) VALUES(?,?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET name=excluded.name,category=excluded.category,locale=excluded.locale,body=excluded.body,active=excluded.active,updated_by=excluded.updated_by,updated_at=datetime('now')")
		.bind(id, name, String(input.category ?? "general"), String(input.locale ?? "en"), macroBody, input.active === false ? 0 : 1, admin.sub).run();
	await auditDb(env, admin, "support.macro_saved", { entity: "support_macro", entity_id: id }, request);
	return jsonResponse({ ok: true, id });
}

async function deleteSupportMacro(env: AdminWorkerEnv, id: string, admin: AdminClaims): Promise<Response> {
	await env.orderak_db.prepare("UPDATE support_macros SET active=0,updated_by=?,updated_at=datetime('now') WHERE id=?").bind(admin.sub, id).run();
	await auditDb(env, admin, "support.macro_disabled", { entity: "support_macro", entity_id: id });
	return jsonResponse({ ok: true });
}

async function contentConfigs(env: AdminWorkerEnv, url: URL): Promise<Response> {
	const key = url.searchParams.get("key");
	const rows = await env.orderak_db.prepare("SELECT * FROM content_configs WHERE (? IS NULL OR content_key=?) ORDER BY content_key,locale,version DESC LIMIT 300").bind(key, key).all();
	return jsonResponse({ items: rows.results });
}

async function saveContentConfig(request: Request, env: AdminWorkerEnv, admin: AdminClaims): Promise<Response> {
	const input = await body(request);
	const key = String(input.content_key ?? "").trim();
	const locale = String(input.locale ?? "en");
	if (!key || !allowed(locale, ["ar", "en", "fr"])) return jsonResponse({ error: "invalid_content_config" }, 400);
	const latest = await env.orderak_db.prepare("SELECT COALESCE(MAX(version),0) version FROM content_configs WHERE content_key=? AND locale=?").bind(key, locale).first<{ version: number }>();
	const id = crypto.randomUUID();
	await env.orderak_db.prepare("INSERT INTO content_configs(id,content_key,locale,audience,version,status,value_json,starts_at,ends_at,created_by) VALUES(?,?,?,?,?,'draft',?,?,?,?)")
		.bind(id, key, locale, String(input.audience ?? "all"), (latest?.version ?? 0) + 1, JSON.stringify(input.value ?? {}), input.starts_at || null, input.ends_at || null, admin.sub).run();
	await auditDb(env, admin, "content.version_created", { entity: "content_config", entity_id: id, content_key: key, locale }, request);
	return jsonResponse({ ok: true, id, version: (latest?.version ?? 0) + 1 }, 201);
}

async function publishContentConfig(env: AdminWorkerEnv, id: string, admin: AdminClaims): Promise<Response> {
	const row = await env.orderak_db.prepare("SELECT content_key,locale FROM content_configs WHERE id=?").bind(id).first<{ content_key: string; locale: string }>();
	if (!row) return jsonResponse({ error: "not_found" }, 404);
	await env.orderak_db.batch([
		env.orderak_db.prepare("UPDATE content_configs SET status='retired' WHERE content_key=? AND locale=? AND status='published'").bind(row.content_key, row.locale),
		env.orderak_db.prepare("UPDATE content_configs SET status='published',published_by=?,published_at=datetime('now') WHERE id=? AND status='draft'").bind(admin.sub, id),
	]);
	await auditDb(env, admin, "content.published", { entity: "content_config", entity_id: id, content_key: row.content_key });
	return jsonResponse({ ok: true });
}

async function exports(env: AdminWorkerEnv, admin: AdminClaims): Promise<Response> {
	const rows = await env.orderak_db.prepare("SELECT id,export_type,classification,filters_json,status,row_count,byte_count,created_at,completed_at,expires_at,downloaded_at,error_message FROM admin_exports WHERE (?='owner' OR requested_by=?) ORDER BY created_at DESC LIMIT 100").bind(admin.role, admin.sub).all();
	return jsonResponse({ items: rows.results, limits: { synchronous_rows: 1000, asynchronous_rows: 100000, asynchronous_bytes: 50_000_000, retention_hours: 24, download_token_minutes: 5 } });
}

async function createExport(request: Request, env: AdminWorkerEnv, admin: AdminClaims): Promise<Response> {
	const input = await body(request);
	const type = String(input.export_type ?? "");
	const classification = String(input.classification ?? "internal");
	if (!allowed(type, ["stores", "buyers", "subscriptions", "support", "audit"]) || !allowed(classification, ["internal", "sensitive"])) return jsonResponse({ error: "invalid_export" }, 400);
	if (classification === "sensitive" && !(await consumeActionAuthorization(request, env, admin, "export.sensitive", type))) return jsonResponse({ error: "fresh_action_authorization_required" }, 403);
	const id = crypto.randomUUID();
	await env.orderak_db.prepare("INSERT INTO admin_exports(id,export_type,classification,filters_json,status,expires_at,requested_by) VALUES(?,?,?,?, 'queued',datetime('now','+24 hours'),?)")
		.bind(id, type, classification, JSON.stringify(input.filters ?? {}), admin.sub).run();
	if (env.ADMIN_EXPORT_QUEUE) await env.ADMIN_EXPORT_QUEUE.send({ exportId: id, requestedBy: admin.sub });
	else await generateExport(env, id, admin.sub);
	await auditDb(env, admin, "export.requested", { entity: "admin_export", entity_id: id, export_type: type, classification }, request);
	const generated = env.ADMIN_EXPORT_QUEUE ? null : await env.orderak_db.prepare("SELECT status,error_message FROM admin_exports WHERE id=?").bind(id).first<Record<string, unknown>>();
	return jsonResponse({ ok: true, id, status: env.ADMIN_EXPORT_QUEUE ? "queued" : generated?.status ?? "failed", error: generated?.error_message ?? undefined }, 202);
}

const EXPORT_PAGE_SIZE = 500;
const MAX_EXPORT_ROWS = 100_000;
const MAX_EXPORT_BYTES = 250_000_000;
const EXPORT_TYPES = new Set(["stores", "buyers", "subscriptions", "support", "audit"]);

class PermanentExportError extends Error {}

type ExportPage = {
	rows: Record<string, unknown>[];
	cursor: Record<string, unknown> | null;
};

export async function generateExport(env: AdminWorkerEnv, id: string, requestedBy: number): Promise<void> {
	const job = await env.orderak_db.prepare(
		`UPDATE admin_exports SET status='processing',attempt_count=COALESCE(attempt_count,0)+1,
		 lease_expires_at=datetime('now','+15 minutes'),error_message=NULL
		 WHERE id=? AND requested_by=? AND (
		   status IN ('queued','retrying') OR
		   (status='processing' AND lease_expires_at<=datetime('now'))
		 ) RETURNING *`,
	).bind(id, requestedBy).first<Record<string, unknown>>();
	if (!job) {
		const state = await env.orderak_db.prepare("SELECT status FROM admin_exports WHERE id=? AND requested_by=?")
			.bind(id, requestedBy).first<{ status: string }>();
		if (!state || state.status === "completed" || state.status === "failed") return;
		throw new Error("export_job_lease_unavailable");
	}

	const type = String(job.export_type);
	if (!EXPORT_TYPES.has(type)) {
		await failExport(env, id, "unsupported_export_type");
		return;
	}
	if (!env.orderak_audit) {
		await env.orderak_db.prepare(
			`UPDATE admin_exports SET status='retrying',lease_expires_at=NULL,
			 error_message='private_export_bucket_unavailable' WHERE id=?`,
		).bind(id).run();
		throw new Error("private_export_bucket_unavailable");
	}

	const key = `exports/${id}.csv`;
	const writer = new R2CsvWriter(env.orderak_audit, key, {
		httpMetadata: { contentType: "text/csv; charset=utf-8" },
		customMetadata: { requestedBy: String(requestedBy), exportType: type },
	});
	let cursor: Record<string, unknown> | null = null;
	let columns: string[] | null = null;
	let rowCount = 0;

	try {
		for (;;) {
			const remaining = MAX_EXPORT_ROWS - rowCount;
			const page = await loadExportPage(env.orderak_db, type, cursor, Math.min(EXPORT_PAGE_SIZE, remaining + 1));
			if (page.rows.length > remaining) throw new PermanentExportError("export_row_limit_exceeded");
			if (!page.rows.length) break;
			columns ??= Object.keys(page.rows[0]);
			if (rowCount === 0) await writer.write(`\ufeff${columns.map(csvCell).join(",")}\r\n`);
			await writer.write(`${page.rows.map((row) => columns!.map((column) => csvCell(row[column])).join(",")).join("\r\n")}\r\n`);
			rowCount += page.rows.length;
			cursor = page.cursor;
			if (writer.byteLength > MAX_EXPORT_BYTES) throw new PermanentExportError("export_byte_limit_exceeded");
		}
		await writer.complete();
		await env.orderak_db.prepare(
			`UPDATE admin_exports SET status='completed',row_count=?,byte_count=?,r2_key=?,
			 completed_at=datetime('now'),lease_expires_at=NULL,error_message=NULL WHERE id=?`,
		).bind(rowCount, writer.byteLength, key, id).run();
	} catch (error) {
		await writer.abort();
		const message = error instanceof Error ? error.message : "export_failed";
		if (error instanceof PermanentExportError) {
			await failExport(env, id, message);
			return;
		}
		await env.orderak_db.prepare(
			`UPDATE admin_exports SET status='retrying',lease_expires_at=NULL,error_message=? WHERE id=?`,
		).bind(message, id).run();
		throw error;
	}
}

export async function markExportDeadLetter(env: AdminWorkerEnv, id: string, requestedBy: number): Promise<void> {
	await env.orderak_db.prepare(
		`UPDATE admin_exports SET status='failed',lease_expires_at=NULL,
		 error_message='dead_lettered_after_retries' WHERE id=? AND requested_by=? AND status<>'completed'`,
	).bind(id, requestedBy).run();
}

async function failExport(env: AdminWorkerEnv, id: string, message: string): Promise<void> {
	await env.orderak_db.prepare(
		"UPDATE admin_exports SET status='failed',lease_expires_at=NULL,error_message=? WHERE id=?",
	).bind(message, id).run();
}

function csvCell(value: unknown): string {
	let text = value == null ? "" : typeof value === "object" ? JSON.stringify(value) : String(value);
	if (/^[=+\-@\t\r]/.test(text)) text = `'${text}`;
	return `"${text.replace(/"/g, '""')}"`;
}

async function loadExportPage(
	db: D1Database,
	type: string,
	cursor: Record<string, unknown> | null,
	limit: number,
): Promise<ExportPage> {
	if (type === "buyers") {
		const where = cursor ? "WHERE store_id>? OR (store_id=? AND buyer_phone>?)" : "";
		const statement = db.prepare(
			`SELECT store_id,buyer_name,substr(buyer_phone,-4) phone_last4,
			 COUNT(*) orders,SUM(total_piasters) total_piasters,MAX(created_at) last_order_at,
			 buyer_phone AS __cursor_phone
			 FROM orders ${where} GROUP BY store_id,buyer_phone ORDER BY store_id,buyer_phone LIMIT ?`,
		);
		const result = cursor
			? await statement.bind(cursor.store_id, cursor.store_id, cursor.phone, limit).all<Record<string, unknown>>()
			: await statement.bind(limit).all<Record<string, unknown>>();
		const raw = result.results;
		const last = raw.at(-1);
		return {
			rows: raw.map(({ __cursor_phone: _phone, ...row }) => row),
			cursor: last ? { store_id: last.store_id, phone: last.__cursor_phone } : null,
		};
	}

	const definition = type === "stores"
		? { table: "sellers", fields: "id,store_code,country_code,store_name,status,created_at", order: "created_at DESC,id DESC", cursorField: "created_at" }
		: type === "subscriptions"
			? { table: "organization_subscriptions", fields: "id,organization_id,status,source,current_period_start,current_period_end,created_at", order: "created_at DESC,id DESC", cursorField: "created_at" }
			: type === "support"
				? { table: "support_tickets", fields: "id,seller_id,subject,status,priority,assigned_to,created_at,updated_at", order: "id DESC", cursorField: "id" }
				: { table: "admin_audit", fields: "id,admin_id,action,entity,entity_id,ip,created_at", order: "id DESC", cursorField: "id" };
	const where = !cursor
		? ""
		: definition.cursorField === "created_at"
			? "WHERE created_at<? OR (created_at=? AND id<?)"
			: "WHERE id<?";
	const statement = db.prepare(`SELECT ${definition.fields} FROM ${definition.table} ${where} ORDER BY ${definition.order} LIMIT ?`);
	const result = !cursor
		? await statement.bind(limit).all<Record<string, unknown>>()
		: definition.cursorField === "created_at"
			? await statement.bind(cursor.created_at, cursor.created_at, cursor.id, limit).all<Record<string, unknown>>()
			: await statement.bind(cursor.id, limit).all<Record<string, unknown>>();
	const last = result.results.at(-1);
	return {
		rows: result.results,
		cursor: last ? { id: last.id, created_at: last.created_at } : null,
	};
}

async function downloadExport(request: Request, env: AdminWorkerEnv, id: string, admin: AdminClaims): Promise<Response> {
	const input = await body(request);
	const row = await env.orderak_db.prepare("SELECT * FROM admin_exports WHERE id=? AND status='completed' AND expires_at>datetime('now')").bind(id).first<Record<string, unknown>>();
	if (!row || (admin.role !== "owner" && Number(row.requested_by) !== admin.sub)) return jsonResponse({ error: "not_found" }, 404);
	if (row.classification === "sensitive" && !(await consumeActionAuthorization(request, env, admin, "export.sensitive", String(row.export_type)))) return jsonResponse({ error: "fresh_action_authorization_required" }, 403);
	if (!env.orderak_audit || !row.r2_key) return jsonResponse({ error: "artifact_unavailable" }, 503);
	const token = randomToken();
	const pepper = env.ADMIN_EXPORT_SIGNING_KEY ?? env.ADMIN_SESSION_PEPPER;
	if (!pepper) return jsonResponse({ error: "server_misconfigured" }, 500);
	await env.orderak_db.prepare("UPDATE admin_exports SET download_token_hash=?,download_expires_at=datetime('now','+5 minutes') WHERE id=?").bind(await keyedHash(token, pepper), id).run();
	await auditDb(env, admin, "export.download_authorized", { entity: "admin_export", entity_id: id, acknowledgement: input.acknowledgement ?? null }, request);
	return jsonResponse({ ok: true, download_url: `/api/admin/v1/exports/${id}/file?token=${encodeURIComponent(token)}`, expires_in_seconds: 300 });
}

export async function handleExportFile(request: Request, env: AdminWorkerEnv, url: URL, admin: AdminClaims): Promise<Response | null> {
	const match = url.pathname.match(/^\/api\/admin\/v1\/exports\/([^/]+)\/file$/);
	if (!match || request.method !== "GET") return null;
	const row = await env.orderak_db.prepare("SELECT * FROM admin_exports WHERE id=? AND status='completed' AND downloaded_at IS NULL AND expires_at>datetime('now') AND download_expires_at>datetime('now')").bind(match[1]).first<Record<string, unknown>>();
	const pepper = env.ADMIN_EXPORT_SIGNING_KEY ?? env.ADMIN_SESSION_PEPPER;
	if (!row || !pepper || !url.searchParams.get("token") || await keyedHash(url.searchParams.get("token")!, pepper) !== row.download_token_hash || (admin.role !== "owner" && Number(row.requested_by) !== admin.sub)) return jsonResponse({ error: "download_token_invalid" }, 403);
	const object = env.orderak_audit && row.r2_key ? await env.orderak_audit.get(String(row.r2_key)) : null;
	if (!object) return jsonResponse({ error: "artifact_unavailable" }, 404);
	await env.orderak_db.prepare("UPDATE admin_exports SET downloaded_at=datetime('now'),download_token_hash=NULL WHERE id=?").bind(match[1]).run();
	await auditDb(env, admin, "export.downloaded", { entity: "admin_export", entity_id: match[1], record_count: row.row_count }, request);
	return new Response(object.body, { headers: { "content-type": "text/csv; charset=utf-8", "content-disposition": `attachment; filename="orderak-${row.export_type}-${match[1]}.csv"`, "cache-control": "no-store", "x-content-type-options": "nosniff" } });
}

/**
 * The audit signing key for a given version.
 *
 * Version 1 is ADMIN_AUDIT_SIGNING_KEY, which predates versioning. Every
 * archive written before migration 043 was signed with it and carries version
 * 1 by that migration's default, so version 1 must keep resolving to that
 * exact value or history stops verifying.
 *
 * Mirrors keyForVersion in admin-auth.ts, which does the same job for TOTP.
 */
function keyForAuditVersion(env: AdminWorkerEnv, version: number): string | undefined {
	if (version === 1) return env.ADMIN_AUDIT_SIGNING_KEY;
	if (version === 2) return env.ADMIN_AUDIT_KEY_V2;
	return undefined;
}

/** The version new archives are signed with. Defaults to 1. */
function currentAuditKeyVersion(env: AdminWorkerEnv): number {
	const parsed = Number(env.ADMIN_AUDIT_KEY_CURRENT ?? "1");
	return Number.isInteger(parsed) && parsed > 0 ? parsed : 1;
}

async function hmacHex(key: string, payload: string): Promise<string> {
	const hmacKey = await crypto.subtle.importKey("raw", new TextEncoder().encode(key), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
	const signed = await crypto.subtle.sign("HMAC", hmacKey, new TextEncoder().encode(payload));
	return [...new Uint8Array(signed)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

export type AuditArchiveVerification = {
	id: string;
	object_key: string;
	signing_key_version: number;
	ok: boolean;
	reason?: "object_missing" | "key_unavailable" | "hash_mismatch" | "signature_mismatch";
};

/**
 * Read archives back out of R2 and prove they are what was written.
 *
 * There was no verification path at all before this. `admin_audit_exports`
 * carried a `verified_at` column that nothing ever wrote, and a `signature`
 * nothing ever checked — so the hash chain was being produced but never
 * relied on, which is indistinguishable from not having one until the day it
 * matters.
 *
 * Each archive is verified with the key version recorded against it, not with
 * whatever key is current. That is the whole point of migration 043: after
 * rotating to version 2, archives written under version 1 still verify.
 *
 * Content hash is checked before the signature. A mismatch there means the
 * stored object no longer matches what was recorded, which is a different
 * failure from a signature that does not match, and conflating them would
 * hide which one happened.
 */
export async function verifyAuditArchives(env: AdminWorkerEnv, limit = 20): Promise<AuditArchiveVerification[]> {
	const bucket = env.orderak_audit;
	if (!bucket) return [];
	const rows = await env.orderak_db.prepare(
		"SELECT id,object_key,content_hash,signature,signing_key_version FROM admin_audit_exports WHERE status='written' ORDER BY last_audit_id DESC LIMIT ?",
	).bind(Math.min(100, Math.max(1, limit))).all<{ id: string; object_key: string; content_hash: string; signature: string; signing_key_version: number }>();

	const results: AuditArchiveVerification[] = [];
	for (const row of rows.results) {
		const version = Number(row.signing_key_version) || 1;
		const base = { id: row.id, object_key: row.object_key, signing_key_version: version };

		const object = await bucket.get(row.object_key);
		if (!object) {
			results.push({ ...base, ok: false, reason: "object_missing" });
			continue;
		}
		const payload = await object.text();

		if (await sha256Hex(payload) !== row.content_hash) {
			results.push({ ...base, ok: false, reason: "hash_mismatch" });
			continue;
		}

		const key = keyForAuditVersion(env, version);
		if (!key) {
			// The key for this archive's version is not configured. Reported as
			// its own reason rather than a signature failure: the archive may be
			// perfectly intact, and treating "we cannot check" as "it is wrong"
			// would provoke an incident response to a configuration gap.
			results.push({ ...base, ok: false, reason: "key_unavailable" });
			continue;
		}

		const ok = await hmacHex(key, payload) === row.signature;
		results.push({ ...base, ok, ...(ok ? {} : { reason: "signature_mismatch" as const }) });
		if (ok) {
			await env.orderak_db.prepare("UPDATE admin_audit_exports SET verified_at=datetime('now') WHERE id=?").bind(row.id).run();
		}
	}
	return results;
}

export async function archiveAuditBatch(env: AdminWorkerEnv): Promise<void> {
	if (!env.orderak_audit) return;
	if (!keyForAuditVersion(env, currentAuditKeyVersion(env))) throw new Error("admin_audit_signing_key_missing");
	const holder = crypto.randomUUID();
	const lease = await env.orderak_db.prepare(
		`INSERT INTO operational_leases(job_key,holder,lease_expires_at)
		 VALUES('admin-audit-archive',?,datetime('now','+10 minutes'))
		 ON CONFLICT(job_key) DO UPDATE SET holder=excluded.holder,
		 lease_expires_at=excluded.lease_expires_at,updated_at=datetime('now')
		 WHERE operational_leases.lease_expires_at<=datetime('now')
		 RETURNING holder`,
	).bind(holder).first<{ holder: string }>();
	if (lease?.holder !== holder) return;
	try {
		for (let page = 0; page < 5; page++) {
			if (!(await archiveOneAuditPage(env))) break;
		}
	} finally {
		await env.orderak_db.prepare("DELETE FROM operational_leases WHERE job_key='admin-audit-archive' AND holder=?")
			.bind(holder).run();
	}
}

async function archiveOneAuditPage(env: AdminWorkerEnv): Promise<boolean> {
	const bucket = env.orderak_audit;
	if (!bucket) return false;
	const last = await env.orderak_db.prepare("SELECT last_audit_id,content_hash FROM admin_audit_exports WHERE status='written' ORDER BY last_audit_id DESC LIMIT 1").first<{ last_audit_id: number; content_hash: string }>();
	const rows = await env.orderak_db.prepare("SELECT * FROM admin_audit WHERE id>? ORDER BY id LIMIT 1000").bind(last?.last_audit_id ?? 0).all<Record<string, unknown>>();
	if (!rows.results.length) return false;
	const first = Number(rows.results[0].id);
	const end = Number(rows.results.at(-1)?.id);
	const payload = JSON.stringify({ version: 1, previous_hash: last?.content_hash ?? null, first_id: first, last_id: end, events: rows.results });
	const hash = await sha256Hex(payload);
	const keyVersion = currentAuditKeyVersion(env);
	const signingKey = keyForAuditVersion(env, keyVersion);
	if (!signingKey) throw new Error("admin_audit_signing_key_missing");
	const signature = await hmacHex(signingKey, payload);
	const objectKey = `audit/${new Date().toISOString().slice(0, 10)}/${first}-${end}-${hash.slice(0, 16)}.json`;
	// The version goes into R2 metadata as well as D1. Either store alone is a
	// single point of failure for verifiability: if the D1 row is lost the
	// object still says how to check it, and if the object's metadata is
	// stripped the row still does.
	await bucket.put(objectKey, payload, { httpMetadata: { contentType: "application/json" }, customMetadata: { sha256: hash, hmacSha256: signature, previousHash: last?.content_hash ?? "genesis", signingKeyVersion: String(keyVersion) } });
	await env.orderak_db.prepare("INSERT INTO admin_audit_exports(id,first_audit_id,last_audit_id,event_count,object_key,content_hash,signature,previous_hash,signing_key_version) VALUES(?,?,?,?,?,?,?,?,?)")
		.bind(crypto.randomUUID(), first, end, rows.results.length, objectKey, hash, signature, last?.content_hash ?? null, keyVersion).run();
	return true;
}

export async function acceptAdminInvitation(request: Request, env: AdminWorkerEnv): Promise<Response> {
	const input = await body(request);
	const token = String(input.invitation_token ?? "");
	const password = String(input.password ?? "");
	const pepper = env.ADMIN_SESSION_PEPPER;
	if (!pepper || token.length < 20 || password.length < 12) return jsonResponse({ error: "invalid_invitation" }, 400);
	const hash = await keyedHash(token, pepper);
	const invitation = await env.orderak_db.prepare("SELECT * FROM admin_invitations WHERE token_hash=? AND accepted_at IS NULL AND revoked_at IS NULL AND expires_at>datetime('now')").bind(hash).first<Record<string, unknown>>();
	if (!invitation) return jsonResponse({ error: "invalid_or_expired_invitation" }, 403);
	await env.orderak_db.batch([
		env.orderak_db.prepare("INSERT INTO admin_users(email,name,password_hash,role,lang,active,mfa_required,must_change_password) VALUES(?,?,?,?,?,1,1,0)").bind(invitation.email, invitation.name, await hashPassword(password), invitation.role, String(input.lang ?? "en")),
		env.orderak_db.prepare("UPDATE admin_invitations SET accepted_at=datetime('now') WHERE id=? AND accepted_at IS NULL").bind(invitation.id),
	]);
	await auditDb(env, null, "admin.invitation_accepted", { entity: "admin_invitation", entity_id: invitation.id, email: invitation.email }, request);
	return jsonResponse({ ok: true, mfa_enrollment_required: true });
}
