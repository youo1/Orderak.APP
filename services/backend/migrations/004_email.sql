-- Orderak D1 — Email system (templates, translations, history, events)
-- Run remote: npx wrangler d1 execute orderak-db --remote --file=migrations/004_email.sql
-- Run local:  npx wrangler d1 execute orderak-db --local  --file=migrations/004_email.sql
--
-- Design notes:
-- * Default template content lives in code (services/backend/src/integrations/email/seeds.ts).
-- * These tables store ADMIN OVERRIDES only. If a (key, lang) row is missing,
--   the EmailService falls back to the seed. This keeps one source of truth
--   and lets the admin "Emails" tab edit copy without a redeploy.
-- * Translations are normalized (one row per language) so adding French,
--   Turkish, etc. later needs no schema change.

-- ---------------------------------------------------------------------------
-- Template header: one row per template key (e.g. 'admin_login_alert').
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS email_templates (
  key             TEXT PRIMARY KEY,          -- 'admin_login_alert' | 'admin_password_reset' | 'invoice' | ...
  category        TEXT NOT NULL DEFAULT 'admin', -- auth | billing | orders | marketing | support | admin
  enabled         INTEGER NOT NULL DEFAULT 1,
  current_version INTEGER NOT NULL DEFAULT 1,
  created_at      TEXT DEFAULT (datetime('now')),
  updated_at      TEXT DEFAULT (datetime('now'))
);

-- ---------------------------------------------------------------------------
-- Per-language content (subject + html + text). PK = (template, lang).
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS email_template_translations (
  template_key TEXT NOT NULL,
  lang         TEXT NOT NULL,              -- 'ar' | 'en'
  subject      TEXT NOT NULL DEFAULT '',
  html         TEXT NOT NULL DEFAULT '',
  text         TEXT NOT NULL DEFAULT '',
  version      INTEGER NOT NULL DEFAULT 1,
  updated_by   INTEGER,                    -- admin_users.id
  updated_at   TEXT DEFAULT (datetime('now')),
  PRIMARY KEY (template_key, lang),
  FOREIGN KEY (template_key) REFERENCES email_templates(key)
);

-- ---------------------------------------------------------------------------
-- Full change history (satisfies audit + enables "restore previous version").
-- Every save writes the NEW content here with who/when/ip.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS email_template_history (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  template_key TEXT NOT NULL,
  lang         TEXT NOT NULL,
  subject      TEXT NOT NULL DEFAULT '',
  html         TEXT NOT NULL DEFAULT '',
  text         TEXT NOT NULL DEFAULT '',
  version      INTEGER NOT NULL DEFAULT 1,
  changed_by   INTEGER,                    -- admin_users.id
  changed_ip   TEXT,
  changed_at   TEXT DEFAULT (datetime('now'))
);

-- ---------------------------------------------------------------------------
-- Delivery events. One row per event (queued/sent/delivered/opened/clicked/
-- bounced/complained/...). Fed by EmailService at send time (Cloudflare Email
-- Sending reports later delivery events in its own dashboard, not a webhook).

-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS email_events (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  to_addr      TEXT,
  template_key TEXT,
  provider_id  TEXT,                       -- Cloudflare messageId (for correlation)

  event        TEXT NOT NULL,              -- sent | failed | delivered | opened | clicked | bounced | complained | ...
  error        TEXT,
  meta_json    TEXT,
  created_at   TEXT DEFAULT (datetime('now'))
);

-- ---------------------------------------------------------------------------
-- Indexes
-- ---------------------------------------------------------------------------
CREATE INDEX IF NOT EXISTS idx_email_tr_key       ON email_template_translations(template_key);
CREATE INDEX IF NOT EXISTS idx_email_hist_key      ON email_template_history(template_key, lang);
CREATE INDEX IF NOT EXISTS idx_email_events_created ON email_events(created_at);
CREATE INDEX IF NOT EXISTS idx_email_events_provider ON email_events(provider_id);
