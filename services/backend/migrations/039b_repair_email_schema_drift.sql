-- Forward repair for email-schema drift in the production D1 database.
--
-- Migration 004 is present in the remote ledger, but its email tables are
-- absent in the production schema. Keep the historical migration immutable
-- and converge existing and freshly replayed databases with idempotent DDL.

CREATE TABLE IF NOT EXISTS email_templates (
  key TEXT PRIMARY KEY,
  category TEXT NOT NULL DEFAULT 'admin',
  enabled INTEGER NOT NULL DEFAULT 1,
  current_version INTEGER NOT NULL DEFAULT 1,
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS email_template_translations (
  template_key TEXT NOT NULL,
  lang TEXT NOT NULL,
  subject TEXT NOT NULL DEFAULT '',
  html TEXT NOT NULL DEFAULT '',
  text TEXT NOT NULL DEFAULT '',
  version INTEGER NOT NULL DEFAULT 1,
  updated_by INTEGER,
  updated_at TEXT DEFAULT (datetime('now')),
  PRIMARY KEY (template_key, lang),
  FOREIGN KEY (template_key) REFERENCES email_templates(key)
);

CREATE TABLE IF NOT EXISTS email_template_history (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  template_key TEXT NOT NULL,
  lang TEXT NOT NULL,
  subject TEXT NOT NULL DEFAULT '',
  html TEXT NOT NULL DEFAULT '',
  text TEXT NOT NULL DEFAULT '',
  version INTEGER NOT NULL DEFAULT 1,
  changed_by INTEGER,
  changed_ip TEXT,
  changed_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS email_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  to_addr TEXT,
  template_key TEXT,
  provider_id TEXT,
  event TEXT NOT NULL,
  error TEXT,
  meta_json TEXT,
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_email_tr_key
  ON email_template_translations(template_key);
CREATE INDEX IF NOT EXISTS idx_email_hist_key
  ON email_template_history(template_key, lang);
CREATE INDEX IF NOT EXISTS idx_email_events_created
  ON email_events(created_at);
CREATE INDEX IF NOT EXISTS idx_email_events_provider
  ON email_events(provider_id);
