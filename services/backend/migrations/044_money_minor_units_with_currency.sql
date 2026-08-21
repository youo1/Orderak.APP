-- ADR-009: money is an amount in minor units plus an explicit currency.
--
-- `_piasters` names a unit that only exists in Egypt and asserts an exponent of
-- 2. Kuwait, Bahrain and Oman use 1000 minor units per major unit, so a column
-- named `price_piasters` holding fils is wrong in the schema itself, and every
-- `/ 100` reading it is wrong by a factor of ten rather than by a rounding
-- error. See docs/decisions/adr-009-minor-units-with-explicit-currency.md.
--
-- WHY NOW
--   There are no users and no live money rows, so `DEFAULT 'EGP'` backfills
--   correctly by construction rather than by assumption. That property is gone
--   the day a second currency exists, and this becomes a migration of live
--   financial records instead of a rename.
--
-- WHY RENAME AND NOT REBUILD
--   Earlier migrations in this directory rebuild tables through a `_new` copy,
--   which is the twelve-step SQLite procedure required for changes SQLite
--   cannot do in place. A column rename is not one of those: ALTER TABLE
--   RENAME COLUMN and ADD COLUMN ... NOT NULL DEFAULT were both verified
--   against D1 on 2026-08-21 and succeed. A rebuild here would take on the
--   rebuild's risks — dropped indexes, lost foreign keys, a partially written
--   copy — to accomplish something the simpler statement already does.
--
-- WHERE CURRENCY IS AND IS NOT ADDED
--   Once per owning entity, never once per amount. `order_items` derives its
--   currency from its parent `orders` row: giving it a column of its own
--   creates a pair that can disagree, and a disagreement between an order and
--   its line items is not detectable after the fact.
--
--   `items` is a dead table. No query in services/backend/src reads or writes
--   it; `products` superseded it. Its column is renamed so the schema stays
--   internally consistent, but no currency column is added to a table nothing
--   uses. Dropping it is a separate decision from this one.

-- ---------------------------------------------------------------------------
-- 1. Amount columns: the unit stops being part of the name.
-- ---------------------------------------------------------------------------

ALTER TABLE affiliate_settings RENAME COLUMN min_payout_piasters TO min_payout_minor;
ALTER TABLE items             RENAME COLUMN price_piasters      TO price_minor;
ALTER TABLE order_items       RENAME COLUMN price_piasters      TO price_minor;
ALTER TABLE orders            RENAME COLUMN total_piasters      TO total_minor;
ALTER TABLE payment_events    RENAME COLUMN amount_piasters     TO amount_minor;
ALTER TABLE plans             RENAME COLUMN price_piasters      TO price_minor;
ALTER TABLE products          RENAME COLUMN price_piasters      TO price_minor;
ALTER TABLE referrals         RENAME COLUMN commission_piasters TO commission_minor;
ALTER TABLE subscriptions     RENAME COLUMN amount_piasters     TO amount_minor;

-- ---------------------------------------------------------------------------
-- 2. Currency, once per owning entity.
--
--    `plans` already carries one from 002_billing.sql and is left alone.
--    `order_items` inherits from `orders` and deliberately gets none.
-- ---------------------------------------------------------------------------

ALTER TABLE affiliate_settings ADD COLUMN currency TEXT NOT NULL DEFAULT 'EGP';
ALTER TABLE orders             ADD COLUMN currency TEXT NOT NULL DEFAULT 'EGP';
ALTER TABLE payment_events     ADD COLUMN currency TEXT NOT NULL DEFAULT 'EGP';
ALTER TABLE products           ADD COLUMN currency TEXT NOT NULL DEFAULT 'EGP';
ALTER TABLE referrals          ADD COLUMN currency TEXT NOT NULL DEFAULT 'EGP';
ALTER TABLE subscriptions      ADD COLUMN currency TEXT NOT NULL DEFAULT 'EGP';
