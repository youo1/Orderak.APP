# Seller Sync and Conflict Contract

**Contract version:** 1

Local databases are operational caches and pending-mutation stores. D1 remains
authoritative for identity, account state, entitlements, accepted legal
versions, public orders, and reconciled inventory.

| Entity | Authority | Conflict/retry policy |
|---|---|---|
| Inventory | D1 current stock revision | Client sends `expected_stock_version`; stale edits return `409 stale_stock` and current mappings. No silent last-write-wins. |
| Product metadata | Seller mirror with D1 public identity | Sync is idempotent by stable local/public identity. A future partial-edit API must add per-entity revisions before multi-client editing. |
| Orders | D1 append/transition authority | Android pulls by monotonic per-store cursor. Order creation uses an idempotency key; state transitions must reject invalid/stale transitions. |
| Store/profile | D1 | Current Android writes are server-authoritative. Before multiple seller clients edit concurrently, add `ETag`/revision preconditions. |
| Entitlements/billing | D1 verified snapshot | Clients cache only the last valid snapshot and never grant paid access from a local purchase result. Verification retries are idempotent. |
| Deletion/revocation | D1 lifecycle state | Clients consume server status. Future record-level offline deletion requires tombstones rather than physical local absence as proof. |

## Pending-mutation envelope

Every new offline-capable write should define a stable client mutation ID,
entity identifier, expected server revision when applicable, creation time for
diagnostics only, retry classification, and a user-visible terminal conflict.
Device clocks never decide the winning value.

Orderak will not introduce a generic automatic merge engine before a concrete
entity needs one. Each entity chooses an explicit policy and tests concurrent
device behavior.
