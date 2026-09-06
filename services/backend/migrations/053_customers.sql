-- Customers as a resource the seller can edit, rather than a shape derived from
-- orders.
--
-- WHAT EXISTED BEFORE
--   Nothing. A buyer was two denormalised columns on `orders` — buyer_phone and
--   buyer_name — and the app's customer list was an aggregation over them
--   computed on the device. There was no row to edit, which is why
--   CustomerDetailsScreen had no edit control and no save: the catalogue sold
--   "editable customer profiles" at paid1 while the app had nowhere to put an
--   edit.
--
-- WHY THE KEY IS NOT buyer_phone
--   buyer_phone is not normalised. The storefront's phone input is a bare
--   type="tel" with no pattern and the value is stripped to digits before it is
--   stored, so the column holds any 8-to-15-digit string on earth with no
--   prefix, no country and no plausibility check. `01012345678` and
--   `+201012345678` are the same person and two different strings. A table keyed
--   on the raw value would inherit that split permanently, so identity here is
--   the canonically normalised number — the same normalisation the identity and
--   order systems use (I-6, services/backend/src/domains/identity/phone.ts).
--
-- WHY THERE IS BOTH A KEY AND A RAW VALUE
--   Normalisation has three outcomes, not two. A value that resolves to exactly
--   one E.164 number is safe to merge two spellings of; one that is ambiguous —
--   a bare national number the store's own country does not explain — or plainly
--   invalid is not. Those are preserved verbatim and keyed to themselves, so an
--   unresolvable value can never collide with another customer. Merging on a
--   guess is how two people's order histories become one, and that is not
--   reversible afterwards.
--
-- WHY THIS MIGRATION DOES NOT BACKFILL
--   Classifying a value needs libphonenumber and the store's country, which SQL
--   cannot do. A crude SQL rule would produce exactly the wrong thing: confident
--   merges that nothing could later distinguish from correct ones. The backfill
--   is scripts/backfill-customers.mjs, run deliberately and reporting what it
--   could not resolve.
--
-- SAFE UNDER THE OLD CODE
--   Purely additive: a new table, no column added to an existing one, nothing
--   renamed, dropped or tightened. Migrations apply before Workers deploy, so
--   the previous release serves live traffic against this schema; it does not
--   know this table exists and is unaffected by it.

CREATE TABLE IF NOT EXISTS customers (
  store_id      TEXT NOT NULL,

  -- The identity. The E.164 form when the number resolved; the raw stored value
  -- when it did not, so an unresolvable customer keys only to itself.
  customer_key  TEXT NOT NULL,

  -- Present only when the number resolved. NULL is not missing data — it is the
  -- recorded fact that this value could not be resolved to one number.
  phone_e164    TEXT,

  -- Exactly what was stored on the order. Never rewritten: the admin console
  -- groups and joins on the raw buyer_phone, so the original has to remain
  -- readable beside the normalised form rather than in place of it.
  phone_raw     TEXT NOT NULL,

  -- 'valid' | 'ambiguous' | 'invalid'. A row that is not 'valid' is flagged for
  -- review and must never be merged with another.
  phone_status  TEXT NOT NULL DEFAULT 'valid',

  -- Seller-editable fields. This is the whole point of the table.
  name          TEXT,
  alt_contact   TEXT,
  note          TEXT,

  created_at    TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at    TEXT NOT NULL DEFAULT (datetime('now')),

  PRIMARY KEY (store_id, customer_key),
  CHECK (phone_status IN ('valid', 'ambiguous', 'invalid')),
  -- A resolved row must carry the number it resolved to, and an unresolved one
  -- must not pretend to have resolved. The two columns cannot disagree.
  CHECK ((phone_status = 'valid') = (phone_e164 IS NOT NULL))
);

-- The seller's own list, newest contact first.
CREATE INDEX IF NOT EXISTS idx_customers_store ON customers(store_id, updated_at DESC);

-- Finding the customer behind an order: the order carries the raw value, and
-- this is how a raw value is looked up without re-normalising every row.
CREATE INDEX IF NOT EXISTS idx_customers_raw ON customers(store_id, phone_raw);

-- Everything the backfill could not resolve, for the review the policy requires.
CREATE INDEX IF NOT EXISTS idx_customers_unresolved
  ON customers(store_id, phone_status) WHERE phone_status <> 'valid';
