-- Make creating a product safe to retry.
--
-- THE DEFECT THIS PREVENTS
--   `POST /api/v1/products` is the only non-idempotent verb in the product API.
--   `PUT` replaces and can be repeated; `DELETE` is idempotent by semantics;
--   stock is protected by compare-and-set, so replaying the same
--   `expected_stock_version` is rejected rather than applied twice. `POST` has
--   nothing, and its failure mode is the classic one:
--
--     device -> POST /products -> D1 commits -> response lost
--     device sees a failure, the seller taps retry, a SECOND product appears
--
--   The catalogue mirror this API replaces did not have the problem, because it
--   sent the whole catalogue keyed by identity: a replay converged. A create
--   endpoint diverges, so it needs the key the mirror got for free.
--
--   The same shape bites the migration itself. A device reconciling rows the
--   mirror never acknowledged cannot tell "never sent" from "sent, response
--   lost" — `productCode` and `remoteUuid` are written together only AFTER the
--   response arrives (Daos.kt), and RetryInterceptor deliberately does not
--   replay the mirror. Without a key, that reconciliation creates duplicates of
--   products the server already has.
--
-- WHY IT COPIES orders
--   `orders` has carried `idempotency_key` since 026, indexed as
--   (store_id, idempotency_key), and `OrderEntity` persists the key it was first
--   posted under so a retry returns the order already written. This is that
--   mechanism for products, deliberately the same shape so there is one pattern
--   to learn rather than two.
--
--   The column is named `client_request_id` rather than `idempotency_key`
--   because it is scoped to a request retry, not to a durable command: the
--   device is not queuing product creates for later, it is repeating one that
--   may already have landed. Orders are Class B and queue; products are Class A
--   and do not. Different lifetimes deserve different names.
--
-- WHY PARTIAL AND NOT NOT-NULL
--   Every product written before this migration has NULL, and the mirror will
--   keep writing NULL for as long as it exists. SQLite treats NULLs as distinct
--   in a UNIQUE index, so those rows never collide with each other — which is
--   the behaviour wanted here and the same reason 026 and 056 wrote their
--   indexes this way. Stating the WHERE makes that intent explicit rather than
--   leaving it to be inferred from NULL semantics.

ALTER TABLE products ADD COLUMN client_request_id TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS products_store_client_request_id
  ON products (store_id, client_request_id)
  WHERE client_request_id IS NOT NULL;
