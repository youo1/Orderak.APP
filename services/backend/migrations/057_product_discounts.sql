-- Give a product's discount somewhere to live on the server.
--
-- WHAT EXISTED BEFORE
--   `ProductEntity` has carried `discountType` and `discountValue` since the
--   Room schema was first written (apps/seller-android/.../data/db/Entities.kt),
--   and nothing on this side has ever known about them. The catalogue mirror
--   binds thirteen columns and none of them is a discount, so a value set on a
--   phone stayed on that phone and no buyer ever saw it.
--
--   In practice no value was ever set. The editor round-trips whatever the row
--   already held (`discountType = existing?.discountType`) and the controls that
--   would write a new one are unreachable — `onDiscountType` and
--   `onDiscountValue` have no caller in any screen. The comment above that line
--   names the precondition exactly:
--
--     "Hidden until backend and public catalog share one discount contract."
--
--   This migration is the backend half of that contract.
--
-- WHY INTEGER AND NOT REAL
--   ADR-009: money is integer minor units with an explicit currency, and
--   floating-point is not revisited. The Android column is a `Double?`, which is
--   the shape the rule exists to forbid, so the server does not copy it.
--
--   One integer column carries both kinds, and the type column says how to read
--   it. There is no data to convert, so the contract is chosen rather than
--   inherited:
--
--     discount_type = 'PERCENTAGE'  ->  discount_value is BASIS POINTS
--                                       1000 = 10.00%, 250 = 2.50%
--     discount_type = 'AMOUNT'      ->  discount_value is MINOR UNITS
--                                       of the product's own currency
--     discount_type IS NULL         ->  discount_value must be NULL
--
--   Basis points rather than whole percent because "7.5% off" is an ordinary
--   thing for a seller to want and an integer percent cannot express it. Two
--   decimal places is the same precision minor units already give money.
--
-- WHY THE CHECKS ARE WORTH THE BYTES
--   The pair is only meaningful together. A type with no value renders nothing;
--   a value with no type cannot be interpreted at all, and a later reader would
--   have to guess. Both halves are asserted here rather than in application
--   code, because this table is written from more than one path and a rule that
--   lives in one of them is not a rule.
--
--   The percentage ceiling is 10000 (100.00%). A discount larger than the price
--   is not a discount; it is a refund, and this column is not how a refund is
--   recorded.
--
--   `stock_movements` is untouched: a discount changes what a buyer pays, never
--   how many units exist.

ALTER TABLE products ADD COLUMN discount_type TEXT;
ALTER TABLE products ADD COLUMN discount_value INTEGER;

-- Enforced with triggers rather than a CHECK or a partial index.
--
-- SQLite cannot add a CHECK to an existing table without the twelve-step
-- recreate, and `products` is the busiest table in the schema with the 052
-- trigger set attached to it. Rebuilding it to police two nullable columns that
-- hold nothing in every existing row is a large risk bought for a small
-- guarantee.
--
-- A partial UNIQUE index over a constant expression looks like it would work and
-- does not: it makes the SECOND violating row collide, while the first is
-- admitted. A constraint that allows one bad row is not a constraint.
--
-- Triggers are what 052 already uses on this table, and they reject every
-- violating write. The condition is repeated across INSERT and UPDATE because
-- SQLite has no shared constraint body; the two must be changed together.
CREATE TRIGGER IF NOT EXISTS trg_products_discount_valid_insert
BEFORE INSERT ON products
WHEN (NEW.discount_type IS NULL) <> (NEW.discount_value IS NULL)
  OR (NEW.discount_type IS NOT NULL AND NEW.discount_type NOT IN ('PERCENTAGE', 'AMOUNT'))
  OR (NEW.discount_value IS NOT NULL AND NEW.discount_value < 0)
  OR (NEW.discount_type = 'PERCENTAGE' AND NEW.discount_value > 10000)
BEGIN
  SELECT RAISE(ABORT, 'invalid_discount');
END;

CREATE TRIGGER IF NOT EXISTS trg_products_discount_valid_update
BEFORE UPDATE OF discount_type, discount_value ON products
WHEN (NEW.discount_type IS NULL) <> (NEW.discount_value IS NULL)
  OR (NEW.discount_type IS NOT NULL AND NEW.discount_type NOT IN ('PERCENTAGE', 'AMOUNT'))
  OR (NEW.discount_value IS NOT NULL AND NEW.discount_value < 0)
  OR (NEW.discount_type = 'PERCENTAGE' AND NEW.discount_value > 10000)
BEGIN
  SELECT RAISE(ABORT, 'invalid_discount');
END;
