-- Cloudflare scalability and reliability hardening.
-- Apply through `wrangler d1 migrations apply`; do not execute directly.

CREATE TABLE IF NOT EXISTS admin_auth_challenges (
  id TEXT PRIMARY KEY,
  admin_id INTEGER NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('mfa','enrollment')),
  attempts INTEGER NOT NULL DEFAULT 0,
  expires_at TEXT NOT NULL,
  consumed_at TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (admin_id) REFERENCES admin_users(id)
);

CREATE INDEX IF NOT EXISTS idx_admin_auth_challenges_expiry
  ON admin_auth_challenges(expires_at,consumed_at);

CREATE TABLE IF NOT EXISTS outbound_email_jobs (
  id TEXT PRIMARY KEY,
  status TEXT NOT NULL DEFAULT 'queued'
    CHECK (status IN ('queued','processing','retrying','sent','failed')),
  attempt_count INTEGER NOT NULL DEFAULT 0,
  lease_expires_at TEXT,
  provider_id TEXT,
  last_error TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  sent_at TEXT
);

CREATE INDEX IF NOT EXISTS idx_outbound_email_jobs_state
  ON outbound_email_jobs(status,lease_expires_at,updated_at);

ALTER TABLE admin_exports ADD COLUMN attempt_count INTEGER NOT NULL DEFAULT 0;
ALTER TABLE admin_exports ADD COLUMN lease_expires_at TEXT;

CREATE INDEX IF NOT EXISTS idx_admin_exports_work
  ON admin_exports(status,lease_expires_at,created_at);

CREATE TABLE IF NOT EXISTS operational_leases (
  job_key TEXT PRIMARY KEY,
  holder TEXT NOT NULL,
  lease_expires_at TEXT NOT NULL,
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_admin_audit_exports_range
  ON admin_audit_exports(first_audit_id,last_audit_id);

-- Retention jobs select old rows in bounded chunks; these indexes prevent
-- repeated full-table scans as the database grows.
CREATE INDEX IF NOT EXISTS idx_error_logs_created_at ON error_logs(created_at);
CREATE INDEX IF NOT EXISTS idx_email_template_history_changed_at ON email_template_history(changed_at);
CREATE INDEX IF NOT EXISTS idx_rate_limits_window_start ON rate_limits(window_start);
CREATE INDEX IF NOT EXISTS idx_onboarding_sessions_absolute_expiry ON onboarding_sessions(absolute_expires_at);
CREATE INDEX IF NOT EXISTS idx_webauthn_challenges_expiry ON webauthn_challenges(expires_at);
CREATE INDEX IF NOT EXISTS idx_recent_auth_proofs_expiry ON recent_auth_proofs(expires_at);
CREATE INDEX IF NOT EXISTS idx_email_verification_tokens_expiry ON email_verification_tokens(expires_at,used_at);
CREATE INDEX IF NOT EXISTS idx_webhook_events_processed_at ON webhook_events(processed_at);
CREATE INDEX IF NOT EXISTS idx_email_events_created_at ON email_events(created_at);
CREATE INDEX IF NOT EXISTS idx_ad_impressions_created_at ON ad_impressions(created_at);
CREATE INDEX IF NOT EXISTS idx_announcements_ends_at ON announcements(ends_at);
