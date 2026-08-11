-- Additional authenticated devices for an existing seller. The original
-- sellers.secret remains valid for backward compatibility and the first phone.
CREATE TABLE IF NOT EXISTS seller_devices (
  seller_id   TEXT NOT NULL,
  secret_hash TEXT NOT NULL,
  created_at  TEXT NOT NULL DEFAULT (datetime('now')),
  last_used_at TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (seller_id, secret_hash)
);

CREATE INDEX IF NOT EXISTS idx_seller_devices_seller ON seller_devices(seller_id);
