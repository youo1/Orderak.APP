-- Orderak D1 — Scalable public URL architecture (UUID keys + immutable codes)
-- Run remote: npx wrangler d1 execute orderak-db --remote --file=migrations/009_uuid_public_urls.sql
-- Run local:  npx wrangler d1 execute orderak-db --local  --file=migrations/009_uuid_public_urls.sql
-- Prereq: migration 008 must be applied first (this reads sellers.country_code).
--
-- WHAT THIS DOES
--   1. Converts sellers/products/orders/order_items to TEXT UUID primary keys
--      and remaps every seller/product/order foreign key to the new UUIDs
--      (subscriptions, coupon_uses, referrals, payment_events, support_tickets,
--       ad_impressions). Auxiliary billing/admin ledger tables keep their own
--      INTEGER autoincrement PKs — only their seller FK column moves to UUID.
--   2. Adds the Store Information fields, renames shop_name -> store_name, adds
--      updated_at, and REGENERATES every store_code as an 8-char code.
--   3. Adds a `categories` table with immutable `category_code`.
--   4. Adds `product_code`/`category_id`/`slug`/`description` to products, and
--      `order_no` to orders.
--   5. Preserves all existing rows and relationships.
--
-- SQLite can't ALTER a primary-key type in place, so each converted table is
-- rebuilt (build *_new -> copy with FK remap -> drop old -> rename). The rebuilt
-- tables intentionally omit FOREIGN KEY *constraints*: D1 enforces FKs, and a
-- table rebuild that repoints ids can't satisfy them mid-migration. Referential
-- integrity is enforced in the app/query layer (every public lookup is scoped by
-- store ownership). The UUID *relationships* are fully preserved in the columns.
-- Run once.

PRAGMA defer_foreign_keys = TRUE;

-- ---------------------------------------------------------------------------
-- 0) Materialize a stable UUID on each parent row so children can be remapped.
-- ---------------------------------------------------------------------------
ALTER TABLE sellers  ADD COLUMN uuid TEXT;
ALTER TABLE products ADD COLUMN uuid TEXT;
ALTER TABLE orders   ADD COLUMN uuid TEXT;

UPDATE sellers SET uuid = lower(
  hex(randomblob(4)) || '-' || hex(randomblob(2)) || '-4' || substr(hex(randomblob(2)),2) ||
  '-' || substr('89ab', abs(random()) % 4 + 1, 1) || substr(hex(randomblob(2)),2) ||
  '-' || hex(randomblob(6))) WHERE uuid IS NULL;
UPDATE products SET uuid = lower(
  hex(randomblob(4)) || '-' || hex(randomblob(2)) || '-4' || substr(hex(randomblob(2)),2) ||
  '-' || substr('89ab', abs(random()) % 4 + 1, 1) || substr(hex(randomblob(2)),2) ||
  '-' || hex(randomblob(6))) WHERE uuid IS NULL;
UPDATE orders SET uuid = lower(
  hex(randomblob(4)) || '-' || hex(randomblob(2)) || '-4' || substr(hex(randomblob(2)),2) ||
  '-' || substr('89ab', abs(random()) % 4 + 1, 1) || substr(hex(randomblob(2)),2) ||
  '-' || hex(randomblob(6))) WHERE uuid IS NULL;

-- ---------------------------------------------------------------------------
-- 1) sellers  ->  UUID PK + Store Information fields + fresh 8-char store_code
-- ---------------------------------------------------------------------------
CREATE TABLE sellers_new (
  id                TEXT PRIMARY KEY,                 -- UUID, never exposed publicly
  store_code        TEXT NOT NULL,                    -- 8-char immutable public key
  country_code      TEXT,                             -- ISO-3166 alpha-2
  store_name        TEXT NOT NULL DEFAULT '',         -- was shop_name
  slug              TEXT,
  public_identifier TEXT,                             -- <ISO2>-<slug>-<store_code>
  phone             TEXT NOT NULL UNIQUE,             -- private auth data, never in URLs
  instapay          TEXT,
  vfcash            TEXT,
  secret            TEXT,
  description       TEXT,
  whatsapp          TEXT,
  email             TEXT,
  website           TEXT,
  address           TEXT,
  logo_url          TEXT,
  cover_url         TEXT,
  referral_code     TEXT,
  lang              TEXT NOT NULL DEFAULT 'ar',
  status            TEXT NOT NULL DEFAULT 'active',
  created_at        TEXT DEFAULT (datetime('now')),
  updated_at        TEXT DEFAULT (datetime('now'))
);

INSERT INTO sellers_new (
  id, store_code, country_code, store_name, slug, public_identifier,
  phone, instapay, vfcash, secret, referral_code, lang, status, created_at, updated_at)
SELECT
  uuid,
  substr(upper(hex(randomblob(8))), 1, 8),                 -- regenerate 8-char code
  COALESCE(NULLIF(country_code, ''), 'EG'),
  COALESCE(shop_name, ''),
  slug,
  NULL,                                                    -- public_identifier set below
  phone, instapay, vfcash, secret, referral_code,
  COALESCE(lang, 'ar'), COALESCE(status, 'active'),
  COALESCE(created_at, datetime('now')), datetime('now')
FROM sellers;

UPDATE sellers_new
SET public_identifier =
  country_code || '-' || COALESCE(NULLIF(slug, ''), 'store') || '-' || store_code;

-- ---------------------------------------------------------------------------
-- 2) categories (new)
-- ---------------------------------------------------------------------------
CREATE TABLE categories (
  id            TEXT PRIMARY KEY,                       -- UUID
  store_id      TEXT NOT NULL,                          -- -> sellers.id (UUID)
  category_code TEXT NOT NULL,                          -- "c-XXXXXX", immutable
  name          TEXT NOT NULL,
  slug          TEXT,
  sort_order    INTEGER NOT NULL DEFAULT 0,
  created_at    TEXT DEFAULT (datetime('now')),
  updated_at    TEXT DEFAULT (datetime('now'))
);

-- ---------------------------------------------------------------------------
-- 3) products  ->  UUID PK + product_code + category_id + slug/description
-- ---------------------------------------------------------------------------
CREATE TABLE products_new (
  id             TEXT PRIMARY KEY,                      -- UUID
  store_id       TEXT NOT NULL,                         -- -> sellers.id (was seller_id)
  category_id    TEXT,                                  -- -> categories.id (nullable)
  product_code   TEXT NOT NULL,                         -- "p-XXXXXX", immutable
  app_id         INTEGER,                               -- app-local Room id (sync upsert key)
  name           TEXT NOT NULL,
  slug           TEXT,
  description    TEXT,
  price_piasters INTEGER NOT NULL DEFAULT 0,
  stock          INTEGER NOT NULL DEFAULT 0,
  available      INTEGER NOT NULL DEFAULT 1,
  image_url      TEXT,
  created_at     TEXT DEFAULT (datetime('now')),
  updated_at     TEXT DEFAULT (datetime('now')),
  UNIQUE(store_id, app_id)
);

INSERT INTO products_new (
  id, store_id, category_id, product_code, app_id, name, slug, description,
  price_piasters, stock, available, image_url, created_at, updated_at)
SELECT
  p.uuid, s.uuid, NULL,
  'p-' || substr(upper(hex(randomblob(4))), 1, 6),
  p.app_id, p.name, NULL, NULL,
  p.price_piasters, p.stock, p.available, p.image_url,
  COALESCE(p.created_at, datetime('now')), datetime('now')
FROM products p
JOIN sellers s ON s.id = p.seller_id;

-- ---------------------------------------------------------------------------
-- 4) orders  ->  UUID PK + per-store order_no
-- ---------------------------------------------------------------------------
CREATE TABLE orders_new (
  id             TEXT PRIMARY KEY,                      -- UUID
  order_no       INTEGER,                               -- human display number (per store)
  store_id       TEXT NOT NULL,                         -- -> sellers.id (was seller_id)
  buyer_phone    TEXT NOT NULL,
  buyer_name     TEXT,
  status         TEXT NOT NULL DEFAULT 'NEW',
  pay_method     TEXT NOT NULL DEFAULT 'COD',
  total_piasters INTEGER NOT NULL DEFAULT 0,
  note           TEXT,
  created_at     TEXT DEFAULT (datetime('now'))
);

INSERT INTO orders_new (
  id, order_no, store_id, buyer_phone, buyer_name, status, pay_method,
  total_piasters, note, created_at)
SELECT
  o.uuid,
  (SELECT COUNT(*) FROM orders o2 WHERE o2.seller_id = o.seller_id AND o2.id <= o.id),
  s.uuid, o.buyer_phone, o.buyer_name, o.status, o.pay_method,
  o.total_piasters, o.note, COALESCE(o.created_at, datetime('now'))
FROM orders o
JOIN sellers s ON s.id = o.seller_id;

-- ---------------------------------------------------------------------------
-- 5) order_items  ->  UUID PK + UUID order/product ids
-- ---------------------------------------------------------------------------
CREATE TABLE order_items_new (
  id             TEXT PRIMARY KEY,                      -- UUID
  order_id       TEXT NOT NULL,                         -- -> orders.id
  product_id     TEXT,                                  -- -> products.id (nullable)
  product_name   TEXT NOT NULL,
  qty            INTEGER NOT NULL DEFAULT 1,
  price_piasters INTEGER NOT NULL DEFAULT 0
);

INSERT INTO order_items_new (id, order_id, product_id, product_name, qty, price_piasters)
SELECT
  lower(hex(randomblob(4)) || '-' || hex(randomblob(2)) || '-4' || substr(hex(randomblob(2)),2) ||
    '-' || substr('89ab', abs(random()) % 4 + 1, 1) || substr(hex(randomblob(2)),2) ||
    '-' || hex(randomblob(6))),
  o.uuid, p.uuid, oi.product_name, oi.qty, oi.price_piasters
FROM order_items oi
JOIN orders o ON o.id = oi.order_id
LEFT JOIN products p ON p.id = oi.product_id;

-- ---------------------------------------------------------------------------
-- 6) Auxiliary tables: remap seller FK to UUID (keep their own INTEGER PKs)
-- ---------------------------------------------------------------------------
CREATE TABLE subscriptions_new (
  id                 INTEGER PRIMARY KEY AUTOINCREMENT,
  seller_id          TEXT NOT NULL,
  plan_id            TEXT NOT NULL,
  status             TEXT NOT NULL DEFAULT 'active',
  gateway            TEXT NOT NULL DEFAULT 'mock',
  gateway_sub_id     TEXT,
  amount_piasters    INTEGER NOT NULL DEFAULT 0,
  coupon_code        TEXT,
  idempotency_key    TEXT,
  current_period_end TEXT,
  created_at         TEXT DEFAULT (datetime('now')),
  updated_at         TEXT DEFAULT (datetime('now'))
);
INSERT INTO subscriptions_new
SELECT sub.id, s.uuid, sub.plan_id, sub.status, sub.gateway, sub.gateway_sub_id,
  sub.amount_piasters, sub.coupon_code, sub.idempotency_key, sub.current_period_end,
  sub.created_at, sub.updated_at
FROM subscriptions sub JOIN sellers s ON s.id = sub.seller_id;

CREATE TABLE coupon_uses_new (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  coupon_code     TEXT NOT NULL,
  seller_id       TEXT NOT NULL,
  subscription_id INTEGER,
  applied_at      TEXT DEFAULT (datetime('now')),
  UNIQUE(coupon_code, seller_id)
);
INSERT INTO coupon_uses_new
SELECT cu.id, cu.coupon_code, s.uuid, cu.subscription_id, cu.applied_at
FROM coupon_uses cu JOIN sellers s ON s.id = cu.seller_id;

CREATE TABLE referrals_new (
  id                  INTEGER PRIMARY KEY AUTOINCREMENT,
  referrer_id         TEXT NOT NULL,
  referred_id         TEXT NOT NULL,
  code                TEXT NOT NULL,
  status              TEXT NOT NULL DEFAULT 'pending',
  commission_piasters INTEGER NOT NULL DEFAULT 0,
  created_at          TEXT DEFAULT (datetime('now')),
  qualified_at        TEXT,
  UNIQUE(referred_id)
);
INSERT INTO referrals_new
SELECT r.id, s1.uuid, s2.uuid, r.code, r.status, r.commission_piasters, r.created_at, r.qualified_at
FROM referrals r
JOIN sellers s1 ON s1.id = r.referrer_id
JOIN sellers s2 ON s2.id = r.referred_id;

CREATE TABLE payment_events_new (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  seller_id       TEXT,
  subscription_id INTEGER,
  gateway         TEXT,
  event_type      TEXT NOT NULL,
  amount_piasters INTEGER NOT NULL DEFAULT 0,
  raw_json        TEXT,
  created_at      TEXT DEFAULT (datetime('now'))
);
INSERT INTO payment_events_new
SELECT pe.id, s.uuid, pe.subscription_id, pe.gateway, pe.event_type, pe.amount_piasters,
  pe.raw_json, pe.created_at
FROM payment_events pe LEFT JOIN sellers s ON s.id = pe.seller_id;

CREATE TABLE support_tickets_new (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  seller_id   TEXT,
  subject     TEXT NOT NULL,
  status      TEXT NOT NULL DEFAULT 'open',
  priority    TEXT NOT NULL DEFAULT 'normal',
  assigned_to INTEGER,
  created_at  TEXT DEFAULT (datetime('now')),
  updated_at  TEXT DEFAULT (datetime('now'))
);
INSERT INTO support_tickets_new
SELECT t.id, s.uuid, t.subject, t.status, t.priority, t.assigned_to, t.created_at, t.updated_at
FROM support_tickets t LEFT JOIN sellers s ON s.id = t.seller_id;

CREATE TABLE ad_impressions_new (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  ad_id      INTEGER NOT NULL,
  seller_id  TEXT,
  kind       TEXT NOT NULL DEFAULT 'impression',
  created_at TEXT DEFAULT (datetime('now'))
);
INSERT INTO ad_impressions_new
SELECT ai.id, ai.ad_id, s.uuid, ai.kind, ai.created_at
FROM ad_impressions ai LEFT JOIN sellers s ON s.id = ai.seller_id;

-- ---------------------------------------------------------------------------
-- 7) Swap tables (children first, then parents).
-- ---------------------------------------------------------------------------
DROP TABLE order_items;     ALTER TABLE order_items_new     RENAME TO order_items;
DROP TABLE ad_impressions;  ALTER TABLE ad_impressions_new  RENAME TO ad_impressions;
DROP TABLE support_tickets; ALTER TABLE support_tickets_new RENAME TO support_tickets;
DROP TABLE payment_events;  ALTER TABLE payment_events_new  RENAME TO payment_events;
DROP TABLE referrals;       ALTER TABLE referrals_new       RENAME TO referrals;
DROP TABLE coupon_uses;     ALTER TABLE coupon_uses_new     RENAME TO coupon_uses;
DROP TABLE subscriptions;   ALTER TABLE subscriptions_new   RENAME TO subscriptions;
DROP TABLE orders;          ALTER TABLE orders_new          RENAME TO orders;
DROP TABLE products;        ALTER TABLE products_new        RENAME TO products;
DROP TABLE sellers;         ALTER TABLE sellers_new         RENAME TO sellers;

-- ---------------------------------------------------------------------------
-- 8) Recreate indexes
-- ---------------------------------------------------------------------------
CREATE UNIQUE INDEX idx_sellers_store_code        ON sellers(store_code COLLATE NOCASE);
CREATE UNIQUE INDEX idx_sellers_public_identifier ON sellers(public_identifier COLLATE NOCASE);
CREATE UNIQUE INDEX idx_sellers_slug              ON sellers(slug COLLATE NOCASE);
CREATE INDEX        idx_sellers_phone             ON sellers(phone);
CREATE INDEX        idx_sellers_refcode           ON sellers(referral_code);
CREATE INDEX        idx_sellers_status            ON sellers(status);

CREATE UNIQUE INDEX idx_categories_code       ON categories(category_code COLLATE NOCASE);
CREATE INDEX        idx_categories_store       ON categories(store_id);
CREATE UNIQUE INDEX idx_categories_store_slug ON categories(store_id, slug);

CREATE UNIQUE INDEX idx_products_code   ON products(product_code COLLATE NOCASE);
CREATE INDEX        idx_products_store  ON products(store_id);
CREATE INDEX        idx_products_cat    ON products(category_id);

CREATE INDEX idx_orders_store        ON orders(store_id);
CREATE INDEX idx_orders_status       ON orders(status);
CREATE INDEX idx_order_items_order   ON order_items(order_id);

CREATE INDEX idx_subs_seller       ON subscriptions(seller_id);
CREATE INDEX idx_subs_status       ON subscriptions(status);
CREATE INDEX idx_subs_gateway_sub  ON subscriptions(gateway_sub_id);
CREATE INDEX idx_coupon_uses_code  ON coupon_uses(coupon_code);
CREATE INDEX idx_coupon_uses_sel   ON coupon_uses(seller_id);
CREATE INDEX idx_referrals_refr    ON referrals(referrer_id);
CREATE INDEX idx_referrals_status  ON referrals(status);
CREATE INDEX idx_pay_events_seller ON payment_events(seller_id);
CREATE INDEX idx_tickets_status    ON support_tickets(status);
CREATE INDEX idx_tickets_seller    ON support_tickets(seller_id);
