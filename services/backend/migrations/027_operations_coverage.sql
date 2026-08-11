-- Operational UI/control-plane coverage for seller lifecycle, support,
-- announcements, translations, devices, and scheduled-job observability.

ALTER TABLE seller_devices ADD COLUMN device_id TEXT;
ALTER TABLE seller_devices ADD COLUMN device_label TEXT;
ALTER TABLE seller_devices ADD COLUMN platform TEXT;
ALTER TABLE seller_devices ADD COLUMN app_version TEXT;

ALTER TABLE sellers ADD COLUMN primary_device_id TEXT;
ALTER TABLE sellers ADD COLUMN primary_device_label TEXT;
ALTER TABLE sellers ADD COLUMN primary_device_platform TEXT;
ALTER TABLE sellers ADD COLUMN primary_device_app_version TEXT;
ALTER TABLE sellers ADD COLUMN primary_device_last_used_at TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS idx_seller_devices_device_id
  ON seller_devices(seller_id, device_id) WHERE device_id IS NOT NULL;

ALTER TABLE product_translations ADD COLUMN reviewed_by_type TEXT;
ALTER TABLE product_translations ADD COLUMN reviewed_by_id TEXT;

-- Client-generated event keys make impression/click retries idempotent without
-- exposing any persistent advertising identifier.
ALTER TABLE ad_impressions ADD COLUMN event_key TEXT;
CREATE UNIQUE INDEX IF NOT EXISTS idx_ad_impressions_event_key
  ON ad_impressions(event_key) WHERE event_key IS NOT NULL;

CREATE TABLE IF NOT EXISTS announcement_reads (
  announcement_id INTEGER NOT NULL,
  seller_id       TEXT NOT NULL,
  read_at         TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (announcement_id, seller_id),
  FOREIGN KEY (announcement_id) REFERENCES announcements(id) ON DELETE CASCADE,
  FOREIGN KEY (seller_id) REFERENCES sellers(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS operational_job_runs (
  id            TEXT PRIMARY KEY,
  job_key       TEXT NOT NULL,
  trigger_kind  TEXT NOT NULL CHECK (trigger_kind IN ('scheduled','admin')),
  status        TEXT NOT NULL CHECK (status IN ('running','succeeded','failed')),
  started_at    TEXT NOT NULL DEFAULT (datetime('now')),
  completed_at  TEXT,
  affected_count INTEGER NOT NULL DEFAULT 0,
  summary_json  TEXT,
  error_message TEXT,
  triggered_by  INTEGER
);

CREATE INDEX IF NOT EXISTS idx_operational_job_runs_key
  ON operational_job_runs(job_key, started_at DESC);

INSERT OR IGNORE INTO settings(key,value_json) VALUES('billing_enabled','false');
