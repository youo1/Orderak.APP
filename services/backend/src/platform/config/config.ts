// ============================================================
// Android app config endpoint: plan limits + feature flags.
//
// GET /api/v1/config
// Auth: x-orderak-phone + x-orderak-secret
// Returns the seller's current plan limits and features for
// in-app enforcement (product limits, category limits, etc.)
// ============================================================

import { jsonResponse, authSeller, type AuthenticatedSeller } from "../http/shared";
import { keyedHash, sha256Hex } from "../../domains/identity/auth";
import {
	projectEntitlementsForAndroid,
	resolveEntitlements,
	type EntitlementSnapshot,
} from "../../domains/commerce/entitlements";

/** Free-plan defaults, returned when a seller has no active subscription. */
const FREE_CONFIG = {
	ok: true,
	plan_id: "free",
	ads_enabled: true,
	limits: {
		max_categories: 5,
		max_products: 20,
		max_orders_per_month: 50,
		max_ai_requests_per_month: 20,
		max_team_members: 1,
	},
	features: {
		custom_domain: false,
		analytics: false,
		priority_support: false,
		ai_assistant: true,
		multi_device: false,
	},
};

/**
 * Load the plan/entitlement config block for a seller. Extracted so it can be
 * piggybacked onto other authenticated responses (e.g. /api/v1/orders) — the
 * Android app used to spend a whole separate authenticated request on
 * /api/v1/config every sync just to read this.
 */
export async function loadPlanConfig(env: Env, sellerId: string): Promise<Record<string, unknown>> {
	if (env.ENTITLEMENTS_ENABLED === "true") {
		return legacyProjection(await resolveEntitlements(env, sellerId));
	}
	const sub = (await env.orderak_db
		.prepare(
			`SELECT s.plan_id, s.status, s.current_period_end,
			        p.name, p.ads_enabled, p.max_categories, p.max_products,
			        p.max_orders_per_month, p.max_ai_requests_per_month,
			        p.max_team_members, p.custom_domain_enabled,
			        p.analytics_enabled, p.priority_support_enabled
			        , p.multi_device_enabled
			 FROM subscriptions s
			 JOIN plans p ON p.id = s.plan_id
			 WHERE s.seller_id = ? AND s.status = 'active'
			 ORDER BY s.id DESC LIMIT 1`,
		)
		.bind(sellerId)
		.first()) as Record<string, unknown> | null;

	if (!sub) return FREE_CONFIG;

	// Helper: NULL means unlimited, return as null in JSON so the app knows.
	const n = (v: unknown): number | null =>
		v === null || v === undefined ? null : Number(v);

	return {
		ok: true,
		plan_id: sub.plan_id,
		plan_name: sub.name,
		ads_enabled: sub.ads_enabled === 1,
		current_period_end: sub.current_period_end ?? null,
		limits: {
			max_categories: n(sub.max_categories),
			max_products: n(sub.max_products),
			max_orders_per_month: n(sub.max_orders_per_month),
			max_ai_requests_per_month: n(sub.max_ai_requests_per_month),
			max_team_members: n(sub.max_team_members),
		},
		features: {
			custom_domain: sub.custom_domain_enabled === 1,
			analytics: sub.analytics_enabled === 1,
			priority_support: sub.priority_support_enabled === 1,
			ai_assistant: true, // available on all plans
			multi_device: sub.multi_device_enabled === 1,
		},
	};
}

/** Plan entitlements plus admin-governed version and feature state. */
export async function loadClientConfig(env: Env, seller: Record<string, unknown>, request: Request): Promise<Record<string, unknown>> {
	const planConfig = await loadPlanConfig(env, String(seller.id));
	const country = String(seller.country_code ?? "").toUpperCase() || null;
	const versionCode = Math.max(0, Number(request.headers.get("x-orderak-version-code") ?? 0));
	const policy = await effectiveVersionPolicy(env, "android", country);
	const versionState = versionDecision(policy, versionCode);
	const planId = String(planConfig.plan_id ?? "free");
	const actorKey = String(seller.id);
	const features = {
		ai_assistant: await effectiveFeature(env, "ai_assistant", actorKey, country, versionCode, planId, actorKey, Boolean((planConfig.features as Record<string, unknown> | undefined)?.ai_assistant)),
		billing: await effectiveFeature(env, "billing", actorKey, country, versionCode, planId, actorKey, true),
		first_party_ads: await effectiveFeature(env, "first_party_ads", actorKey, country, versionCode, planId, actorKey, Boolean(planConfig.ads_enabled)),
		referrals: await effectiveFeature(env, "referrals", actorKey, country, versionCode, planId, actorKey, true),
	};
	return { ...planConfig, governance: { schema_version: 1, server_time: new Date().toISOString(), version: versionState, features } };
}

function legacyProjection(snapshot: EntitlementSnapshot): Record<string, unknown> {
	const numberValue = (key: string): number | null => {
		const item = snapshot.entitlements[key];
		if (!item || item.custom_required) return 0;
		return item.mode === "unlimited" ? null : Number(item.value ?? 0);
	};
	const enabled = (key: string): boolean => snapshot.entitlements[key]?.available === true;
	return {
		ok: true,
		plan_id: snapshot.plan_key,
		plan_name: snapshot.plan_name,
		plan_revision_id: snapshot.plan_revision_id,
		plan_version: snapshot.plan_version,
		ads_enabled: enabled("show_ads"),
		current_period_end: snapshot.current_period_end,
		pending_revision_id: snapshot.pending_revision_id,
		pending_effective_at: snapshot.pending_effective_at,
		limits: {
			max_categories: numberValue("max_categories"),
			max_products: numberValue("max_products"),
			max_orders_per_month: numberValue("max_orders_per_month"),
			max_ai_requests_per_month: numberValue("max_ai_requests_per_month"),
			max_team_members: numberValue("max_team_members"),
			max_concurrent_devices: numberValue("max_concurrent_devices"),
		},
		features: {
			custom_domain: enabled("custom_domain"),
			analytics: enabled("advanced_analytics"),
			priority_support: enabled("support_service.priority_queue"),
			ai_assistant: enabled("ai_capabilities.basic_ai_assistance"),
			multi_device: (numberValue("max_concurrent_devices") ?? Number.MAX_SAFE_INTEGER) > 1,
		},
	};
}

export async function handleConfigRoute(
	request: Request,
	env: Env,
	url: URL,
	authenticatedSeller?: AuthenticatedSeller | null,
): Promise<Response | null> {
	if (!["/api/v1/config", "/api/v1/entitlements"].includes(url.pathname) || request.method !== "GET") return null;

	const phone = request.headers.get("x-orderak-phone") ?? "";
	const secret = request.headers.get("x-orderak-secret") ?? "";
	const seller = authenticatedSeller !== undefined ? authenticatedSeller : await authSeller(env, phone, secret);
	if (!seller) return jsonResponse({ error: "auth" }, 401);
	if (url.pathname === "/api/v1/entitlements") {
		if (env.ENTITLEMENTS_ENABLED !== "true") return jsonResponse({ error: "entitlements_v2_disabled" }, 503);
		const resolved = await resolveEntitlements(env, String(seller.id));
		const baseSnapshot = url.searchParams.get("projection") === "android-v1"
			? await projectEntitlementsForAndroid(resolved)
			: resolved;
		const clientConfig = await loadClientConfig(env, seller as unknown as Record<string, unknown>, request);
		const governance = clientConfig.governance;
		const etag = `"${await sha256Hex(`${baseSnapshot.etag}:${JSON.stringify(governance)}`)}"`;
		const snapshot = { ...baseSnapshot, etag, governance };
		const headers = {
			etag,
			"cache-control": "private, max-age=0, must-revalidate",
			vary: "x-orderak-phone",
		};
		if (request.headers.get("if-none-match") === etag) {
			return new Response(null, { status: 304, headers });
		}
		return new Response(JSON.stringify(snapshot), {
			headers: { ...headers, "content-type": "application/json" },
		});
	}

	return jsonResponse(await loadClientConfig(env, seller as unknown as Record<string, unknown>, request));
}

type DbRow = Record<string, unknown>;

async function effectiveVersionPolicy(env: Env, platform: string, country: string | null): Promise<DbRow | null> {
	return env.orderak_db.prepare(
		`SELECT * FROM app_version_policies WHERE platform=? AND active=1 AND (country_code=? OR country_code IS NULL)
		 ORDER BY CASE WHEN country_code=? THEN 0 ELSE 1 END,updated_at DESC LIMIT 1`,
	).bind(platform, country, country).first<DbRow>();
}

function versionDecision(policy: DbRow | null, versionCode: number): Record<string, unknown> {
	if (!policy) return { status: "ok", policy_id: null };
	const blocked = parseJson<number[]>(policy.blocked_version_codes_json, []);
	const enforceAfter = policy.enforce_after ? Date.parse(`${String(policy.enforce_after).replace(" ", "T")}Z`) : null;
	const graceElapsed = enforceAfter == null || enforceAfter <= Date.now();
	const minimum = Number(policy.minimum_version_code ?? 0);
	const recommended = Number(policy.recommended_version_code ?? 0);
	const status = Number(policy.maintenance_mode) === 1 ? "maintenance"
		: blocked.includes(versionCode) ? "blocked"
		: minimum > 0 && versionCode > 0 && versionCode < minimum && graceElapsed ? "force_update"
		: recommended > 0 && versionCode > 0 && versionCode < recommended ? "warning"
		: "ok";
	return {
		status,
		policy_id: policy.id,
		minimum_version_code: minimum || null,
		recommended_version_code: recommended || null,
		enforce_after: policy.enforce_after ?? null,
		store_url: policy.store_url ?? null,
		warning_message: parseJson(policy.warning_message_i18n, {}),
		blocking_message: parseJson(policy.blocking_message_i18n, {}),
	};
}

async function effectiveFeature(
	env: Env,
	flagKey: string,
	actorKey: string,
	country: string | null,
	versionCode: number,
	plan: string,
	storeId: string,
	planEligible: boolean,
): Promise<Record<string, unknown>> {
	const definition = await env.orderak_db.prepare("SELECT * FROM feature_flags WHERE flag_key=? AND status='published'").bind(flagKey).first<DbRow>();
	if (!definition) return { enabled: false, source: "missing" };
	const envGate = definition.env_gate ? String(definition.env_gate) : null;
	if (envGate && (env as unknown as Record<string, unknown>)[envGate] !== "true") return { enabled: false, source: `environment:${envGate}` };
	if (!planEligible) return { enabled: false, source: "plan_entitlement" };
	const capabilityKey = flagKey === "ai_assistant" ? "ai.assistant" : flagKey === "first_party_ads" ? "ads.eligible" : flagKey === "referrals" ? "referrals.enabled" : null;
	if (capabilityKey) {
		const override = await env.orderak_db.prepare("SELECT enabled,id FROM store_capability_overrides WHERE store_id=? AND capability_key=? AND revoked_at IS NULL AND (expires_at IS NULL OR expires_at>datetime('now')) ORDER BY created_at DESC LIMIT 1").bind(storeId, capabilityKey).first<{ enabled: number; id: string }>();
		if (override) return { enabled: override.enabled === 1, source: `store_override:${override.id}` };
	}
	const rules = await env.orderak_db.prepare(
		`SELECT * FROM feature_flag_rules WHERE flag_key=? AND active=1 AND (starts_at IS NULL OR starts_at<=datetime('now'))
		 AND (ends_at IS NULL OR ends_at>datetime('now')) ORDER BY priority,id`,
	).bind(flagKey).all<DbRow>();
	for (const rule of rules.results) {
		const scope = String(rule.scope_type);
		const match = scope === "global"
			|| (scope === "country" && rule.scope_value === country)
			|| (scope === "app_version" && (rule.min_version_code == null || versionCode >= Number(rule.min_version_code)) && (rule.max_version_code == null || versionCode <= Number(rule.max_version_code)))
			|| (scope === "plan" && rule.scope_value === plan)
			|| (["store", "seller"].includes(scope) && rule.scope_value === storeId)
			|| (scope === "percentage" && await hmacBucket(actorKey, String(definition.rollout_seed)) < Number(rule.rollout_basis_points ?? 0));
		if (match) return { enabled: parseJson<boolean>(rule.value_json, false) === true, source: `rule:${rule.id}` };
	}
	return { enabled: parseJson<boolean>(definition.default_value_json, false) === true, source: "global_default" };
}

async function hmacBucket(actor: string, seed: string): Promise<number> {
	return Number.parseInt((await sha256Hex(await keyedHash(actor, seed))).slice(0, 8), 16) % 10000;
}

function parseJson<T>(value: unknown, fallback: T): T {
	try { return JSON.parse(String(value)) as T; } catch { return fallback; }
}
