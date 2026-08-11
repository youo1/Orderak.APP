-- Order integrity and Firebase deletion support.
--
-- Stock is claimed by this trigger while the order_items INSERT runs inside
-- the same D1 batch as the order header. If any line cannot be fulfilled,
-- RAISE(ABORT) makes D1 roll back the entire batch.
--
-- Lowercase compound terminators are intentional. Wrangler 4.116's remote D1
-- splitter otherwise removes the trigger's required final semicolon and sends
-- incomplete SQL when replaying this historical migration on a fresh database.

ALTER TABLE orders ADD COLUMN idempotency_key TEXT;
CREATE UNIQUE INDEX IF NOT EXISTS idx_orders_store_idempotency
  ON orders(store_id, idempotency_key)
  WHERE idempotency_key IS NOT NULL;

ALTER TABLE sellers ADD COLUMN firebase_uid TEXT;
CREATE INDEX IF NOT EXISTS idx_sellers_firebase_uid ON sellers(firebase_uid);

ALTER TABLE products ADD COLUMN stock_version INTEGER NOT NULL DEFAULT 0;

CREATE TRIGGER IF NOT EXISTS trg_order_items_claim_stock
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
end;
