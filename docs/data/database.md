---
status: current
generated: false
owner: backend
last_verified: 2026-08-21
applies_to: [production, staging]
authoritative_for: [database-topology]
---
# Database topology

Which databases exist, what the tenant key is, and — most importantly — what
D1 does not give you and how this codebase works within that.

For what each migration does, see the
[migration reference](../guides/database-migrations.md). For which Workers bind
which resources, see the
[deployment environment map](../architecture/deployment-environment-map.md).

## Four D1 databases

| Database | Environment | Holds |
| --- | --- | --- |
| `orderak-db` | production | All business data — 119 tables |
| `orderak-geo` | production | Pinned ODbL city catalogue |
| `orderak-db-staging` | staging | Same schema as production |
| `orderak-geo-staging` | staging | Same catalogue |

Binding names are identical across environments — `orderak_db` and
`orderak_geo` — which means **the binding name cannot tell you which
environment you are in.** Wrangler commands must name the database explicitly
and pass `--env`; relying on the binding alone silently resolves to the default.
The comment in `services/backend/wrangler.jsonc` records where that already
caused a problem.

The geo database is separate on purpose: different provenance, different update
cadence, and ODbL attribution obligations that should not be entangled with
business data in backup and restore. See
[catalog](../domains/catalog.md#geography).

## Staging and production are on different schemas right now

> **Measured 2026-08-21 against both live databases.** Staging is at migration
> `044`. Production is at `043`. This is the single place that fact is
> recorded; other documents point here rather than repeating it.

| | Staging | Production |
| --- | --- | --- |
| Latest migration | `044_money_minor_units_with_currency.sql` | `043_audit_signing_key_version.sql` |
| Money columns | `*_minor` | `*_piasters` |
| `currency` column | Present | **Absent** |

Migration 044 merged to `main` in `6cc7410` and reached staging automatically on
the merge, under the pre-2026-08-24 model in which `main` was the Staging
trigger. That branch is now `staging`. Production deploys are
`workflow_dispatch` only — gated by the automated checks in
`production-deploy.yml`, not by a required reviewer, which is unavailable on
this plan and withdrawn as a plan — so it has not run; production was last
deployed on 2026-08-17.

**What this means when reading the rest of the documentation.** Money columns
are described by their post-044 names, because that is what the code in `main`
expects and what the next production deploy will create. Until that deploy
runs, a query written against production must still use `total_piasters`,
`price_minor` does not exist there, and there is no `currency` column to read.

This skew closes the moment production deploys. It is recorded rather than
smoothed over because a document that says "money has a currency column" is
wrong in production today, and someone debugging a production query needs to
know that before they trust it.

## The tenant key

The tenant is the **organization**. `organization_routing` maps
`organization_id` to a `shard_key`, a `routing_version`, and a
`migration_state`.

Today every organization routes to `shard_key = 'primary'`, which is the single
physical database. `resolveTenantContext` in
`services/backend/src/platform/tenancy/tenant-routing.ts` throws
`tenant_shard_unavailable` for anything else — the shape is in place, the second
shard is not.

`migration_state` is a write fence. `requireTenantWrite` throws
`TenantWriteFencedError` (with a 30-second retry hint) while a tenant is
`write_fenced` or `copying`, which is what lets a tenant be moved without losing
writes. The procedure is the
[tenant shard migration runbook](../runbooks/tenant-shard-migration.md); the
reasoning is [ADR-007](../decisions/adr-007-shard-ready-single-d1.md).

Note that most business tables key on `seller_id` or `store_id`, which are the
same value; the organization sits above them. See
[identity](../domains/identity.md#one-table-two-meanings).

## What D1 does not give you

**There is no interactive transaction.** You cannot `BEGIN`, read, decide, write
and `COMMIT` across round trips. This is the single most important constraint in
the data layer and it shapes every correctness-critical write path in the
backend.

What is available:

- `db.batch([...])` — a set of prepared statements applied **atomically**. All
  of them land or none do.
- Ordinary SQL constraints — unique indexes, checks, foreign keys.
- Conditional `UPDATE ... WHERE`, whose `changes()` count tells you whether it
  applied.

### The three patterns this codebase uses

Every place that needs atomicity uses one of these. Prefer them to
read-then-write, which is a race in every case.

**1. Make the limit check part of the write.** The update only touches the row
if the condition still holds, and `changes() > 0` is the answer:

```sql
UPDATE entitlement_usage_counters SET used = used + ?
WHERE organization_id = ? AND entitlement_key = ? AND period_start = ?
  AND used + ? <= ?
```

Two concurrent requests at the boundary cannot both win, because only one can be
the statement that moved the row.
([entitlements](../domains/entitlements.md#usage-reservation))

**2. Let a constraint be the arbiter, then retry.** Per-store order numbers are
computed as `MAX + 1`, which races. The unique index is authoritative: on a
duplicate the code recomputes once and retries the whole batch. Safe precisely
*because* a failed batch is atomic — nothing was written, so no stock was
decremented twice. ([orders](../domains/orders.md#order-numbers-and-the-race-that-shaped-them))

**3. Make the write idempotent.** `INSERT OR IGNORE` keyed on a natural
idempotency key turns an at-least-once delivery path into an exactly-once
record — used for ad impressions and for the conditional single-row activation
of a design-system revision.

If you find yourself wanting a transaction, you want one of these three.

## Read replication

`orderak-geo` reads use `withSession("first-unconstrained")`, permitting a read
from any replica without a consistency constraint. City names do not change
mid-session, so the latency is free.

> **Read replication is not enabled by the wrangler config.** It is not a
> binding field — wrangler ignores it and warns about unexpected fields. It must
> be enabled per database from the Cloudflare dashboard or REST API, and the
> `withSession` calls only take effect once it is.

Business data in `orderak_db` does **not** use unconstrained reads.

## Other storage

| Store | Used for |
| --- | --- |
| R2 `orderak-media` | Product images, logos, uploaded files |
| R2 `orderak-admin-audit` | Signed audit archives ([admin control plane](../domains/admin-control-plane.md#audit-signed-and-archived)) |
| Queues | `orderak-play-billing`, `orderak-email`, `orderak-admin-exports`, each with a dead-letter queue |
| Durable Object | `RateLimiter`, a SQLite-backed class on the public Worker only |
| **Workers KV** | **Not used.** No `kv_namespaces` binding exists in any config. |

KV is called out explicitly because it is the Cloudflare primitive people assume
is present. Configuration and cache-like state live in the `settings` table and
in module-level isolate caches instead.

Durable Objects are used for coordination only — rate limiting. **They are not a
database here**, and order, product, payment and account data all live in D1.

## Backup and restore

Backups run from `.github/workflows/d1-backup.yml` into R2, encrypted with age,
and restore is rehearsed by `.github/workflows/restore-drill.yml`. Both use
GitHub Environments with required reviewers.

Recovery — including decryption, index and trigger rebuild, and the FTS5 caveat
— is the [D1 restore runbook](../runbooks/d1-restore.md). Diagnosing a
divergent migration ledger is the
[D1 migration drift runbook](../runbooks/d1-migration-drift.md); never mutate
the ledger without a backup and explicit approval.

## Related

- [ADR-001 — Cloudflare Workers and D1](../decisions/adr-001-cloudflare-workers-d1.md)
- [ADR-007 — Shard-ready single D1](../decisions/adr-007-shard-ready-single-d1.md)
- [Migration reference](../guides/database-migrations.md)
- [D1 restore runbook](../runbooks/d1-restore.md)
- [Tenant shard migration runbook](../runbooks/tenant-shard-migration.md)
- [Deployment environment map](../architecture/deployment-environment-map.md)
