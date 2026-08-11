-- Orderak D1 — Admin RBAC + 2FA, i18n, CMS, Announcements, Support, Settings
-- Run remote: npx wrangler d1 execute orderak-db --remote --file=migrations/003_admin.sql
-- Run local:  npx wrangler d1 execute orderak-db --local  --file=migrations/003_admin.sql
--
-- NOTE: all money is stored as INTEGER "piasters" (EGP * 100). Never floats.
-- i18n note: human-facing text managed by admins is stored as JSON
--            objects like {"ar":"...","en":"..."} in *_i18n columns.

-- ---------------------------------------------------------------------------
-- Language preferences (i18n foundation)
-- ---------------------------------------------------------------------------
ALTER TABLE sellers ADD COLUMN lang TEXT NOT NULL DEFAULT 'ar';
-- Seller lifecycle status: active | suspended | banned
ALTER TABLE sellers ADD COLUMN status TEXT NOT NULL DEFAULT 'active';

-- Localized names for plans & features (JSON {"ar":..,"en":..}); legacy name kept as fallback
ALTER TABLE plans ADD COLUMN name_i18n TEXT;
ALTER TABLE plan_features ADD COLUMN name_i18n TEXT;
ALTER TABLE plan_features ADD COLUMN description_i18n TEXT;

-- Localized ad titles + optional per-language creatives
ALTER TABLE ads ADD COLUMN title_i18n TEXT;
ALTER TABLE ads ADD COLUMN image_url_i18n TEXT;
-- Ad scheduling (NULL = always)
ALTER TABLE ads ADD COLUMN starts_at TEXT;
ALTER TABLE ads ADD COLUMN ends_at TEXT;

-- ---------------------------------------------------------------------------
-- Admin users (multi-admin + RBAC + 2FA)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS admin_users (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  email         TEXT NOT NULL UNIQUE,
  name          TEXT,
  password_hash TEXT NOT NULL,          -- PBKDF2: "pbkdf2$<iter>$<saltB64>$<hashB64>"
  role          TEXT NOT NULL DEFAULT 'readonly', -- owner | finance | support | readonly
  lang          TEXT NOT NULL DEFAULT 'ar',
  totp_secret   TEXT,                   -- base32 secret (set during enrollment)
  totp_enabled  INTEGER NOT NULL DEFAULT 0,
  active        INTEGER NOT NULL DEFAULT 1,
  created_at    TEXT DEFAULT (datetime('now')),
  last_login_at TEXT
);

-- Admin sessions (fallback store if not using KV; KV is preferred).
CREATE TABLE IF NOT EXISTS admin_sessions (
  id         TEXT PRIMARY KEY,          -- random session id
  admin_id   INTEGER NOT NULL,
  token_hash TEXT NOT NULL,             -- sha256 of the session token
  expires_at TEXT NOT NULL,
  ip         TEXT,
  user_agent TEXT,
  created_at TEXT DEFAULT (datetime('now')),
  FOREIGN KEY (admin_id) REFERENCES admin_users(id)
);

-- Persistent audit log (the audit() helper writes here in addition to console).
CREATE TABLE IF NOT EXISTS admin_audit (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  admin_id     INTEGER,                 -- NULL for system / unauthenticated
  action       TEXT NOT NULL,
  entity       TEXT,
  entity_id    TEXT,
  details_json TEXT,
  ip           TEXT,
  created_at   TEXT DEFAULT (datetime('now'))
);

-- ---------------------------------------------------------------------------
-- Global settings / feature flags (key -> JSON value)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS settings (
  key        TEXT PRIMARY KEY,
  value_json TEXT NOT NULL,
  updated_by INTEGER,
  updated_at TEXT DEFAULT (datetime('now'))
);

-- ---------------------------------------------------------------------------
-- CMS content pages, per (slug, lang)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS content_pages (
  slug       TEXT NOT NULL,            -- 'terms' | 'privacy' | 'help-sign-in' | 'landing'
  lang       TEXT NOT NULL,            -- 'ar' | 'en'
  title      TEXT,
  body_html  TEXT,
  updated_by INTEGER,
  updated_at TEXT DEFAULT (datetime('now')),
  PRIMARY KEY (slug, lang)
);

-- ---------------------------------------------------------------------------
-- Announcements / broadcast (localized)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS announcements (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  title_i18n  TEXT,                    -- {"ar":..,"en":..}
  body_i18n   TEXT,
  target_plan TEXT NOT NULL DEFAULT 'all', -- 'all' | 'free' | plan id
  starts_at   TEXT,
  ends_at     TEXT,
  active      INTEGER NOT NULL DEFAULT 1,
  created_by  INTEGER,
  created_at  TEXT DEFAULT (datetime('now'))
);

-- ---------------------------------------------------------------------------
-- Support tickets
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS support_tickets (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  seller_id   INTEGER,
  subject     TEXT NOT NULL,
  status      TEXT NOT NULL DEFAULT 'open',   -- open | pending | closed
  priority    TEXT NOT NULL DEFAULT 'normal', -- low | normal | high
  assigned_to INTEGER,                        -- admin_users.id
  created_at  TEXT DEFAULT (datetime('now')),
  updated_at  TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS support_messages (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  ticket_id  INTEGER NOT NULL,
  sender     TEXT NOT NULL,            -- 'seller' | 'admin'
  body       TEXT NOT NULL,
  created_at TEXT DEFAULT (datetime('now')),
  FOREIGN KEY (ticket_id) REFERENCES support_tickets(id)
);

-- ---------------------------------------------------------------------------
-- Payment events (audit trail for billing / webhooks)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS payment_events (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  seller_id       INTEGER,
  subscription_id INTEGER,
  gateway         TEXT,
  event_type      TEXT NOT NULL,       -- checkout | paid | failed | refunded | canceled
  amount_piasters INTEGER NOT NULL DEFAULT 0,
  raw_json        TEXT,
  created_at      TEXT DEFAULT (datetime('now'))
);

-- ---------------------------------------------------------------------------
-- Admin preferences on admin_users already covers lang.
-- ---------------------------------------------------------------------------

-- ---------------------------------------------------------------------------
-- Indexes
-- ---------------------------------------------------------------------------
CREATE INDEX IF NOT EXISTS idx_admin_sessions_admin ON admin_sessions(admin_id);
CREATE INDEX IF NOT EXISTS idx_admin_audit_action   ON admin_audit(action);
CREATE INDEX IF NOT EXISTS idx_admin_audit_created  ON admin_audit(created_at);
CREATE INDEX IF NOT EXISTS idx_content_slug         ON content_pages(slug);
CREATE INDEX IF NOT EXISTS idx_ann_active           ON announcements(active, target_plan);
CREATE INDEX IF NOT EXISTS idx_tickets_status       ON support_tickets(status);
CREATE INDEX IF NOT EXISTS idx_tickets_seller       ON support_tickets(seller_id);
CREATE INDEX IF NOT EXISTS idx_pay_events_seller    ON payment_events(seller_id);
CREATE INDEX IF NOT EXISTS idx_sellers_status       ON sellers(status);

-- ---------------------------------------------------------------------------
-- Seed: default settings (feature flags) + bilingual plan names + legal pages
-- ---------------------------------------------------------------------------
INSERT OR IGNORE INTO settings (key, value_json) VALUES
  ('maintenance_mode',      'false'),
  ('signups_open',          'true'),
  ('default_trial_days',    '0'),
  ('default_ad_frequency',  '1'),
  ('ai_enabled',            'true'),
  ('ai_provider',           '"deepseek"'),
  ('ai_model',              '"deepseek-chat"'),
  ('supported_langs',       '["ar","en"]'),
  ('default_lang',          '"ar"');

-- Bilingual plan names (fallback to existing plans.name if a lang is missing).
UPDATE plans SET name_i18n = '{"ar":"مجاني","en":"Free"}'                 WHERE id = 'free';
UPDATE plans SET name_i18n = '{"ar":"المبتدئ","en":"Starter"}'            WHERE id = 'starter';
UPDATE plans SET name_i18n = '{"ar":"الاحترافي","en":"Professional"}'     WHERE id = 'professional';

-- Bilingual feature labels for existing seed features.
UPDATE plan_features SET name_i18n = '{"ar":"حتى 20 منتج","en":"Up to 20 products"}'        WHERE plan_id='free'         AND feature_key='products_limit';
UPDATE plan_features SET name_i18n = '{"ar":"إعلانات","en":"Ads shown"}'                    WHERE plan_id='free'         AND feature_key='ads';
UPDATE plan_features SET name_i18n = '{"ar":"مساعد ذكي أساسي","en":"Basic AI assistant"}'   WHERE plan_id='free'         AND feature_key='ai_chat';
UPDATE plan_features SET name_i18n = '{"ar":"تحليلات","en":"Analytics"}'                    WHERE plan_id='free'         AND feature_key='analytics';
UPDATE plan_features SET name_i18n = '{"ar":"حتى 200 منتج","en":"Up to 200 products"}'      WHERE plan_id='starter'      AND feature_key='products_limit';
UPDATE plan_features SET name_i18n = '{"ar":"بدون إعلانات","en":"Ad-free"}'                 WHERE plan_id='starter'      AND feature_key='ads';
UPDATE plan_features SET name_i18n = '{"ar":"مساعد ذكي","en":"AI assistant"}'               WHERE plan_id='starter'      AND feature_key='ai_chat';
UPDATE plan_features SET name_i18n = '{"ar":"تحليلات","en":"Analytics"}'                    WHERE plan_id='starter'      AND feature_key='analytics';
UPDATE plan_features SET name_i18n = '{"ar":"منتجات بلا حدود","en":"Unlimited products"}'   WHERE plan_id='professional' AND feature_key='products_limit';
UPDATE plan_features SET name_i18n = '{"ar":"بدون إعلانات","en":"Ad-free"}'                 WHERE plan_id='professional' AND feature_key='ads';
UPDATE plan_features SET name_i18n = '{"ar":"مساعد ذكي متقدم","en":"Advanced AI assistant"}' WHERE plan_id='professional' AND feature_key='ai_chat';
UPDATE plan_features SET name_i18n = '{"ar":"تحليلات متقدمة","en":"Advanced analytics"}'    WHERE plan_id='professional' AND feature_key='analytics';
UPDATE plan_features SET name_i18n = '{"ar":"دعم أولوية","en":"Priority support"}'          WHERE plan_id='professional' AND feature_key='priority_support';

-- Seed legal/help pages (both languages) so /terms /privacy /help/sign-in work immediately.
INSERT OR IGNORE INTO content_pages (slug, lang, title, body_html) VALUES
  ('terms', 'ar', 'شروط الاستخدام', '<p>مرحبًا بك في أوردرك. باستخدامك للتطبيق فإنك توافق على هذه الشروط.</p>'),
  ('terms', 'en', 'Terms of Service', '<p>Welcome to Orderak. By using the app you agree to these terms.</p>'),
  ('privacy', 'ar', 'سياسة الخصوصية', '<p>نحن نحترم خصوصيتك ونحمي بياناتك.</p>'),
  ('privacy', 'en', 'Privacy Policy', '<p>We respect your privacy and protect your data.</p>'),
  ('help-sign-in', 'ar', 'مشاكل تسجيل الدخول', '<p>هل تواجه مشكلة في تسجيل الدخول؟ إليك بعض الحلول.</p>'),
  ('help-sign-in', 'en', 'Sign-in Help', '<p>Trouble signing in? Here are some solutions.</p>');
