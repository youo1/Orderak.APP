---
status: current
generated: false
owner: backend
last_verified: 2026-08-21
applies_to: [production, staging]
authoritative_for: [entitlements-domain]
---
# Entitlements domain

What a store is allowed to do, who decides, and which of the two systems that
answer that question is currently in charge.

> **Runtime state: `ENTITLEMENTS_ENABLED` is `false` in production and staging.**
> The v2 policy engine described below is implemented but not the live answer.
> Limits are currently served by the legacy path.

## The naming trap, first

Two identifiers in this domain mean something other than what they say. Getting
this wrong produces code that looks correct and queries the wrong scope.

- **`seller_id` is a store id.** The `sellers` table created in
  `services/backend/migrations/001_init.sql` is the stores table under its
  original name. `getPlanLimit(env, sellerId, key)` passes that value straight
  into `getIntegerEntitlement(env, storeId, key)` — same value, two names.
- **The tenant is the organization, not the seller and not the store.** A store
  belongs to exactly one organization via `organization_stores`; an organization
  may hold several stores. Usage, overrides, and subscriptions are all keyed on
  `organization_id`.

`services/backend/src/domains/identity/identity.ts` creates the whole shell
atomically when a store registers: a row in `organizations` (with the new store
as `owner_store_id`), `organization_stores` with `is_primary=1`,
`organization_members` with `role='owner'`, and `organization_routing`. Tenant
resolution and shard state live in
`services/backend/src/platform/tenancy/tenant-routing.ts`, which is keyed on
`organization_id` throughout.

Entitlement usage is therefore **organization-wide**, not per store. A merchant
with three stores draws down one monthly order allowance across all of them.

## Two systems, one router

There are two complete plan systems in the schema. Which one answers depends on
`ENTITLEMENTS_ENABLED`.

| | Legacy (live today) | v2 (built, flagged off) |
| --- | --- | --- |
| Resolver | `domains/commerce/plan-limits.ts` | `domains/commerce/entitlements.ts` |
| Entry point | `getPlanLimit(env, sellerId, key)` | `resolveEntitlements(env, storeId)` |
| Scope | Per store | Per organization |
| Tables | `plans`, `plan_features`, `subscriptions`, `subscription_plans` | `plan_revisions`, `plan_revision_entitlements`, `entitlement_definitions`, `organization_subscriptions`, `organization_entitlement_overrides`, `entitlement_usage_counters`, `entitlement_usage_reservations` |
| Versioning | None — plans are mutable | Immutable revisions with pending/effective dating |
| Usage metering | None | Calendar-month counters with reservations |

`getPlanLimit` is the router. When `ENTITLEMENTS_ENABLED === "true"` it
delegates to the v2 engine. Otherwise it reads the legacy join:

```sql
SELECT p.<key> FROM subscriptions s JOIN plans p ON p.id = s.plan_id
WHERE s.seller_id = ? AND s.status = 'active' AND p.active = 1
ORDER BY s.id DESC LIMIT 1
```

and falls back to hard-coded Free defaults when no active subscription exists:

| Key | Free default |
| --- | --- |
| `max_categories` | 5 |
| `max_products` | 20 |
| `max_orders_per_month` | 50 |
| `max_ai_requests_per_month` | 20 |

These constants live in `FREE_LIMITS` in `plan-limits.ts`. They are the limits
actually in force in production today.

### The second fallback

Even inside the v2 engine there is a further retreat. `resolveEntitlements`
calls `resolveSubscriptionContext`, and when that returns nothing — or when a
query fails with a missing table or column, detected by `isMissingV2Schema` —
it returns `legacySnapshot(env, storeId)`. That reconstructs a v2-shaped
snapshot from the legacy tables.

So a caller always receives an `EntitlementSnapshot`, and the shape of the
response never tells you which system produced it. When debugging a wrong
limit, establish which path ran before reading further.

## The v2 snapshot

`EntitlementSnapshot` is the backend-authoritative answer for one store:
`plan_revision_id`, `plan_version`, `subscription_status`,
`current_period_end`, any `pending_revision_id` with its effective date, and a
map of `EffectiveEntitlement` keyed by entitlement key.

Each entitlement carries a `mode` — `value`, `disabled`, `unlimited`, or
`custom_required` — alongside its typed value, current `used`, `remaining`, and
`reset_at`. Resolution joins `entitlement_definitions` to
`plan_revision_entitlements` for the store's revision, then `COALESCE`s an
active row from `organization_entitlement_overrides` over the top. An override
counts only while it is unrevoked, already effective, and not expired.

The snapshot carries an `etag` derived from a hash of its version material, so
clients can revalidate cheaply.

`projectEntitlementsForAndroid` filters the map down to entries whose
`implementation_status` is `implemented`, and rehashes the etag. Android never
sees `partial` or `planned` entitlements — the backend decides what the client
is allowed to know about.

## Usage reservation

Calendar-month allowances such as AI requests are consumed through
`reserveUsage(env, storeId, key, delta, idempotencyKey)`.

The interesting part is how it stays correct without an interactive
transaction. D1 does not offer one, so the limit check *is* the write. Inside a
single `batch`, a conditional update only touches the counter row when the
allowance permits it:

```sql
UPDATE entitlement_usage_counters SET used = used + ?
WHERE organization_id = ? AND entitlement_key = ? AND period_start = ?
  AND used + ? <= ?
  AND EXISTS (SELECT 1 FROM entitlement_usage_reservations
              WHERE id = ? AND status = 'reserved')
```

A following statement then marks the reservation `committed` when
`changes() > 0` and `voided` otherwise. Two concurrent requests at the boundary
cannot both succeed, because only one of them can be the update that moved the
row.

Other properties:

- **Idempotent.** A repeated `idempotency_key` returns the existing
  reservation's outcome — `committed` allows, `voided` denies — without
  double-charging.
- **Seeded from truth for orders.** `max_orders_per_month` seeds its counter by
  counting real rows in `orders` joined through `organization_stores` for the
  current month, then takes `MAX(used, excluded.used)`. A missing counter
  cannot hand out a fresh month's allowance.
- **`unlimited` skips metering entirely**, and a store with no
  `organization_id` falls back to a non-transactional `remaining` comparison.
- **Release is explicit.** `voidUsageReservation(reservationId)` decrements the
  counter with a `MAX(0, used - delta)` floor and marks the reservation voided.
  It is a no-op unless the reservation is currently `committed`.

## Denial responses

Two helpers produce the refusals, and they are not interchangeable:

- `entitlementDenied` — the entitlement is unavailable or requires a custom
  arrangement.
- `entitlementLimitReached` — the entitlement exists but the allowance is
  exhausted. Returns `409` with `entitlement_key`, `limit`, `used`, and
  `remaining`.

The legacy path has its own `limitReached` in `plan-limits.ts`, also `409`,
also carrying `entitlement_key`. The wire shapes were deliberately aligned so
clients need not know which system answered.

## Boundaries

- **Taking payment** is the [billing domain](./billing.md), separately flagged.
  Entitlements decide what is permitted; billing decides what was bought.
- **Publishing plan revisions, approving plans, and writing overrides** are
  administrator operations in
  `services/backend/src/domains/admin/admin-entitlements.ts`. That is the
  write side of the same tables and belongs to the admin control plane, which
  is not yet documented.
- **The API surface** for entitlements is in the
  [API reference](../reference/api.md); this page explains the model, not the
  routes.

## Related

- [Billing domain](./billing.md)
- [ADR-005 — Versioned entitlements and Google Play](../decisions/adr-005-versioned-entitlements-google-play.md)
- [ADR-007 — Shard-ready single D1](../decisions/adr-007-shard-ready-single-d1.md)
- [Tenant shard migration runbook](../runbooks/tenant-shard-migration.md)
- [Generated migration reference](../guides/database-migrations.md)
