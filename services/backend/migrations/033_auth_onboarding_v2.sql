-- Orderak D1 — Auth & Onboarding V2 (OTP + Passkeys).
-- Additive and rollback-safe: legacy /api/auth/session and /api/register remain.

ALTER TABLE sellers ADD COLUMN business_category TEXT;
ALTER TABLE sellers ADD COLUMN city_geoname_id INTEGER;
ALTER TABLE sellers ADD COLUMN city_name TEXT;

CREATE TABLE onboarding_sessions (
  id                  TEXT PRIMARY KEY,
  token_hash          TEXT NOT NULL UNIQUE,
  phone_e164          TEXT NOT NULL,
  firebase_uid        TEXT NOT NULL,
  device_secret_hash  TEXT NOT NULL,
  locale              TEXT NOT NULL DEFAULT 'en',
  status              TEXT NOT NULL DEFAULT 'phone_verified'
                      CHECK (status IN ('phone_verified','account_saved','completed','expired')),
  full_name           TEXT,
  email_private       TEXT,
  terms_version       INTEGER,
  privacy_version     INTEGER,
  terms_accepted_at   TEXT,
  app_version         TEXT,
  completed_seller_id TEXT,
  idempotency_key     TEXT,
  expires_at          TEXT NOT NULL,
  absolute_expires_at TEXT NOT NULL,
  created_at          TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at          TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX idx_onboarding_sessions_phone
  ON onboarding_sessions(phone_e164, created_at DESC);
CREATE INDEX idx_onboarding_sessions_expiry
  ON onboarding_sessions(status, expires_at, absolute_expires_at);
CREATE UNIQUE INDEX idx_onboarding_sessions_idempotency
  ON onboarding_sessions(idempotency_key) WHERE idempotency_key IS NOT NULL;

CREATE TABLE seller_profiles (
  seller_id          TEXT PRIMARY KEY,
  full_name          TEXT NOT NULL,
  email_private      TEXT,
  email_verified_at  TEXT,
  created_at         TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at         TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (seller_id) REFERENCES sellers(id)
);
CREATE UNIQUE INDEX idx_seller_profiles_email
  ON seller_profiles(lower(email_private)) WHERE email_private IS NOT NULL;

CREATE TABLE passkey_credentials (
  id                    TEXT PRIMARY KEY,
  seller_id             TEXT NOT NULL,
  credential_id         TEXT NOT NULL UNIQUE,
  credential_public_key BLOB NOT NULL,
  webauthn_user_id      TEXT NOT NULL,
  counter               INTEGER NOT NULL DEFAULT 0,
  aaguid                TEXT,
  transports_json       TEXT NOT NULL DEFAULT '[]',
  device_type           TEXT NOT NULL,
  backed_up              INTEGER NOT NULL DEFAULT 0 CHECK (backed_up IN (0,1)),
  label                  TEXT,
  status                 TEXT NOT NULL DEFAULT 'active'
                         CHECK (status IN ('active','revoked')),
  created_at             TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at             TEXT NOT NULL DEFAULT (datetime('now')),
  last_used_at           TEXT,
  revoked_at             TEXT,
  FOREIGN KEY (seller_id) REFERENCES sellers(id)
);
CREATE INDEX idx_passkey_credentials_seller
  ON passkey_credentials(seller_id, status, created_at DESC);

CREATE TABLE webauthn_challenges (
  id             TEXT PRIMARY KEY,
  challenge_hash TEXT NOT NULL UNIQUE,
  ceremony       TEXT NOT NULL CHECK (ceremony IN ('registration','authentication')),
  seller_id      TEXT,
  webauthn_user_id TEXT,
  expires_at     TEXT NOT NULL,
  consumed_at    TEXT,
  created_at     TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (seller_id) REFERENCES sellers(id)
);
CREATE INDEX idx_webauthn_challenges_expiry
  ON webauthn_challenges(ceremony, expires_at, consumed_at);

CREATE TABLE recent_auth_proofs (
  id          TEXT PRIMARY KEY,
  token_hash  TEXT NOT NULL UNIQUE,
  seller_id   TEXT NOT NULL,
  method      TEXT NOT NULL CHECK (method IN ('otp','passkey')),
  expires_at  TEXT NOT NULL,
  consumed_at TEXT,
  created_at  TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (seller_id) REFERENCES sellers(id)
);
CREATE INDEX idx_recent_auth_proofs_seller
  ON recent_auth_proofs(seller_id, expires_at, consumed_at);

CREATE TABLE email_verification_tokens (
  id          TEXT PRIMARY KEY,
  seller_id   TEXT NOT NULL,
  email       TEXT NOT NULL,
  token_hash  TEXT NOT NULL UNIQUE,
  kind        TEXT NOT NULL DEFAULT 'initial' CHECK (kind IN ('initial','resend')),
  expires_at  TEXT NOT NULL,
  used_at     TEXT,
  created_at  TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (seller_id) REFERENCES sellers(id)
);
CREATE INDEX idx_email_verification_seller
  ON email_verification_tokens(seller_id, created_at DESC);
CREATE TRIGGER trg_email_verification_applied
AFTER UPDATE OF used_at ON email_verification_tokens
WHEN OLD.used_at IS NULL AND NEW.used_at IS NOT NULL
BEGIN
  UPDATE seller_profiles
  SET email_verified_at = NEW.used_at, updated_at = NEW.used_at
  WHERE seller_id = NEW.seller_id
    AND lower(email_private) = lower(NEW.email);
END;

CREATE TABLE geo_cities (
  geoname_id   INTEGER PRIMARY KEY,
  country_iso  TEXT NOT NULL,
  name         TEXT NOT NULL,
  ascii_name   TEXT NOT NULL,
  admin1_code  TEXT,
  population   INTEGER NOT NULL DEFAULT 0,
  timezone     TEXT,
  updated_at   TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX idx_geo_cities_country_population
  ON geo_cities(country_iso, population DESC);

CREATE TABLE geo_city_names (
  geoname_id  INTEGER NOT NULL,
  lang        TEXT NOT NULL,
  name        TEXT NOT NULL,
  preferred   INTEGER NOT NULL DEFAULT 0 CHECK (preferred IN (0,1)),
  PRIMARY KEY (geoname_id, lang, name),
  FOREIGN KEY (geoname_id) REFERENCES geo_cities(geoname_id)
);
CREATE INDEX idx_geo_city_names_lookup
  ON geo_city_names(lang, name);

CREATE VIRTUAL TABLE geo_city_search USING fts5(
  geoname_id UNINDEXED,
  country_iso UNINDEXED,
  lang UNINDEXED,
  name,
  ascii_name,
  tokenize='unicode61 remove_diacritics 2'
);

PRAGMA optimize;
