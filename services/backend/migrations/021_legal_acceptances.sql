-- Immutable evidence of the legal versions accepted during verified phone auth.
-- account_id is introduced by the production-session migration; seller_id and
-- phone_e164 provide the Phase-1 bridge without making phone a future identity key.
CREATE TABLE IF NOT EXISTS legal_acceptances (
  id                    TEXT PRIMARY KEY,
  seller_id             TEXT,
  phone_e164            TEXT NOT NULL,
  terms_version         INTEGER NOT NULL,
  privacy_version       INTEGER NOT NULL,
  locale                TEXT NOT NULL,
  source                TEXT NOT NULL,
  app_version           TEXT,
  marketing_consent     INTEGER NOT NULL DEFAULT 0,
  accepted_at           TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_legal_acceptances_phone
  ON legal_acceptances(phone_e164, accepted_at DESC);
CREATE INDEX IF NOT EXISTS idx_legal_acceptances_seller
  ON legal_acceptances(seller_id, accepted_at DESC);
