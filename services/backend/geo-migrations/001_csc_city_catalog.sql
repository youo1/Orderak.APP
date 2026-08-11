-- Orderak isolated city catalogue.
-- Source: Countries States Cities Database (ODbL-1.0).
-- Versioned imports keep the previously active snapshot available until the
-- replacement snapshot has been loaded completely.

CREATE TABLE city_catalog_versions (
  version          TEXT PRIMARY KEY,
  source_url       TEXT NOT NULL,
  source_sha256    TEXT NOT NULL,
  license          TEXT NOT NULL,
  city_count       INTEGER NOT NULL DEFAULT 0,
  active           INTEGER NOT NULL DEFAULT 0 CHECK (active IN (0,1)),
  imported_at      TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE UNIQUE INDEX idx_city_catalog_one_active
  ON city_catalog_versions(active) WHERE active = 1;

CREATE TABLE city_catalog (
  version          TEXT NOT NULL,
  source_city_id   INTEGER NOT NULL,
  country_iso      TEXT NOT NULL CHECK (
    length(country_iso) = 2 AND country_iso = upper(country_iso)
  ),
  name             TEXT NOT NULL,
  native_name      TEXT,
  state_code       TEXT,
  state_name       TEXT,
  population       INTEGER NOT NULL DEFAULT 0,
  timezone         TEXT,
  PRIMARY KEY (version, source_city_id),
  FOREIGN KEY (version) REFERENCES city_catalog_versions(version)
);

CREATE INDEX idx_city_catalog_country_population
  ON city_catalog(version, country_iso, population DESC, name);

CREATE VIRTUAL TABLE city_catalog_search USING fts5(
  version UNINDEXED,
  source_city_id UNINDEXED,
  country_iso UNINDEXED,
  name,
  native_name,
  state_name,
  tokenize='unicode61 remove_diacritics 2'
);
