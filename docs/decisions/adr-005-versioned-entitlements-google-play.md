---
status: current
generated: false
owner: backend
applies_to: [production, staging]
---
# ADR-005: Versioned organization entitlements and Google Play verification

- **Status:** Accepted for local implementation; production activation gated
- **Date:** 19 July 2026
- **Change record:** CHG-004

## Context

The legacy seller-scoped plan table mixed prices, limits, and feature booleans,
allowed immediate mutation, and could not safely represent organizations,
custom contracts, renewal-safe changes, or the complete 242-feature comparison.
The Android billing scaffold also could have granted access from unverified
local purchase state.

## Decision

Use stable plan identities (`free`, `paid1`, `paid2`, `paid3`) with immutable
published revisions and typed entitlement values. Resolve access per
organization, then apply active audited overrides. Only implemented features may
be available; only implemented and explicitly admin-configurable definitions may
be edited. Enforce quotas at backend write boundaries with structured errors.

Use Google Play Billing for Android purchase UI and the Play Developer API on
the Worker as the subscription authority. Persist encrypted tokens and hashes,
acknowledge only after the subscription commit, consume RTDN idempotently, and
re-query Google on every lifecycle event. Paid 3 requires sales approval and
complete custom overrides.

## Consequences

- Existing IDs and data remain compatible through explicit legacy mapping and
  `/api/v1/config` projection.
- Published plan history is auditable and restrictive paid changes wait for
  renewal; downgrades block growth without deleting seller data.
- The catalog can describe planned value without falsely exposing it as live.
- Additional schema, admin workflow, reconciliation, secrets, and lifecycle
  tests are required.
- Production remains disabled until the governance freeze and finance, legal,
  security, QA, Play Console, and release gates are satisfied.

## Rollback

Keep `ENTITLEMENTS_ENABLED=false`, `BILLING_ENABLED=false`, and all Play
mappings inactive. The legacy tables and compatibility endpoint remain intact
during the rollout window, so application traffic can stay on the prior path
without deleting the new audit/history data.
