-- 041: restore database-level referential integrity to the commerce tables.
--
-- WHY
--   Migration 009 rebuilt sellers/categories/products/orders/order_items to
--   move them onto UUID primary keys, and deliberately dropped every FOREIGN
--   KEY constraint while doing so ("Referential integrity is enforced in the
--   app/query layer"). That was a reasonable expedient mid-rebuild and an
--   unreasonable end state: application checks do not protect against admin
--   operations, repair scripts, cron jobs, imports, partial deployments, or a
--   future bug. Orders and order items are authoritative commerce records.
--
--   Verified against production before writing this: all five tables carry
--   zero FOREIGN KEY and zero CHECK constraints.
--
--   This migration also restores idx_orders_store_orderno. Migration 015 is
--   recorded as applied in d1_migrations, but the unique index it creates is
--   absent from production. Nothing in migrations/ drops it and nothing
--   rebuilds `orders` after 015, so the cause is unexplained drift — but the
--   consequence is concrete: without it, two concurrent buyer orders can be
--   assigned the same order_no, which (per 015's own note) silently breaks the
--   Android sync cursor. IF NOT EXISTS makes restoring it safe either way.
--
-- SAFETY
--   SQLite cannot add constraints in place, so each table is rebuilt
--   (create _new -> copy -> drop -> rename) and every index is recreated
--   afterwards. Rebuild order is parents-before-children so each FOREIGN KEY
--   references a table that already exists in its final form.
--
--   Run the orphan diagnostics in docs/runbooks/d1-restore.md against a copy
--   before applying to an environment that holds real data: this migration
--   will fail rather than silently discard rows if any child references a
--   missing parent. That failure is the point.
--
-- DELIBERATELY NOT DONE
--   No CHECK on orders.status or orders.pay_method. 'NEW' is the only value
--   that appears anywhere in the worker, the Android client, or the OpenAPI
--   contract, so any enum written here would be a guess, and a wrong guess
--   rejects valid writes in production. Add one when the state machine is
--   actually specified.

PRAGMA defer_foreign_keys = TRUE;

-- ---------------------------------------------------------------------------
-- Triggers must come down first.
--
-- trg_order_items_claim_stock lives on order_items but reads and writes
-- products. Dropping products while it still exists makes the trigger
-- reference a missing table, and the migration fails with
--   "error in trigger trg_order_items_claim_stock: no such table: main.products"
-- Rebuilding order_items would drop it anyway, so it is removed here and
-- recreated verbatim at the end, once every table is in its final shape.
-- ---------------------------------------------------------------------------
DROP TRIGGER IF EXISTS trg_order_items_claim_stock;

-- ---------------------------------------------------------------------------
-- categories -> sellers
-- ---------------------------------------------------------------------------
CREATE TABLE categories_new (
  id            TEXT PRIMARY KEY,
  store_id      TEXT NOT NULL,
  category_code TEXT NOT NULL,
  name          TEXT NOT NULL,
  slug          TEXT,
  sort_order    INTEGER NOT NULL DEFAULT 0,
  created_at    TEXT DEFAULT (datetime('now')),
  updated_at    TEXT DEFAULT (datetime('now')),
  -- A store's categories are meaningless without the store.
  FOREIGN KEY (store_id) REFERENCES sellers(id) ON DELETE CASCADE
);

INSERT INTO categories_new (id, store_id, category_code, name, slug, sort_order, created_at, updated_at)
SELECT id, store_id, category_code, name, slug, sort_order, created_at, updated_at FROM categories;

DROP TABLE categories;
ALTER TABLE categories_new RENAME TO categories;

CREATE UNIQUE INDEX idx_categories_code       ON categories(category_code COLLATE NOCASE);
CREATE INDEX        idx_categories_store      ON categories(store_id);
CREATE UNIQUE INDEX idx_categories_store_slug ON categories(store_id, slug);

-- ---------------------------------------------------------------------------
-- products -> sellers, categories
-- ---------------------------------------------------------------------------
CREATE TABLE products_new (
  id             TEXT PRIMARY KEY,
  store_id       TEXT NOT NULL,
  category_id    TEXT,
  product_code   TEXT NOT NULL,
  app_id         INTEGER,
  name           TEXT NOT NULL,
  slug           TEXT,
  description    TEXT,
  price_piasters INTEGER NOT NULL DEFAULT 0,
  stock          INTEGER NOT NULL DEFAULT 0,
  available      INTEGER NOT NULL DEFAULT 1,
  image_url      TEXT,
  created_at     TEXT DEFAULT (datetime('now')),
  updated_at     TEXT DEFAULT (datetime('now')),
  stock_version  INTEGER NOT NULL DEFAULT 0,
  UNIQUE(store_id, app_id),
  -- Money and stock are never negative; `available` is a boolean flag.
  CHECK (price_piasters >= 0),
  CHECK (stock >= 0),
  CHECK (available IN (0, 1)),
  FOREIGN KEY (store_id)    REFERENCES sellers(id)    ON DELETE CASCADE,
  -- Deleting a category must not delete the products in it.
  FOREIGN KEY (category_id) REFERENCES categories(id) ON DELETE SET NULL
);

INSERT INTO products_new (id, store_id, category_id, product_code, app_id, name, slug, description,
                          price_piasters, stock, available, image_url, created_at, updated_at, stock_version)
SELECT id, store_id, category_id, product_code, app_id, name, slug, description,
       price_piasters, stock, available, image_url, created_at, updated_at, stock_version FROM products;

DROP TABLE products;
ALTER TABLE products_new RENAME TO products;

CREATE UNIQUE INDEX idx_products_code  ON products(product_code COLLATE NOCASE);
CREATE INDEX        idx_products_store ON products(store_id);
CREATE INDEX        idx_products_cat   ON products(category_id);

-- ---------------------------------------------------------------------------
-- orders -> sellers
-- ---------------------------------------------------------------------------
CREATE TABLE orders_new (
  id              TEXT PRIMARY KEY,
  order_no        INTEGER,
  store_id        TEXT NOT NULL,
  buyer_phone     TEXT NOT NULL,
  buyer_name      TEXT,
  status          TEXT NOT NULL DEFAULT 'NEW',
  pay_method      TEXT NOT NULL DEFAULT 'COD',
  total_piasters  INTEGER NOT NULL DEFAULT 0,
  note            TEXT,
  created_at      TEXT DEFAULT (datetime('now')),
  idempotency_key TEXT,
  CHECK (total_piasters >= 0),
  -- RESTRICT, not CASCADE: orders are commerce records, so removing a store
  -- must be an explicit decision that deletes them first. The account-deletion
  -- flow already deletes orders before touching the seller row (and in fact
  -- anonymises the seller in place rather than deleting it), so this
  -- constraint fences accidental paths without blocking the intended one.
  FOREIGN KEY (store_id) REFERENCES sellers(id) ON DELETE RESTRICT
);

INSERT INTO orders_new (id, order_no, store_id, buyer_phone, buyer_name, status, pay_method,
                        total_piasters, note, created_at, idempotency_key)
SELECT id, order_no, store_id, buyer_phone, buyer_name, status, pay_method,
       total_piasters, note, created_at, idempotency_key FROM orders;

DROP TABLE orders;
ALTER TABLE orders_new RENAME TO orders;

CREATE INDEX idx_orders_store  ON orders(store_id);
CREATE INDEX idx_orders_status ON orders(status);
CREATE UNIQUE INDEX idx_orders_store_idempotency
  ON orders(store_id, idempotency_key)
  WHERE idempotency_key IS NOT NULL;
-- Restored: see the note at the top of this file.
CREATE UNIQUE INDEX IF NOT EXISTS idx_orders_store_orderno ON orders(store_id, order_no);

-- ---------------------------------------------------------------------------
-- order_items -> orders, products
-- ---------------------------------------------------------------------------
CREATE TABLE order_items_new (
  id             TEXT PRIMARY KEY,
  order_id       TEXT NOT NULL,
  product_id     TEXT,
  product_name   TEXT NOT NULL,
  qty            INTEGER NOT NULL DEFAULT 1,
  price_piasters INTEGER NOT NULL DEFAULT 0,
  CHECK (qty > 0),
  CHECK (price_piasters >= 0),
  -- A line item cannot outlive its order.
  FOREIGN KEY (order_id)   REFERENCES orders(id)   ON DELETE CASCADE,
  -- A deleted product must not erase order history; product_name is
  -- denormalised onto the line for exactly this reason.
  FOREIGN KEY (product_id) REFERENCES products(id) ON DELETE SET NULL
);

INSERT INTO order_items_new (id, order_id, product_id, product_name, qty, price_piasters)
SELECT id, order_id, product_id, product_name, qty, price_piasters FROM order_items;

DROP TABLE order_items;
ALTER TABLE order_items_new RENAME TO order_items;

CREATE INDEX idx_order_items_order ON order_items(order_id);

-- ---------------------------------------------------------------------------
-- Restore the stock-claim trigger, verbatim from the pre-migration schema.
--
-- Its qty <= 0 guard is now also enforced by CHECK (qty > 0) on the table, so
-- a non-positive quantity is rejected whether or not a product is linked.
--
-- The lowercase `end;` terminators are deliberate and must stay lowercase.
-- Wrangler splits a migration into statements on semicolons and treats an
-- uppercase `END;` as the end of a statement, so an uppercase trigger body is
-- cut in half and D1 rejects the fragment with:
--   incomplete input: SQLITE_ERROR [code: 7500]
-- Migration 026, which created this same trigger, uses lowercase for exactly
-- this reason. SQLite keywords are case-insensitive, so the trigger is
-- identical either way.
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
end;
