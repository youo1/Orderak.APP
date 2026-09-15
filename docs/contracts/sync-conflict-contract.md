---
status: current
generated: false
owner: backend
last_verified: 2026-09-14
applies_to: [production, staging]
authoritative_for: [sync-conflict]
---
# Seller Data Authority Contract

**Contract version:** 2

D1 is the system of record. The Android database is a cache of what D1 holds,
plus a small queue of commands that have not reached it yet. Nothing else on the
device is authoritative, and absence from the device is never evidence of
anything.

Version 1 of this contract already said the first half of that. What it could
not say was the second half, because the catalogue still travelled as a mirror —
the device sent the products it held and the server deleted the rest, so absence
*was* evidence, and three guards existed to decide when to believe it. Version 2
records that the mirror is being retired and states the rule that replaces it.

## The three invariants

These outrank everything below. An endpoint table is detail; these are the
contract, and each one is a named test rather than a description.

**Class A — normal CRUD.** Product, Category, Customer.

```text
network failure
  -> the operation fails, visibly
  -> the local database is unchanged
  -> NO pending mutation is created anywhere
server success
  -> the cache is written in ONE transaction
  -> never delete-all-then-insert-each
```

**Class B — financial command.** Order creation, and nothing else today.

```text
network failure
  -> the command is persisted and survives process death
  -> a worker retries it until the server acknowledges it
  -> the drain is INDEPENDENT of any Class A call succeeding
```

**Stock compare-and-set.**

```text
409 stale_stock
  -> the local value is NOT silently replaced by the server's
  -> the conflict is shown, and the seller resolves it explicitly
  -> NO false success, and NO automatic retry
```

Class B is a durable command log, not a sync engine. It replays business intents
in order against one source of truth. It never merges, never resolves a conflict
between two versions that each claim to be correct, and never asks which device
is right — because only one of them is writing.

## Authority by entity

| Entity | Authority | Conflict/retry policy |
|---|---|---|
| Inventory | D1 current stock revision | Client sends `expected_stock_version`; a stale edit returns `409 stale_stock` carrying the authoritative stock and revision. No silent last-write-wins, and no automatic retry with the returned revision — that is last-write-wins wearing a different coat, and it would erase a buyer's decrement. |
| Product metadata | **D1, exclusively** | Android holds a read-through cache with no write authority. Edits are online-only `POST`/`PUT`/`DELETE /api/v1/products`; an offline edit is refused at the screen and never written locally. No per-entity revision is required, because there is no offline write to reconcile. Version 1 promised revisions "before multi-client editing"; that promise is kept by removing the concurrent-edit case rather than versioning it. |
| Orders | D1 append/transition authority | Android pulls by monotonic per-store cursor. Creation carries an idempotency key and may be queued offline. Transitions must reject invalid or stale transitions. |
| Store/profile | D1 | Android writes are server-authoritative. Before multiple seller clients edit concurrently, add `ETag`/revision preconditions. |
| Entitlements/billing | D1 verified snapshot | Clients cache only the last valid snapshot and never grant paid access from a local purchase result. Verification retries are idempotent. |
| Deletion/revocation | D1 lifecycle state | Clients consume server status. **Record-level offline deletion is not supported and will not be added.** `DELETE` is online-only. Physical local absence is never proof, because the local store is never consulted as evidence — which is exactly why no tombstone is needed. Version 1 anticipated tombstones; they are not coming. |
| Device-only records | **The device, and nothing else** | `payments` (`PaymentEntity`) has no server counterpart. It is neither cache nor command: it is local, unsynced, and lost on reinstall or app-data clear. Named here so the "Room is a cache" rule has no undocumented hole. Anything else that wants to live only on a device must be added to this row first. |

## `catalog_version` is a staleness signal, not a decision input

`sellers.catalog_version` advances on catalogue **metadata** writes — create,
replace and delete — and deliberately **not** on stock changes. An order's
trigger already moves stock without touching it, so it has never been a complete
stock-staleness signal, and pretending otherwise would imply a completeness it
does not have. Stock freshness comes from `GET /api/v1/products`, or from the
409 body.

Android may read it to decide **when** to refresh. Android may **never** branch
on it to decide **what is true**. There is no compare-then-reconcile and no
mismatch-triggered merge; the refresh path is unconditionally

```text
GET /api/v1/products -> replace the cache
```

A `catalog_version` that drives reconciliation is a sync engine returning
through the back door.

## The mirror is gone

`POST /api/v1/products/sync` was removed on 2026-09-15. While it was served
alongside the product routes the server was authoritative only for clients using
the new routes: a legacy client that mirrored could still recreate a product a
newer client had deleted. That window is closed, and the qualification with it —
D1 is now authoritative for the catalogue without exception.

It was deleted on evidence rather than on a grep. Route coverage could only prove
that no code in this repository called it, which is a different question from
whether an installed app did; the endpoint therefore announced every call with
the build that made it, and seven days of Workers logs across production and
staging showed none. See
[ADR-012](../decisions/adr-012-server-authoritative-catalogue.md).

### What an app built before the cutover now receives

**`405`, not `404`** — and anyone monitoring for remaining old clients has to
filter on that, or they will see silence and read it as "none left".

The path still matches `isStoreRoute` through `startsWith("/api/v1/products/")`,
so it is recognised, authenticated and tenant-fenced before dispatch reaches it.
Dispatch then reads `sync` as a product code, and a product code serves `PUT` and
`DELETE`; a legacy `POST` lands on the method-not-allowed for those. `PUT` and
`DELETE` on that path reach a handler and answer `404` for a product that does
not exist.

None of them is a mirror, which is the part that matters: an old client's push
fails and the catalogue is untouched, including the empty-payload push that used
to delete everything. Both are asserted in `product-crud.spec.ts` rather than
left as a reading of the routing code.

## Pending-mutation envelope

Every offline-capable write defines a stable client mutation ID, an entity
identifier, an expected server revision where one applies, a creation time for
diagnostics only, a retry classification, and a user-visible terminal conflict.
Device clocks never decide the winning value.

Only Class B operations may use this envelope. Today that is order creation
alone. A Class A operation that acquires a pending-mutation store has stopped
being Class A, and this contract has to change before it does.

Orderak will not introduce a generic automatic merge engine before a concrete
entity needs one. Each entity chooses an explicit policy and tests concurrent
device behaviour.
