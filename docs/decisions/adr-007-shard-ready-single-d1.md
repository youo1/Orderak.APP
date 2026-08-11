# ADR-007: Shard-ready tenant boundary on one D1 database

**Status:** accepted; physical sharding deferred until measured

**Date:** 2026-07-22

## Context

One D1 database is appropriate before launch, but authentication, billing,
catalog, order, and operational workloads must not remain coupled to a database
binding that cannot later be routed. Worker edge placement and D1 primary
placement are separate concerns. Read replication can reduce eligible read
latency; it does not scale primary writes.

## Decision

Every organization has an `organization_routing` row. `TenantContext` resolves
that logical route and currently maps only `shard_key=primary` to `orderak_db`.
Tenant-owned request writes must pass the context's write-fence check. Seller and
public request paths may never synchronously fan out across shards.

Table ownership is explicit:

- **Global:** seller authentication identities, organization routing, admin
  authentication/RBAC, plan definitions, feature controls, Play account and
  token-conflict directories, provider circuits/budgets, and audit/security
  indexes.
- **Tenant-owned:** catalogs, orders, organization memberships, entitlements,
  subscriptions, purchases, metered usage, and organization support data.

Future cross-organization work includes admin statistics/store counts,
buyer/subscription/support exports, finance reporting, reconciliation,
retention/deletion enumeration, AI usage totals, and cross-organization
fraud/token-reuse detection. It is handled as follows:

- One-organization operations route directly.
- Exports and maintenance use queued, checkpointed, bounded-concurrency shard
  scans and merge private-R2 artifacts.
- Real-time uniqueness, security conflicts, Play routing, and global provider
  budgets use compact global ledgers.
- Dashboards read materialized summaries, never request-time scatter queries.

## Physical-shard trigger

Add a shard only when measured write contention, capacity, recovery objectives,
or failure-isolation SLOs justify it. Customer count alone is not a trigger.
Before any customer move, complete both rehearsals in the versioned
[`tenant-shard-migration.md`](../runbooks/tenant-shard-migration.md) runbook.

## Consequences

The current topology stays operationally simple while tenant writes already
have a routing and fence boundary. Global-ledger availability becomes a
dependency after physical sharding, and cross-shard reports become asynchronous
by design.
