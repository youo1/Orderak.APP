-- Multi-device authentication is paid-only and backend-enforced.
ALTER TABLE plans ADD COLUMN multi_device_enabled INTEGER NOT NULL DEFAULT 0;

UPDATE plans SET multi_device_enabled = 0 WHERE id = 'free';
UPDATE plans SET multi_device_enabled = 1 WHERE id IN ('starter', 'professional');

INSERT OR REPLACE INTO plan_features(plan_id, feature_key, name, description, enabled) VALUES
  ('free', 'multi_device', 'Multi-device access', 'Sign in to the same store from more than one device', 0),
  ('starter', 'multi_device', 'Multi-device access', 'Sign in to the same store from more than one device', 1),
  ('professional', 'multi_device', 'Multi-device access', 'Sign in to the same store from more than one device', 1);
