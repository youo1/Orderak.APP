import type { AdminClaims } from "../identity/auth";
import { auditDb } from "./admin-auth";
import { jsonResponse } from "../../platform/http/shared";
import { Hono } from "hono";
import type { AdminEnv } from "./admin-context";

type Row = Record<string, unknown>;

function id(): string { return crypto.randomUUID(); }
function asMode(value: unknown): "value" | "disabled" | "unlimited" | "custom_required" | null {
	return ["value", "disabled", "unlimited", "custom_required"].includes(String(value)) ? String(value) as ReturnType<typeof asMode> : null;
}

/** Entitlement and plan-revision routes, mounted by admin.ts. */
export const entitlementsApp = new Hono<AdminEnv>();
const ent = entitlementsApp;
const B = "/api/admin/v1";
/** Every id in this module arrived percent-encoded through a regex capture. */
const rid = (c: { req: { param: (k: string) => string } }) => decodeURIComponent(c.req.param("id"));

ent.get(`${B}/plan-catalog`, (c) => c.get("gate")("plans:view") ?? listPlans(c.env));

ent.post(`${B}/plans/:id/drafts`, (c) =>
	c.get("gate")("plans:draft") ?? createDraft(c.req.raw, c.env, rid(c), c.get("admin")));

ent.patch(`${B}/plan-revisions/:id`, (c) =>
	c.get("gate")("plans:draft") ?? updateDraft(c.req.raw, c.env, rid(c), c.get("admin")));

ent.post(`${B}/plan-revisions/:id/validate`, (c) =>
	c.get("gate")("plans:draft") ?? validateResponse(c.env, rid(c)));
// impact answers both GET and POST.
ent.on(["GET", "POST"], `${B}/plan-revisions/:id/impact`, (c) =>
	c.get("gate")("plans:view") ?? impact(c.env, rid(c)));
ent.post(`${B}/plan-revisions/:id/publish`, (c) =>
	c.get("gate")("plans:publish") ?? publish(c.req.raw, c.env, rid(c), c.get("admin")));
ent.post(`${B}/plan-revisions/:id/archive`, (c) =>
	c.get("gate")("plans:publish") ?? archive(c.req.raw, c.env, rid(c), c.get("admin")));

ent.post(`${B}/organizations/:id/entitlement-overrides`, (c) =>
	c.get("gate")("subscriptions:manage") ?? addOverride(c.req.raw, c.env, rid(c), c.get("admin")));

ent.post(`${B}/test-lab/organizations/:id/plan`, (c) =>
	c.get("gate")("subscriptions:manage") ?? applyTestPlan(c.req.raw, c.env, rid(c), c.get("admin")));
ent.delete(`${B}/test-lab/organizations/:id/plan`, (c) =>
	c.get("gate")("subscriptions:manage") ?? resetTestPlan(c.req.raw, c.env, rid(c), c.get("admin")));

ent.post(`${B}/organizations/:id/paid3-approval`, (c) =>
	c.get("gate")("plans:publish") ?? approvePaid3(c.req.raw, c.env, rid(c), c.get("admin")));

ent.get(`${B}/storefront-locales`, async (c) => {
	const denied = c.get("gate")("plans:view");
	if (denied) return denied;
	const { results } = await c.env.orderak_db
		.prepare("SELECT * FROM storefront_locale_definitions ORDER BY core_universal DESC,locale_tag").all();
	return jsonResponse({ ok: true, locales: results ?? [] });
});

ent.post(`${B}/organizations/:id/storefront-locales`, (c) =>
	c.get("gate")("subscriptions:manage") ?? setStorefrontLocale(c.req.raw, c.env, rid(c), c.get("admin")));

async function listPlans(env: AdminWorkerEnv): Promise<Response> {
	const { results: plans } = await env.orderak_db.prepare(
		`SELECT sp.*,pr.version,pr.status AS revision_status,pr.change_type,pr.updated_at AS revision_updated_at
		 FROM subscription_plans sp LEFT JOIN plan_revisions pr ON pr.id=sp.current_revision_id
		 ORDER BY sp.sort_order`,
	).all<Row>();
	const { results: revisions } = await env.orderak_db.prepare(
		`SELECT pr.*,sp.plan_key FROM plan_revisions pr JOIN subscription_plans sp ON sp.id=pr.plan_id
		 ORDER BY sp.sort_order,pr.version DESC`,
	).all<Row>();
	const { results: definitions } = await env.orderak_db.prepare(
		`SELECT * FROM entitlement_definitions WHERE active=1 ORDER BY sort_order`,
	).all<Row>();
	const { results: values } = await env.orderak_db.prepare(
		`SELECT e.* FROM plan_revision_entitlements e JOIN plan_revisions pr ON pr.id=e.revision_id
		 WHERE pr.status IN ('published','draft') ORDER BY e.entitlement_key`,
	).all<Row>();
	return jsonResponse({ ok: true, plans: plans ?? [], revisions: revisions ?? [], definitions: definitions ?? [], values });
}

async function createDraft(request: Request, env: AdminWorkerEnv, planId: string, admin: AdminClaims): Promise<Response> {
	const plan = await env.orderak_db.prepare("SELECT current_revision_id FROM subscription_plans WHERE id=? OR plan_key=?")
		.bind(planId, planId).first<{ current_revision_id: string }>();
	if (!plan) return jsonResponse({ error: "plan_not_found" }, 404);
	const existing = await env.orderak_db.prepare("SELECT id,version,updated_at FROM plan_revisions WHERE plan_id=(SELECT plan_id FROM plan_revisions WHERE id=?) AND status='draft' ORDER BY version DESC LIMIT 1")
		.bind(plan.current_revision_id).first<Row>();
	if (existing) return jsonResponse({ ok: true, draft: existing, reused: true });
	const current = await env.orderak_db.prepare("SELECT plan_id,version,source_catalog_hash FROM plan_revisions WHERE id=?")
		.bind(plan.current_revision_id).first<Row>();
	if (!current) return jsonResponse({ error: "current_revision_missing" }, 409);
	const revisionId = id();
	await env.orderak_db.batch([
		env.orderak_db.prepare(
			`INSERT INTO plan_revisions(id,plan_id,version,status,change_type,source_catalog_hash,created_by)
			 VALUES(?,?,?,'draft','additive',?,?)`,
		).bind(revisionId, current.plan_id, Number(current.version) + 1, current.source_catalog_hash, admin.sub),
		env.orderak_db.prepare(
			`INSERT INTO plan_revision_entitlements
			 (revision_id,entitlement_key,value_mode,bool_value,int_value,text_value,display_value)
			 SELECT ?,entitlement_key,value_mode,bool_value,int_value,text_value,display_value
			 FROM plan_revision_entitlements WHERE revision_id=?`,
		).bind(revisionId, plan.current_revision_id),
	]);
	await auditDb(env, admin, "admin.plan_draft_created", { entity: "plan_revision", entity_id: revisionId }, request);
	return jsonResponse({ ok: true, draft: { id: revisionId, version: Number(current.version) + 1 } }, 201);
}

async function updateDraft(request: Request, env: AdminWorkerEnv, revisionId: string, admin: AdminClaims): Promise<Response> {
	const body = await request.json<Row>().catch(() => ({} as Row));
	const revision = await env.orderak_db.prepare("SELECT status,updated_at,lock_version FROM plan_revisions WHERE id=?")
		.bind(revisionId).first<{ status: string; updated_at: string; lock_version: number }>();
	if (!revision) return jsonResponse({ error: "revision_not_found" }, 404);
	if (revision.status !== "draft") return jsonResponse({ error: "published_revision_immutable" }, 409);
	const expectedRaw = request.headers.get("if-match")?.replaceAll('"', "") || String(body.expected_lock_version ?? "");
	if (!expectedRaw) return jsonResponse({ error: "if_match_required", current_lock_version: revision.lock_version }, 428);
	const expected = Number(expectedRaw);
	if (!Number.isInteger(expected) || expected !== Number(revision.lock_version))
		return jsonResponse({ error: "revision_conflict", current_lock_version: revision.lock_version }, 409);
	const changes = Array.isArray(body.entitlements) ? body.entitlements as Row[] : [];
	if (!changes.length) return jsonResponse({ error: "entitlements_required" }, 400);
	const uniqueKeys = [...new Set(changes.map((change) => String(change.entitlement_key ?? "")).filter((key) => key.length > 0))];
	if (!uniqueKeys.length) return jsonResponse({ error: "entitlements_required" }, 400);
	const placeholders = uniqueKeys.map(() => "?").join(",");
	const { results: definitionRows } = await env.orderak_db.prepare(
		`SELECT entitlement_key,value_type,supports_unlimited,admin_configurable,implementation_status
		 FROM entitlement_definitions
		 WHERE active=1 AND entitlement_key IN (${placeholders})`,
	).bind(...uniqueKeys).all<Row>();
	const definitionByKey = new Map((definitionRows ?? []).map((row) => [String(row.entitlement_key), row]));
	const prepared: Array<{ key: string; mode: string; bool: number | null; integer: number | null; text: unknown; display: string }> = [];
	for (const change of changes) {
		const key = String(change.entitlement_key ?? "");
		const mode = asMode(change.value_mode);
		const definition = definitionByKey.get(key);
		if (!definition) return jsonResponse({ error: "entitlement_not_found", entitlement_key: key }, 404);
		if (!Number(definition.admin_configurable) || definition.implementation_status !== "implemented")
			return jsonResponse({ error: "entitlement_not_configurable", entitlement_key: key }, 409);
		if (!mode || mode === "custom_required") return jsonResponse({ error: "invalid_value_mode", entitlement_key: key }, 400);
		if (mode === "unlimited" && !Number(definition.supports_unlimited)) return jsonResponse({ error: "unlimited_not_supported", entitlement_key: key }, 400);
		const integer = change.int_value == null ? null : Math.floor(Number(change.int_value));
		if (definition.value_type === "integer" && mode === "value" && (!Number.isFinite(integer) || Number(integer) < 0))
			return jsonResponse({ error: "invalid_integer", entitlement_key: key }, 400);
		if (definition.value_type === "boolean" && mode === "value" && typeof change.bool_value !== "boolean")
			return jsonResponse({ error: "invalid_boolean", entitlement_key: key }, 400);
		prepared.push({
			key, mode, bool: change.bool_value == null ? null : change.bool_value ? 1 : 0, integer,
			text: change.text_value ?? null,
			display: String(change.display_value ?? (mode === "unlimited" ? "Unlimited" : integer ?? change.bool_value ?? "Disabled")),
		});
	}
	const changeType = ["additive", "restrictive", "mixed"].includes(String(body.change_type)) ? String(body.change_type) : "mixed";
	const editToken = id();
	const statements: D1PreparedStatement[] = [env.orderak_db.prepare(
		`UPDATE plan_revisions SET change_type=?,lock_version=lock_version+1,edit_token=?,updated_at=datetime('now')
		 WHERE id=? AND status='draft' AND lock_version=?`,
	).bind(changeType, editToken, revisionId, expected)];
	for (const change of prepared) statements.push(env.orderak_db.prepare(
		`UPDATE plan_revision_entitlements SET value_mode=?,bool_value=?,int_value=?,text_value=?,display_value=?,updated_at=datetime('now')
		 WHERE revision_id=? AND entitlement_key=? AND EXISTS(
		 SELECT 1 FROM plan_revisions pr WHERE pr.id=? AND pr.edit_token=?)`,
	).bind(change.mode, change.bool, change.integer, change.text, change.display, revisionId, change.key, revisionId, editToken));
	const results = await env.orderak_db.batch(statements);
	if (!results[0].meta?.changes) return jsonResponse({ error: "revision_conflict" }, 409);
	await auditDb(env, admin, "admin.plan_draft_updated", { entity: "plan_revision", entity_id: revisionId, entitlement_keys: changes.map((c) => c.entitlement_key) }, request);
	return jsonResponse({ ok: true, revision_id: revisionId, lock_version: expected + 1 });
}

interface Validation { valid: boolean; errors: Row[]; warnings: Row[] }
async function validateRevision(env: AdminWorkerEnv, revisionId: string): Promise<Validation> {
	const revision = await env.orderak_db.prepare("SELECT plan_id,status FROM plan_revisions WHERE id=?").bind(revisionId).first<Row>();
	if (!revision) return { valid: false, errors: [{ code: "revision_not_found" }], warnings: [] };
	const { results } = await env.orderak_db.prepare(
		`SELECT d.entitlement_key,d.value_type,d.implementation_status,d.admin_configurable,d.supports_unlimited,
		 e.value_mode,e.bool_value,e.int_value,e.text_value
		 FROM entitlement_definitions d LEFT JOIN plan_revision_entitlements e
		 ON e.entitlement_key=d.entitlement_key AND e.revision_id=? WHERE d.active=1`,
	).bind(revisionId).all<Row>();
	const errors: Row[] = [];
	const warnings: Row[] = [];
	for (const row of results ?? []) {
		if (!row.value_mode) errors.push({ code: "missing_value", entitlement_key: row.entitlement_key });
		if (row.implementation_status !== "implemented" && Number(row.admin_configurable)) errors.push({ code: "planned_configurable", entitlement_key: row.entitlement_key });
		if (row.value_type === "integer" && row.value_mode === "value" && (row.int_value == null || Number(row.int_value) < 0)) errors.push({ code: "invalid_integer", entitlement_key: row.entitlement_key });
		if (row.value_mode === "unlimited" && !Number(row.supports_unlimited)) errors.push({ code: "unlimited_not_supported", entitlement_key: row.entitlement_key });
		if (row.value_mode === "custom_required") warnings.push({ code: "custom_override_required", entitlement_key: row.entitlement_key });
	}
	const { results: ladder } = await env.orderak_db.prepare(
		`SELECT sp.plan_key,sp.sort_order,d.entitlement_key,e.value_mode,e.int_value
		 FROM subscription_plans sp JOIN plan_revision_entitlements e
		 ON e.revision_id=CASE WHEN sp.id=? THEN ? ELSE sp.current_revision_id END
		 JOIN entitlement_definitions d ON d.entitlement_key=e.entitlement_key
		 WHERE sp.active=1 AND d.higher_is_better=1 ORDER BY d.entitlement_key,sp.sort_order`,
	).bind(revision.plan_id, revisionId).all<Row>();
	const previous = new Map<string, { score: number; plan: string }>();
	for (const row of ladder ?? []) {
		const mode = String(row.value_mode);
		const score = mode === "unlimited" || mode === "custom_required" ? Number.POSITIVE_INFINITY
			: mode === "disabled" ? -1 : Number(row.int_value ?? 0);
		const prior = previous.get(String(row.entitlement_key));
		if (prior && score < prior.score) errors.push({
			code: "plan_ladder_decreases",
			entitlement_key: row.entitlement_key,
			lower_plan: prior.plan,
			higher_plan: row.plan_key,
		});
		previous.set(String(row.entitlement_key), { score, plan: String(row.plan_key) });
	}
	return { valid: errors.length === 0, errors, warnings };
}
async function validateResponse(env: AdminWorkerEnv, revisionId: string): Promise<Response> { return jsonResponse({ ok: true, ...(await validateRevision(env, revisionId)) }); }

interface ChangeAssessment {
	change_type: "additive" | "restrictive" | "mixed";
	changes: Row[];
	restrictive_changes: Row[];
}

function entitlementScore(row: Row, prefix: "old" | "new"): number {
	const mode = String(row[`${prefix}_mode`] ?? "disabled");
	const type = String(row.value_type ?? "text");
	if (type === "boolean") return mode === "value" && Number(row[`${prefix}_bool`]) ? 1 : 0;
	if (mode === "disabled") return Number.NEGATIVE_INFINITY;
	if (mode === "unlimited" || mode === "custom_required") return Number.POSITIVE_INFINITY;
	if (type === "integer") return Number(row[`${prefix}_int`] ?? 0);
	return 1;
}

async function assessChange(env: AdminWorkerEnv, revisionId: string): Promise<ChangeAssessment | null> {
	const revision = await env.orderak_db.prepare(
		`SELECT pr.plan_id,sp.current_revision_id FROM plan_revisions pr
		 JOIN subscription_plans sp ON sp.id=pr.plan_id WHERE pr.id=?`,
	).bind(revisionId).first<Row>();
	if (!revision) return null;
	const { results } = await env.orderak_db.prepare(
		`SELECT d.entitlement_key,d.value_type,d.higher_is_better,
		 o.value_mode AS old_mode,o.bool_value AS old_bool,o.int_value AS old_int,o.text_value AS old_text,o.display_value AS old_display,
		 n.value_mode AS new_mode,n.bool_value AS new_bool,n.int_value AS new_int,n.text_value AS new_text,n.display_value AS new_display
		 FROM entitlement_definitions d
		 JOIN plan_revision_entitlements o ON o.entitlement_key=d.entitlement_key AND o.revision_id=?
		 JOIN plan_revision_entitlements n ON n.entitlement_key=d.entitlement_key AND n.revision_id=?
		 WHERE d.active=1 ORDER BY d.sort_order`,
	).bind(revision.current_revision_id, revisionId).all<Row>();
	let additive = false;
	let restrictive = false;
	const changes: Row[] = [];
	for (const row of results ?? []) {
		const valueChanged = row.old_mode !== row.new_mode || row.old_bool !== row.new_bool
			|| row.old_int !== row.new_int || row.old_text !== row.new_text;
		if (!valueChanged) continue;
		const oldScore = entitlementScore(row, "old");
		const newScore = entitlementScore(row, "new");
		const rawDirection = newScore === oldScore ? 0 : newScore > oldScore ? 1 : -1;
		const benefitDirection = Number(row.higher_is_better) ? rawDirection : -rawDirection;
		const direction = benefitDirection < 0 ? "restrictive" : benefitDirection > 0 ? "additive" : "neutral";
		if (direction === "restrictive") restrictive = true;
		if (direction === "additive") additive = true;
		changes.push({
			entitlement_key: row.entitlement_key,
			old_value: row.old_display,
			new_value: row.new_display,
			direction,
		});
	}
	return {
		change_type: restrictive && additive ? "mixed" : restrictive ? "restrictive" : "additive",
		changes,
		restrictive_changes: changes.filter((change) => change.direction === "restrictive"),
	};
}

async function impact(env: AdminWorkerEnv, revisionId: string): Promise<Response> {
	const revision = await env.orderak_db.prepare("SELECT plan_id FROM plan_revisions WHERE id=?").bind(revisionId).first<Row>();
	if (!revision) return jsonResponse({ error: "revision_not_found" }, 404);
	const subscribers = await env.orderak_db.prepare(
		`SELECT COUNT(*) AS c FROM organization_subscriptions os JOIN plan_revisions pr ON pr.id=os.plan_revision_id
		 WHERE pr.plan_id=? AND os.status IN ('active','grace','canceled')`,
	).bind(revision.plan_id).first<{ c: number }>();
	const assessment = await assessChange(env, revisionId);
	if (!assessment) return jsonResponse({ error: "revision_not_found" }, 404);
	return jsonResponse({
		ok: true,
		revision_id: revisionId,
		affected_subscriptions: Number(subscribers?.c ?? 0),
		...assessment,
		restrictive_limits: assessment.restrictive_changes,
		requires_notice: assessment.restrictive_changes.length > 0,
	});
}

async function publish(request: Request, env: AdminWorkerEnv, revisionId: string, admin: AdminClaims): Promise<Response> {
	const validation = await validateRevision(env, revisionId);
	if (!validation.valid) return jsonResponse({ error: "validation_failed", ...validation }, 409);
	const revision = await env.orderak_db.prepare("SELECT plan_id,status FROM plan_revisions WHERE id=?").bind(revisionId).first<Row>();
	if (!revision) return jsonResponse({ error: "revision_not_found" }, 404);
	if (revision.status !== "draft") return jsonResponse({ error: "revision_not_draft" }, 409);
	const plan = await env.orderak_db.prepare("SELECT plan_key,current_revision_id FROM subscription_plans WHERE id=?").bind(revision.plan_id).first<Row>();
	if (!plan) return jsonResponse({ error: "plan_not_found" }, 404);
	const assessment = await assessChange(env, revisionId);
	if (!assessment) return jsonResponse({ error: "revision_not_found" }, 404);
	const changeType = assessment.change_type;
	const restrictive = changeType === "restrictive" || changeType === "mixed";
	await env.orderak_db.batch([
		env.orderak_db.prepare("UPDATE plan_revisions SET status='published',change_type=?,published_by=?,published_at=datetime('now'),updated_at=datetime('now') WHERE id=? AND status='draft'").bind(changeType, admin.sub, revisionId),
		env.orderak_db.prepare("UPDATE subscription_plans SET current_revision_id=?,updated_at=datetime('now') WHERE id=?").bind(revisionId, revision.plan_id),
	]);
	if (plan.plan_key === "free") {
		await env.orderak_db.prepare(
			`UPDATE organization_subscriptions SET plan_revision_id=?,pending_revision_id=NULL,pending_effective_at=NULL,updated_at=datetime('now')
			 WHERE id IN (SELECT os.id FROM organization_subscriptions os JOIN plan_revisions pr ON pr.id=os.plan_revision_id WHERE pr.plan_id=?)`,
		).bind(revisionId, revision.plan_id).run();
	} else {
		if (restrictive) {
			await env.orderak_db.prepare(
				`UPDATE organization_subscriptions SET pending_revision_id=?,pending_effective_at=COALESCE(current_period_end,datetime('now','+30 days')),updated_at=datetime('now')
				 WHERE id IN (SELECT os.id FROM organization_subscriptions os JOIN plan_revisions pr ON pr.id=os.plan_revision_id
				 WHERE pr.plan_id=? AND os.status IN ('active','grace','canceled'))`,
			).bind(revisionId, revision.plan_id).run();
			await env.orderak_db.prepare(
				`INSERT INTO plan_change_notices(id,organization_id,from_revision_id,to_revision_id,effective_at,change_type)
				 SELECT lower(hex(randomblob(16))),organization_id,plan_revision_id,?,COALESCE(current_period_end,datetime('now','+30 days')),?
				 FROM organization_subscriptions os JOIN plan_revisions pr ON pr.id=os.plan_revision_id
				 WHERE pr.plan_id=? AND os.pending_revision_id=?`,
			).bind(revisionId, changeType, revision.plan_id, revisionId).run();
		} else {
			await env.orderak_db.prepare(
				`UPDATE organization_subscriptions SET plan_revision_id=?,pending_revision_id=NULL,pending_effective_at=NULL,updated_at=datetime('now')
				 WHERE id IN (SELECT os.id FROM organization_subscriptions os JOIN plan_revisions pr ON pr.id=os.plan_revision_id WHERE pr.plan_id=?)`,
			).bind(revisionId, revision.plan_id).run();
		}
	}
	await auditDb(env, admin, "admin.plan_revision_published", { entity: "plan_revision", entity_id: revisionId, change_type: changeType }, request);
	return jsonResponse({ ok: true, revision_id: revisionId, change_type: changeType, rollout: restrictive ? "renewal" : "immediate" });
}

async function archive(request: Request, env: AdminWorkerEnv, revisionId: string, admin: AdminClaims): Promise<Response> {
	const used = await env.orderak_db.prepare("SELECT 1 AS used FROM organization_subscriptions WHERE plan_revision_id=? OR pending_revision_id=? LIMIT 1")
		.bind(revisionId, revisionId).first();
	if (used) return jsonResponse({ error: "revision_in_use" }, 409);
	await env.orderak_db.prepare("UPDATE plan_revisions SET status='retired',retired_at=datetime('now'),updated_at=datetime('now') WHERE id=? AND status!='published'").bind(revisionId).run();
	await auditDb(env, admin, "admin.plan_revision_archived", { entity: "plan_revision", entity_id: revisionId }, request);
	return jsonResponse({ ok: true });
}

async function addOverride(request: Request, env: AdminWorkerEnv, organizationId: string, admin: AdminClaims): Promise<Response> {
	const body = await request.json<Row>().catch(() => ({} as Row));
	const key = String(body.entitlement_key ?? "");
	const mode = asMode(body.value_mode);
	const reason = String(body.reason ?? "").trim();
	const organization = await env.orderak_db.prepare("SELECT id FROM organizations WHERE id=? AND status='active'").bind(organizationId).first();
	if (!organization) return jsonResponse({ error: "organization_not_found" }, 404);
	const definition = await env.orderak_db.prepare("SELECT value_type,implementation_status,admin_configurable,supports_unlimited FROM entitlement_definitions WHERE entitlement_key=?")
		.bind(key).first<Row>();
	if (!definition) return jsonResponse({ error: "entitlement_not_found" }, 404);
	if (definition.implementation_status !== "implemented" || !Number(definition.admin_configurable)) return jsonResponse({ error: "entitlement_not_configurable" }, 409);
	if (!mode || mode === "custom_required" || !reason) return jsonResponse({ error: "invalid_override" }, 400);
	if (mode === "unlimited" && !Number(definition.supports_unlimited)) return jsonResponse({ error: "unlimited_not_supported" }, 400);
	const intValue = body.int_value == null ? null : Math.floor(Number(body.int_value));
	if (mode === "value" && definition.value_type === "integer" && (!Number.isFinite(intValue) || Number(intValue) < 0))
		return jsonResponse({ error: "invalid_integer" }, 400);
	if (mode === "value" && definition.value_type === "boolean" && typeof body.bool_value !== "boolean")
		return jsonResponse({ error: "invalid_boolean" }, 400);
	if (body.effective_at && body.expires_at && Date.parse(String(body.expires_at)) <= Date.parse(String(body.effective_at)))
		return jsonResponse({ error: "invalid_override_window" }, 400);
	const overrideId = id();
	await env.orderak_db.prepare(
		`INSERT INTO organization_entitlement_overrides
		 (id,organization_id,entitlement_key,value_mode,bool_value,int_value,text_value,reason,effective_at,expires_at,created_by)
		 VALUES(?,?,?,?,?,?,?,?,COALESCE(?,datetime('now')),?,?)`,
	).bind(overrideId, organizationId, key, mode, body.bool_value == null ? null : body.bool_value ? 1 : 0,
		intValue, body.text_value ?? null, reason,
		body.effective_at ?? null, body.expires_at ?? null, admin.sub).run();
	await auditDb(env, admin, "admin.entitlement_override_created", { entity: "organization", entity_id: organizationId, entitlement_key: key, override_id: overrideId }, request);
	return jsonResponse({ ok: true, override_id: overrideId }, 201);
}

const TEST_LAB_PREFIX = "[TEST_LAB:";
const TEST_LAB_MAX_MS = 24 * 60 * 60 * 1_000;

function stagingOnly(env: AdminWorkerEnv): Response | null {
	return env.DEPLOYMENT_ENVIRONMENT === "staging"
		? null
		: jsonResponse({ error: "not_found" }, 404);
}

async function applyTestPlan(
	request: Request,
	env: AdminWorkerEnv,
	organizationId: string,
	admin: AdminClaims,
): Promise<Response> {
	const denied = stagingOnly(env);
	if (denied) return denied;
	const body = await request.json<Row>().catch(() => ({} as Row));
	const planKey = String(body.plan_key ?? "").trim();
	const reason = String(body.reason ?? "").trim();
	const expiresAt = String(body.expires_at ?? "");
	const expiresMs = Date.parse(expiresAt);
	const now = Date.now();
	if (!planKey || reason.length < 8)
		return jsonResponse({ error: "test_plan_and_reason_required" }, 400);
	if (!Number.isFinite(expiresMs) || expiresMs <= now || expiresMs > now + TEST_LAB_MAX_MS)
		return jsonResponse({ error: "invalid_test_lab_expiry", max_hours: 24 }, 400);
	const organization = await env.orderak_db.prepare(
		"SELECT id FROM organizations WHERE id=? AND status='active'",
	).bind(organizationId).first();
	if (!organization) return jsonResponse({ error: "organization_not_found" }, 404);
	const plan = await env.orderak_db.prepare(
		"SELECT id,current_revision_id FROM subscription_plans WHERE plan_key=? AND active=1",
	).bind(planKey).first<{ id: string; current_revision_id: string }>();
	if (!plan) return jsonResponse({ error: "plan_not_found" }, 404);
	const { results } = await env.orderak_db.prepare(
		`SELECT e.entitlement_key,e.value_mode,e.bool_value,e.int_value,e.text_value
		 FROM plan_revision_entitlements e
		 JOIN entitlement_definitions d ON d.entitlement_key=e.entitlement_key
		 WHERE e.revision_id=? AND d.active=1 AND d.implementation_status='implemented'
		 AND d.admin_configurable=1 AND e.value_mode!='custom_required'
		 ORDER BY d.sort_order,e.entitlement_key`,
	).bind(plan.current_revision_id).all<Row>();
	if (!results?.length) return jsonResponse({ error: "test_plan_has_no_configurable_entitlements" }, 409);
	const taggedReason = `${TEST_LAB_PREFIX}${planKey}] ${reason}`;
	const statements: D1PreparedStatement[] = [
		env.orderak_db.prepare(
			`UPDATE organization_entitlement_overrides
			 SET revoked_at=datetime('now'),revoked_by=?
			 WHERE organization_id=? AND revoked_at IS NULL AND reason LIKE '[TEST_LAB:%'`,
		).bind(admin.sub, organizationId),
	];
	for (const row of results) {
		statements.push(env.orderak_db.prepare(
			`INSERT INTO organization_entitlement_overrides
			 (id,organization_id,entitlement_key,value_mode,bool_value,int_value,text_value,reason,effective_at,expires_at,created_by)
			 VALUES(?,?,?,?,?,?,?,?,datetime('now'),?,?)`,
		).bind(
			id(), organizationId, row.entitlement_key, row.value_mode, row.bool_value,
			row.int_value, row.text_value, taggedReason, new Date(expiresMs).toISOString(), admin.sub,
		));
	}
	await env.orderak_db.batch(statements);
	await auditDb(env, admin, "admin.test_lab_plan_applied", {
		entity: "organization",
		entity_id: organizationId,
		plan_key: planKey,
		override_count: results.length,
		expires_at: new Date(expiresMs).toISOString(),
	}, request);
	return jsonResponse({
		ok: true,
		organization_id: organizationId,
		plan_key: planKey,
		override_count: results.length,
		expires_at: new Date(expiresMs).toISOString(),
	}, 201);
}

async function resetTestPlan(
	request: Request,
	env: AdminWorkerEnv,
	organizationId: string,
	admin: AdminClaims,
): Promise<Response> {
	const denied = stagingOnly(env);
	if (denied) return denied;
	const result = await env.orderak_db.prepare(
		`UPDATE organization_entitlement_overrides
		 SET revoked_at=datetime('now'),revoked_by=?
		 WHERE organization_id=? AND revoked_at IS NULL AND reason LIKE '[TEST_LAB:%'`,
	).bind(admin.sub, organizationId).run();
	const revoked = Number(result.meta?.changes ?? 0);
	await auditDb(env, admin, "admin.test_lab_plan_reset", {
		entity: "organization",
		entity_id: organizationId,
		revoked_count: revoked,
	}, request);
	return jsonResponse({ ok: true, organization_id: organizationId, revoked_count: revoked });
}

async function approvePaid3(request: Request, env: AdminWorkerEnv, organizationId: string, admin: AdminClaims): Promise<Response> {
	const body = await request.json<Row>().catch(() => ({} as Row));
	const notes = String(body.notes ?? "").trim();
	if (!notes) return jsonResponse({ error: "notes_required" }, 400);
	const organization = await env.orderak_db.prepare("SELECT id FROM organizations WHERE id=? AND status='active'").bind(organizationId).first();
	if (!organization) return jsonResponse({ error: "organization_not_found" }, 404);
	const paid3 = await env.orderak_db.prepare("SELECT id FROM subscription_plans WHERE plan_key='paid3'").first<{ id: string }>();
	if (!paid3) return jsonResponse({ error: "paid3_not_found" }, 404);
	const custom = await env.orderak_db.prepare(
		`SELECT COUNT(*) AS c FROM plan_revision_entitlements e JOIN subscription_plans sp ON sp.current_revision_id=e.revision_id
		 WHERE sp.id=? AND e.value_mode='custom_required' AND NOT EXISTS(
		 SELECT 1 FROM organization_entitlement_overrides o WHERE o.organization_id=? AND o.entitlement_key=e.entitlement_key
		 AND o.revoked_at IS NULL AND o.effective_at<=datetime('now') AND (o.expires_at IS NULL OR o.expires_at>datetime('now')))`,
	).bind(paid3.id, organizationId).first<{ c: number }>();
	if (Number(custom?.c ?? 0) > 0) return jsonResponse({ error: "custom_overrides_incomplete", remaining: Number(custom?.c) }, 409);
	await env.orderak_db.prepare(
		`INSERT INTO organization_plan_approvals(organization_id,plan_id,approved_by,expires_at,notes)
		 VALUES(?,?,?,?,?) ON CONFLICT(organization_id,plan_id) DO UPDATE SET approved_by=excluded.approved_by,
		 approved_at=datetime('now'),expires_at=excluded.expires_at,notes=excluded.notes,revoked_at=NULL`,
	).bind(organizationId, paid3.id, admin.sub, body.expires_at ?? null, notes).run();
	await auditDb(env, admin, "admin.paid3_approved", { entity: "organization", entity_id: organizationId }, request);
	return jsonResponse({ ok: true });
}

async function setStorefrontLocale(request: Request, env: AdminWorkerEnv, organizationId: string, admin: AdminClaims): Promise<Response> {
	const body = await request.json<Row>().catch(() => ({} as Row));
	const locale = String(body.locale_tag ?? "").trim().toLowerCase();
	const definition = await env.orderak_db.prepare("SELECT implementation_status,core_universal FROM storefront_locale_definitions WHERE locale_tag=? AND active=1")
		.bind(locale).first<Row>();
	if (!definition) return jsonResponse({ error: "locale_not_found" }, 404);
	if (definition.implementation_status !== "implemented") return jsonResponse({ error: "locale_not_implemented" }, 409);
	if (Number(definition.core_universal)) return jsonResponse({ error: "core_locale_cannot_be_disabled" }, 409);
	const paid3 = await env.orderak_db.prepare(
		`SELECT 1 AS ok FROM organization_subscriptions os JOIN plan_revisions pr ON pr.id=os.plan_revision_id
		 JOIN subscription_plans sp ON sp.id=pr.plan_id WHERE os.organization_id=? AND sp.plan_key='paid3'
		 AND os.status IN ('active','grace') LIMIT 1`,
	).bind(organizationId).first();
	if (!paid3) return jsonResponse({ error: "paid3_required" }, 409);
	await env.orderak_db.prepare(
		`INSERT INTO organization_storefront_locales(organization_id,locale_tag,enabled,enabled_by)
		 VALUES(?,?,?,?) ON CONFLICT(organization_id,locale_tag) DO UPDATE SET enabled=excluded.enabled,enabled_by=excluded.enabled_by,enabled_at=datetime('now')`,
	).bind(organizationId, locale, body.enabled === false ? 0 : 1, admin.sub).run();
	await auditDb(env, admin, "admin.storefront_locale_updated", { entity: "organization", entity_id: organizationId, locale_tag: locale, enabled: body.enabled !== false }, request);
	return jsonResponse({ ok: true });
}
