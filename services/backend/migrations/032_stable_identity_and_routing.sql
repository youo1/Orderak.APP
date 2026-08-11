-- Stable authentication ownership and logical tenant routing. This migration
-- is additive: sellers.phone/firebase_uid remain compatibility projections
-- throughout the pre-production observation period.

CREATE TABLE seller_auth_identities (
  id                    TEXT PRIMARY KEY,
  seller_id             TEXT NOT NULL,
  provider              TEXT NOT NULL CHECK (provider IN ('firebase_phone')),
  provider_subject      TEXT NOT NULL,
  verified_phone_e164   TEXT NOT NULL,
  status                TEXT NOT NULL DEFAULT 'active'
                        CHECK (status IN ('active','superseded','revoked')),
  verified_at           TEXT NOT NULL DEFAULT (datetime('now')),
  superseded_at         TEXT,
  created_at            TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at            TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (seller_id) REFERENCES sellers(id)
);

CREATE UNIQUE INDEX idx_auth_identity_provider_subject
  ON seller_auth_identities(provider,provider_subject);
CREATE UNIQUE INDEX idx_auth_identity_active_phone
  ON seller_auth_identities(verified_phone_e164) WHERE status='active';
CREATE UNIQUE INDEX idx_auth_identity_one_active_provider_per_seller
  ON seller_auth_identities(seller_id,provider) WHERE status='active';
CREATE INDEX idx_auth_identity_seller_history
  ON seller_auth_identities(seller_id,created_at DESC);

CREATE TABLE identity_migration_issues (
  seller_id         TEXT NOT NULL,
  issue_code        TEXT NOT NULL CHECK (issue_code IN (
                      'missing_firebase_subject','invalid_phone_e164',
                      'phone_conflict','firebase_subject_conflict','write_failed'
                    )),
  first_observed_at TEXT NOT NULL DEFAULT (datetime('now')),
  last_observed_at  TEXT NOT NULL DEFAULT (datetime('now')),
  occurrence_count INTEGER NOT NULL DEFAULT 1,
  resolved_at       TEXT,
  PRIMARY KEY (seller_id,issue_code),
  FOREIGN KEY (seller_id) REFERENCES sellers(id)
);

CREATE TABLE organization_routing (
  organization_id      TEXT PRIMARY KEY,
  shard_key            TEXT NOT NULL DEFAULT 'primary',
  routing_version      INTEGER NOT NULL DEFAULT 1 CHECK (routing_version > 0),
  migration_state      TEXT NOT NULL DEFAULT 'stable' CHECK (migration_state IN (
                         'stable','write_fenced','copying','catching_up',
                         'observing','rolling_back'
                       )),
  target_shard_key     TEXT,
  write_fence_started_at TEXT,
  write_fence_reason   TEXT,
  updated_at           TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (organization_id) REFERENCES organizations(id)
);
CREATE INDEX idx_organization_routing_migration
  ON organization_routing(migration_state,target_shard_key);

-- D1-backed challenges make replay protection transactional with identity and
-- credential replacement. Only a hash of the bearer challenge is persisted.
CREATE TABLE phone_change_challenges (
  id                    TEXT PRIMARY KEY,
  challenge_token_hash  TEXT NOT NULL UNIQUE,
  seller_id             TEXT NOT NULL,
  current_phone_e164    TEXT NOT NULL,
  new_phone_e164        TEXT NOT NULL,
  current_provider_subject TEXT NOT NULL,
  expires_at            TEXT NOT NULL,
  consumed_at           TEXT,
  created_at            TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (seller_id) REFERENCES sellers(id)
);
CREATE INDEX idx_phone_change_challenge_expiry
  ON phone_change_challenges(seller_id,expires_at,consumed_at);

PRAGMA optimize;
