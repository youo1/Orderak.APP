-- Order status was a client-side fiction.
--
-- `OrderStatus.kt` defines NEW → CONFIRMED → PAID → SHIPPED → DONE with
-- CANCELLED reachable from NEW or CONFIRMED, and OrderDetailsScreen renders a
-- button for the next state. `OrderRepository.markPaid` and `.cancel` then wrote
-- that transition to the Room database on the phone and stopped there: no
-- backend route accepted a status change, and the only `UPDATE orders` in the
-- Worker anonymises buyer names for a privacy request.
--
-- So the server held every order at NEW forever. Reinstalling the app, or
-- signing in on a second device, restored a pipeline the seller had already
-- worked through.
--
-- The cancel path was worse than cosmetic. `trg_order_items_claim_stock`
-- decrements stock when an order is placed; `OrderRepository.cancel` restored it
-- in Room only. Every cancellation therefore leaked stock on the server: the
-- units came off the catalog and never went back, and the seller's own phone
-- showed a number the store could not sell down to.
--
-- This migration adds the missing half of the pair.

-- ---------------------------------------------------------------------------
-- Stock is returned by a trigger, not by the handler.
--
-- The claim side is already a trigger (026, restored by 041), and the two must
-- agree about what "the stock for this order" means. Splitting them — claim in
-- SQL, release in TypeScript — would let the definitions drift, and a drift
-- between them is silent: it shows up as a stock count nobody can explain.
--
-- Guarded on the transition, not on the value: `WHEN OLD.status <> 'CANCELLED'`
-- means a repeated UPDATE to CANCELLED restores nothing the second time. The
-- handler is idempotent for the same reason, and neither one relies on the
-- other for it.
--
-- The lowercase `end;` terminators are deliberate. Wrangler splits a migration
-- on semicolons and reads an uppercase `END;` as the end of a statement, which
-- cuts the trigger body in half and makes D1 reject the fragment with
-- `incomplete input: SQLITE_ERROR [code: 7500]`. Migrations 026 and 041 use
-- lowercase for exactly this reason. SQLite keywords are case-insensitive.
-- ---------------------------------------------------------------------------

CREATE TRIGGER IF NOT EXISTS trg_orders_release_stock_on_cancel
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
end;

-- ---------------------------------------------------------------------------
-- When the status last moved, so the app can order its own view and a seller
-- can see that something happened even when the state is terminal.
-- ---------------------------------------------------------------------------

ALTER TABLE orders ADD COLUMN status_changed_at TEXT;
