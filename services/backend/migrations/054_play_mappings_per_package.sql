-- Two Play packages, so the product mapping has to know which one it is for.
--
-- WHAT CHANGED THE REQUIREMENT
--   Staging gets its own Play Console entry. The staging Android flavour applies
--   applicationIdSuffix = ".staging", so its package is
--   `app.orderak.seller.staging` and its products live under a different app in
--   the Play Console. Product ids are scoped per app, so both packages carry an
--   `orderak_paid1` and they are different products.
--
--   `mappingForItem` already looks a mapping up by product_id + base_plan_id +
--   package_name, binding the package from `env.GOOGLE_PLAY_PACKAGE_NAME`. So
--   the query was ready. The table was not: `UNIQUE (product_id, base_plan_id)`
--   permits exactly one row per product and base plan across all packages, which
--   means the staging rows could not be inserted at all.
--
--   The constraint was not wrong when it was written — there was one package.
--   It is wrong now, and widening it to include the package is what the lookup
--   has always assumed.
--
-- rollout: expand-contract  SQLite cannot alter a table-level UNIQUE constraint
--   in place, so this is a rebuild: create, copy, drop, rename. Three things make
--   it safe to run before the Workers deploy, in the window where the previous
--   release is serving live traffic against this schema.
--
--   First, the old code's only read of this table is `mappingForItem` and
--   `deferredMapping`, both reached exclusively from Play purchase verification.
--   BILLING_ENABLED and GOOGLE_PLAY_LIFECYCLE_ENABLED are "false" in both
--   environments, so no code path reaches either function; there is no live
--   traffic against this table to be interrupted.
--
--   Second, the shape the old code selects is unchanged. Every column it names
--   survives with the same name and type, so even if a read did occur during the
--   window it would succeed. Only the constraint widens, and widening a
--   uniqueness rule cannot make an existing row invalid.
--
--   Third, six rows. The rebuild is not a long operation with a wide window.
--
--   The contract half is that the old constraint is gone. Nothing depends on it:
--   it was never enforcing a rule anyone stated, only a limit nobody had needed
--   to exceed.

CREATE TABLE play_product_mappings_new (
  id              TEXT PRIMARY KEY,
  plan_id         TEXT NOT NULL,
  product_id      TEXT NOT NULL,
  base_plan_id    TEXT NOT NULL CHECK (base_plan_id IN ('monthly','annual')),
  package_name    TEXT NOT NULL DEFAULT 'app.orderak.seller',
  active          INTEGER NOT NULL DEFAULT 0 CHECK (active IN (0,1)),
  last_synced_at  TEXT,
  price_snapshot_json TEXT,
  created_at      TEXT NOT NULL DEFAULT (datetime('now')),
  -- The package leads: it is the coarsest distinction and the one the lookup
  -- binds first.
  UNIQUE (package_name, product_id, base_plan_id),
  FOREIGN KEY (plan_id) REFERENCES subscription_plans(id)
);

INSERT INTO play_product_mappings_new
  (id, plan_id, product_id, base_plan_id, package_name, active, last_synced_at, price_snapshot_json, created_at)
SELECT id, plan_id, product_id, base_plan_id, package_name, active, last_synced_at, price_snapshot_json, created_at
  FROM play_product_mappings;

DROP TABLE play_product_mappings;
ALTER TABLE play_product_mappings_new RENAME TO play_product_mappings;

-- The staging package's six mappings, inactive.
--
-- Inactive for the same reason the production six are: a mapping is activated
-- only after the corresponding product has been confirmed to exist in that Play
-- Console entry. An active mapping for a product that does not exist turns a
-- purchase attempt into `play_product_not_enabled` at best, and at worst accepts
-- a token for something else.
--
-- plan_id values are migration 025's, so these point at the same four plans as
-- the production rows. The ids below are fresh UUIDs; nothing derives them.
INSERT INTO play_product_mappings(id, plan_id, product_id, base_plan_id, package_name, active) VALUES
  ('b2a41f0c-6c1e-4e0a-9f6f-2a3d5c7e91a4','29b0920e-4ea7-4340-8631-2d9552c2b77c','orderak_paid1','monthly','app.orderak.seller.staging',0),
  ('7d5e8c31-0b94-4a52-8e17-6f0c2d4a83b7','29b0920e-4ea7-4340-8631-2d9552c2b77c','orderak_paid1','annual','app.orderak.seller.staging',0),
  ('c9f27a46-3d18-4b6e-90a3-5e8b1c04d2f9','26e1e24b-7237-4e38-931a-a3e2e7380591','orderak_paid2','monthly','app.orderak.seller.staging',0),
  ('4e610b8d-92c7-4f31-a5d0-8b3f6a2e7c15','26e1e24b-7237-4e38-931a-a3e2e7380591','orderak_paid2','annual','app.orderak.seller.staging',0),
  ('a03c5d72-1f86-4e94-b7a2-9d4e0c6b8351','716e6c85-21a5-42b2-9a9b-b96621322814','orderak_paid3','monthly','app.orderak.seller.staging',0),
  ('f186be49-5a2d-4c70-83b1-0e7a9d3f6c82','716e6c85-21a5-42b2-9a9b-b96621322814','orderak_paid3','annual','app.orderak.seller.staging',0);

-- The lookup binds product_id, base_plan_id and package_name together, and
-- filters on active. The UNIQUE constraint above already indexes the first
-- three; this covers the deferredMapping path, which omits base_plan_id.
CREATE INDEX IF NOT EXISTS idx_play_mappings_package_product
  ON play_product_mappings(package_name, product_id, active);
