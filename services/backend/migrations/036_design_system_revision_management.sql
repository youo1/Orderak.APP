-- Add user-facing names to immutable design-system checkpoints and make
-- rollback ancestry safe when an inactive checkpoint is permanently deleted.
CREATE TABLE design_system_revisions_backup (
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
  name                   TEXT
                         CHECK (name IS NULL OR length(trim(name)) BETWEEN 1 AND 80),
  name_key               TEXT
);

INSERT INTO design_system_revisions_backup (
  id, schema_version, generator_version, source_json, overrides_json,
  snapshot_json, validation_json, legacy_projection_json, content_hash,
  status, created_by, created_at, published_at, rollback_of_revision_id,
  name, name_key
)
SELECT
  id, schema_version, generator_version, source_json, overrides_json,
  snapshot_json, validation_json, legacy_projection_json, content_hash,
  status, created_by, created_at, published_at, rollback_of_revision_id,
  NULL, NULL
FROM design_system_revisions;

CREATE TABLE design_system_state_backup (
  id                 INTEGER PRIMARY KEY CHECK (id = 1),
  active_revision_id INTEGER,
  updated_at         TEXT NOT NULL DEFAULT (datetime('now'))
);

INSERT INTO design_system_state_backup(id, active_revision_id, updated_at)
SELECT id, active_revision_id, updated_at FROM design_system_state;

DROP TABLE design_system_state;
DROP TABLE design_system_revisions;

CREATE TABLE design_system_revisions (
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
  name                   TEXT
                         CHECK (name IS NULL OR length(trim(name)) BETWEEN 1 AND 80),
  name_key               TEXT,
  FOREIGN KEY (rollback_of_revision_id)
    REFERENCES design_system_revisions(id) ON DELETE SET NULL
);

INSERT INTO design_system_revisions
SELECT * FROM design_system_revisions_backup;

CREATE TABLE design_system_state (
  id                 INTEGER PRIMARY KEY CHECK (id = 1),
  active_revision_id INTEGER,
  updated_at         TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (active_revision_id) REFERENCES design_system_revisions(id)
);

INSERT INTO design_system_state
SELECT * FROM design_system_state_backup;

DROP TABLE design_system_state_backup;
DROP TABLE design_system_revisions_backup;

CREATE INDEX idx_design_system_revision_hash
  ON design_system_revisions(content_hash);
CREATE INDEX idx_design_system_revision_published
  ON design_system_revisions(status, id DESC);
CREATE UNIQUE INDEX idx_design_system_revision_name_key
  ON design_system_revisions(name_key)
  WHERE name_key IS NOT NULL;
