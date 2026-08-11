-- Orderak D1 — Security & reliability hardening
-- Run remote: npx wrangler d1 execute orderak-db --remote --file=migrations/006_hardening.sql
-- Run local:  npx wrangler d1 execute orderak-db --local  --file=migrations/006_hardening.sql
--
-- What this migration adds:
--   1. webhook_events  → idempotency ledger so a replayed payment webhook
--                        (gateways retry) is processed at most once.
--   2. error_logs      → lightweight server-side error log surfaced in the
--                        admin "Errors" tab (observability without a 3rd party).
--
-- NOTE: seller secrets are NOT changed by this migration. The `sellers.secret`
-- column keeps its TEXT type; the code now stores a PBKDF2 hash there and
-- transparently upgrades any existing plaintext secret on the seller's next
-- authenticated call — so no data migration or re-registration is needed.

-- ---------------------------------------------------------------------------
-- Processed payment-webhook events (dedupe by the gateway's event id)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS webhook_events (
  event_id     TEXT PRIMARY KEY,               -- provider's unique event id
  gateway      TEXT,                            -- 'mock' | 'stripe' | ...
  type         TEXT,                            -- event type, for auditing
  processed_at TEXT DEFAULT (datetime('now'))
);

-- ---------------------------------------------------------------------------
-- Server-side error log (shown in the admin panel "Errors" tab)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS error_logs (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  context    TEXT,                              -- where it happened, e.g. 'api'
  message    TEXT,                              -- error message
  stack      TEXT,                              -- stack trace (truncated)
  path       TEXT,                              -- request path, if available
  method     TEXT,                              -- request method, if available
  ip         TEXT,                              -- cf-connecting-ip, if available
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_error_logs_id ON error_logs(id DESC);
