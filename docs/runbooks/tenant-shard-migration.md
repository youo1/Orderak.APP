# Tenant shard migration runbook

**Current revision:** 1.0

**Status:** rehearsal-only; no customer migration is authorized

## Revision history

| Revision | Date | Change | Evidence |
|---|---|---|---|
| 1.0 | 2026-07-22 | Initial pre-production procedure | Not yet rehearsed |

Corrections found in rehearsal one must be committed as a newer runbook
revision before rehearsal two starts. Rehearsal two records that exact commit
and revision; repeating revision 1.0 does not satisfy the gate.

## Preconditions

- Name the source/target shard, organization, routing versions, operator, and
  rollback owner in a copy of the evidence template.
- Confirm both shard schemas/migration ledgers match and backups are restorable.
- Confirm all tenant writes pass `TenantContext`; no seller/public synchronous
  fan-out exists.
- Establish RTO, maximum permitted write interruption, checksum method, and an
  observation/rollback window before fencing.

## Procedure

1. Set `migration_state=write_fenced`, record reason/time, increment the routing
   version, and verify new writes return retryable `tenant_write_fenced` with
   `Retry-After` while reads remain available.
2. Snapshot/copy every tenant-owned table in dependency order. Keep global
   identity, routing, security, plan, circuit, budget, and conflict ledgers on
   the global database.
3. Record per-table source/target row counts and deterministic checksums. Verify
   foreign keys and application references, including memberships,
   subscriptions, purchases, entitlements, orders/items, usage, support data,
   and billing-job organization references.
4. Catch up tenant outbox/events created before the fence. Record the final
   cursor and prove no unprocessed source event precedes it.
5. Atomically flip `shard_key`, clear the target marker, increment the routing
   version, and enter `observing`. Do not un-fence until target reads and writes
   pass smoke checks.
6. Remove the write fence, measure interruption/RTO, and observe error rate,
   latency, queues, stale routes, billing generations, and reconciliation.
7. If any acceptance check fails, re-fence, drain target changes, route back to
   the source at a newer routing version, validate counts/checksums, and record
   the rollback result. Never reuse an older routing version.
8. Close only when evidence is stored, findings have owners, and no unresolved
   data-integrity item remains.

## Required rehearsals

1. A synthetic staging organization under concurrent catalog, order,
   entitlement, subscription, and active billing-job writes.
2. An Orderak-owned production test organization, using a newer committed
   runbook revision that incorporates rehearsal-one corrections.

Customer migration stays blocked until both pass and their evidence is reviewed.

## Evidence

Use [`tenant-shard-migration-rehearsal-template.md`](../governance/evidence/tenant-shard-migration-rehearsal-template.md).
Store source/target routing versions, commit, checksums, write interruption,
elapsed time/RTO, outbox catch-up, rollback outcome, and unresolved findings.
