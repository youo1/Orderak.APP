-- Make the stock ledger self-sufficient: `product_code` becomes NOT NULL.
--
-- WHAT THIS CLOSES
--   Migration 052 created `stock_movements` with `product_code` nullable and
--   made the argument for why the column exists at all:
--
--     "Deleting a product is routine here [...] and a ledger whose history is
--      rewritten by a later deletion is not a ledger."
--
--   That argument was never finished. `product_id` carries no foreign key so a
--   deletion cannot erase attribution — but only if `product_code` is actually
--   populated, and nothing enforced that. A single write path that forgot the
--   column would write history nobody can attribute, and it would look exactly
--   like a normal row until someone tried to read the ledger back.
--
--   Deleting a product stopped being the mirror's business and became its own
--   endpoint (`DELETE /api/v1/products/{product_code}`), so the deletions 052
--   anticipated are now a deliberate, routine operation. The constraint that
--   makes its comment true should land before they are common, not after.
--
-- WHY THERE IS NOTHING TO REPAIR
--   Every path that writes this table already resolves the code through
--   `products`, where `product_code` has been TEXT NOT NULL since 009:
--
--     * the seller's adjustment (api-store.ts) selects `p.product_code` from a
--       row it matched BY that same code, so it cannot be null by construction;
--     * both triggers below select it from the joined `products` row;
--     * all three backfills in 052 inner-join `products`, so a row whose
--       product was already gone was never inserted rather than inserted blank.
--
--   Verified rather than assumed, on 2026-09-15: staging holds 0 movement rows,
--   and production has not reached 052 at all (last applied: 043), so the table
--   does not yet exist there. There is no historical data in either environment
--   for this constraint to reject. That is precisely why it is being added now
--   — the rebuild is as cheap as it will ever be, and every day of real ledger
--   traffic makes it more expensive.
--
-- THE TWO CASES THE COPY BELOW DISTINGUISHES
--   The plan this migration comes from left one branch open: what to do with a
--   row whose `product_code` is null and cannot be resolved. It is answered
--   here rather than left to whoever hits it.
--
--     resolvable   -- the product still exists: COALESCE recovers the code from
--                     `products` by `product_id`, and the row is preserved with
--                     its attribution restored.
--     unresolvable -- the product is gone and the row never carried a code: the
--                     NOT NULL constraint rejects it and THIS MIGRATION ABORTS.
--
--   Aborting is the decision, not an oversight. The alternatives are to drop
--   the row, which destroys a financial record, or to invent a placeholder code,
--   which makes unattributable history look attributed — the exact failure 052
--   wrote the table to avoid. A deploy that stops and asks is the cheapest of
--   the three, and on current data it cannot trigger.
--
-- WHAT DELIBERATELY DOES NOT CHANGE
--   `product_id` stays nullable and keeps carrying no foreign key. It is a
--   legacy forensic column: useful for tracing a movement back to a row that
--   may since have been deleted, never the identity the ledger is read by.
--
-- WHY THE TRIGGERS ARE DROPPED AND REWRITTEN
--   SQLite has no ALTER TABLE ... SET NOT NULL, so this is the standard table
--   rebuild, and the rebuild cannot skip the triggers. The first attempt here
--   did, on the reasoning that they are declared ON `order_items` and ON
--   `orders` rather than on this table, so DROP TABLE would not take them with
--   it. That is true and it is not enough: `ALTER TABLE ... RENAME TO` reparses
--   every trigger in the schema, both of these name `stock_movements` in their
--   bodies, and at that moment the old table is gone and the new one has not
--   been renamed into place yet. The migration failed with
--
--     error in trigger trg_order_items_claim_stock:
--     no such table: main.stock_movements
--
--   which is why they are dropped first and recreated last, as SQLite's own
--   documented rebuild procedure prescribes. Both are carried across verbatim
--   from 052 — byte-for-byte, comments included — so that a reader diffing the
--   two sees no behaviour change hidden in a table migration.
--
-- The two indices are ON this table and are rebuilt below for the same reason.
--
-- rollout: expand-contract  The previously deployed Worker keeps working against
--   this rebuilt table for the length of the upload, and the pairing was checked
--   rather than assumed:
--
--     * it has exactly one statement touching `stock_movements`, the seller's
--       adjustment INSERT (api-store.ts), and that statement already supplies
--       `product_code` from a `products` row it matched BY that code. The
--       tightened constraint cannot reject a write it makes.
--     * it never reads the table. The retention job names it only to skip it —
--       `RETENTION_EXEMPT_TABLES = ["stock_movements"]` — because the ledger is
--       financial state and is deliberately exempt from the two-year cleanup.
--     * every column keeps its name, type and order, so no query it holds needs
--       rewriting. `product_code` gains NOT NULL and nothing else changes.
--     * the two triggers are recreated in this same file, so order-driven
--       movements keep being recorded across the window.
--
--   The honest residual: SQLite cannot do this without the table briefly not
--   existing between the DROP and the RENAME, and D1 gives a migration no
--   transaction to hide that in. An order placed in that exact instant would
--   fail its INSERT rather than write a bad row. The window is one statement
--   wide, production has not reached 052 so the table does not exist there yet,
--   and staging holds zero movement rows — which is the argument for applying
--   this now rather than once the ledger is carrying real traffic.

DROP TRIGGER IF EXISTS trg_order_items_claim_stock;
DROP TRIGGER IF EXISTS trg_orders_release_stock_on_cancel;

CREATE TABLE stock_movements_new (
  id            TEXT PRIMARY KEY,
  store_id      TEXT NOT NULL,
  -- No FK, deliberately: the product may be deleted; what it did must not be.
  product_id    TEXT,
  -- NOT NULL as of this migration. This is the column the ledger is read by,
  -- and the one a deletion cannot take away.
  product_code  TEXT NOT NULL,
  -- Negative takes stock, positive returns it. Never zero: a movement of
  -- nothing is not a movement, and allowing it invites rows that mean nothing.
  delta         INTEGER NOT NULL,
  -- The stock this product held immediately after this movement. NULL on
  -- reconstructed rows, because a historical balance cannot be known after the
  -- fact and guessing one would make derived history look observed.
  balance_after INTEGER,
  cause         TEXT NOT NULL,
  -- The order this movement belongs to, for SALE and SALE_CANCELLED.
  cause_id      TEXT,
  actor         TEXT NOT NULL,
  -- 1 when the row was derived from other records rather than observed as it
  -- happened. Everything 052's backfill wrote is reconstructed; nothing written
  -- since is.
  reconstructed INTEGER NOT NULL DEFAULT 0,
  created_at    TEXT NOT NULL DEFAULT (datetime('now')),
  CHECK (delta <> 0),
  CHECK (actor IN ('buyer', 'seller', 'system')),
  CHECK (reconstructed IN (0, 1)),
  -- Carried across verbatim from 052. Widening a CHECK in SQLite means
  -- rebuilding the table, so the vocabulary stays declared once and in full.
  --
  --   OPENING_BALANCE      everything that happened before the ledger began,
  --                        as one number per product
  --   SALE                 units claimed by an order
  --   SALE_CANCELLED       units returned when an order was cancelled
  --   MANUAL_ADJUSTMENT    the seller set the figure themselves
  --   LEGACY_UNATTRIBUTED  a correcting entry for drift reconciliation found
  --                        and could not explain
  --   RETURN               a buyer sent goods back
  --   RESTOCK              new units arrived
  --   CORRECTION           a deliberate fix to a known-wrong figure
  CHECK (cause IN (
    'OPENING_BALANCE', 'SALE', 'SALE_CANCELLED', 'MANUAL_ADJUSTMENT',
    'LEGACY_UNATTRIBUTED', 'RETURN', 'RESTOCK', 'CORRECTION'
  ))
);

-- COALESCE is the backfill: a row that lost its code but whose product survives
-- gets it back here. A row that has neither hits NOT NULL and stops the
-- migration, which is the intended outcome — see the header.
INSERT INTO stock_movements_new (
  id, store_id, product_id, product_code, delta, balance_after,
  cause, cause_id, actor, reconstructed, created_at
)
SELECT
  m.id,
  m.store_id,
  m.product_id,
  COALESCE(
    m.product_code,
    (SELECT p.product_code FROM products p WHERE p.id = m.product_id)
  ),
  m.delta,
  m.balance_after,
  m.cause,
  m.cause_id,
  m.actor,
  m.reconstructed,
  m.created_at
FROM stock_movements m;

DROP TABLE stock_movements;

ALTER TABLE stock_movements_new RENAME TO stock_movements;

-- Rebuilt because DROP TABLE took the originals with it. Same definitions as
-- 052: the question this table exists to answer is what happened to this
-- product's stock, in this store, over this period.
CREATE INDEX IF NOT EXISTS idx_stock_movements_product
  ON stock_movements(store_id, product_id, created_at);

-- Reconciliation sums a whole store at once.
CREATE INDEX IF NOT EXISTS idx_stock_movements_store
  ON stock_movements(store_id, created_at);

-- ---------------------------------------------------------------------------
-- The triggers, restored exactly as 052 declared them.
--
-- Replaced rather than added to: a second trigger on the same event would run
-- in an order SQLite does not promise, and `balance_after` has to be read after
-- the UPDATE that sets it.
-- ---------------------------------------------------------------------------

CREATE TRIGGER trg_order_items_claim_stock
BEFORE INSERT ON order_items
WHEN NEW.product_id IS NOT NULL
BEGIN
  SELECT CASE
    WHEN NEW.qty <= 0 OR NOT EXISTS (
      SELECT 1
      FROM products
      WHERE id = NEW.product_id
        AND available = 1
        AND stock >= NEW.qty
    )
    THEN RAISE(ABORT, 'insufficient_stock')
  end;

  UPDATE products
  SET stock = stock - NEW.qty,
      stock_version = stock_version + 1,
      updated_at = datetime('now')
  WHERE id = NEW.product_id;

  -- Same statement as the movement, so the two cannot come apart. The order
  -- header may still be rolled back by the quota clause on its INSERT, which
  -- takes this row with it — which is correct: an order that was not written
  -- did not move any stock.
  INSERT INTO stock_movements (
    id, store_id, product_id, product_code, delta, balance_after,
    cause, cause_id, actor, reconstructed
  )
  SELECT
    lower(hex(randomblob(16))),
    p.store_id,
    p.id,
    p.product_code,
    -NEW.qty,
    p.stock,
    'SALE',
    NEW.order_id,
    COALESCE((SELECT CASE WHEN o.origin = 'manual' THEN 'seller' ELSE 'buyer' END
              FROM orders o WHERE o.id = NEW.order_id), 'buyer'),
    0
  FROM products p
  WHERE p.id = NEW.product_id;
end;

CREATE TRIGGER trg_orders_release_stock_on_cancel
AFTER UPDATE OF status ON orders
WHEN NEW.status = 'CANCELLED' AND OLD.status <> 'CANCELLED'
BEGIN
  UPDATE products
  SET stock = stock + (
        SELECT COALESCE(SUM(oi.qty), 0)
        FROM order_items oi
        WHERE oi.order_id = NEW.id
          AND oi.product_id = products.id
      ),
      stock_version = stock_version + 1,
      updated_at = datetime('now')
  WHERE id IN (
    SELECT oi.product_id
    FROM order_items oi
    WHERE oi.order_id = NEW.id
      AND oi.product_id IS NOT NULL
  );

  -- One row per product the order touched, carrying the units it returned.
  INSERT INTO stock_movements (
    id, store_id, product_id, product_code, delta, balance_after,
    cause, cause_id, actor, reconstructed
  )
  SELECT
    lower(hex(randomblob(16))),
    p.store_id,
    p.id,
    p.product_code,
    (SELECT SUM(oi.qty) FROM order_items oi
      WHERE oi.order_id = NEW.id AND oi.product_id = p.id),
    p.stock,
    'SALE_CANCELLED',
    NEW.id,
    'seller',
    0
  FROM products p
  WHERE p.id IN (
    SELECT oi.product_id FROM order_items oi
    WHERE oi.order_id = NEW.id AND oi.product_id IS NOT NULL
  );
end;
