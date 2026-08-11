-- Orderak D1 — Inbound email (Cloudflare Email Routing → Worker)
-- Run remote: npx wrangler d1 execute orderak-db --remote --file=migrations/005_inbound_email.sql
-- Run local:  npx wrangler d1 execute orderak-db --local  --file=migrations/005_inbound_email.sql
--
-- Design notes:
-- * Cloudflare Email Routing delivers each message addressed to a configured
--   address (e.g. support@orderak.app) to the Worker's `email()` handler.
-- * handleInboundEmail() parses the message and stores one row here, then
--   optionally re-forwards a copy to FORWARD_TO (a personal inbox).
-- * One table serves any number of inbound addresses; filter by `to_addr`.

CREATE TABLE IF NOT EXISTS inbound_emails (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  to_addr      TEXT NOT NULL,               -- which Orderak address it was sent to
  from_addr    TEXT NOT NULL,               -- sender (envelope/from header)
  subject      TEXT NOT NULL DEFAULT '',
  text_body    TEXT NOT NULL DEFAULT '',    -- decoded text/plain part
  html_body    TEXT NOT NULL DEFAULT '',    -- decoded text/html part (if any)
  message_id   TEXT,                        -- RFC Message-ID header (dedupe/correlation)
  size         INTEGER NOT NULL DEFAULT 0,  -- raw message size in bytes
  forwarded    INTEGER NOT NULL DEFAULT 0,  -- 1 if re-forwarded to FORWARD_TO
  read_at      TEXT,                        -- set when an admin opens it
  received_at  TEXT DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_inbound_received ON inbound_emails(received_at);
CREATE INDEX IF NOT EXISTS idx_inbound_to       ON inbound_emails(to_addr);
CREATE INDEX IF NOT EXISTS idx_inbound_msgid     ON inbound_emails(message_id);
