-- Full admin access stays locked until the initial recovery-code set is acknowledged.
ALTER TABLE admin_users ADD COLUMN recovery_codes_acknowledged_at TEXT;
