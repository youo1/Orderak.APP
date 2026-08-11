-- Google Play lifecycle reliability, provider circuits, and AI usage evidence.
-- Production acquisition and lifecycle flags remain disabled until the release
-- gates documented in docs/guides/setup.md are complete.

ALTER TABLE organizations ADD COLUMN play_account_hash TEXT;

ALTER TABLE organization_subscriptions
  ADD COLUMN verification_generation INTEGER NOT NULL DEFAULT 0;

ALTER TABLE play_purchases
  ADD COLUMN verification_generation INTEGER NOT NULL DEFAULT 0;
ALTER TABLE play_purchases ADD COLUMN replaced_by_token_hash TEXT;
ALTER TABLE play_purchases ADD COLUMN replaced_at TEXT;

ALTER TABLE play_billing_events ADD COLUMN verification_job_id TEXT;

CREATE TABLE billing_verification_heads (
  organization_id   TEXT PRIMARY KEY,
  latest_generation INTEGER NOT NULL DEFAULT 0,
  updated_at        TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (organization_id) REFERENCES organizations(id)
);

CREATE TABLE play_verification_jobs (
  id                       TEXT PRIMARY KEY,
  organization_id          TEXT,
  seller_id                TEXT,
  purchase_token_hash      TEXT NOT NULL,
  purchase_token_encrypted TEXT NOT NULL,
  source                   TEXT NOT NULL CHECK (source IN ('direct','rtdn','reconcile','admin')),
  message_id               TEXT UNIQUE,
  event_time               TEXT,
  status                   TEXT NOT NULL DEFAULT 'queued' CHECK (status IN (
    'queued','processing','retrying','applied_ack_pending','succeeded',
    'terminal_failed','superseded','dead_lettered'
  )),
  attempt_count            INTEGER NOT NULL DEFAULT 0,
  verification_generation  INTEGER,
  purchase_status          TEXT,
  result_json              TEXT,
  error_code               TEXT,
  next_attempt_at          TEXT,
  dispatched_at            TEXT,
  last_attempt_at          TEXT,
  completed_at             TEXT,
  created_at               TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at               TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (organization_id) REFERENCES organizations(id),
  FOREIGN KEY (seller_id) REFERENCES sellers(id)
);

CREATE TABLE provider_circuit_state (
  provider          TEXT PRIMARY KEY,
  state             TEXT NOT NULL DEFAULT 'closed' CHECK (state IN ('closed','open','half_open')),
  failure_count     INTEGER NOT NULL DEFAULT 0,
  window_started_at INTEGER,
  opened_at         INTEGER,
  cooldown_until    INTEGER,
  cooldown_seconds  INTEGER NOT NULL DEFAULT 60,
  probe_lease_until INTEGER,
  updated_at        TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE ai_provider_usage_events (
  idempotency_key       TEXT PRIMARY KEY,
  organization_id      TEXT,
  provider             TEXT NOT NULL,
  prompt_tokens        INTEGER NOT NULL DEFAULT 0,
  completion_tokens    INTEGER NOT NULL DEFAULT 0,
  estimated_cost_microusd INTEGER NOT NULL DEFAULT 0,
  created_at           TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (organization_id) REFERENCES organizations(id)
);

CREATE TABLE ai_budget_alerts (
  provider          TEXT NOT NULL,
  budget_month      TEXT NOT NULL,
  threshold_percent INTEGER NOT NULL CHECK (threshold_percent IN (50,80,100)),
  alerted_at        TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (provider,budget_month,threshold_percent)
);

CREATE UNIQUE INDEX idx_organizations_play_account_hash
  ON organizations(play_account_hash) WHERE play_account_hash IS NOT NULL;
CREATE INDEX idx_play_jobs_dispatch
  ON play_verification_jobs(status,dispatched_at,next_attempt_at,created_at);
CREATE INDEX idx_play_jobs_token
  ON play_verification_jobs(purchase_token_hash,created_at DESC);
CREATE INDEX idx_play_jobs_org
  ON play_verification_jobs(organization_id,status,created_at DESC);
CREATE INDEX idx_play_events_job ON play_billing_events(verification_job_id);
CREATE INDEX idx_play_replaced_by ON play_purchases(replaced_by_token_hash);
CREATE INDEX idx_ai_usage_month
  ON ai_provider_usage_events(provider,created_at,organization_id);

-- Every Google Play state write carries the generation captured immediately
-- before the authoritative Google query. If a newer query began in the
-- meantime, abort the full D1 batch instead of allowing an older response to
-- overwrite a newer subscription state.
CREATE TRIGGER trg_google_subscription_generation_insert
BEFORE INSERT ON organization_subscriptions
WHEN NEW.source='google_play' AND NOT EXISTS (
  SELECT 1 FROM billing_verification_heads h
  WHERE h.organization_id=NEW.organization_id
    AND h.latest_generation=NEW.verification_generation
)
BEGIN
  SELECT RAISE(ABORT, 'stale_play_verification');
END;

CREATE TRIGGER trg_google_subscription_generation_update
BEFORE UPDATE ON organization_subscriptions
WHEN NEW.source='google_play' AND NOT EXISTS (
  SELECT 1 FROM billing_verification_heads h
  WHERE h.organization_id=NEW.organization_id
    AND h.latest_generation=NEW.verification_generation
)
BEGIN
  SELECT RAISE(ABORT, 'stale_play_verification');
END;

CREATE TRIGGER trg_play_purchase_generation_insert
BEFORE INSERT ON play_purchases
WHEN NOT EXISTS (
  SELECT 1 FROM billing_verification_heads h
  WHERE h.organization_id=NEW.organization_id
    AND h.latest_generation=NEW.verification_generation
)
BEGIN
  SELECT RAISE(ABORT, 'stale_play_verification');
END;

CREATE TRIGGER trg_play_purchase_generation_update
BEFORE UPDATE ON play_purchases
WHEN NOT EXISTS (
  SELECT 1 FROM billing_verification_heads h
  WHERE h.organization_id=NEW.organization_id
    AND h.latest_generation=NEW.verification_generation
)
BEGIN
  SELECT RAISE(ABORT, 'stale_play_verification');
END;

PRAGMA optimize;
