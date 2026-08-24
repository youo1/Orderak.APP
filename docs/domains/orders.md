---
status: current
generated: false
owner: backend
last_verified: 2026-08-22
applies_to: [production, staging]
authoritative_for: [orders-domain]
---
# Orders domain

How an order is created, what state it can be in, and why the public order
endpoint is the most carefully defended route in the backend.

## There is no cart

Orders are created in one shot. A buyer submits a complete list of items to
`handleCatalogOrder` in `services/backend/src/domains/catalog/catalog.ts` and
either gets an order or gets a refusal. There is no `carts` table, no
multi-step checkout, and no payment authorization in this path — the order
records what was agreed, and payment happens out of band by the method the
store supports.

A seller can also create an order from the Android app. Both paths write the
same rows.

## Tables

`orders` and `order_items`. Ownership is `store_id`, renamed from `seller_id`
by migration `009_uuid_public_urls.sql`, so orders use the newer name while
older tables still say `seller_id` for the same value.

Money is `total_minor` on the order and `price_minor` on each item, plus a
`currency` column added by migration `044`. **Production has not received 044
yet** and still uses `total_piasters` with no currency column — see
[schema skew](../data/database.md#staging-and-production-are-on-different-schemas-right-now). Item rows carry `product_name` as
written at the time — a **snapshot**, so renaming a product later does not
rewrite history.

## Status

`NEW → CONFIRMED → PAID → SHIPPED → DONE`, with `CANCELLED` reachable only
from `NEW` or `CONFIRMED`. `DONE` and `CANCELLED` are terminal.

The machine is defined twice, deliberately. The client copy is
`apps/seller-android/app/src/main/java/app/orderak/seller/domain/OrderStatus.kt`
as an explicit `next` transition plus a `canCancel` predicate; the server copy
is the transition table in `PATCH /api/v1/orders/{id}/status`. They must agree,
and the server one is authoritative — the app writes its own row first for
responsiveness, so a client that skips `PAID` or revives a cancelled order has
to be refused rather than believed. Every order is created as `NEW`.

### Advancing an order

`PATCH /api/v1/orders/{id}/status` moves one order, scoped by `store_id` in the
same statement that reads it — a stranger gets `404`, not `403`, because the
difference would confirm the id exists. An illegal move is `409` and changes
nothing. Requesting the status an order already holds is `200` with
`changed: false`, so a client retrying a dropped response converges instead of
being shown an error for work that landed. The `UPDATE` is conditional on the
status that was read, so two devices racing the same order cannot both apply a
transition.

**Cancelling returns the stock.** `trg_orders_release_stock_on_cancel`
(migration `046`) fires on the transition into `CANCELLED` and adds each line's
`qty` back. It is guarded on `OLD.status <> 'CANCELLED'`, so a repeat restores
nothing a second time.

The release is a trigger because the claim is a trigger. Splitting them — claim
in SQL, release in TypeScript — would let two definitions of "the stock for this
order" drift, and that drift is silent: it surfaces as a stock count nobody can
explain.

#### What this replaced

Until 2026-08-22 no route accepted a status change. `OrderRepository.markPaid`
and `.cancel` wrote to the Android Room database and stopped, so the server held
every order at `NEW` forever and a reinstall replayed a pipeline the seller had
already worked through.

The cancel half was worse than cosmetic. Placing an order decrements stock
through `trg_order_items_claim_stock`; cancelling restored it in Room only. Every
cancellation therefore leaked stock on the server — the units came off the
catalog and never went back, and the seller's own phone showed a number the
store could not sell down to.

### Payment methods disagree between client and server

The Android enum lists `VF_CASH`, `INSTAPAY`, `FAWRY`, `COD`.

The public order path offers `COD` always, adds `VF_CASH` only when the store
has a `vfcash` value, and `INSTAPAY` only when it has an `instapay` value. It
**never** offers `FAWRY`, and rejects it with `payment_unavailable`.

So `FAWRY` exists in the client enum and is unreachable through this endpoint.
Treat it as reserved, not supported.

## The public order path

`handleCatalogOrder` is a **public, unauthenticated `POST` that writes rows and
decrements stock.** Every defence below exists because of that sentence, and
none should be removed without replacing it.

In order:

1. **Tenant resolution and write fence.** `resolveTenantContextForStore` then
   `requireTenantWrite`. During a shard migration the tenant is fenced and the
   write is refused with a retry hint rather than landing in the wrong place.
2. **Store capability.** `orders.accepting` must be enabled, or `403
   orders_disabled`. A seller can close their store without deleting it.
3. **Idempotency.** An `Idempotency-Key` header matching
   `^[A-Za-z0-9._:-]{8,100}$` is used; anything else is replaced with a fresh
   UUID. A prior order with the same `(store_id, idempotency_key)` returns the
   original result instead of creating a second one.
4. **Rate limit.** 5 orders per minute per IP per store. Without it a single
   client could zero a store's inventory and flood the seller's app.
5. **Monthly order allowance.** With `ENTITLEMENTS_ENABLED` off, a pre-check
   counts this month's orders against `max_orders_per_month`. With it on,
   `reserveUsage` reserves atomically instead — see
   [entitlements](./entitlements.md#usage-reservation).
6. **Input bounds.** Buyer phone 8–15 digits; 1–50 line items; quantity a
   positive integer no greater than 999 and never above available stock.
7. **Buyer restrictions.** When `BUYER_PRIVACY_PEPPER` is set, the buyer phone
   is keyed-hashed and checked against `buyer_restrictions`. A blocked buyer
   gets `403 buyer_restricted`. **The raw phone is never used as the lookup
   key** — the block list stores hashes, so it cannot be read back as a list of
   phone numbers.
8. **Duplicate products** in one request are rejected outright.
9. **Stock re-validated at line build.** If any line no longer fits available
   stock, the whole request fails with `409 stock_changed` rather than
   partially succeeding.

### Order numbers, and the race that shaped them

`order_no` is a small per-store human number, not a UUID — sellers read it
aloud. It is computed as `MAX + 1`, which races under concurrency.

The resolution is that **the unique index from migration 015 is authoritative,
not the computation.** On a duplicate-key failure the code recomputes once and
retries the whole batch. That is safe because a failed D1 batch is atomic:
nothing was written, so no stock was decremented twice by the retry.

This is the same pattern as the entitlement counter — where an interactive
transaction is unavailable, let a constraint or a conditional write be the
arbiter and handle the loss, rather than reading-then-writing and hoping.

## Buyers are derived, not stored

**There is no `customers` table.** The Android app's Customers screen is an
aggregation over `orders.buyer_phone` — `CustomerSummary` is keyed by phone,
built from order history, and has no row of its own.

This is worth stating plainly because the app has a Customers screen and the
word appears throughout product discussion, which makes a `customers` entity
easy to assume. A buyer exists only as the phone number and name recorded on
the orders they placed, and `buyer_name` is a per-order snapshot, so the same
person may appear under different names on different orders.

Two tables do hold buyer-related state, and both belong to the **admin control
plane** rather than to sellers — they were created by migration
`028_admin_control_plane.sql`:

- `buyer_restrictions` — platform-level blocks, matched by keyed hash, optionally
  scoped to one store and optionally expiring.
- `buyer_privacy_requests` — buyer-initiated privacy requests.

A seller cannot write either one.

## Boundaries

- **Products, prices and stock definitions** are the [catalog domain](./catalog.md).
- **Order allowances** are set by [entitlements](./entitlements.md); this domain
  consumes them.
- **Taking payment** is the [billing domain](./billing.md), which is currently
  closed. Nothing in the order path charges anyone — `pay_method` records an
  intention, and settlement happens between buyer and seller directly.
- **Buyer identity and privacy requests** touch `buyer_privacy_requests` and
  `buyer_restrictions`; the customers domain is not yet documented.
- **Sync and conflict rules** between the Android app and the backend are the
  [sync/conflict contract](../contracts/sync-conflict-contract.md), which is
  authoritative over this page on that subject.

## Related

- [Catalog domain](./catalog.md)
- [Entitlements domain](./entitlements.md)
- [Sync and conflict contract](../contracts/sync-conflict-contract.md)
- [ADR-009 — Minor units with explicit currency](../decisions/adr-009-minor-units-with-explicit-currency.md)
- [API reference](../reference/api.md)
