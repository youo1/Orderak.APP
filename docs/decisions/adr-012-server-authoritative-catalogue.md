---
status: current
generated: false
owner: governance
applies_to: [production, staging]
---
# ADR-012: The catalogue is server-authoritative, and the device holds a cache

**Status:** accepted

**Date:** 2026-09-14

**Supersedes:** none

**Superseded by:** none

## Context

The seller app wrote its catalogue by mirroring it. `POST /api/v1/products/sync`
took the complete set of products the device held, and the server deleted
whatever the payload omitted. That single decision — **absence means deletion** —
produced every defect the mirror has:

- A store with fewer than ten products skips the bulk-deletion confirmation
  entirely, so an empty push carrying a valid baseline wipes it silently. This is
  not an oversight: `store.spec.ts` asserts it, in a case named "lets a device
  with a current baseline delete the last product". Hardening the mirror would
  have meant arguing with a passing test that encodes the intent.
- `adoptServerCatalog` is upsert-only, so a second device resurrects products the
  first one deleted.
- No dirty flag protects name, price or description, so a `stale_catalog` 409
  discards the second device's edits.

Three guards exist solely to decide when absence can be believed: a
download-before-push baseline, a catalogue version check, and a bulk-deletion
confirmation. They are not a design; they are the cost of a shape that cannot
distinguish *"the seller deleted this"* from *"this device has not looked yet."*

Meanwhile categories, customers and orders already travelled as ordinary REST and
had none of these problems. Only products were different.

## Decision

**D1 is the system of record. The Android database is a cache, plus a queue of
commands that have not reached D1 yet.** The mirror is retired in stages, and
every write becomes one of exactly two things.

**Class A — normal CRUD.** Product, Category, Customer. Online-only. A network
failure fails visibly, leaves the local database unchanged, and creates no
pending mutation anywhere. On success the cache is written in one transaction.

**Class B — financial command.** Order creation, and nothing else today. The
command is persisted locally, survives process death, and a worker retries it
until the server acknowledges it. Its drain is independent of any Class A call
succeeding.

The boundary between them is one question: **does losing this write cost the
seller money?** A product edit that fails can be retyped in ten seconds. A sale
taken at a market stall with no signal cannot be recovered at all, because the
buyer has gone. That is the whole basis for the split, and it is why the list of
Class B operations is one item long and should stay that way.

Four rules follow, and each exists because the obvious alternative quietly
rebuilds what we are removing:

1. **A durable command log is not a sync engine.** It replays intents in order
   against one source of truth. It never merges and never reconciles two
   versions each claiming to be correct, because only one side writes.
2. **`stock_version` compare-and-set is retained.** It is concurrency control
   against overselling, not sync machinery, and it must not be deleted with the
   rest. A 409 is surfaced to the seller with both numbers; it is never retried
   automatically with the returned revision, which would be last-write-wins in a
   different coat and would erase a buyer's decrement.
3. **`catalog_version` is demoted to a staleness signal.** It advances on
   metadata writes and not on stock, because an order's trigger already moves
   stock without touching it. Android may use it to decide *when* to refresh,
   never to decide *what is true*.
4. **No tombstones, ever.** Deletion is an explicit online call. Local absence is
   never evidence, so there is nothing for a tombstone to disprove. Introducing
   one would restore exactly the ambiguity this ADR removes.

`app_id` remains only as legacy compatibility for apps built against the mirror.
`product_code` is the identity.

## Consequences

**What gets better.** Multi-device correctness stops being a feature to build and
becomes a property of the shape: the resurrection and lost-edit defects cannot
occur when only the server writes. The entire class of destructive-mirror risk
disappears rather than being guarded. Deletion becomes honest. Limits are
enforced at the point of write instead of being reconciled afterwards. A large
amount of code — baseline storage, push decisions, adoption merges, dirty flags,
bulk-deletion confirmation — is deleted rather than maintained.

**What gets worse, and is accepted.** Offline product, category and customer
edits stop working; they fail visibly instead. Every write becomes a round trip,
which is unremarkable on wifi and noticeable on a weak connection. During the
migration window the server is authoritative only for clients on a CRUD-capable
build, because a legacy client can still mirror.

**What the team must do.** The three invariants in the data authority contract
are acceptance tests, not prose — each is a named test that fails loudly. A
static guard enforces the *boundary* (which files may write a DAO); unit tests
enforce the *value* (that a cache writer is only ever handed a server response).
Those are different questions, and a guard that claimed to answer the second
would be advertising a guarantee it cannot deliver.

**A guard with a deliberate expiry.** The build-time guard forbids a list of
symbol names — `CatalogPushDecision`, `adoptServerCatalog`, `stockDirty`,
`baseline_version` and the rest. That is the weaker form of guard: it depends on
implementation names rather than architectural properties. It is right *now*,
because during the migration the concrete risk is someone reintroducing one of
those exact symbols. Once the architecture has settled, each line should migrate
to a property the cache-write-boundary guard can express — *"no product mutation
path writes Room directly"* is stronger than *"no class named X"*. This paragraph
exists so that list is retired deliberately rather than accumulating forever.

**Payments remain a third class.** `PaymentEntity` has no server counterpart: it
is local, unsynced, and lost on reinstall. The contract names it so the "Room is
a cache" rule has no undocumented hole. Whether payments belong in Orderak at all
is a separate decision this ADR does not make.

## Alternatives considered

**Harden the mirror.** Lower the bulk-deletion floor, add dirty flags for
metadata, make adoption remove as well as upsert. Rejected: each fix addresses
one symptom of *absence means deletion* while leaving the premise in place, and
the floor is asserted by a passing test, so "fixing" it means deciding that test
was wrong. The premise is the defect.

**Full bidirectional sync with tombstones, vector clocks and merge policies.**
Rejected as the most expensive way to solve a problem we do not have. It would
require per-entity revisions, tombstone lifecycle and retention, a conflict
resolution policy per field, and multi-device merge tests — to support offline
editing of data that one person edits on one phone. The cost is permanent and
the benefit is hypothetical.

**Pure cache with no offline writes at all.** Simplest of the three, and rejected
for one reason: a seller at a market stall with no signal could not record a
sale. Orderak targets low-end devices in places where connectivity is not
guaranteed, and losing a sale is not the same kind of loss as losing a product
edit. The order outbox already existed and already worked, so keeping it cost
nothing and dropping it would have been a real regression.

**Keep offline writes for products and customers too.** Rejected because each
queued domain needs its own conflict rule on replay, and three such rules is a
merge engine with extra steps — which is the thing this ADR exists to avoid.
