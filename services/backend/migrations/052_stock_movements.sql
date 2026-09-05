-- An append-only record of every change to a product's stock, and why.
--
-- WHY A TABLE AND NOT THE AUDIT TRAIL
--   `admin_audit` was the obvious candidate and cannot do this job. It is
--   indexed on `action` and `created_at` only, so "every stock change for this
--   product between two dates" is a full scan; the entity lives in an unindexed
--   `details_json` blob; and retention.ts DELETEs rows older than two years on a
--   nightly cron. Inventory is financial state, and a record that is expensive
--   to query and deliberately destroyed after two years is not a record of it.
--
--   It also contained no stock events at all. The only catalogue event in the
--   whole backend is `catalog.mirror_emptied`, which fires on a total wipe.
--
-- WHAT WAS ACTUALLY UNATTRIBUTED
--   Order-driven movement was already attributable by inference: an
--   `order_items` row says which product and how many. What had no trace of any
--   kind was the seller's own adjustment. Editing a product's stock travels
--   through POST /api/v1/products/sync as a compare-and-set UPDATE that bumps
--   `stock_version` and writes nothing else, so after the fact there is no way
--   to tell a seller correcting a count from an order that went missing.
--
-- WHY THE TRIGGERS WRITE IT
--   Stock is moved by triggers, not by application code: one claims units when
--   an order line is inserted, another returns them when an order is cancelled.
--   Writing the ledger from the trigger makes the row and the movement the same
--   statement — there is no ordering to get wrong and no code path that can move
--   stock while forgetting to say so. The seller's adjustment is the one
--   movement made in application code, and it writes its row in the same D1
--   batch as the UPDATE for the same reason.
--
-- WHY IT KEEPS ITS OWN COPY OF THE PRODUCT
--   `product_id` carries no foreign key, deliberately, and `product_code` is
--   denormalised beside it. Deleting a product is routine here — the catalogue
--   mirror deletes anything a push omits — and a ledger whose history is
--   rewritten by a later deletion is not a ledger. ON DELETE SET NULL would
--   erase the attribution; CASCADE would erase the record. `order_items` already
--   denormalises `product_name` for exactly this reason (migration 041).
CREATE TABLE IF NOT EXISTS stock_movements (
  id            TEXT PRIMARY KEY,
  store_id      TEXT NOT NULL,
  -- No FK: see above. The product may be deleted; what it did must not be.
  product_id    TEXT,
  product_code  TEXT,
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
  -- happened. Everything the backfill below writes is reconstructed; nothing
  -- written from here on is.
  reconstructed INTEGER NOT NULL DEFAULT 0,
  created_at    TEXT NOT NULL DEFAULT (datetime('now')),
  CHECK (delta <> 0),
  CHECK (actor IN ('buyer', 'seller', 'system')),
  CHECK (reconstructed IN (0, 1)),
  -- Widening a CHECK in SQLite means rebuilding the table, so the vocabulary is
  -- declared once and in full. RETURN, RESTOCK and CORRECTION are not written
  -- by anything yet; they are the movements this product will need next, and
  -- naming them now costs nothing.
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

-- The question this table exists to answer: what happened to this product's
-- stock, in this store, over this period.
CREATE INDEX IF NOT EXISTS idx_stock_movements_product
  ON stock_movements(store_id, product_id, created_at);

-- Reconciliation sums a whole store at once.
CREATE INDEX IF NOT EXISTS idx_stock_movements_store
  ON stock_movements(store_id, created_at);

-- ---------------------------------------------------------------------------
-- Backfill: reconstruct what can be reconstructed, and say so.
--
-- Do not read the rows below as history observed. They are derived, every one
-- of them carries reconstructed = 1, and what could not be derived is not
-- invented — it is absorbed into a single opening balance per product.
--
-- What was available, and what was not:
--
--   SALE                 reconstructible for order lines whose product still
--                        exists. `orders.created_at` is exact, because the claim
--                        is a BEFORE INSERT trigger inside the order's own
--                        transaction. Lines whose product was deleted have
--                        product_id NULL and cannot be attributed at all.
--
--   SALE_CANCELLED       a fact, but not a time. `status_changed_at` arrived
--                        with migration 046 and only the status route writes it,
--                        so an order cancelled before that has the fact of being
--                        CANCELLED and no date. Worse, cancellations that never
--                        reached the server left no trace whatsoever: before 046
--                        there was no status route, so the app cancelled in Room
--                        alone and the server kept the stock consumed.
--
--   MANUAL_ADJUSTMENT    not reconstructible in any case. It wrote nothing.
--
-- So the opening balance is the honest remainder: current stock minus everything
-- above. It means "the stock this product had before the ledger began, plus any
-- earlier movement that left no evidence", and it is what makes the ledger
-- reconcile from this point without pretending to know how it got here.
-- ---------------------------------------------------------------------------

INSERT INTO stock_movements (
  id, store_id, product_id, product_code, delta, balance_after,
  cause, cause_id, actor, reconstructed, created_at
)
SELECT
  lower(hex(randomblob(16))),
  o.store_id,
  oi.product_id,
  p.product_code,
  -oi.qty,
  NULL,
  'SALE',
  o.id,
  CASE WHEN o.origin = 'manual' THEN 'seller' ELSE 'buyer' END,
  1,
  o.created_at
FROM order_items oi
JOIN orders o ON o.id = oi.order_id
JOIN products p ON p.id = oi.product_id
WHERE oi.product_id IS NOT NULL;

INSERT INTO stock_movements (
  id, store_id, product_id, product_code, delta, balance_after,
  cause, cause_id, actor, reconstructed, created_at
)
SELECT
  lower(hex(randomblob(16))),
  o.store_id,
  oi.product_id,
  p.product_code,
  oi.qty,
  NULL,
  'SALE_CANCELLED',
  o.id,
  'seller',
  1,
  -- The cancellation's own timestamp where it exists, the order's otherwise.
  -- An inferred date on a row already flagged reconstructed is honest; leaving
  -- it null would put the movement outside every period query.
  COALESCE(o.status_changed_at, o.created_at)
FROM order_items oi
JOIN orders o ON o.id = oi.order_id
JOIN products p ON p.id = oi.product_id
WHERE oi.product_id IS NOT NULL
  AND o.status = 'CANCELLED';

-- One row per product, carrying whatever the two passes above could not explain.
-- Written last because it is defined as the remainder, and skipped when it is
-- zero: a movement of nothing is not a movement.
INSERT INTO stock_movements (
  id, store_id, product_id, product_code, delta, balance_after,
  cause, cause_id, actor, reconstructed, created_at
)
SELECT
  lower(hex(randomblob(16))),
  p.store_id,
  p.id,
  p.product_code,
  p.stock - COALESCE((
    SELECT SUM(m.delta) FROM stock_movements m WHERE m.product_id = p.id
  ), 0),
  p.stock,
  'OPENING_BALANCE',
  NULL,
  'system',
  1,
  p.created_at
FROM products p
WHERE p.stock - COALESCE((
  SELECT SUM(m.delta) FROM stock_movements m WHERE m.product_id = p.id
), 0) <> 0;

-- ---------------------------------------------------------------------------
-- The triggers now record what they do.
--
-- Replaced rather than added to: a second trigger on the same event would run
-- in an order SQLite does not promise, and `balance_after` has to be read after
-- the UPDATE that sets it.
-- ---------------------------------------------------------------------------

DROP TRIGGER IF EXISTS trg_order_items_claim_stock;
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

DROP TRIGGER IF EXISTS trg_orders_release_stock_on_cancel;
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
