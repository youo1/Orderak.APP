// Test helpers: apply the real migrations to the test D1 and drive the API via
// SELF.fetch.
import { applyD1Migrations, env, SELF, createExecutionContext } from "cloudflare:test";
import type { D1Migration } from "cloudflare:test";

/** Migration arrays injected as bindings by vitest.config.mts. */
interface TestMigrationEnv {
	TEST_MIGRATIONS: D1Migration[];
	TEST_GEO_MIGRATIONS: D1Migration[];
}
import { invalidateDesignSystemCache } from "../src/domains/design/design-system";
import { invalidateFeatureFlagCache } from "../src/platform/config/config";

// Derived from ExportedHandler rather than hand-written: its `fetch` takes a
// Request narrowed with IncomingRequestCfProperties, which a plain `Request`
// parameter would not accept.
type WorkerFetch = NonNullable<ExportedHandler<TestEnv>["fetch"]>;
type WorkerWithFetch = { fetch?: WorkerFetch };

/**
 * Invoke a Worker's fetch handler directly (as opposed to through SELF).
 *
 * ExportedHandler declares `fetch` as optional and the runtime requires an
 * ExecutionContext, so every direct call site otherwise has to repeat both the
 * existence check and the ctx plumbing.
 */
export function callWorker(
	worker: WorkerWithFetch,
	request: Request,
	runtimeEnv: TestEnv = env as TestEnv,
	ctx: ExecutionContext = createExecutionContext(),
): Promise<Response> {
	if (!worker.fetch) throw new Error("worker module exposes no fetch handler");
	// `new Request(...)` widens cf to RequestInitCfProperties | IncomingRequestCfProperties,
	// while the handler wants the incoming-only narrowing. Narrowing here keeps
	// the dance out of every call site; no test reads `cf`.
	return Promise.resolve(worker.fetch(request as Parameters<WorkerFetch>[0], runtimeEnv, ctx));
}

// The hand-written SCHEMA and GEO_SCHEMA arrays stood here: 94 CREATE TABLE
// statements maintained in parallel with migrations/. They are gone — the test
// database is built from the real migrations now. See vitest.config.mts.

/**
 * Every table the suite should clear between tests: whatever the migrations
 * created, minus the things clearing would break.
 *
 * Derived from the database rather than from a list, because a list is the
 * thing this change removes. A new migration adding a table used to require
 * remembering to add it here too, and forgetting left state leaking between
 * tests in exactly one table — the least likely place anyone would look.
 *
 * `d1_migrations` is excluded because applyD1Migrations() uses it to decide
 * what has already run: clearing it makes every migration re-apply, and the
 * second CREATE TABLE fails. FTS5 shadow tables are excluded because they are
 * maintained by their virtual table, not written directly.
 */
async function clearableTables(db: D1Database): Promise<Map<string, string>> {
	const { results } = await db
		.prepare(
			`SELECT name, sql FROM sqlite_master
			 WHERE type = 'table'
			   AND name NOT LIKE 'sqlite_%'
			   AND name NOT LIKE '_cf_%'
			   AND name <> 'd1_migrations'`,
		)
		.all<{ name: string; sql: string | null }>();
	const ftsShadowSuffixes = ["_data", "_idx", "_content", "_docsize", "_config"];
	const tables = new Map<string, string>();
	for (const row of results) {
		if (ftsShadowSuffixes.some((suffix) => row.name.endsWith(suffix))) continue;
		tables.set(row.name, row.sql ?? "");
	}
	return tables;
}

/**
 * A delete order that satisfies the schema's foreign keys: children before the
 * parents they reference.
 *
 * Derived by reading `REFERENCES` out of each table's own DDL and sorting, not
 * by attempting deletes and retrying the failures. That was the first attempt
 * and it is subtly wrong: on an empty database every delete succeeds, so the
 * "discovered" order records nothing about the constraints and breaks the
 * moment a populated database uses it. A delete that succeeds because there was
 * nothing to delete has proved nothing.
 *
 * A cycle is reported rather than worked around, because a half-cleared
 * database leaking into the next test is harder to diagnose than a loud
 * failure here.
 */
function deleteOrderFor(tables: Map<string, string>): string[] {
	const referencedBy = new Map<string, Set<string>>();
	for (const [table, ddl] of tables) {
		const targets = new Set<string>();
		for (const match of ddl.matchAll(/REFERENCES\s+["`[]?([A-Za-z0-9_]+)/gi)) {
			const target = match[1];
			if (target !== table && tables.has(target)) targets.add(target);
		}
		referencedBy.set(table, targets);
	}

	const order: string[] = [];
	const done = new Set<string>();
	while (done.size < tables.size) {
		// A table is safe to delete once everything it references is either already
		// deleted or is itself waiting on nothing but already-deleted tables.
		const ready = [...tables.keys()].filter(
			(table) => !done.has(table)
				&& [...(referencedBy.get(table) ?? [])].every((target) => done.has(target) || target === table),
		);
		const layer = ready.length > 0
			? ready
			: [...tables.keys()].filter((table) => !done.has(table));
		if (ready.length === 0) {
			throw new Error(
				`Foreign-key cycle among test tables, so no delete order exists: ${layer.join(", ")}`,
			);
		}
		for (const table of layer) {
			order.push(table);
			done.add(table);
		}
	}
	// Children reference parents, so a table whose dependencies resolved first is
	// a parent and must be emptied last.
	return order.reverse();
}

/** Computed once from the schema; see deleteOrderFor. */
let deleteOrder: string[] | null = null;

export async function createSchema(): Promise<void> {
	invalidateDesignSystemCache();
	// Feature-flag definitions are cached per isolate for 30s; a suite that seeds
	// different flags per test would otherwise read the previous test's rows.
	invalidateFeatureFlagCache();
	// The real migrations, not a copy of them. See vitest.config.mts.
	await applyD1Migrations(env.orderak_db, (env as unknown as TestMigrationEnv).TEST_MIGRATIONS);
	await applyD1Migrations(env.orderak_geo, (env as unknown as TestMigrationEnv).TEST_GEO_MIGRATIONS);
	// Vitest 4 keeps a project's D1 binding between tests, so tables are cleared
	// rather than recreated, keeping tests order-independent.
	//
	// The order respects foreign keys and is computed once: cleanup runs before
	// every one of 246 tests, so anything repeated per-call is paid 246 times.
	if (deleteOrder === null) deleteOrder = deleteOrderFor(await clearableTables(env.orderak_db));
	for (const table of deleteOrder) {
		await env.orderak_db.prepare(`DELETE FROM ${table}`).run();
	}
	await env.orderak_db.prepare("DELETE FROM geo_city_search").run();
	await env.orderak_db.prepare("DELETE FROM business_taxonomy_search").run();
	await env.orderak_geo.prepare("DELETE FROM city_catalog_search").run();
	await env.orderak_geo.prepare("DELETE FROM city_catalog").run();
	await env.orderak_geo.prepare("DELETE FROM city_catalog_versions").run();
	await env.orderak_db.prepare("INSERT INTO design_system_state(id,active_revision_id) VALUES(1,NULL)").run();
	await env.orderak_db.prepare(
		`INSERT INTO business_taxonomy_versions(id,label,status,source_name,review_method,published_at)
		 VALUES(1,'test-v1','active','test','test',datetime('now'))`,
	).run();
	await env.orderak_db.prepare(
		`INSERT INTO business_categories(id,version_id,key,name_en,name_ar,name_fr,sort_order,active)
		 VALUES('fashion',1,'fashion','Fashion','الأزياء','Mode',1,1)`,
	).run();
	await env.orderak_db.prepare(
		`INSERT INTO business_subcategories(
		   id,version_id,category_id,key,name_en,name_ar,name_fr,sort_order,active
		 ) VALUES('fashion_clothing',1,'fashion','clothing_store','Clothing Store','متجر ملابس','Magasin de vêtements',1,1)`,
	).run();
	await env.orderak_db.prepare(
		`INSERT INTO business_taxonomy_search(subcategory_id,category_id,name_en,name_ar,name_fr)
		 VALUES('fashion_clothing','fashion','Clothing Store','متجر ملابس','Magasin de vêtements')`,
	).run();
	await env.orderak_geo.prepare(
		`INSERT INTO city_catalog_versions(
		   version,source_url,source_sha256,license,city_count,active
		 ) VALUES('test-v1','https://example.invalid/cities','test-sha','ODbL-1.0',3,1)`,
	).run();
	await env.orderak_geo.prepare(
		`INSERT INTO city_catalog(
		   version,source_city_id,country_iso,name,native_name,state_code,state_name,population,timezone
		 ) VALUES
		   ('test-v1',1,'EG','Cairo','القاهرة','C','Cairo Governorate',10000000,'Africa/Cairo'),
		   ('test-v1',2,'EG','Alexandria','الإسكندرية','ALX','Alexandria Governorate',5000000,'Africa/Cairo'),
		   ('test-v1',3,'FR','Paris','Paris','IDF','Île-de-France',2100000,'Europe/Paris')`,
	).run();
	await env.orderak_geo.prepare(
		`INSERT INTO city_catalog_search(
		   version,source_city_id,country_iso,name,native_name,state_name
		 ) VALUES
		   ('test-v1',1,'EG','Cairo','القاهرة','Cairo Governorate'),
		   ('test-v1',2,'EG','Alexandria','الإسكندرية','Alexandria Governorate'),
		   ('test-v1',3,'FR','Paris','Paris','Île-de-France')`,
	).run();
	await env.orderak_db.prepare(
		`INSERT OR IGNORE INTO content_page_versions
		 (slug,lang,version,title,body_html,status,published_at)
		 VALUES
		 ('terms','en',1,'Terms','<p>Terms</p>','published',datetime('now')),
		 ('privacy','en',1,'Privacy','<p>Privacy</p>','published',datetime('now')),
		 ('terms','ar',1,'Terms AR','<p>Terms AR</p>','published',datetime('now')),
		 ('privacy','ar',1,'Privacy AR','<p>Privacy AR</p>','published',datetime('now'))`,
	).run();
}

/** Minimal v2 entitlement schema used by focused policy-engine tests. */
export async function createEntitlementSchema(): Promise<void> {
	const statements = [
		`CREATE TABLE IF NOT EXISTS organizations(id TEXT PRIMARY KEY,name TEXT NOT NULL,owner_store_id TEXT NOT NULL UNIQUE,status TEXT DEFAULT 'active',default_locale TEXT DEFAULT 'en',play_account_hash TEXT,created_at TEXT DEFAULT (datetime('now')),updated_at TEXT DEFAULT (datetime('now')))` ,
		`CREATE TABLE IF NOT EXISTS organization_stores(organization_id TEXT NOT NULL,store_id TEXT NOT NULL UNIQUE,is_primary INTEGER DEFAULT 0,created_at TEXT DEFAULT (datetime('now')),PRIMARY KEY(organization_id,store_id))`,
		`CREATE TABLE IF NOT EXISTS organization_members(id TEXT PRIMARY KEY,organization_id TEXT NOT NULL,seller_id TEXT,role TEXT,status TEXT,created_at TEXT DEFAULT (datetime('now')),updated_at TEXT DEFAULT (datetime('now')))` ,
		`CREATE TABLE IF NOT EXISTS subscription_plans(id TEXT PRIMARY KEY,plan_key TEXT UNIQUE,name TEXT,description TEXT,target_customer TEXT,primary_value TEXT,sort_order INTEGER,active INTEGER,current_revision_id TEXT,created_at TEXT DEFAULT (datetime('now')),updated_at TEXT DEFAULT (datetime('now')))` ,
		`CREATE TABLE IF NOT EXISTS plan_revisions(id TEXT PRIMARY KEY,plan_id TEXT,version INTEGER,status TEXT,change_type TEXT,source_catalog_hash TEXT,created_by INTEGER,published_by INTEGER,created_at TEXT DEFAULT (datetime('now')),updated_at TEXT DEFAULT (datetime('now')),lock_version INTEGER NOT NULL DEFAULT 0,edit_token TEXT,published_at TEXT,retired_at TEXT,UNIQUE(plan_id,version))`,
		`CREATE TABLE IF NOT EXISTS entitlement_definitions(entitlement_key TEXT PRIMARY KEY,category TEXT,name TEXT,description TEXT,value_type TEXT,unit TEXT,reset_period TEXT,supports_unlimited INTEGER,higher_is_better INTEGER,implementation_status TEXT,enforcement_binding TEXT,admin_configurable INTEGER,core_universal INTEGER,sort_order INTEGER,active INTEGER,created_at TEXT DEFAULT (datetime('now')),updated_at TEXT DEFAULT (datetime('now')))` ,
		`CREATE TABLE IF NOT EXISTS plan_revision_entitlements(revision_id TEXT,entitlement_key TEXT,value_mode TEXT,bool_value INTEGER,int_value INTEGER,text_value TEXT,display_value TEXT,updated_at TEXT DEFAULT (datetime('now')),PRIMARY KEY(revision_id,entitlement_key))`,
		`CREATE TABLE IF NOT EXISTS organization_subscriptions(id TEXT PRIMARY KEY,organization_id TEXT,plan_revision_id TEXT,pending_revision_id TEXT,pending_effective_at TEXT,source TEXT,status TEXT,legacy_subscription_id INTEGER,current_period_start TEXT,current_period_end TEXT,cancel_at_period_end INTEGER DEFAULT 0,verification_generation INTEGER NOT NULL DEFAULT 0,created_at TEXT DEFAULT (datetime('now')),updated_at TEXT DEFAULT (datetime('now')))` ,
		`CREATE TABLE IF NOT EXISTS organization_entitlement_overrides(id TEXT PRIMARY KEY,organization_id TEXT,entitlement_key TEXT,value_mode TEXT,bool_value INTEGER,int_value INTEGER,text_value TEXT,reason TEXT,effective_at TEXT DEFAULT (datetime('now')),expires_at TEXT,created_by INTEGER,created_at TEXT DEFAULT (datetime('now')),revoked_at TEXT,revoked_by INTEGER)` ,
		`CREATE TABLE IF NOT EXISTS entitlement_usage_counters(organization_id TEXT,entitlement_key TEXT,period_start TEXT,period_end TEXT,used INTEGER DEFAULT 0,updated_at TEXT DEFAULT (datetime('now')),PRIMARY KEY(organization_id,entitlement_key,period_start))`,
		`CREATE TABLE IF NOT EXISTS entitlement_usage_reservations(id TEXT PRIMARY KEY,organization_id TEXT,entitlement_key TEXT,period_start TEXT,delta INTEGER,idempotency_key TEXT,status TEXT DEFAULT 'reserved',created_at TEXT DEFAULT (datetime('now')),updated_at TEXT DEFAULT (datetime('now')),UNIQUE(organization_id,entitlement_key,idempotency_key))`,
		`CREATE TABLE IF NOT EXISTS plan_change_notices(id TEXT PRIMARY KEY,organization_id TEXT,from_revision_id TEXT,to_revision_id TEXT,effective_at TEXT,change_type TEXT,created_at TEXT DEFAULT (datetime('now')))` ,
		`CREATE TABLE IF NOT EXISTS play_product_mappings(id TEXT PRIMARY KEY,plan_id TEXT,product_id TEXT,base_plan_id TEXT,package_name TEXT,active INTEGER,last_synced_at TEXT,price_snapshot_json TEXT,created_at TEXT DEFAULT (datetime('now')),UNIQUE(product_id,base_plan_id))`,
		`CREATE TABLE IF NOT EXISTS play_purchases(id TEXT PRIMARY KEY,organization_id TEXT,subscription_id TEXT,product_mapping_id TEXT,purchase_token_hash TEXT UNIQUE,purchase_token_encrypted TEXT,linked_token_hash TEXT,order_id TEXT,state TEXT,acknowledgement_state TEXT,region_code TEXT,start_at TEXT,expires_at TEXT,raw_etag TEXT,last_verified_at TEXT DEFAULT (datetime('now')),verification_generation INTEGER NOT NULL DEFAULT 0,replaced_by_token_hash TEXT,replaced_at TEXT,created_at TEXT DEFAULT (datetime('now')),updated_at TEXT DEFAULT (datetime('now')))`,
		`CREATE TABLE IF NOT EXISTS play_billing_events(message_id TEXT PRIMARY KEY,notification_type INTEGER,purchase_token_hash TEXT,event_time TEXT,status TEXT,error_code TEXT,verification_job_id TEXT,received_at TEXT DEFAULT (datetime('now')),processed_at TEXT)`,
		`CREATE TABLE IF NOT EXISTS billing_verification_heads(organization_id TEXT PRIMARY KEY,latest_generation INTEGER NOT NULL DEFAULT 0,updated_at TEXT DEFAULT (datetime('now')))`,
		`CREATE TABLE IF NOT EXISTS play_verification_jobs(id TEXT PRIMARY KEY,organization_id TEXT,seller_id TEXT,purchase_token_hash TEXT NOT NULL,purchase_token_encrypted TEXT NOT NULL,source TEXT NOT NULL,message_id TEXT UNIQUE,event_time TEXT,status TEXT NOT NULL DEFAULT 'queued',attempt_count INTEGER NOT NULL DEFAULT 0,verification_generation INTEGER,purchase_status TEXT,result_json TEXT,error_code TEXT,next_attempt_at TEXT,dispatched_at TEXT,last_attempt_at TEXT,completed_at TEXT,claim_token TEXT,claim_started_at TEXT,claim_expires_at TEXT,lease_reclaim_count INTEGER NOT NULL DEFAULT 0,last_lease_reclaimed_at TEXT,requeued_from_job_id TEXT,created_at TEXT DEFAULT (datetime('now')),updated_at TEXT DEFAULT (datetime('now')))`,
		`CREATE UNIQUE INDEX IF NOT EXISTS idx_play_jobs_one_requeue_child ON play_verification_jobs(requeued_from_job_id) WHERE requeued_from_job_id IS NOT NULL`,
		`CREATE TABLE IF NOT EXISTS provider_circuit_state(provider TEXT PRIMARY KEY,state TEXT NOT NULL DEFAULT 'closed',failure_count INTEGER NOT NULL DEFAULT 0,window_started_at INTEGER,opened_at INTEGER,cooldown_until INTEGER,cooldown_seconds INTEGER NOT NULL DEFAULT 60,probe_lease_until INTEGER,updated_at TEXT DEFAULT (datetime('now')))`,
		`CREATE TABLE IF NOT EXISTS ai_provider_usage_events(idempotency_key TEXT PRIMARY KEY,organization_id TEXT,provider TEXT,prompt_tokens INTEGER DEFAULT 0,completion_tokens INTEGER DEFAULT 0,estimated_cost_microusd INTEGER DEFAULT 0,created_at TEXT DEFAULT (datetime('now')))`,
		`CREATE TABLE IF NOT EXISTS ai_budget_alerts(provider TEXT,budget_month TEXT,threshold_percent INTEGER,alerted_at TEXT DEFAULT (datetime('now')),PRIMARY KEY(provider,budget_month,threshold_percent))`,
		`CREATE TRIGGER IF NOT EXISTS trg_google_subscription_generation_insert BEFORE INSERT ON organization_subscriptions WHEN NEW.source='google_play' AND NOT EXISTS(SELECT 1 FROM billing_verification_heads h WHERE h.organization_id=NEW.organization_id AND h.latest_generation=NEW.verification_generation) BEGIN SELECT RAISE(ABORT,'stale_play_verification'); END`,
		`CREATE TRIGGER IF NOT EXISTS trg_google_subscription_generation_update BEFORE UPDATE ON organization_subscriptions WHEN NEW.source='google_play' AND NOT EXISTS(SELECT 1 FROM billing_verification_heads h WHERE h.organization_id=NEW.organization_id AND h.latest_generation=NEW.verification_generation) BEGIN SELECT RAISE(ABORT,'stale_play_verification'); END`,
		`CREATE TRIGGER IF NOT EXISTS trg_play_purchase_generation_insert BEFORE INSERT ON play_purchases WHEN NOT EXISTS(SELECT 1 FROM billing_verification_heads h WHERE h.organization_id=NEW.organization_id AND h.latest_generation=NEW.verification_generation) BEGIN SELECT RAISE(ABORT,'stale_play_verification'); END`,
		`CREATE TRIGGER IF NOT EXISTS trg_play_purchase_generation_update BEFORE UPDATE ON play_purchases WHEN NOT EXISTS(SELECT 1 FROM billing_verification_heads h WHERE h.organization_id=NEW.organization_id AND h.latest_generation=NEW.verification_generation) BEGIN SELECT RAISE(ABORT,'stale_play_verification'); END`,
	];
	for (const statement of statements) await env.orderak_db.prepare(statement).run();
	for (const table of [
		"ai_budget_alerts", "ai_provider_usage_events", "provider_circuit_state", "play_verification_jobs", "play_billing_events",
		"play_purchases", "play_product_mappings", "billing_verification_heads",
		"plan_change_notices", "entitlement_usage_reservations", "entitlement_usage_counters", "organization_entitlement_overrides",
		"organization_subscriptions", "organization_members", "organization_stores", "organizations",
		"plan_revision_entitlements", "plan_revisions", "subscription_plans", "entitlement_definitions",
	]) await env.orderak_db.prepare(`DELETE FROM ${table}`).run();
	const plans = [
		["p-free", "free", "Free", 0, "r-free"],
		["p-1", "paid1", "Launch", 1, "r-1"],
		["p-2", "paid2", "Momentum", 2, "r-2"],
		["p-3", "paid3", "Command", 3, "r-3"],
	] as const;
	for (const [planId, key, name, sort, revisionId] of plans) {
		await env.orderak_db.prepare("INSERT OR IGNORE INTO subscription_plans(id,plan_key,name,sort_order,active,current_revision_id) VALUES(?,?,?,?,1,?)")
			.bind(planId, key, name, sort, revisionId).run();
		await env.orderak_db.prepare("INSERT OR IGNORE INTO plan_revisions(id,plan_id,version,status,change_type) VALUES(?,?,1,'published','initial')")
			.bind(revisionId, planId).run();
	}
	const definitions = [
		["max_products", "integer", "none", 1, 1],
		["max_categories", "integer", "none", 1, 1],
		["max_orders_per_month", "integer", "calendar_month_utc", 1, 1],
		["max_ai_requests_per_month", "integer", "calendar_month_utc", 1, 1],
		["max_concurrent_devices", "integer", "none", 1, 1],
		["show_ads", "boolean", "none", 0, 0],
	] as const;
	for (const [key, type, reset, unlimited, higher] of definitions) {
		await env.orderak_db.prepare(`INSERT OR IGNORE INTO entitlement_definitions
		 (entitlement_key,category,name,value_type,reset_period,supports_unlimited,higher_is_better,implementation_status,admin_configurable,core_universal,sort_order,active)
		 VALUES(?,'Plan limits',?,?,?, ?,?,'implemented',1,0,1,1)`).bind(key, key, type, reset, unlimited, higher).run();
	}
	const values: Record<string, Array<number | boolean | null>> = {
		max_products: [20, 200, 2000, null], max_categories: [5, 20, 100, null],
		max_orders_per_month: [50, 500, 5000, null], max_ai_requests_per_month: [2, 200, 1000, null],
		max_concurrent_devices: [1, 2, 10, null], show_ads: [true, false, false, false],
	};
	for (const [index, plan] of plans.entries()) for (const [key, planValues] of Object.entries(values)) {
		const value = planValues[index];
		const custom = index === 3 && key !== "show_ads";
		const mode = custom ? "custom_required" : value == null ? "unlimited" : "value";
		await env.orderak_db.prepare(`INSERT OR IGNORE INTO plan_revision_entitlements
		 (revision_id,entitlement_key,value_mode,bool_value,int_value,display_value) VALUES(?,?,?,?,?,?)`)
			.bind(plan[4], key, mode, typeof value === "boolean" ? (value ? 1 : 0) : null,
				typeof value === "number" ? value : null, custom ? "Custom" : value == null ? "Unlimited" : String(value)).run();
	}
}

const BASE = "https://api.orderak.app";

export interface Registered {
	phone: string;
	secret: string;
	store_code: string;
	public_identifier: string;
	slug: string;
	store_url: string;
}

/** Register a fresh store and return its identity. */
export async function registerStore(
	overrides: Record<string, unknown> = {},
): Promise<Registered> {
	const phone = String(overrides.phone ?? "+2010" + Math.floor(Math.random() * 1e8));
	const secret = String(overrides.secret ?? "dev-secret-" + Math.random().toString(36).slice(2, 8));
	const res = await SELF.fetch(`${BASE}/api/v1/register`, {
		method: "POST",
		headers: { "content-type": "application/json" },
		body: JSON.stringify({ phone, secret, store_name: "Fresh Market", country_iso: "EG", ...overrides }),
	});
	const body = (await res.json()) as Record<string, string>;
	return {
		phone,
		secret,
		store_code: body.store_code,
		public_identifier: body.public_identifier,
		slug: body.slug,
		store_url: body.store_url,
	};
}

/** Authenticated JSON headers for a registered store. */
export function authHeaders(r: Registered): Record<string, string> {
	return {
		"content-type": "application/json",
		"x-orderak-phone": r.phone,
		"x-orderak-secret": r.secret,
	};
}

export { SELF, env, BASE };
