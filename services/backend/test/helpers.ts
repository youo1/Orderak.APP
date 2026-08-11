// Test helpers: create the final (post-009) domain schema in the test D1 and
// small utilities for driving the API via SELF.fetch.
import { env, SELF, createExecutionContext } from "cloudflare:test";
import { invalidateDesignSystemCache } from "../src/domains/design/design-system";

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

const SCHEMA: string[] = [
	`CREATE TABLE IF NOT EXISTS sellers (
	  id TEXT PRIMARY KEY, store_code TEXT NOT NULL, country_code TEXT,
	  store_name TEXT NOT NULL DEFAULT '', slug TEXT, public_identifier TEXT,
	  phone TEXT NOT NULL UNIQUE, firebase_uid TEXT, instapay TEXT, vfcash TEXT, secret TEXT,
	  description TEXT, whatsapp TEXT, email TEXT, website TEXT, address TEXT,
	  logo_url TEXT, cover_url TEXT, referral_code TEXT,
	  lang TEXT NOT NULL DEFAULT 'ar', status TEXT NOT NULL DEFAULT 'active',
	  primary_device_id TEXT, primary_device_label TEXT, primary_device_platform TEXT,
	  primary_device_app_version TEXT, primary_device_last_used_at TEXT,
	  business_category TEXT, city_geoname_id INTEGER, city_catalog_id INTEGER,
	  city_catalog_version TEXT, city_name TEXT,
	  business_category_id TEXT,business_subcategory_id TEXT,business_taxonomy_version INTEGER,
	  created_at TEXT DEFAULT (datetime('now')), updated_at TEXT DEFAULT (datetime('now')))`,
	`CREATE TABLE IF NOT EXISTS organizations (
	  id TEXT PRIMARY KEY,name TEXT NOT NULL,owner_store_id TEXT NOT NULL UNIQUE,status TEXT DEFAULT 'active',
	  default_locale TEXT DEFAULT 'en',play_account_hash TEXT UNIQUE,
	  created_at TEXT DEFAULT (datetime('now')),updated_at TEXT DEFAULT (datetime('now')))`,
	`CREATE TABLE IF NOT EXISTS organization_stores (
	  organization_id TEXT NOT NULL,store_id TEXT NOT NULL UNIQUE,is_primary INTEGER DEFAULT 0,
	  created_at TEXT DEFAULT (datetime('now')),PRIMARY KEY(organization_id,store_id))`,
	`CREATE TABLE IF NOT EXISTS organization_members (
	  id TEXT PRIMARY KEY,organization_id TEXT NOT NULL,seller_id TEXT,role TEXT,status TEXT,
	  created_at TEXT DEFAULT (datetime('now')),updated_at TEXT DEFAULT (datetime('now')))`,
	`CREATE TABLE IF NOT EXISTS seller_auth_identities (
	  id TEXT PRIMARY KEY,seller_id TEXT NOT NULL,provider TEXT NOT NULL,provider_subject TEXT NOT NULL,
	  verified_phone_e164 TEXT NOT NULL,status TEXT NOT NULL DEFAULT 'active',verified_at TEXT DEFAULT (datetime('now')),
	  superseded_at TEXT,created_at TEXT DEFAULT (datetime('now')),updated_at TEXT DEFAULT (datetime('now')))`,
	`CREATE UNIQUE INDEX IF NOT EXISTS idx_auth_identity_provider_subject ON seller_auth_identities(provider,provider_subject)`,
	`CREATE UNIQUE INDEX IF NOT EXISTS idx_auth_identity_active_phone ON seller_auth_identities(verified_phone_e164) WHERE status='active'`,
	`CREATE UNIQUE INDEX IF NOT EXISTS idx_auth_identity_one_active_provider_per_seller ON seller_auth_identities(seller_id,provider) WHERE status='active'`,
	`CREATE TABLE IF NOT EXISTS identity_migration_issues (
	  seller_id TEXT NOT NULL,issue_code TEXT NOT NULL,first_observed_at TEXT DEFAULT (datetime('now')),
	  last_observed_at TEXT DEFAULT (datetime('now')),occurrence_count INTEGER DEFAULT 1,resolved_at TEXT,
	  PRIMARY KEY(seller_id,issue_code))`,
	`CREATE TABLE IF NOT EXISTS organization_routing (
	  organization_id TEXT PRIMARY KEY,shard_key TEXT NOT NULL DEFAULT 'primary',routing_version INTEGER DEFAULT 1,
	  migration_state TEXT NOT NULL DEFAULT 'stable',target_shard_key TEXT,write_fence_started_at TEXT,
	  write_fence_reason TEXT,updated_at TEXT DEFAULT (datetime('now')))`,
	`CREATE TABLE IF NOT EXISTS phone_change_challenges (
	  id TEXT PRIMARY KEY,challenge_token_hash TEXT NOT NULL UNIQUE,seller_id TEXT NOT NULL,current_phone_e164 TEXT NOT NULL,
	  new_phone_e164 TEXT NOT NULL,current_provider_subject TEXT NOT NULL,expires_at TEXT NOT NULL,consumed_at TEXT,
	  created_at TEXT DEFAULT (datetime('now')))`,
	`CREATE TABLE IF NOT EXISTS categories (
	  id TEXT PRIMARY KEY, store_id TEXT NOT NULL, category_code TEXT NOT NULL,
	  name TEXT NOT NULL, slug TEXT, sort_order INTEGER NOT NULL DEFAULT 0,
	  created_at TEXT DEFAULT (datetime('now')), updated_at TEXT DEFAULT (datetime('now')))`,
	`CREATE TABLE IF NOT EXISTS products (
	  id TEXT PRIMARY KEY, store_id TEXT NOT NULL, category_id TEXT,
	  product_code TEXT NOT NULL, app_id INTEGER, name TEXT NOT NULL, slug TEXT,
	  description TEXT, price_piasters INTEGER NOT NULL DEFAULT 0, stock INTEGER NOT NULL DEFAULT 0,
	  stock_version INTEGER NOT NULL DEFAULT 0,
	  available INTEGER NOT NULL DEFAULT 1, image_url TEXT,
	  created_at TEXT DEFAULT (datetime('now')), updated_at TEXT DEFAULT (datetime('now')),
	  UNIQUE(store_id, app_id))`,
	`CREATE TABLE IF NOT EXISTS product_translations (
	  product_id TEXT NOT NULL, lang TEXT NOT NULL, name TEXT NOT NULL, description TEXT,
	  source_name TEXT NOT NULL, source_description TEXT NOT NULL DEFAULT '', detected_language TEXT,
	  source_locale TEXT NOT NULL DEFAULT 'und', source_version TEXT NOT NULL DEFAULT '',
	  translation_status TEXT NOT NULL DEFAULT 'machine', provider TEXT, model TEXT, reviewed_at TEXT,
	  reviewed_by_type TEXT, reviewed_by_id TEXT,
	  updated_at TEXT DEFAULT (datetime('now')), PRIMARY KEY(product_id, lang))`,
	`CREATE TABLE IF NOT EXISTS seller_devices (
	  seller_id TEXT NOT NULL, secret_hash TEXT NOT NULL,
	  device_id TEXT, device_label TEXT, platform TEXT, app_version TEXT,
	  created_at TEXT DEFAULT (datetime('now')), last_used_at TEXT DEFAULT (datetime('now')),
	  PRIMARY KEY(seller_id, secret_hash))`,
	`CREATE TABLE IF NOT EXISTS orders (
	  id TEXT PRIMARY KEY, order_no INTEGER, store_id TEXT NOT NULL, buyer_phone TEXT NOT NULL,
	  buyer_name TEXT, status TEXT NOT NULL DEFAULT 'NEW', pay_method TEXT NOT NULL DEFAULT 'COD',
	  total_piasters INTEGER NOT NULL DEFAULT 0, note TEXT, idempotency_key TEXT,
	  created_at TEXT DEFAULT (datetime('now')))`,
	`CREATE TABLE IF NOT EXISTS coupon_uses (
	  id INTEGER PRIMARY KEY AUTOINCREMENT, seller_id TEXT NOT NULL)`,
	`CREATE TABLE IF NOT EXISTS referrals (
	  id INTEGER PRIMARY KEY AUTOINCREMENT, referrer_id TEXT, referred_id TEXT)`,
	`CREATE TABLE IF NOT EXISTS payment_events (
	  id INTEGER PRIMARY KEY AUTOINCREMENT, seller_id TEXT, raw_json TEXT)`,
	`CREATE TABLE IF NOT EXISTS order_items (
	  id TEXT PRIMARY KEY, order_id TEXT NOT NULL, product_id TEXT, product_name TEXT NOT NULL,
	  qty INTEGER NOT NULL DEFAULT 1, price_piasters INTEGER NOT NULL DEFAULT 0)`,
	// Columns must cover everything getPlanLimit() and loadPlanConfig() SELECT —
	// SQLite validates columns at prepare time, so a missing one throws even
	// when no rows match. max_ai_requests_per_month is read on the /api/v1/chat
	// path (that's what was 500-ing the chat tests once they authenticated).
	`CREATE TABLE IF NOT EXISTS plans (
	  id TEXT PRIMARY KEY, name TEXT, price_piasters INTEGER NOT NULL DEFAULT 0,
	  currency TEXT NOT NULL DEFAULT 'EGP', ads_enabled INTEGER NOT NULL DEFAULT 0,
	  active INTEGER NOT NULL DEFAULT 1, sort_order INTEGER NOT NULL DEFAULT 0,
	  max_categories INTEGER, max_products INTEGER, max_orders_per_month INTEGER,
	  max_ai_requests_per_month INTEGER, max_team_members INTEGER,
	  custom_domain_enabled INTEGER NOT NULL DEFAULT 0,
	  analytics_enabled INTEGER NOT NULL DEFAULT 0,
	  priority_support_enabled INTEGER NOT NULL DEFAULT 0,
	  multi_device_enabled INTEGER NOT NULL DEFAULT 0)`,
	`CREATE TABLE IF NOT EXISTS subscriptions (
	  id INTEGER PRIMARY KEY AUTOINCREMENT, seller_id TEXT NOT NULL, plan_id TEXT NOT NULL,
	  status TEXT NOT NULL DEFAULT 'active', gateway TEXT NOT NULL DEFAULT 'mock',
	  gateway_sub_id TEXT, amount_piasters INTEGER NOT NULL DEFAULT 0, coupon_code TEXT,
	  idempotency_key TEXT, current_period_end TEXT,
	  created_at TEXT DEFAULT (datetime('now')), updated_at TEXT DEFAULT (datetime('now')))`,
	`CREATE TABLE IF NOT EXISTS content_page_versions (
	  id INTEGER PRIMARY KEY AUTOINCREMENT, slug TEXT NOT NULL, lang TEXT NOT NULL,
	  version INTEGER NOT NULL, title TEXT, body_html TEXT, notes TEXT,
	  status TEXT NOT NULL DEFAULT 'draft', created_by INTEGER, created_at TEXT DEFAULT (datetime('now')),
	  published_at TEXT, UNIQUE(slug,lang,version))`,
	`CREATE TABLE IF NOT EXISTS legal_acceptances (
	  id TEXT PRIMARY KEY, seller_id TEXT, phone_e164 TEXT NOT NULL,
	  terms_version INTEGER NOT NULL, privacy_version INTEGER NOT NULL,
	  locale TEXT NOT NULL, source TEXT NOT NULL, app_version TEXT,
	  marketing_consent INTEGER NOT NULL DEFAULT 0,
	  accepted_at TEXT DEFAULT (datetime('now')))`,
	`CREATE TABLE IF NOT EXISTS onboarding_sessions (
	  id TEXT PRIMARY KEY,token_hash TEXT NOT NULL UNIQUE,phone_e164 TEXT NOT NULL,firebase_uid TEXT NOT NULL,
	  device_secret_hash TEXT NOT NULL,phone_country_iso TEXT,locale TEXT NOT NULL DEFAULT 'en',
	  status TEXT NOT NULL DEFAULT 'phone_verified',
	  full_name TEXT,birth_year INTEGER,email_private TEXT,terms_version INTEGER,privacy_version INTEGER,terms_accepted_at TEXT,
	  app_version TEXT,completed_seller_id TEXT,idempotency_key TEXT,expires_at TEXT NOT NULL,
	  city_catalog_id INTEGER,city_catalog_version TEXT,city_name TEXT,
	  absolute_expires_at TEXT NOT NULL,created_at TEXT DEFAULT (datetime('now')),updated_at TEXT DEFAULT (datetime('now')))`,
	`CREATE TABLE IF NOT EXISTS seller_profiles (
	  seller_id TEXT PRIMARY KEY,full_name TEXT NOT NULL,birth_year INTEGER NOT NULL,email_private TEXT,email_verified_at TEXT,
	  created_at TEXT DEFAULT (datetime('now')),updated_at TEXT DEFAULT (datetime('now')))`,
	`CREATE UNIQUE INDEX IF NOT EXISTS idx_seller_profiles_email
	  ON seller_profiles(lower(email_private)) WHERE email_private IS NOT NULL`,
	`CREATE TABLE IF NOT EXISTS passkey_credentials (
	  id TEXT PRIMARY KEY,seller_id TEXT NOT NULL,credential_id TEXT NOT NULL UNIQUE,
	  credential_public_key BLOB NOT NULL,webauthn_user_id TEXT NOT NULL,counter INTEGER DEFAULT 0,
	  aaguid TEXT,transports_json TEXT DEFAULT '[]',device_type TEXT NOT NULL,backed_up INTEGER DEFAULT 0,
	  label TEXT,status TEXT DEFAULT 'active',created_at TEXT DEFAULT (datetime('now')),
	  updated_at TEXT DEFAULT (datetime('now')),last_used_at TEXT,revoked_at TEXT)`,
	`CREATE TABLE IF NOT EXISTS webauthn_challenges (
	  id TEXT PRIMARY KEY,challenge_hash TEXT NOT NULL UNIQUE,ceremony TEXT NOT NULL,seller_id TEXT,
	  webauthn_user_id TEXT,expires_at TEXT NOT NULL,consumed_at TEXT,created_at TEXT DEFAULT (datetime('now')))`,
	`CREATE TABLE IF NOT EXISTS recent_auth_proofs (
	  id TEXT PRIMARY KEY,token_hash TEXT NOT NULL UNIQUE,seller_id TEXT NOT NULL,method TEXT NOT NULL,
	  expires_at TEXT NOT NULL,consumed_at TEXT,created_at TEXT DEFAULT (datetime('now')))`,
	`CREATE TABLE IF NOT EXISTS email_verification_tokens (
	  id TEXT PRIMARY KEY,seller_id TEXT NOT NULL,email TEXT NOT NULL,token_hash TEXT NOT NULL UNIQUE,
	  kind TEXT NOT NULL DEFAULT 'initial' CHECK (kind IN ('initial','resend')),
	  expires_at TEXT NOT NULL,used_at TEXT,created_at TEXT DEFAULT (datetime('now')))`,
	`CREATE TRIGGER IF NOT EXISTS trg_email_verification_applied
	  AFTER UPDATE OF used_at ON email_verification_tokens
	  WHEN OLD.used_at IS NULL AND NEW.used_at IS NOT NULL
	  BEGIN
	    UPDATE seller_profiles SET email_verified_at=NEW.used_at,updated_at=NEW.used_at
	    WHERE seller_id=NEW.seller_id AND lower(email_private)=lower(NEW.email);
	  END`,
	`CREATE TABLE IF NOT EXISTS geo_cities (
	  geoname_id INTEGER PRIMARY KEY,country_iso TEXT NOT NULL,name TEXT NOT NULL,ascii_name TEXT NOT NULL,
	  admin1_code TEXT,population INTEGER DEFAULT 0,timezone TEXT,updated_at TEXT DEFAULT (datetime('now')))`,
	`CREATE TABLE IF NOT EXISTS geo_city_names (
	  geoname_id INTEGER NOT NULL,lang TEXT NOT NULL,name TEXT NOT NULL,preferred INTEGER DEFAULT 0,
	  PRIMARY KEY(geoname_id,lang,name))`,
	`CREATE VIRTUAL TABLE IF NOT EXISTS geo_city_search USING fts5(
	  geoname_id UNINDEXED,country_iso UNINDEXED,lang UNINDEXED,name,ascii_name,
	  tokenize='unicode61 remove_diacritics 2')`,
	`CREATE TABLE IF NOT EXISTS business_taxonomy_versions(
	  id INTEGER PRIMARY KEY,label TEXT UNIQUE,status TEXT,source_name TEXT,review_method TEXT,published_at TEXT,
	  created_at TEXT DEFAULT (datetime('now')))`,
	`CREATE TABLE IF NOT EXISTS business_categories(
	  id TEXT PRIMARY KEY,version_id INTEGER,key TEXT,name_en TEXT,name_ar TEXT,name_fr TEXT,
	  sort_order INTEGER DEFAULT 0,active INTEGER DEFAULT 1)`,
	`CREATE TABLE IF NOT EXISTS business_subcategories(
	  id TEXT PRIMARY KEY,version_id INTEGER,category_id TEXT,key TEXT,name_en TEXT,name_ar TEXT,name_fr TEXT,
	  sort_order INTEGER DEFAULT 0,active INTEGER DEFAULT 1)`,
	`CREATE VIRTUAL TABLE IF NOT EXISTS business_taxonomy_search USING fts5(
	  subcategory_id UNINDEXED,category_id UNINDEXED,name_en,name_ar,name_fr,
	  tokenize='unicode61 remove_diacritics 2')`,
	`CREATE TABLE IF NOT EXISTS deletion_requests (
	  id TEXT PRIMARY KEY, phone_e164 TEXT NOT NULL, email TEXT, locale TEXT NOT NULL,
	  source TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'pending', requested_at TEXT DEFAULT (datetime('now')),
	  deadline_at TEXT NOT NULL, verified_at TEXT, completed_at TEXT, notes TEXT)` ,
	`CREATE TABLE IF NOT EXISTS admin_audit (
	  id INTEGER PRIMARY KEY AUTOINCREMENT, admin_id INTEGER, action TEXT NOT NULL,
	  entity TEXT, entity_id TEXT, details_json TEXT, ip TEXT, created_at TEXT DEFAULT (datetime('now')))` ,
	`CREATE TABLE IF NOT EXISTS email_template_history (
	  id INTEGER PRIMARY KEY AUTOINCREMENT, changed_ip TEXT, changed_at TEXT DEFAULT (datetime('now')))` ,
	`CREATE TABLE IF NOT EXISTS email_events (
	  id INTEGER PRIMARY KEY AUTOINCREMENT,to_addr TEXT,template_key TEXT,provider_id TEXT,
	  event TEXT NOT NULL,error TEXT,meta_json TEXT,created_at TEXT DEFAULT (datetime('now')))` ,
	`CREATE TABLE IF NOT EXISTS email_templates (
	  key TEXT PRIMARY KEY,category TEXT,enabled INTEGER DEFAULT 1,current_version INTEGER DEFAULT 1,
	  created_at TEXT DEFAULT (datetime('now')),updated_at TEXT DEFAULT (datetime('now')))`,
	`CREATE TABLE IF NOT EXISTS email_template_translations (
	  template_key TEXT NOT NULL,lang TEXT NOT NULL,subject TEXT DEFAULT '',html TEXT DEFAULT '',text TEXT DEFAULT '',
	  version INTEGER DEFAULT 1,updated_by INTEGER,updated_at TEXT DEFAULT (datetime('now')),
	  PRIMARY KEY(template_key,lang))`,
	`CREATE TABLE IF NOT EXISTS ads (
	  id INTEGER PRIMARY KEY AUTOINCREMENT, title TEXT NOT NULL, title_i18n TEXT,
	  image_url TEXT NOT NULL, image_url_i18n TEXT, click_url TEXT, type TEXT DEFAULT 'banner',
	  target_plan TEXT DEFAULT 'free', frequency INTEGER DEFAULT 1, weight INTEGER DEFAULT 1,
	  active INTEGER DEFAULT 1, starts_at TEXT, ends_at TEXT, created_at TEXT DEFAULT (datetime('now')))` ,
	`CREATE TABLE IF NOT EXISTS ad_impressions (
	  id INTEGER PRIMARY KEY AUTOINCREMENT, ad_id INTEGER, seller_id TEXT, kind TEXT,
	  event_key TEXT UNIQUE, created_at TEXT DEFAULT (datetime('now')))` ,
	`CREATE TABLE IF NOT EXISTS announcements (
	  id INTEGER PRIMARY KEY AUTOINCREMENT, title_i18n TEXT, body_i18n TEXT, target_plan TEXT DEFAULT 'all',
	  starts_at TEXT, ends_at TEXT, active INTEGER DEFAULT 1, created_by INTEGER,
	  created_at TEXT DEFAULT (datetime('now')))` ,
	`CREATE TABLE IF NOT EXISTS announcement_reads (
	  announcement_id INTEGER NOT NULL, seller_id TEXT NOT NULL, read_at TEXT DEFAULT (datetime('now')),
	  PRIMARY KEY(announcement_id,seller_id))` ,
	`CREATE TABLE IF NOT EXISTS support_tickets (
	  id INTEGER PRIMARY KEY AUTOINCREMENT, seller_id TEXT NOT NULL, subject TEXT NOT NULL,
	  status TEXT DEFAULT 'open', priority TEXT DEFAULT 'normal', assigned_to INTEGER,
	  created_at TEXT DEFAULT (datetime('now')), updated_at TEXT DEFAULT (datetime('now')))` ,
	`CREATE TABLE IF NOT EXISTS support_messages (
	  id INTEGER PRIMARY KEY AUTOINCREMENT, ticket_id INTEGER NOT NULL, sender TEXT NOT NULL,
	  body TEXT NOT NULL, created_at TEXT DEFAULT (datetime('now')))` ,
	`CREATE TABLE IF NOT EXISTS operational_job_runs (
	  id TEXT PRIMARY KEY, job_key TEXT, trigger_kind TEXT, status TEXT, started_at TEXT DEFAULT (datetime('now')),
	  completed_at TEXT, affected_count INTEGER, error_message TEXT, triggered_by INTEGER)` ,
	`CREATE TABLE IF NOT EXISTS settings (
	  key TEXT PRIMARY KEY, value_json TEXT, updated_by INTEGER, updated_at TEXT DEFAULT (datetime('now')))` ,
	`CREATE TABLE IF NOT EXISTS design_system_revisions (
	  id INTEGER PRIMARY KEY AUTOINCREMENT,schema_version INTEGER NOT NULL,generator_version TEXT NOT NULL,
	  source_json TEXT NOT NULL,overrides_json TEXT NOT NULL DEFAULT '{}',snapshot_json TEXT NOT NULL,
	  validation_json TEXT NOT NULL,legacy_projection_json TEXT NOT NULL,content_hash TEXT NOT NULL,
	  status TEXT NOT NULL DEFAULT 'candidate',created_by INTEGER,created_at TEXT DEFAULT (datetime('now')),
	  published_at TEXT,rollback_of_revision_id INTEGER,name TEXT,name_key TEXT,
	  FOREIGN KEY(rollback_of_revision_id) REFERENCES design_system_revisions(id) ON DELETE SET NULL)` ,
	`CREATE UNIQUE INDEX IF NOT EXISTS idx_design_system_revision_name_key
	  ON design_system_revisions(name_key) WHERE name_key IS NOT NULL` ,
	`CREATE TABLE IF NOT EXISTS design_system_state (
	  id INTEGER PRIMARY KEY,active_revision_id INTEGER,updated_at TEXT DEFAULT (datetime('now')))` ,
	`INSERT OR IGNORE INTO design_system_state(id,active_revision_id) VALUES(1,NULL)` ,
	`CREATE TABLE IF NOT EXISTS store_capability_overrides (
	  id TEXT PRIMARY KEY, store_id TEXT NOT NULL, capability_key TEXT NOT NULL, enabled INTEGER NOT NULL,
	  reason TEXT NOT NULL, expires_at TEXT, created_by INTEGER, created_at TEXT DEFAULT (datetime('now')), revoked_at TEXT)` ,
	`CREATE TABLE IF NOT EXISTS feature_flags (
	  flag_key TEXT PRIMARY KEY, description TEXT, value_type TEXT DEFAULT 'boolean', default_value_json TEXT,
	  env_gate TEXT, runtime_consumer TEXT, risk TEXT, rollout_seed TEXT, status TEXT, version INTEGER DEFAULT 1,
	  updated_by INTEGER, updated_at TEXT DEFAULT (datetime('now')))` ,
	`CREATE TABLE IF NOT EXISTS feature_flag_rules (
	  id TEXT PRIMARY KEY, flag_key TEXT, priority INTEGER, scope_type TEXT, scope_value TEXT,
	  min_version_code INTEGER, max_version_code INTEGER, rollout_basis_points INTEGER, value_json TEXT,
	  starts_at TEXT, ends_at TEXT, active INTEGER DEFAULT 1, reason TEXT, created_by INTEGER, created_at TEXT DEFAULT (datetime('now')))` ,
	`CREATE TABLE IF NOT EXISTS app_version_policies (
	  id TEXT PRIMARY KEY, platform TEXT, country_code TEXT, channel TEXT, recommended_version_code INTEGER,
	  minimum_version_code INTEGER, blocked_version_codes_json TEXT DEFAULT '[]', warning_message_i18n TEXT DEFAULT '{}',
	  blocking_message_i18n TEXT DEFAULT '{}', store_url TEXT, enforce_after TEXT, maintenance_mode INTEGER DEFAULT 0,
	  active INTEGER DEFAULT 1, reason TEXT, updated_by INTEGER, updated_at TEXT DEFAULT (datetime('now')))` ,
	`CREATE TABLE IF NOT EXISTS buyer_restrictions (
	  id TEXT PRIMARY KEY, store_id TEXT, buyer_phone_hash TEXT, buyer_phone_last4 TEXT, scope TEXT,
	  status TEXT, reason TEXT, evidence TEXT, expires_at TEXT, created_by INTEGER, created_at TEXT DEFAULT (datetime('now')), revoked_at TEXT)` ,
	`CREATE TABLE IF NOT EXISTS buyer_privacy_requests (
	  id TEXT PRIMARY KEY, store_id TEXT, buyer_phone_hash TEXT NOT NULL, buyer_phone_last4 TEXT NOT NULL,
	  request_type TEXT NOT NULL, status TEXT DEFAULT 'open', notes TEXT, requested_at TEXT DEFAULT (datetime('now')),
	  completed_at TEXT, updated_by INTEGER)` ,
	`CREATE TABLE IF NOT EXISTS capability_definitions (
	  capability_key TEXT PRIMARY KEY, domain TEXT, label TEXT, description TEXT, implementation_status TEXT,
	  enforcement_binding TEXT, runtime_consumer TEXT, risk TEXT, scopes_json TEXT DEFAULT '[]', updated_at TEXT DEFAULT (datetime('now')))` ,
	`CREATE TABLE IF NOT EXISTS support_macros (
	  id TEXT PRIMARY KEY, name TEXT, category TEXT, locale TEXT, body TEXT, active INTEGER DEFAULT 1,
	  updated_by INTEGER, updated_at TEXT DEFAULT (datetime('now')))` ,
	`CREATE TABLE IF NOT EXISTS content_configs (
	  id TEXT PRIMARY KEY, content_key TEXT, locale TEXT, audience TEXT, version INTEGER, status TEXT,
	  value_json TEXT, starts_at TEXT, ends_at TEXT, created_by INTEGER, created_at TEXT DEFAULT (datetime('now')),
	  published_by INTEGER, published_at TEXT)` ,
	`CREATE TABLE IF NOT EXISTS admin_exports (
	  id TEXT PRIMARY KEY, export_type TEXT, classification TEXT, filters_json TEXT, status TEXT,
	  row_count INTEGER, byte_count INTEGER, r2_key TEXT, created_at TEXT DEFAULT (datetime('now')),
	  completed_at TEXT, expires_at TEXT, requested_by INTEGER, download_token_hash TEXT,
	  download_expires_at TEXT, downloaded_at TEXT, error_message TEXT,
	  attempt_count INTEGER NOT NULL DEFAULT 0, lease_expires_at TEXT)` ,
	`CREATE TABLE IF NOT EXISTS admin_audit_exports (
	  id TEXT PRIMARY KEY, first_audit_id INTEGER, last_audit_id INTEGER, event_count INTEGER,
	  object_key TEXT, content_hash TEXT, signature TEXT, previous_hash TEXT, status TEXT DEFAULT 'written',
	  created_at TEXT DEFAULT (datetime('now')), verified_at TEXT)` ,
	`CREATE TABLE IF NOT EXISTS admin_users (
	  id INTEGER PRIMARY KEY AUTOINCREMENT, email TEXT NOT NULL UNIQUE, name TEXT, password_hash TEXT NOT NULL,
	  role TEXT NOT NULL DEFAULT 'readonly', lang TEXT NOT NULL DEFAULT 'en', timezone TEXT DEFAULT 'Africa/Cairo',
	  totp_secret TEXT, totp_secret_ciphertext TEXT, totp_key_version INTEGER, totp_enabled INTEGER DEFAULT 0,
	  mfa_required INTEGER DEFAULT 1, must_change_password INTEGER DEFAULT 0, password_expires_at TEXT,
	  recovery_codes_acknowledged_at TEXT,
	  active INTEGER DEFAULT 1, created_at TEXT DEFAULT (datetime('now')), updated_at TEXT, last_login_at TEXT)` ,
	`CREATE TABLE IF NOT EXISTS admin_sessions (
	  id TEXT PRIMARY KEY, admin_id INTEGER NOT NULL DEFAULT 0, token_hash TEXT NOT NULL DEFAULT '', csrf_hash TEXT,
	  expires_at TEXT NOT NULL, idle_expires_at TEXT, last_used_at TEXT, ip TEXT, user_agent TEXT,
	  revoked_at TEXT, revoked_by INTEGER, revocation_reason TEXT, created_at TEXT DEFAULT (datetime('now')))` ,
	`CREATE TABLE IF NOT EXISTS admin_auth_challenges (
	  id TEXT PRIMARY KEY, admin_id INTEGER NOT NULL, kind TEXT NOT NULL, attempts INTEGER NOT NULL DEFAULT 0,
	  expires_at TEXT NOT NULL, consumed_at TEXT, created_at TEXT DEFAULT (datetime('now')))` ,
	`CREATE TABLE IF NOT EXISTS admin_recovery_codes (
	  id TEXT PRIMARY KEY, admin_id INTEGER NOT NULL, code_hash TEXT NOT NULL, created_at TEXT DEFAULT (datetime('now')), used_at TEXT)` ,
	`CREATE TABLE IF NOT EXISTS admin_invitations (
	  id TEXT PRIMARY KEY, email TEXT NOT NULL, name TEXT, role TEXT NOT NULL, token_hash TEXT UNIQUE,
	  expires_at TEXT NOT NULL, created_by INTEGER NOT NULL, created_at TEXT DEFAULT (datetime('now')),
	  accepted_at TEXT, revoked_at TEXT)` ,
	`CREATE TABLE IF NOT EXISTS admin_action_authorizations (
	  id TEXT PRIMARY KEY, admin_id INTEGER, action TEXT, entity_id TEXT, payload_hash TEXT, expires_at TEXT,
	  verified_at TEXT, consumed_at TEXT, created_at TEXT DEFAULT (datetime('now')))` ,
	`CREATE TABLE IF NOT EXISTS security_alerts (
	  id TEXT PRIMARY KEY, severity TEXT, kind TEXT, fingerprint TEXT, title TEXT, details_json TEXT DEFAULT '{}',
	  occurrence_count INTEGER DEFAULT 1, status TEXT DEFAULT 'open', first_seen_at TEXT DEFAULT (datetime('now')),
	  last_seen_at TEXT DEFAULT (datetime('now')), acknowledged_at TEXT, acknowledged_by INTEGER,
	  resolved_at TEXT, resolved_by INTEGER, resolution_note TEXT)` ,
	`CREATE TABLE IF NOT EXISTS error_logs (
	  id INTEGER PRIMARY KEY AUTOINCREMENT, context TEXT, message TEXT, stack TEXT,
	  path TEXT, method TEXT, ip TEXT, created_at TEXT DEFAULT (datetime('now')))`,
	`CREATE TABLE IF NOT EXISTS outbound_email_jobs (
	  id TEXT PRIMARY KEY, status TEXT NOT NULL DEFAULT 'queued', attempt_count INTEGER NOT NULL DEFAULT 0,
	  lease_expires_at TEXT, provider_id TEXT, last_error TEXT, created_at TEXT DEFAULT (datetime('now')),
	  updated_at TEXT DEFAULT (datetime('now')), sent_at TEXT,
	  -- Outbox columns (prod: 042_email_outbox.sql). payload holds the job until
	  -- it is sent; dispatched_at is NULL until the Queue accepted the id.
	  payload TEXT, dispatched_at TEXT)`,
	`CREATE TABLE IF NOT EXISTS operational_leases (
	  job_key TEXT PRIMARY KEY, holder TEXT NOT NULL, lease_expires_at TEXT NOT NULL,
	  updated_at TEXT DEFAULT (datetime('now')))`,
	// Required by checkRateLimit() — hit by register, catalog order submission,
	// media upload, admin login, coupons, /api/v1/auth/session, and the auth-failure
	// throttle in authSeller(). Missing here made registerStore() throw, which
	// cascaded into "no seller" 401s across the authenticated tests. (Prod: 002_billing.sql)
	`CREATE TABLE IF NOT EXISTS rate_limits (
	  bucket TEXT PRIMARY KEY, count INTEGER NOT NULL DEFAULT 0, window_start INTEGER NOT NULL)`,
	// Webhook idempotency dedupe (prod: 006_hardening.sql).
	`CREATE TABLE IF NOT EXISTS webhook_events (
	  event_id TEXT PRIMARY KEY, gateway TEXT, type TEXT,
	  processed_at TEXT DEFAULT (datetime('now')))`,
	`CREATE UNIQUE INDEX IF NOT EXISTS idx_sellers_store_code ON sellers(store_code COLLATE NOCASE)`,
	`CREATE UNIQUE INDEX IF NOT EXISTS idx_sellers_public_identifier ON sellers(public_identifier COLLATE NOCASE)`,
	`CREATE UNIQUE INDEX IF NOT EXISTS idx_sellers_slug ON sellers(slug COLLATE NOCASE)`,
	`CREATE UNIQUE INDEX IF NOT EXISTS idx_categories_code ON categories(category_code COLLATE NOCASE)`,
	`CREATE UNIQUE INDEX IF NOT EXISTS idx_categories_store_slug ON categories(store_id, slug)`,
	`CREATE UNIQUE INDEX IF NOT EXISTS idx_products_code ON products(product_code COLLATE NOCASE)`,
	`CREATE UNIQUE INDEX IF NOT EXISTS idx_orders_store_idempotency
	  ON orders(store_id, idempotency_key) WHERE idempotency_key IS NOT NULL`,
	`CREATE TRIGGER IF NOT EXISTS trg_order_items_claim_stock
	 BEFORE INSERT ON order_items WHEN NEW.product_id IS NOT NULL
	 BEGIN
	   SELECT CASE WHEN NEW.qty <= 0 OR NOT EXISTS (
	     SELECT 1 FROM products WHERE id=NEW.product_id AND available=1 AND stock>=NEW.qty
	   ) THEN RAISE(ABORT, 'insufficient_stock') END;
	   UPDATE products SET stock=stock-NEW.qty, stock_version=stock_version+1,
	     updated_at=datetime('now') WHERE id=NEW.product_id;
	 END`,
];

const GEO_SCHEMA: string[] = [
	`CREATE TABLE IF NOT EXISTS city_catalog_versions (
	  version TEXT PRIMARY KEY,source_url TEXT NOT NULL,source_sha256 TEXT NOT NULL,
	  license TEXT NOT NULL,city_count INTEGER NOT NULL DEFAULT 0,
	  active INTEGER NOT NULL DEFAULT 0,imported_at TEXT DEFAULT (datetime('now')))`,
	`CREATE TABLE IF NOT EXISTS city_catalog (
	  version TEXT NOT NULL,source_city_id INTEGER NOT NULL,country_iso TEXT NOT NULL,
	  name TEXT NOT NULL,native_name TEXT,state_code TEXT,state_name TEXT,
	  population INTEGER NOT NULL DEFAULT 0,timezone TEXT,
	  PRIMARY KEY(version,source_city_id))`,
	`CREATE VIRTUAL TABLE IF NOT EXISTS city_catalog_search USING fts5(
	  version UNINDEXED,source_city_id UNINDEXED,country_iso UNINDEXED,
	  name,native_name,state_name,tokenize='unicode61 remove_diacritics 2')`,
];

export async function createSchema(): Promise<void> {
	invalidateDesignSystemCache();
	for (const stmt of SCHEMA) await env.orderak_db.prepare(stmt).run();
	for (const stmt of GEO_SCHEMA) await env.orderak_geo.prepare(stmt).run();
	// Vitest 4 keeps a project's D1 binding between tests. Reset every table
	// represented by this focused schema so tests remain order-independent.
	const tables = SCHEMA.map((stmt) => stmt.match(/CREATE TABLE IF NOT EXISTS\s+([a-z0-9_]+)/i)?.[1])
		.filter((name): name is string => Boolean(name));
	for (const table of [...new Set(tables)].reverse()) {
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
