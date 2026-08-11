-- Canonical Admin Control Center: security sessions, scoped configuration,
-- buyers, app governance, capabilities, exports, and owner access management.

ALTER TABLE admin_users ADD COLUMN timezone TEXT NOT NULL DEFAULT 'Africa/Cairo';
ALTER TABLE admin_users ADD COLUMN totp_secret_ciphertext TEXT;
ALTER TABLE admin_users ADD COLUMN totp_key_version INTEGER;
ALTER TABLE admin_users ADD COLUMN mfa_required INTEGER NOT NULL DEFAULT 1;
ALTER TABLE admin_users ADD COLUMN must_change_password INTEGER NOT NULL DEFAULT 0;
ALTER TABLE admin_users ADD COLUMN password_expires_at TEXT;
ALTER TABLE admin_users ADD COLUMN updated_at TEXT;

ALTER TABLE admin_sessions ADD COLUMN csrf_hash TEXT;
ALTER TABLE admin_sessions ADD COLUMN last_used_at TEXT;
ALTER TABLE admin_sessions ADD COLUMN idle_expires_at TEXT;
ALTER TABLE admin_sessions ADD COLUMN revoked_at TEXT;
ALTER TABLE admin_sessions ADD COLUMN revoked_by INTEGER;
ALTER TABLE admin_sessions ADD COLUMN revocation_reason TEXT;

CREATE TABLE IF NOT EXISTS admin_recovery_codes (
  id TEXT PRIMARY KEY,
  admin_id INTEGER NOT NULL,
  code_hash TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  used_at TEXT,
  FOREIGN KEY (admin_id) REFERENCES admin_users(id)
);

CREATE TABLE IF NOT EXISTS admin_invitations (
  id TEXT PRIMARY KEY,
  email TEXT NOT NULL,
  name TEXT,
  role TEXT NOT NULL,
  token_hash TEXT NOT NULL UNIQUE,
  expires_at TEXT NOT NULL,
  created_by INTEGER NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  accepted_at TEXT,
  revoked_at TEXT,
  FOREIGN KEY (created_by) REFERENCES admin_users(id)
);

CREATE TABLE IF NOT EXISTS admin_action_authorizations (
  id TEXT PRIMARY KEY,
  admin_id INTEGER NOT NULL,
  action TEXT NOT NULL,
  entity_id TEXT,
  payload_hash TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  verified_at TEXT,
  consumed_at TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (admin_id) REFERENCES admin_users(id)
);

CREATE TABLE IF NOT EXISTS security_alerts (
  id TEXT PRIMARY KEY,
  severity TEXT NOT NULL,
  kind TEXT NOT NULL,
  fingerprint TEXT NOT NULL,
  title TEXT NOT NULL,
  details_json TEXT NOT NULL DEFAULT '{}',
  occurrence_count INTEGER NOT NULL DEFAULT 1,
  status TEXT NOT NULL DEFAULT 'open',
  first_seen_at TEXT NOT NULL DEFAULT (datetime('now')),
  last_seen_at TEXT NOT NULL DEFAULT (datetime('now')),
  acknowledged_at TEXT,
  acknowledged_by INTEGER,
  resolved_at TEXT,
  resolved_by INTEGER,
  resolution_note TEXT
);

CREATE TABLE IF NOT EXISTS capability_definitions (
  capability_key TEXT PRIMARY KEY,
  domain TEXT NOT NULL,
  label TEXT NOT NULL,
  description TEXT NOT NULL,
  implementation_status TEXT NOT NULL,
  enforcement_binding TEXT,
  runtime_consumer TEXT,
  risk TEXT NOT NULL DEFAULT 'medium',
  scopes_json TEXT NOT NULL DEFAULT '["global"]',
  active INTEGER NOT NULL DEFAULT 1,
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS feature_flags (
  flag_key TEXT PRIMARY KEY,
  description TEXT NOT NULL,
  value_type TEXT NOT NULL DEFAULT 'boolean',
  default_value_json TEXT NOT NULL,
  env_gate TEXT,
  runtime_consumer TEXT NOT NULL,
  risk TEXT NOT NULL DEFAULT 'medium',
  rollout_seed TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'draft',
  version INTEGER NOT NULL DEFAULT 1,
  updated_by INTEGER,
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS feature_flag_rules (
  id TEXT PRIMARY KEY,
  flag_key TEXT NOT NULL,
  priority INTEGER NOT NULL DEFAULT 100,
  scope_type TEXT NOT NULL,
  scope_value TEXT,
  min_version_code INTEGER,
  max_version_code INTEGER,
  rollout_basis_points INTEGER,
  value_json TEXT NOT NULL,
  starts_at TEXT,
  ends_at TEXT,
  active INTEGER NOT NULL DEFAULT 1,
  reason TEXT NOT NULL,
  created_by INTEGER,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (flag_key) REFERENCES feature_flags(flag_key)
);

CREATE TABLE IF NOT EXISTS app_version_policies (
  id TEXT PRIMARY KEY,
  platform TEXT NOT NULL DEFAULT 'android',
  country_code TEXT,
  channel TEXT NOT NULL DEFAULT 'production',
  recommended_version_code INTEGER,
  minimum_version_code INTEGER,
  blocked_version_codes_json TEXT NOT NULL DEFAULT '[]',
  warning_message_i18n TEXT NOT NULL DEFAULT '{}',
  blocking_message_i18n TEXT NOT NULL DEFAULT '{}',
  store_url TEXT,
  enforce_after TEXT,
  maintenance_mode INTEGER NOT NULL DEFAULT 0,
  active INTEGER NOT NULL DEFAULT 1,
  reason TEXT NOT NULL,
  updated_by INTEGER,
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS store_capability_overrides (
  id TEXT PRIMARY KEY,
  store_id TEXT NOT NULL,
  capability_key TEXT NOT NULL,
  enabled INTEGER NOT NULL,
  reason TEXT NOT NULL,
  expires_at TEXT,
  created_by INTEGER,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  revoked_at TEXT,
  FOREIGN KEY (store_id) REFERENCES sellers(id),
  FOREIGN KEY (capability_key) REFERENCES capability_definitions(capability_key)
);

CREATE TABLE IF NOT EXISTS buyer_restrictions (
  id TEXT PRIMARY KEY,
  store_id TEXT,
  buyer_phone_hash TEXT NOT NULL,
  buyer_phone_last4 TEXT NOT NULL,
  scope TEXT NOT NULL DEFAULT 'store',
  status TEXT NOT NULL DEFAULT 'blocked',
  reason TEXT NOT NULL,
  evidence TEXT,
  expires_at TEXT,
  created_by INTEGER,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  revoked_at TEXT
);

CREATE TABLE IF NOT EXISTS buyer_privacy_requests (
  id TEXT PRIMARY KEY,
  store_id TEXT,
  buyer_phone_hash TEXT NOT NULL,
  buyer_phone_last4 TEXT NOT NULL,
  request_type TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'open',
  notes TEXT,
  requested_at TEXT NOT NULL DEFAULT (datetime('now')),
  completed_at TEXT,
  updated_by INTEGER
);

CREATE TABLE IF NOT EXISTS support_macros (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  category TEXT NOT NULL,
  locale TEXT NOT NULL,
  body TEXT NOT NULL,
  active INTEGER NOT NULL DEFAULT 1,
  updated_by INTEGER,
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS content_configs (
  id TEXT PRIMARY KEY,
  content_key TEXT NOT NULL,
  locale TEXT NOT NULL,
  audience TEXT NOT NULL DEFAULT 'all',
  version INTEGER NOT NULL,
  status TEXT NOT NULL DEFAULT 'draft',
  value_json TEXT NOT NULL,
  starts_at TEXT,
  ends_at TEXT,
  created_by INTEGER,
  published_by INTEGER,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  published_at TEXT,
  UNIQUE(content_key, locale, version)
);

CREATE TABLE IF NOT EXISTS admin_exports (
  id TEXT PRIMARY KEY,
  export_type TEXT NOT NULL,
  classification TEXT NOT NULL,
  filters_json TEXT NOT NULL DEFAULT '{}',
  status TEXT NOT NULL DEFAULT 'queued',
  row_count INTEGER,
  byte_count INTEGER,
  r2_key TEXT,
  download_token_hash TEXT,
  download_expires_at TEXT,
  downloaded_at TEXT,
  expires_at TEXT NOT NULL,
  requested_by INTEGER NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  completed_at TEXT,
  error_message TEXT
);

CREATE TABLE IF NOT EXISTS admin_audit_exports (
  id TEXT PRIMARY KEY,
  first_audit_id INTEGER NOT NULL,
  last_audit_id INTEGER NOT NULL,
  event_count INTEGER NOT NULL,
  object_key TEXT NOT NULL,
  content_hash TEXT NOT NULL,
  signature TEXT NOT NULL,
  previous_hash TEXT,
  status TEXT NOT NULL DEFAULT 'written',
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  verified_at TEXT
);

CREATE INDEX IF NOT EXISTS idx_admin_sessions_token ON admin_sessions(token_hash);
CREATE INDEX IF NOT EXISTS idx_admin_sessions_active ON admin_sessions(admin_id,revoked_at,expires_at);
CREATE INDEX IF NOT EXISTS idx_security_alerts_status ON security_alerts(status,severity,last_seen_at);
CREATE INDEX IF NOT EXISTS idx_flag_rules_lookup ON feature_flag_rules(flag_key,active,priority);
CREATE INDEX IF NOT EXISTS idx_version_policy_lookup ON app_version_policies(platform,active,country_code);
CREATE INDEX IF NOT EXISTS idx_store_capability_active ON store_capability_overrides(store_id,capability_key,revoked_at);
CREATE INDEX IF NOT EXISTS idx_buyer_restriction_lookup ON buyer_restrictions(store_id,buyer_phone_hash,status);

INSERT OR IGNORE INTO capability_definitions VALUES
('orders.accepting','Store controls','Accept orders','Allow new orders for the store','enforced','catalog.order_submission','backend/public catalog','high','["store"]',1,datetime('now')),
('catalog.public','Store controls','Public catalog','Make the public catalog visible','enforced','public_router','backend/public catalog','high','["store"]',1,datetime('now')),
('fulfillment.delivery','Store controls','Delivery','Allow delivery fulfilment','display_only',NULL,NULL,'medium','["store"]',1,datetime('now')),
('fulfillment.pickup','Store controls','Pickup','Allow pickup fulfilment','display_only',NULL,NULL,'medium','["store"]',1,datetime('now')),
('ads.eligible','Commerce','Ads eligibility','Allow first-party advertising','enforced','show_ads','backend/android','medium','["plan","store"]',1,datetime('now')),
('referrals.enabled','Commerce','Referrals','Allow seller referral participation','enforced','billing.referrals','backend/android','medium','["global","store"]',1,datetime('now')),
('ai.assistant','AI','AI assistant','Allow the seller AI assistant','enforced','AI_ASSISTANT_ENABLED','backend/android','high','["global","plan","store","country","version","percentage"]',1,datetime('now')),
('moderation.restricted','Trust','Moderation restriction','Restrict unsafe store activity','enforced','sellers.status','backend/android/public catalog','critical','["store"]',1,datetime('now')),
('max_products','Plan limits','Products limit','Maximum products per store','enforced','max_products','backend/android','medium','["plan","organization"]',1,datetime('now')),
('max_orders_per_month','Plan limits','Monthly order limit','Maximum accepted orders per UTC month','enforced','max_orders_per_month','backend/android/public catalog','high','["plan","organization"]',1,datetime('now')),
('max_ai_requests_per_month','Plan limits','AI usage limit','Maximum AI requests per UTC month','enforced','max_ai_requests_per_month','backend/android','high','["plan","organization"]',1,datetime('now')),
('max_concurrent_devices','Plan limits','Device limit','Maximum concurrent seller devices','enforced','max_concurrent_devices','backend/android auth','high','["plan","organization"]',1,datetime('now')),
('max_staff','Plan limits','Staff limit','Maximum organization staff members','planned',NULL,NULL,'high','["plan","organization"]',1,datetime('now')),
('max_stores','Plan limits','Store limit','Maximum organization stores','planned',NULL,NULL,'high','["plan","organization"]',1,datetime('now'));

INSERT OR IGNORE INTO feature_flags
(flag_key,description,default_value_json,env_gate,runtime_consumer,risk,rollout_seed,status)
VALUES
('ai_assistant','Seller AI assistant availability','false','AI_ASSISTANT_ENABLED','backend/android','high','ai-assistant-v1','published'),
('billing','Paid billing availability','false','BILLING_ENABLED','backend/android','critical','billing-v1','published'),
('first_party_ads','First-party ad cards','true',NULL,'backend/android','medium','first-party-ads-v1','published'),
('referrals','Seller referrals','false','BILLING_ENABLED','backend/android','high','referrals-v1','published');
