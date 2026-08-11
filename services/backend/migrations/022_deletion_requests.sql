-- Account-deletion requests submitted from the public web resource or app.
-- Requests are verified and fulfilled manually until automated erasure ships.
CREATE TABLE IF NOT EXISTS deletion_requests (
  id            TEXT PRIMARY KEY,
  phone_e164    TEXT NOT NULL,
  email         TEXT,
  locale        TEXT NOT NULL DEFAULT 'ar',
  source        TEXT NOT NULL,
  status        TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'verified', 'completed', 'rejected')),
  requested_at  TEXT NOT NULL DEFAULT (datetime('now')),
  deadline_at   TEXT NOT NULL,
  verified_at   TEXT,
  completed_at  TEXT,
  notes         TEXT
);

CREATE INDEX IF NOT EXISTS idx_deletion_requests_status_deadline
  ON deletion_requests(status, deadline_at);
CREATE INDEX IF NOT EXISTS idx_deletion_requests_phone
  ON deletion_requests(phone_e164, requested_at DESC);
