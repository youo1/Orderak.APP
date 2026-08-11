-- Immutable, generated design-system revisions.
-- The singleton state row is the only mutable pointer. Published snapshots
-- are never regenerated or edited in place.
CREATE TABLE IF NOT EXISTS design_system_revisions (
  id                     INTEGER PRIMARY KEY AUTOINCREMENT,
  schema_version         INTEGER NOT NULL,
  generator_version      TEXT NOT NULL,
  source_json            TEXT NOT NULL,
  overrides_json         TEXT NOT NULL DEFAULT '{}',
  snapshot_json          TEXT NOT NULL,
  validation_json        TEXT NOT NULL,
  legacy_projection_json TEXT NOT NULL,
  content_hash           TEXT NOT NULL,
  status                 TEXT NOT NULL DEFAULT 'candidate'
                         CHECK (status IN ('candidate','published','abandoned')),
  created_by             INTEGER,
  created_at             TEXT NOT NULL DEFAULT (datetime('now')),
  published_at           TEXT,
  rollback_of_revision_id INTEGER,
  FOREIGN KEY (rollback_of_revision_id) REFERENCES design_system_revisions(id)
);

CREATE INDEX IF NOT EXISTS idx_design_system_revision_hash
  ON design_system_revisions(content_hash);
CREATE INDEX IF NOT EXISTS idx_design_system_revision_published
  ON design_system_revisions(status, id DESC);

CREATE TABLE IF NOT EXISTS design_system_state (
  id                 INTEGER PRIMARY KEY CHECK (id = 1),
  active_revision_id INTEGER,
  updated_at         TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (active_revision_id) REFERENCES design_system_revisions(id)
);

INSERT OR IGNORE INTO design_system_state(id, active_revision_id) VALUES (1, NULL);

INSERT OR IGNORE INTO capability_definitions
(capability_key,domain,label,description,implementation_status,enforcement_binding,runtime_consumer,risk,scopes_json,active)
VALUES
('design_system.generated','System','Generated design system',
 'Immutable generated colors, typography, spacing and shapes across Android and web surfaces',
 'enforced','design_system_state.active_revision_id','backend/admin/android/public web','high','["global"]',1);
