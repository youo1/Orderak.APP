-- ============================================================
-- How to put each FTS5 search index back after a restore.
--
-- WHY THIS FILE EXISTS
--   `wrangler d1 export` cannot export an FTS5 virtual table, and its shadow
--   tables (`<vtab>_data`, `_idx`, `_content`, `_docsize`, `_config`) are
--   deliberately excluded from the export too — see d1-exportable-tables.mjs.
--   Until this file existed, that meant the search tables were in no backup at
--   all and nothing recreated them: a restore produced a database where
--   `SELECT ... FROM geo_city_search` fails with "no such table", and the
--   restore drill passed because both copies were equally incomplete. City
--   search, business-category search and the onboarding flows built on them
--   were the part of the system a restore silently did not bring back.
--
-- WHY REBUILD RATHER THAN BACK UP
--   Every one of these indexes is derived. Nothing in src/ writes to them —
--   they are populated once by an import script or a migration and only ever
--   read afterwards. Their sources (geo_cities, geo_city_names, city_catalog,
--   business_subcategories) are ordinary tables that the export already
--   contains in full. So the index is recomputable from the backup rather than
--   contained in it, which is also smaller, and cannot drift from its source
--   the way a separately-backed-up copy could.
--
-- HOW IT IS USED
--   d1-export-schema-extras.mjs appends the `CREATE VIRTUAL TABLE` statement
--   for each search table found in sqlite_master, followed by the matching
--   block below, to the end of every export. A restored export therefore
--   arrives with its search indexes already rebuilt; no separate step, and no
--   runbook instruction to forget.
--
-- ADDING A SEARCH TABLE
--   Add a `-- @rebuild <table>` block here in the same commit. The extras
--   script fails the backup if a virtual table has no block, because the
--   alternative is a backup that quietly stops containing something again.
--
-- Each block must be idempotent against the empty table the CREATE VIRTUAL
-- TABLE statement immediately before it produces.
-- ============================================================

-- @rebuild geo_city_search
-- One search row per (city, language) name, which is exactly what
-- import-geonames.mjs writes: a language-neutral 'und' row carrying the
-- canonical name, plus one row per translation. geo_city_names holds the same
-- set one-to-one, so joining it to geo_cities for the country and ascii name
-- reproduces the index without consulting the source dataset.
INSERT INTO geo_city_search(geoname_id, country_iso, lang, name, ascii_name)
SELECT n.geoname_id, c.country_iso, n.lang, n.name, c.ascii_name
FROM geo_city_names n
JOIN geo_cities c ON c.geoname_id = n.geoname_id;

-- @rebuild city_catalog_search
-- import-csc-cities.mjs appends a search row for every city_catalog row it
-- writes, in the same pass, with no filtering between them — so the catalogue
-- table is the whole index. Every version is rebuilt, not just the active one,
-- because city_catalog retains the previous snapshot until a replacement has
-- loaded completely and a restore should land in that same state.
INSERT INTO city_catalog_search(version, source_city_id, country_iso, name, native_name, state_name)
SELECT version, source_city_id, country_iso, name, native_name, state_name
FROM city_catalog;

-- @rebuild business_taxonomy_search
-- Migration 037 seeded this from `version_id=1 AND active=1`. The version is
-- resolved through business_taxonomy_versions.status here instead of being
-- pinned to 1, so a future taxonomy version restores its own rows rather than
-- the first one's.
INSERT INTO business_taxonomy_search(subcategory_id, category_id, name_en, name_ar, name_fr)
SELECT s.id, s.category_id, s.name_en, s.name_ar, s.name_fr
FROM business_subcategories s
JOIN business_taxonomy_versions v ON v.id = s.version_id
WHERE v.status = 'active' AND s.active = 1;
