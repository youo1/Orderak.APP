-- One subscription per (seller, idempotency key), enforced by the database.
--
-- WHAT EXISTED BEFORE
--   subscribe() read `SELECT * FROM subscriptions WHERE idempotency_key = ? AND
--   seller_id = ?`, returned the row if it found one, and inserted if it did
--   not. Nothing else enforced the rule: migration 002 declared
--   `idempotency_key TEXT`, 009 rebuilt the table and declared it the same way,
--   and no UNIQUE constraint on `subscriptions` exists anywhere in the fifty-five
--   migrations before this one.
--
--   So the check was a read followed by a write with no interlock. Two requests
--   carrying the same key, arriving together, both saw no row and both inserted
--   one. The seller ended up with two subscription rows, and because
--   createOrReplaceSubscription cancels prior active rows before inserting, which
--   of them is "the" subscription depends on the order two concurrent
--   transactions happened to interleave in.
--
--   The charge itself is safe: the gateway takes the same idempotency key and
--   dedupes on it. What was not safe was the record of the charge.
--
-- WHY PARTIAL
--   `idempotency_key` is nullable, and rows written before subscribe() started
--   generating a fallback key have NULL in it. SQLite treats NULLs as distinct
--   in a UNIQUE index, so those rows would not collide anyway — but stating
--   WHERE idempotency_key IS NOT NULL makes the intent explicit rather than
--   relying on that, and matches how 026 indexed orders(store_id,
--   idempotency_key).
--
-- WHY THE DEDUPE STEP IS HERE
--   The index cannot be created while a duplicate pair exists, and a pair can
--   exist: that is the defect. Rather than fail the migration on a database that
--   has hit the race, the older rows of any duplicate group are marked
--   'superseded' and their key cleared, which takes them out of the index
--   without deleting a record of money. The newest row of each group — the one
--   createOrReplaceSubscription's cancel-then-insert leaves active — keeps the
--   key. On a database that never hit the race this updates nothing.

UPDATE subscriptions
   SET status = 'superseded',
       idempotency_key = NULL,
       updated_at = datetime('now')
 WHERE idempotency_key IS NOT NULL
   AND id NOT IN (
     SELECT MAX(id) FROM subscriptions
      WHERE idempotency_key IS NOT NULL
      GROUP BY seller_id, idempotency_key
   );

CREATE UNIQUE INDEX IF NOT EXISTS idx_subscriptions_seller_idempotency
  ON subscriptions(seller_id, idempotency_key)
  WHERE idempotency_key IS NOT NULL;
