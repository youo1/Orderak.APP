ALTER TABLE app_screens ADD COLUMN source TEXT NOT NULL DEFAULT 'manual';
ALTER TABLE app_screens ADD COLUMN last_synced_at TEXT;
CREATE INDEX IF NOT EXISTS idx_screens_android_route ON app_screens(android_route);
