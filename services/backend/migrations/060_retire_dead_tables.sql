-- 060_retire_dead_tables.sql
--
-- Retire two tables no code reads, in the reversible form.
--
-- rollout: expand-contract — safe to apply before the Worker deploy because
-- neither table is named by any query in any release. Verified against the tree
-- this migration ships with: `src/` has no FROM/INTO/UPDATE/JOIN/TABLE statement
-- naming either table, and neither `scripts/` nor `test/` does either. The
-- between-steps window (production-deploy.yml applies migrations, then deploys
-- the Workers) is therefore not a window for these two: the code serving traffic
-- on both sides of the deploy does not know they exist.
--
-- WHY RENAME AND NOT DROP
--   `items` was already declared dead by migration 044's own comment — "No query
--   in services/backend/src reads or writes it; `products` superseded it" — and
--   `content_pages` was superseded by `content_page_versions` in 012. Both are
--   code-dead, which is a fact about reachability, not about emptiness. Nobody
--   has counted the rows, and there is no verified backup in this repository to
--   restore them from. Dropping them would be destroying data on the strength of
--   an inference, so this migration renames them: every reader's path is cleared
--   exactly as a drop would clear it, the name now says what the table is, and
--   the data is one statement away from coming back.
--
--   The drop belongs in a later migration, after a backup has been taken and the
--   row counts recorded in it. That is a deliberate second step, not an
--   oversight: this repository's applied migrations are immutable history, so a
--   drop here could not be undone by editing this file.
--
-- ROLLBACK
--   ALTER TABLE zz_retired_items RENAME TO items;
--   ALTER TABLE zz_retired_content_pages RENAME TO content_pages;
--   Both statements are exact inverses; no data is touched by this migration.
--
-- NOT IN THIS MIGRATION, DELIBERATELY
--   `geo_city_names` and `geo_city_search` were proposed for deletion alongside
--   these two. They are not code-dead in the same sense: they carry live
--   maintenance tooling — `scripts/import-geonames.mjs` (wired as
--   `pnpm run geo:build-geonames-rollback`) writes both, and
--   `scripts/d1-search-index-rebuild.sql` rebuilds the search index from
--   `geo_city_names`. The runtime moved to the `city_catalog*` set
--   (`src/domains/catalog/geo.ts` reads it), but retiring these two is retiring
--   a subsystem together with its tools, and doing it by rename would turn three
--   recovery scripts into failures discovered during an incident. See
--   `docs/redesign/backend-deletions.md`.

ALTER TABLE items RENAME TO zz_retired_items;
ALTER TABLE content_pages RENAME TO zz_retired_content_pages;

-- Record what was retired, so the follow-up migration that drops them has the
-- date and the reason without reading this file's history.
CREATE TABLE IF NOT EXISTS retired_tables (
    table_name TEXT PRIMARY KEY,
    retired_at TEXT NOT NULL,
    migration TEXT NOT NULL,
    reason TEXT NOT NULL
);

INSERT OR IGNORE INTO retired_tables (table_name, retired_at, migration, reason) VALUES
    ('items', '2026-09-26', '060_retire_dead_tables.sql',
     'Superseded by products. No query in src/, scripts/ or test/ names it; migration 044 records it as dead. Renamed rather than dropped because the row count is unknown and no backup has been verified.'),
    ('content_pages', '2026-09-26', '060_retire_dead_tables.sql',
     'Superseded by content_page_versions in migration 012. No query names it; public-router.ts read the versions table all along and only a stale comment named this one. Renamed rather than dropped for the same reason as items.');
