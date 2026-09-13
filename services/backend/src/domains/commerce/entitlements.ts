import { jsonResponse } from "../../platform/http/shared";
import { ensureOrganizationRoute, playAccountHash } from "../identity/identity";
import {
	LEGACY_FEATURE_ENTITLEMENTS,
	LEGACY_LIMIT_ENTITLEMENTS,
	LEGACY_MULTI_DEVICE_KEY,
	LEGACY_PAID_ONLY_KEYS,
} from "./legacy-entitlements";

export type EntitlementValueMode = "value" | "disabled" | "unlimited" | "custom_required";
export type EntitlementValue = boolean | number | string | null;

export interface EffectiveEntitlement {
	key: string;
	category: string;
	name: string;
	description: string | null;
	value_type: "boolean" | "integer" | "text" | "enum";
	unit: string | null;
	reset_period: "none" | "calendar_month_utc";
	implementation_status: "implemented" | "partial" | "planned";
	admin_configurable: boolean;
	mode: EntitlementValueMode;
	value: EntitlementValue;
	display_value: string;
	available: boolean;
	used: number | null;
	remaining: number | null;
	reset_at: string | null;
	custom_required: boolean;
}

export interface EntitlementSnapshot {
	ok: true;
	schema_version: 1;
	organization_id: string | null;
	plan_id: string;
	plan_key: string;
	plan_name: string;
	plan_revision_id: string;
	plan_version: number;
	subscription_status: string;
	current_period_end: string | null;
	pending_revision_id: string | null;
	pending_effective_at: string | null;
	entitlements: Record<string, EffectiveEntitlement>;
	server_time: string;
	etag: string;
}

interface EntitlementRow {
	entitlement_key: string;
	category: string;
	name: string;
	description: string | null;
	value_type: EffectiveEntitlement["value_type"];
	unit: string | null;
	reset_period: EffectiveEntitlement["reset_period"];
	implementation_status: EffectiveEntitlement["implementation_status"];
	admin_configurable: number;
	core_universal: number;
	value_mode: EntitlementValueMode;
	bool_value: number | null;
	int_value: number | null;
	text_value: string | null;
	display_value: string;
}

interface SubscriptionContext {
	organization_id: string;
	plan_id: string;
	plan_key: string;
	plan_name: string;
	plan_revision_id: string;
	plan_version: number;
	status: string;
	current_period_end: string | null;
	pending_revision_id: string | null;
	pending_effective_at: string | null;
}

const LEGACY_FREE_LIMITS: Record<string, number> = {
	max_categories: 5,
	max_products: 20,
	max_orders_per_month: 50,
	max_ai_requests_per_month: 20,
	max_concurrent_devices: 1,
	// No plans column enforces this and no server code reads it, but the app
	// draws a row for it, and a key the snapshot omits is drawn as unbuilt rather
	// than as "1". Reporting the true value is not the same claim as reporting
	// nothing at all.
	max_team_members: 1,
};

function uuid(): string {
	return crypto.randomUUID();
}

function isMissingV2Schema(error: unknown): boolean {
	const message = error instanceof Error ? error.message : String(error);
	return message.includes("no such table") || message.includes("no such column");
}

/** Create the one-to-one organization shell for a newly registered store. */
export async function ensureOrganizationForStore(
	env: Env,
	storeId: string,
	name?: string,
	locale?: string,
): Promise<string | null> {
	try {
		const existing = await env.orderak_db
			.prepare("SELECT organization_id FROM organization_stores WHERE store_id=?")
			.bind(storeId)
			.first<{ organization_id: string }>();
		if (existing) {
			await ensureOrganizationRoute(env, existing.organization_id);
			await env.orderak_db.prepare(
				"UPDATE organizations SET play_account_hash=COALESCE(play_account_hash,?) WHERE id=?",
			).bind(await playAccountHash(existing.organization_id), existing.organization_id).run();
			return existing.organization_id;
		}

		const organizationId = uuid();
		const memberId = uuid();
		try {
			await env.orderak_db.batch([
				env.orderak_db.prepare(
					`INSERT INTO organizations(id,name,owner_store_id,default_locale,play_account_hash)
					 VALUES(?,?,?,?,?)`,
				).bind(organizationId, (name || "Orderak organization").slice(0, 100), storeId, locale || "en", await playAccountHash(organizationId)),
				env.orderak_db.prepare(
					"INSERT INTO organization_stores(organization_id,store_id,is_primary) VALUES(?,?,1)",
				).bind(organizationId, storeId),
				env.orderak_db.prepare(
					`INSERT INTO organization_members(id,organization_id,seller_id,role,status)
					 VALUES(?,?,?,'owner','active')`,
				).bind(memberId, organizationId, storeId),
				env.orderak_db.prepare(
					"INSERT INTO organization_routing(organization_id,shard_key,routing_version,migration_state) VALUES(?,'primary',1,'stable')",
				).bind(organizationId),
			]);
			return organizationId;
		} catch (error) {
			const raced = await env.orderak_db
				.prepare("SELECT organization_id FROM organization_stores WHERE store_id=?")
				.bind(storeId)
				.first<{ organization_id: string }>();
			if (raced) return raced.organization_id;
			throw error;
		}
	} catch (error) {
		if (isMissingV2Schema(error)) return null;
		throw error;
	}
}

async function resolveSubscriptionContext(env: Env, storeId: string): Promise<SubscriptionContext | null> {
	const org = await env.orderak_db
		.prepare("SELECT organization_id FROM organization_stores WHERE store_id=?")
		.bind(storeId)
		.first<{ organization_id: string }>();
	if (!org) return null;

	const subscription = await env.orderak_db.prepare(
		`SELECT os.organization_id,os.status,os.current_period_end,os.pending_revision_id,os.pending_effective_at,
		        pr.id AS plan_revision_id,pr.version,sp.id AS plan_id,sp.plan_key,sp.name AS plan_name
		 FROM organization_subscriptions os
		 JOIN plan_revisions pr ON pr.id = CASE
		   WHEN os.pending_revision_id IS NOT NULL AND os.pending_effective_at <= datetime('now')
		   THEN os.pending_revision_id ELSE os.plan_revision_id END
		 JOIN subscription_plans sp ON sp.id=pr.plan_id
		 WHERE os.organization_id=? AND (
		   os.status IN ('active','grace') OR
		   (os.status='canceled' AND os.current_period_end IS NOT NULL AND os.current_period_end > datetime('now'))
		 )
		 ORDER BY CASE os.status WHEN 'active' THEN 0 WHEN 'grace' THEN 1 ELSE 2 END, os.updated_at DESC
		 LIMIT 1`,
	).bind(org.organization_id).first<Record<string, unknown>>();

	if (subscription) {
		return {
			organization_id: String(subscription.organization_id),
			plan_id: String(subscription.plan_id),
			plan_key: String(subscription.plan_key),
			plan_name: String(subscription.plan_name),
			plan_revision_id: String(subscription.plan_revision_id),
			plan_version: Number(subscription.version),
			status: String(subscription.status),
			current_period_end: subscription.current_period_end ? String(subscription.current_period_end) : null,
			pending_revision_id: subscription.pending_revision_id ? String(subscription.pending_revision_id) : null,
			pending_effective_at: subscription.pending_effective_at ? String(subscription.pending_effective_at) : null,
		};
	}

	const free = await env.orderak_db.prepare(
		`SELECT sp.id AS plan_id,sp.plan_key,sp.name AS plan_name,pr.id AS plan_revision_id,pr.version
		 FROM subscription_plans sp JOIN plan_revisions pr ON pr.id=sp.current_revision_id
		 WHERE sp.plan_key='free' AND sp.active=1`,
	).first<Record<string, unknown>>();
	if (!free) return null;
	return {
		organization_id: org.organization_id,
		plan_id: String(free.plan_id),
		plan_key: "free",
		plan_name: String(free.plan_name),
		plan_revision_id: String(free.plan_revision_id),
		plan_version: Number(free.version),
		status: "active",
		current_period_end: null,
		pending_revision_id: null,
		pending_effective_at: null,
	};
}

function rowValue(row: EntitlementRow): EntitlementValue {
	if (row.value_mode === "disabled" || row.value_mode === "custom_required") return null;
	if (row.value_mode === "unlimited") return null;
	if (row.value_type === "boolean") return Number(row.bool_value) === 1;
	if (row.value_type === "integer") return row.int_value == null ? null : Number(row.int_value);
	return row.text_value;
}

function monthWindow(now = new Date()): { start: string; end: string } {
	const start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
	const end = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1));
	return { start: start.toISOString(), end: end.toISOString() };
}

async function usageFor(
	env: Env,
	storeId: string,
	organizationId: string,
	key: string,
	resetPeriod: string,
): Promise<{ used: number | null; resetAt: string | null }> {
	if (key === "max_products") {
		const row = await env.orderak_db.prepare(
			`SELECT COUNT(*) AS c FROM products p JOIN organization_stores os ON os.store_id=p.store_id
			 WHERE os.organization_id=?`,
		).bind(organizationId).first<{ c: number }>();
		return { used: Number(row?.c ?? 0), resetAt: null };
	}
	if (key === "max_categories") {
		const row = await env.orderak_db.prepare(
			`SELECT COUNT(*) AS c FROM categories c JOIN organization_stores os ON os.store_id=c.store_id
			 WHERE os.organization_id=?`,
		).bind(organizationId).first<{ c: number }>();
		return { used: Number(row?.c ?? 0), resetAt: null };
	}
	if (key === "max_orders_per_month") {
		const window = monthWindow();
		const row = await env.orderak_db.prepare(
			`SELECT COUNT(*) AS c FROM orders o JOIN organization_stores os ON os.store_id=o.store_id
			 WHERE os.organization_id=?
			   AND o.created_at>=datetime('now','start of month')
			   AND o.created_at<datetime('now','start of month','+1 month')`,
		).bind(organizationId).first<{ c: number }>();
		return { used: Number(row?.c ?? 0), resetAt: window.end };
	}
	if (key === "max_concurrent_devices") {
		const row = await env.orderak_db.prepare(
			`SELECT COUNT(DISTINCT os.store_id) + COUNT(DISTINCT sd.secret_hash) AS c
			 FROM organization_stores os LEFT JOIN seller_devices sd ON sd.seller_id=os.store_id
			 WHERE os.organization_id=?`,
		).bind(organizationId).first<{ c: number }>();
		return { used: Math.max(1, Number(row?.c ?? 1)), resetAt: null };
	}
	if (resetPeriod === "calendar_month_utc") {
		const window = monthWindow();
		const row = await env.orderak_db.prepare(
			`SELECT used FROM entitlement_usage_counters
			 WHERE organization_id=? AND entitlement_key=? AND period_start=?`,
		).bind(organizationId, key, window.start).first<{ used: number }>();
		return { used: Number(row?.used ?? 0), resetAt: window.end };
	}
	void storeId;
	return { used: null, resetAt: null };
}

async function hashSnapshot(value: string): Promise<string> {
	const bytes = new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value)));
	return `"${Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("")}"`;
}

function snapshotVersionMaterial(snapshot: Omit<EntitlementSnapshot, "etag"> | EntitlementSnapshot): string {
	return JSON.stringify({
		schema_version: snapshot.schema_version,
		organization_id: snapshot.organization_id,
		plan_key: snapshot.plan_key,
		plan_name: snapshot.plan_name,
		plan_revision_id: snapshot.plan_revision_id,
		plan_version: snapshot.plan_version,
		subscription_status: snapshot.subscription_status,
		current_period_end: snapshot.current_period_end,
		pending_revision_id: snapshot.pending_revision_id,
		pending_effective_at: snapshot.pending_effective_at,
		// Usage is client-visible policy state too. Excluding it would return a
		// stale 304 after a seller consumes or releases quota.
		entitlements: snapshot.entitlements,
	});
}

/**
 * Keep the app payload bounded while the administrative catalog can continue
 * to describe planned features. Missing planned entries fail closed on Android.
 */
export async function projectEntitlementsForAndroid(
	snapshot: EntitlementSnapshot,
): Promise<EntitlementSnapshot> {
	const entitlements = Object.fromEntries(
		Object.entries(snapshot.entitlements).filter(([, item]) => item.implementation_status === "implemented"),
	);
	const projected = { ...snapshot, entitlements, etag: "" };
	projected.etag = await hashSnapshot(snapshotVersionMaterial(projected));
	return projected;
}

/**
 * Usage for the legacy path, counted per store rather than per organization.
 *
 * The engine's usageFor() joins through `organization_stores`, which the legacy
 * model has no row in — so reusing it would return zero for every seller and the
 * meters would read "0 of 20" forever. These are the same counts, scoped the way
 * the legacy world is scoped.
 *
 * A null `used` is not the same as zero. The app draws a meter only when it
 * knows the numerator, so a key nothing counts is left without one rather than
 * being drawn as unused.
 */
async function legacyUsage(
	env: Env,
	storeId: string,
	key: string,
): Promise<{ used: number | null; resetAt: string | null }> {
	if (key === "max_products") {
		const row = await env.orderak_db.prepare("SELECT COUNT(*) AS c FROM products WHERE store_id=?")
			.bind(storeId).first<{ c: number }>();
		return { used: Number(row?.c ?? 0), resetAt: null };
	}
	if (key === "max_categories") {
		const row = await env.orderak_db.prepare("SELECT COUNT(*) AS c FROM categories WHERE store_id=?")
			.bind(storeId).first<{ c: number }>();
		return { used: Number(row?.c ?? 0), resetAt: null };
	}
	if (key === "max_orders_per_month") {
		const window = monthWindow();
		const row = await env.orderak_db.prepare(
			`SELECT COUNT(*) AS c FROM orders
			 WHERE store_id=?
			   AND created_at>=datetime('now','start of month')
			   AND created_at<datetime('now','start of month','+1 month')`,
		).bind(storeId).first<{ c: number }>();
		return { used: Number(row?.c ?? 0), resetAt: window.end };
	}
	if (key === "max_concurrent_devices") {
		// The account itself is one device; seller_devices holds the additional
		// ones. Counting only the table would report 0 for a seller signed in on
		// the phone in their hand.
		const row = await env.orderak_db.prepare("SELECT COUNT(*) AS c FROM seller_devices WHERE seller_id=?")
			.bind(storeId).first<{ c: number }>();
		return { used: 1 + Number(row?.c ?? 0), resetAt: null };
	}
	if (key === "max_ai_requests_per_month") {
		// Nothing counts AI requests per store in the legacy model. Reporting a
		// zero nobody measured would draw a meter saying the seller has used none,
		// which is a claim; reporting null draws no meter, which is not.
		return { used: null, resetAt: monthWindow().end };
	}
	return { used: null, resetAt: null };
}

/**
 * The entitlement snapshot as the legacy plan model can state it.
 *
 * Exported because it is no longer only a fallback: while `ENTITLEMENTS_ENABLED`
 * is false this is what every seller receives, so it is the shape the client is
 * actually built against. legacy-entitlements.ts carries what it can and cannot
 * honestly say.
 */
export async function legacySnapshot(env: Env, storeId: string): Promise<EntitlementSnapshot> {
	let plan: Record<string, unknown> | null = null;
	try {
		plan = await env.orderak_db.prepare(
			`SELECT s.status,s.current_period_end,p.* FROM subscriptions s JOIN plans p ON p.id=s.plan_id
			 WHERE s.seller_id=? AND s.status='active' ORDER BY s.id DESC LIMIT 1`,
		).bind(storeId).first<Record<string, unknown>>();
	} catch {
		plan = null;
	}
	const planKey = plan ? String(plan.id) : "free";
	const legacyLimit = (key: keyof typeof LEGACY_FREE_LIMITS): number | null => {
		if (!plan) return LEGACY_FREE_LIMITS[key];
		const value = plan[key];
		return value == null ? null : Number(value);
	};
	const multiDevice = plan ? Number(plan.multi_device_enabled) === 1 : false;
	const entitlements: Record<string, EffectiveEntitlement> = {};

	// ---- Integer limits, from the plan row ---------------------------------
	const limitValues: Record<string, number | null> = {
		max_categories: legacyLimit("max_categories"),
		max_products: legacyLimit("max_products"),
		max_orders_per_month: legacyLimit("max_orders_per_month"),
		max_ai_requests_per_month: legacyLimit("max_ai_requests_per_month"),
		max_team_members: legacyLimit("max_team_members"),
		// The legacy table has no device count, only a boolean. Two is what the
		// plan comparison gives the first paid tier; one is what a plan without
		// the flag permits.
		max_concurrent_devices: plan ? (multiDevice ? 2 : 1) : LEGACY_FREE_LIMITS.max_concurrent_devices,
	};
	for (const limit of LEGACY_LIMIT_ENTITLEMENTS) {
		const key = limit.key;
		const value = limitValues[key];
		const { used, resetAt } = await legacyUsage(env, storeId, key);
		entitlements[key] = {
			key,
			category: "Plan limits",
			name: key,
			description: "Legacy compatibility entitlement",
			value_type: "integer",
			unit: null,
			reset_period: key.endsWith("_per_month") ? "calendar_month_utc" : "none",
			// The catalogue's own status, not a blanket "implemented". max_team_members
			// is sent because the engine sends it and the key sets must match, and is
			// sent as planned because no server code enforces it — which the resolver
			// reads as unbuilt rather than as a limit the seller has run into.
			implementation_status: limit.implementation_status,
			admin_configurable: true,
			mode: value == null ? "unlimited" : "value",
			value,
			display_value: value == null ? "Unlimited" : String(value),
			available: true,
			used,
			// Unlimited has no remainder, and neither does a limit whose usage was
			// never counted. Both are null rather than a number that would be wrong.
			remaining: value == null || used == null ? null : Math.max(0, value - used),
			reset_at: resetAt,
			custom_required: false,
		};
	}

	// ---- Ads, the one boolean the plan row carries directly -----------------
	const adsOn = plan ? Number(plan.ads_enabled) === 1 : true;
	entitlements.show_ads = {
		key: "show_ads",
		category: "Plan limits",
		name: "show_ads",
		description: "Legacy compatibility entitlement",
		value_type: "boolean",
		unit: null,
		reset_period: "none",
		implementation_status: "implemented",
		admin_configurable: true,
		mode: "value",
		value: adsOn,
		display_value: adsOn ? "Shown" : "Hidden",
		available: adsOn,
		used: null,
		remaining: null,
		reset_at: null,
		custom_required: false,
	};

	// ---- Implemented features ------------------------------------------------
	//
	// Everything the app has actually built. Two are gated — one by the legacy
	// plan row's multi_device flag, one by the plan row existing at all — and the
	// rest are open on every plan, which is what the app permits today. Emitting
	// them matters because the resolver reads an absent key as NotBuilt, so before
	// this every built feature looked unbuilt.
	for (const feature of LEGACY_FEATURE_ENTITLEMENTS) {
		const available =
			feature.key === LEGACY_MULTI_DEVICE_KEY ? multiDevice
			: LEGACY_PAID_ONLY_KEYS.includes(feature.key) ? plan != null
			: true;
		entitlements[feature.key] = {
			key: feature.key,
			category: feature.category,
			name: feature.name,
			description: null,
			value_type: feature.value_type,
			unit: null,
			reset_period: "none",
			implementation_status: "implemented",
			admin_configurable: false,
			mode: available ? "value" : "disabled",
			value: feature.value_type === "boolean" ? available : (available ? feature.display_value : null),
			display_value: available ? feature.display_value : "\u2014",
			available,
			used: null,
			remaining: null,
			reset_at: null,
			custom_required: false,
		};
	}

	const snapshot = {
		ok: true as const,
		schema_version: 1 as const,
		organization_id: null,
		plan_id: planKey,
		plan_key: planKey,
		plan_name: plan ? String(plan.name ?? planKey) : "Free",
		plan_revision_id: `legacy:${planKey}`,
		plan_version: 0,
		subscription_status: plan ? String(plan.status) : "active",
		current_period_end: plan?.current_period_end ? String(plan.current_period_end) : null,
		pending_revision_id: null,
		pending_effective_at: null,
		entitlements,
		server_time: new Date().toISOString(),
		etag: "",
	};
	snapshot.etag = await hashSnapshot(snapshotVersionMaterial(snapshot));
	return snapshot;
}

/**
 * The snapshot a client receives, whichever engine is switched on.
 *
 * The flag decides which side answers; it does not decide whether the client
 * gets an answer at all. That distinction is the whole of I-4, and it used to be
 * the other way round — `ENTITLEMENTS_ENABLED=false` meant a 503 and an empty
 * map, so the client's behaviour depended on a server flag it could not see.
 */
export async function resolveEntitlementsForClient(env: Env, storeId: string): Promise<EntitlementSnapshot> {
	// PLAY_PROJECTION_PENDING — a Google Play purchase does not reach this answer.
	//
	// The Play verifier writes `organization_subscriptions`. legacySnapshot below
	// reads `subscriptions JOIN plans`, which is a different table written by a
	// different code path, so under ENTITLEMENTS_ENABLED=false a seller can pay
	// Google, have the purchase verified and recorded, and still be told plan_key
	// "free". No refund, no alert. entitlement-projection.spec.ts cannot see it:
	// it compares the two engines' shapes without ever seeding a Play purchase and
	// asking for the client snapshot.
	//
	// Nobody can reach it today — BILLING_ENABLED is "false" in both environments
	// and a `billing_enabled` row in `settings` gates it again — and
	// verify-billing-entitlement-path.mjs fails the build if either of those
	// changes while this marker is still here.
	//
	// It is not fixed here because fixing it means deciding how two plan
	// vocabularies line up, and they do not line up on their own: legacy `plans`
	// holds free / starter / professional, v2 `subscription_plans` holds free /
	// paid1 / paid2 / paid3 — three tiers against four, overlapping only on
	// "free", at prices that are not the same numbers. Whether paid2 is
	// "professional", or whether the legacy table should be retired instead, is a
	// pricing decision; guessing it bills a seller for one tier and grants another.
	//
	// Delete this marker when the projection exists, and the guard will start
	// requiring it.
	if (env.ENTITLEMENTS_ENABLED === "true") return resolveEntitlements(env, storeId);
	return legacySnapshot(env, storeId);
}

/** Resolve the backend-authoritative, typed entitlement set for one store. */
export async function resolveEntitlements(env: Env, storeId: string): Promise<EntitlementSnapshot> {
	try {
		const context = await resolveSubscriptionContext(env, storeId);
		if (!context) return legacySnapshot(env, storeId);

		const { results } = await env.orderak_db.prepare(
			`SELECT d.entitlement_key,d.category,d.name,d.description,d.value_type,d.unit,d.reset_period,
			        d.implementation_status,d.admin_configurable,d.core_universal,
			        COALESCE(o.value_mode,e.value_mode) AS value_mode,
			        COALESCE(o.bool_value,e.bool_value) AS bool_value,
			        COALESCE(o.int_value,e.int_value) AS int_value,
			        COALESCE(o.text_value,e.text_value) AS text_value,e.display_value
			 FROM entitlement_definitions d
			 JOIN plan_revision_entitlements e ON e.entitlement_key=d.entitlement_key AND e.revision_id=?
			 LEFT JOIN organization_entitlement_overrides o ON o.id=(
			   SELECT oo.id FROM organization_entitlement_overrides oo
			   WHERE oo.organization_id=? AND oo.entitlement_key=d.entitlement_key
			     AND oo.revoked_at IS NULL AND oo.effective_at<=datetime('now')
			     AND (oo.expires_at IS NULL OR oo.expires_at>datetime('now'))
			   ORDER BY oo.created_at DESC LIMIT 1
			 )
			 WHERE d.active=1 ORDER BY d.sort_order`,
		).bind(context.plan_revision_id, context.organization_id).all<EntitlementRow>();

		const entitlements: Record<string, EffectiveEntitlement> = {};
		for (const row of results ?? []) {
			const value = rowValue(row);
			const implemented = row.implementation_status === "implemented";
			const customRequired = row.value_mode === "custom_required";
			const available = implemented && !customRequired && row.value_mode !== "disabled" && (
				Number(row.core_universal) === 1 || row.value_type === "integer" || row.value_mode === "unlimited" ||
				(row.value_type === "boolean" ? value === true : row.value_mode === "value")
			);
			const usage = implemented && row.admin_configurable
				? await usageFor(env, storeId, context.organization_id, row.entitlement_key, row.reset_period)
				: { used: null, resetAt: null };
			const limit = row.value_type === "integer" && row.value_mode === "value" ? Number(value) : null;
			entitlements[row.entitlement_key] = {
				key: row.entitlement_key,
				category: row.category,
				name: row.name,
				description: row.description,
				value_type: row.value_type,
				unit: row.unit,
				reset_period: row.reset_period,
				implementation_status: row.implementation_status,
				admin_configurable: Number(row.admin_configurable) === 1,
				mode: row.value_mode,
				value,
				display_value: row.display_value,
				available,
				used: usage.used,
				remaining: limit == null || usage.used == null ? null : Math.max(0, limit - usage.used),
				reset_at: usage.resetAt,
				custom_required: customRequired,
			};
		}

		const serverTime = new Date().toISOString();
		const snapshotWithoutEtag = {
			ok: true as const,
			schema_version: 1 as const,
			organization_id: context.organization_id,
			plan_id: context.plan_id,
			plan_key: context.plan_key,
			plan_name: context.plan_name,
			plan_revision_id: context.plan_revision_id,
			plan_version: context.plan_version,
			subscription_status: context.status,
			current_period_end: context.current_period_end,
			pending_revision_id: context.pending_revision_id,
			pending_effective_at: context.pending_effective_at,
			entitlements,
			server_time: serverTime,
		};
		const etag = await hashSnapshot(snapshotVersionMaterial(snapshotWithoutEtag));
		return { ...snapshotWithoutEtag, etag };
	} catch (error) {
		if (isMissingV2Schema(error)) return legacySnapshot(env, storeId);
		throw error;
	}
}

/**
 * What an integer entitlement resolves to, which is three things and not two.
 *
 * `number | null` could say "this many" and "unlimited". It could not say "there
 * is no enforceable number here", so that third case was being folded into the
 * first as 0 — and 0 read as a ceiling refuses everything. A paid3 seller whose
 * AI allowance is marked custom_required was told their plan "allows up to 0 ai
 * requests per month".
 *
 * Migration 025 seeds 242 entitlement definitions of which 210 are `planned`, so
 * the third case is the common one rather than the exotic one.
 */
export type IntegerEntitlement =
	/** A real ceiling, from a configured value. */
	| { kind: "limit"; value: number }
	/** Configured, and deliberately without a ceiling. */
	| { kind: "unlimited" }
	/**
	 * No enforceable number: the catalogue marks the entitlement `planned` (no
	 * server code implements it) or `custom_required` (the value is negotiated
	 * per customer and is not in the table).
	 */
	| { kind: "not_configured"; reason: "not_implemented" | "custom_required" }
	/**
	 * The key is not in the snapshot at all. Distinct from not_configured: that
	 * is a declared state, this is a data error, and the two deserve different
	 * answers.
	 */
	| { kind: "missing" };

export async function getIntegerEntitlement(env: Env, storeId: string, key: string): Promise<IntegerEntitlement> {
	const item = (await resolveEntitlements(env, storeId)).entitlements[key];
	if (!item) return { kind: "missing" };
	if (item.custom_required) return { kind: "not_configured", reason: "custom_required" };
	if (item.implementation_status !== "implemented") {
		return { kind: "not_configured", reason: "not_implemented" };
	}
	if (item.mode === "unlimited") return { kind: "unlimited" };
	if (item.value_type !== "integer") return { kind: "missing" };
	return { kind: "limit", value: Number(item.value ?? 0) };
}

export async function isEntitlementEnabled(env: Env, storeId: string, key: string): Promise<boolean> {
	return (await resolveEntitlements(env, storeId)).entitlements[key]?.available === true;
}

/** Catalogue keys the API itself gates on, named rather than written inline. */
export const EDITABLE_CUSTOMER_PROFILES = "customers_crm.editable_customer_profiles";

/**
 * Whether a store may use a catalogue feature, decided the way the client
 * decides it.
 *
 * Resolved through resolveEntitlementsForClient, not resolveEntitlements,
 * because the snapshot the app gates on comes from the former — it is the one
 * that answers under either engine. A server gate reading the other function
 * could refuse a feature the seller's own app is showing as available, which is
 * a worse failure than the missing check it replaces.
 *
 * The three conditions mirror EntitlementManager.isEntitlementAvailable on the
 * device: built, included in the plan, and not requiring a bespoke arrangement.
 * Fails closed — an unresolvable snapshot is not permission.
 */
export async function entitlementAllows(env: Env, storeId: string, key: string): Promise<boolean> {
	try {
		const item = (await resolveEntitlementsForClient(env, storeId)).entitlements[key];
		return item?.implementation_status === "implemented"
			&& item.available === true
			&& item.custom_required !== true;
	} catch {
		return false;
	}
}

export function entitlementDenied(
	snapshot: EntitlementSnapshot,
	key: string,
	status = 403,
): Response {
	const item = snapshot.entitlements[key];
	return jsonResponse({
		error: "PLAN_FEATURE_REQUIRED",
		entitlement_key: key,
		plan_key: snapshot.plan_key,
		plan_revision_id: snapshot.plan_revision_id,
		implementation_status: item?.implementation_status ?? "planned",
		upgrade_plan_keys: snapshot.plan_key === "free" ? ["paid1", "paid2", "paid3"] : ["paid2", "paid3"],
		request_id: uuid(),
	}, status);
}


/**
 * The HTTP status a plan limit answers with, decided by the KIND of limit.
 *
 * Two things were wrong. A limit that resets — a monthly order or AI allowance —
 * is a rate, and a rate says 429 with Retry-After; a structural cap like
 * max_products is a conflict with the plan's shape, which is 409. That
 * distinction is worth making.
 *
 * What is not defensible is making it differently on each side of a flag. The
 * same condition, exceeding the monthly order allowance, answered 409 through
 * limitReached() under the legacy plan model and 429 through this function
 * under the entitlements engine — and staging and production sit on opposite
 * sides of ENTITLEMENTS_ENABLED. I-4 says flipping that flag must produce no
 * client-visible difference, and a status code is client-visible. Both helpers
 * read this one rule now, so the engine cannot be the thing that decides.
 *
 * It lives here rather than in plan-limits.ts because that module already
 * imports this one, and the reverse edge would be a cycle.
 */
export function planLimitStatus(key: string): 409 | 429 {
	return key.endsWith("_per_month") ? 429 : 409;
}

/**
 * Seconds until a resetting allowance refills.
 *
 * Falls back to the UTC calendar-month boundary, which is the boundary the
 * quotas are actually counted on (`datetime('now','start of month')` in
 * catalog.ts and reserveUsage) — so a snapshot with no reset_at still produces
 * an honest Retry-After rather than a guessed one.
 */
export function planLimitRetryAfterSeconds(resetAt?: string | null): number {
	if (resetAt) {
		const at = Date.parse(resetAt.includes("T") ? resetAt : `${resetAt.replace(" ", "T")}Z`);
		if (Number.isFinite(at)) return Math.max(1, Math.ceil((at - Date.now()) / 1000));
	}
	const now = new Date();
	const next = Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1);
	return Math.max(1, Math.ceil((next - now.getTime()) / 1000));
}

/**
 * `status` is no longer a parameter callers choose.
 *
 * It used to be, and two call sites passed 429 while the legacy helper answered
 * 409 for the identical condition — so exceeding the monthly order allowance
 * had a different status depending only on which engine was enabled. The kind
 * of limit decides now; see planLimitStatus.
 */
export function entitlementLimitReached(snapshot: EntitlementSnapshot, key: string): Response {
	const item = snapshot.entitlements[key];
	const status = planLimitStatus(key);
	const extra: Record<string, string> = status === 429
		? { "retry-after": String(planLimitRetryAfterSeconds(item?.reset_at)) }
		: {};
	return jsonResponse({
		error: "plan_limit_reached",
		code: "PLAN_LIMIT_REACHED",
		entitlement_key: key,
		limit_key: key,
		plan_key: snapshot.plan_key,
		plan_revision_id: snapshot.plan_revision_id,
		limit: item?.mode === "unlimited" ? null : item?.value ?? 0,
		used: item?.used ?? null,
		remaining: item?.remaining ?? 0,
		reset_at: item?.reset_at ?? null,
		upgrade_plan_keys: snapshot.plan_key === "free" ? ["paid1", "paid2", "paid3"] : ["paid2", "paid3"],
		request_id: uuid(),
	}, status, extra);
}


export interface UsageReservationResult {
	allowed: boolean;
	idempotent: boolean;
	snapshot: EntitlementSnapshot;
	reservation_id: string | null;
}

/** Atomically reserve a calendar-month allowance such as an AI request. */
export async function reserveUsage(
	env: Env,
	storeId: string,
	key: string,
	delta: number,
	idempotencyKey: string,
): Promise<UsageReservationResult> {
	const snapshot = await resolveEntitlements(env, storeId);
	const item = snapshot.entitlements[key];
	if (!item?.available || item.custom_required) return { allowed: false, idempotent: false, snapshot, reservation_id: null };
	if (item.mode === "unlimited") return { allowed: true, idempotent: false, snapshot, reservation_id: null };
	if (!snapshot.organization_id) {
		const allowed = item.remaining == null || item.remaining >= delta;
		return { allowed, idempotent: false, snapshot, reservation_id: null };
	}
	const organizationId = snapshot.organization_id;
	const window = monthWindow();
	const existing = await env.orderak_db.prepare(
		`SELECT id,status FROM entitlement_usage_reservations
		 WHERE organization_id=? AND entitlement_key=? AND idempotency_key=?`,
	).bind(organizationId, key, idempotencyKey).first<{ id: string; status: string }>();
	if (existing?.status === "committed") {
		return { allowed: true, idempotent: true, snapshot, reservation_id: existing.id };
	}
	if (existing?.status === "voided") {
		return { allowed: false, idempotent: true, snapshot, reservation_id: existing.id };
	}

	const limit = Number(item.value ?? 0);
	const reservationId = existing?.id ?? uuid();
	const counterSeed = key === "max_orders_per_month"
		? env.orderak_db.prepare(
			`INSERT INTO entitlement_usage_counters(organization_id,entitlement_key,period_start,period_end,used)
			 SELECT ?,?,?,?,COUNT(*) FROM orders o JOIN organization_stores os ON os.store_id=o.store_id
			 WHERE os.organization_id=? AND o.created_at>=datetime('now','start of month')
			 AND o.created_at<datetime('now','start of month','+1 month')
			 ON CONFLICT(organization_id,entitlement_key,period_start) DO UPDATE SET used=MAX(used,excluded.used),updated_at=datetime('now')`,
		).bind(organizationId, key, window.start, window.end, organizationId)
		: env.orderak_db.prepare(
			`INSERT OR IGNORE INTO entitlement_usage_counters
			 (organization_id,entitlement_key,period_start,period_end,used) VALUES(?,?,?,?,0)`,
		).bind(organizationId, key, window.start, window.end);
	const statements: D1PreparedStatement[] = [counterSeed];
	if (!existing) {
		statements.push(env.orderak_db.prepare(
			`INSERT OR IGNORE INTO entitlement_usage_reservations
			 (id,organization_id,entitlement_key,period_start,delta,idempotency_key,status)
			 VALUES(?,?,?,?,?,?,'reserved')`,
		).bind(reservationId, organizationId, key, window.start, delta, idempotencyKey));
	}
	statements.push(env.orderak_db.prepare(
		`UPDATE entitlement_usage_counters SET used=used+?,updated_at=datetime('now')
		 WHERE organization_id=? AND entitlement_key=? AND period_start=? AND used+?<=?
		 AND EXISTS(SELECT 1 FROM entitlement_usage_reservations r WHERE r.id=? AND r.status='reserved')`,
	).bind(delta, organizationId, key, window.start, delta, limit, reservationId));
	statements.push(env.orderak_db.prepare(
		`UPDATE entitlement_usage_reservations SET status=CASE WHEN changes()>0 THEN 'committed' ELSE 'voided' END,updated_at=datetime('now')
		 WHERE id=? AND status='reserved'`,
	).bind(reservationId));
	const results = await env.orderak_db.batch(statements);
	const counterResult = results[statements.length - 2];
	if (!counterResult.meta?.changes) {
		await env.orderak_db.prepare(
			"UPDATE entitlement_usage_reservations SET status='voided',updated_at=datetime('now') WHERE id=? AND status='reserved'",
		).bind(reservationId).run();
		return { allowed: false, idempotent: false, snapshot: await resolveEntitlements(env, storeId), reservation_id: reservationId };
	}
	return { allowed: true, idempotent: false, snapshot: await resolveEntitlements(env, storeId), reservation_id: reservationId };
}

export async function voidUsageReservation(env: Env, reservationId: string): Promise<void> {
	const row = await env.orderak_db.prepare(
		`SELECT organization_id,entitlement_key,period_start,delta,status
		 FROM entitlement_usage_reservations WHERE id=?`,
	).bind(reservationId).first<{ organization_id: string; entitlement_key: string; period_start: string; delta: number; status: string }>();
	if (!row || row.status !== "committed") return;

	// Both statements are guarded on the reservation still being committed, and
	// the read above only supplies the counter's address.
	//
	// It used to be read-then-act: this function checked status === "committed"
	// and then decremented unconditionally. Two voids of one reservation could
	// both pass that check and both subtract, so the seller's used count fell by
	// twice the delta and they were handed quota they had not been given back.
	// That is reachable without concurrency being exotic: the idempotent re-issue
	// path hands the same committed reservation id to two callers, and
	// public-worker voids on failure, so two failing requests sharing one
	// idempotency key is the ordinary way in.
	//
	// The guards make the transition itself the interlock. In one transaction the
	// EXISTS sees the pre-transaction status and the second statement flips it; a
	// second transaction runs after that commit, finds 'voided', and both of its
	// statements match nothing. The decrement cannot happen without the
	// transition, and the transition can only happen once.
	await env.orderak_db.batch([
		env.orderak_db.prepare(
			`UPDATE entitlement_usage_counters SET used=MAX(0,used-?),updated_at=datetime('now')
			 WHERE organization_id=? AND entitlement_key=? AND period_start=?
			   AND EXISTS (SELECT 1 FROM entitlement_usage_reservations
			                WHERE id=? AND status='committed')`,
		).bind(row.delta, row.organization_id, row.entitlement_key, row.period_start, reservationId),
		env.orderak_db.prepare(
			`UPDATE entitlement_usage_reservations SET status='voided',updated_at=datetime('now')
			  WHERE id=? AND status='committed'`,
		).bind(reservationId),
	]);
}
