---
status: current
generated: false
owner: backend
last_verified: 2026-09-06
applies_to: [staging, production]
---
# Opening Google Play billing

How `BILLING_ENABLED` and `GOOGLE_PLAY_LIFECYCLE_ENABLED` are turned on, in
what order, and what has to be true first. Staging only, until every row of the
matrix below has a recorded result.

This is not the dead-letter runbook. For recovering a verification job that has
already failed, see [play-billing-dlq.md](play-billing-dlq.md).

## Why this is a release, not a config change

Two flags, both one-line edits. Behind them sits a subsystem that has never run
against Google: token verification, an encrypted purchase-token store, a queue
with leases and reclaims, RTDN handling, refund and revocation paths, and a
dead-letter queue. None of it has been exercised outside the test suite.

The failure mode is also unusual for this repository. A purchase is money the
seller has already paid. If verification fails after the charge, the entitlement
never arrives and the seller has paid for nothing — and **rollback does not undo
it**. Turning the flags back off stops new purchases; it does not refund the
ones already made, and the entitlements they bought must still be honoured.

So: staging first, the whole matrix, then production as a separate decision.

## Before anything is flipped

Run the preflight. It is read-only and changes nothing:

```bash
node services/backend/scripts/play-billing-preflight.mjs --remote --env staging
```

It checks the things that fail quietly:

- the five Play credentials `google-play.ts` reads at runtime, none of which
  are in wrangler's `secrets.required` and so none of which anything proves are
  set
- the six `play_product_mappings` rows, their plan foreign keys, and the package
  name on each
- `settings.billing_enabled`, the D1 runtime control that can veto the
  environment flag independently
- that every active plan has a **published** revision
- any pre-existing dead-lettered jobs, which would hide the first real failure

A blocker means stop. The script exits non-zero.

### The two gates

`BILLING_ENABLED=true` is necessary and not sufficient. `handleBillingRoutes`
requires the environment flag **and** `settings.billing_enabled` in D1, compared
as `JSON.parse(value_json) === true`. That comparison is stricter than it looks:
the JSON string `"true"` is not the boolean `true`, so a row set that way reads
as disabled and the flag flip appears to do nothing, silently. The preflight
checks the stored bytes rather than whether the word appears.

### External prerequisites

None of these can be done from this repository, and all of them must be done
first:

1. **Play Console products** — `orderak_paid1`, `orderak_paid2`,
   `orderak_paid3`, each with `monthly` and `annual` base plans, priced, and
   active. The product ids must match `play_product_mappings.product_id`
   exactly; the mappings are already seeded and inactive.
2. **Service account** with Android Publisher access, granted permissions on
   those specific products.
3. **Pub/Sub topic and push subscription** for RTDN, with the OIDC audience and
   service-account email that `GOOGLE_PLAY_PUBSUB_*` expect.
4. **Package name match** — the mappings say `app.orderak.seller`, and the
   signed build's `applicationId` must equal it. Note the staging flavour
   applies `applicationIdSuffix = ".staging"`, so a staging build is
   `app.orderak.seller.staging` and needs its own Play entry or a production
   package build pointed at staging.
5. **A signed build** in a Play testing track. See
   [android-release.md](../guides/android-release.md) — a purchase cannot be
   tested from a locally-installed APK.

## Order of operations

1. Preflight clean.
2. Set the five Play secrets on staging (`wrangler secret put`, per secret).
3. Add them to `secrets.required` for the staging environment in
   `wrangler.jsonc`, **in the same change that enables billing** and not before
   — declaring them required while billing is off would fail every staging
   deploy for credentials the environment does not use.
4. `GOOGLE_PLAY_LIFECYCLE_ENABLED=true` first, alone. Lifecycle handling covers
   RTDN, reconciliation, refunds and revocations. Enabling it before purchases
   are possible means the machinery is running and observable before anything
   depends on it.
5. Watch for one full day. `error_logs`, `operational_job_runs`, and the queue
   health panel under **Commerce → Purchase verification**.
6. Activate the mappings for one product only — start with `orderak_paid1`,
   monthly. One product proves the path; six multiply the ways a first attempt
   can fail.
7. `BILLING_ENABLED=true` and `settings.billing_enabled` to the boolean `true`.
8. Work the matrix.
9. Activate the remaining mappings once the matrix passes for the first.

## The test matrix

Every row needs a recorded result before production is considered. A row that
cannot be produced is recorded as such, with the reason — an untested row is not
a passing row.

### Purchase

| Case | Expected |
|---|---|
| new purchase | verified server-side, plan changes, entitlement snapshot reflects it |
| duplicate purchase token | second attempt is a no-op, one subscription |
| pending purchase | no entitlement until it resolves |
| failed purchase | no plan change, no partial state |
| cancelled by user before completion | no plan change |
| refunded after grant | entitlement revoked on the RTDN |
| subscription expired | access ends at the authoritative period end, not before |
| subscription renewed | period extends, no second subscription row |

### Verification

| Case | Expected |
|---|---|
| valid token | accepted |
| invalid token | refused, no entitlement |
| already-used token | refused as reused, security conflict recorded |
| wrong product id | refused, mapping does not resolve |
| wrong package name | refused |
| wrong account | refused, cross-organization conflict recorded, **not** requeued until Security confirms |
| wrong environment (staging token against production, or the reverse) | refused |

### Queue

| Case | Expected |
|---|---|
| job succeeds | terminal `succeeded`, entitlement applied |
| job retries | attempt count rises, backoff respected, eventually succeeds |
| job dead-letters | reaches `dead_lettered`, visible in the console |
| manual retry from the console | requeued with an audited reason, child job created, parent can produce only one |

### The two locks that must stay shut

| Case | Expected |
|---|---|
| the client claims a purchase without server verification | refused — the server is the only authority (BR-509) |
| a direct gateway checkout on production | refused — no real gateway exists, and `gatewayCanCharge` must keep saying so (BR-512) |

The second is the one worth being deliberate about. `gatewayCanCharge` returns
true on any non-production environment, so a staging test cannot demonstrate
that production refuses. Check it by reading the code path and the production
environment value, not by inference from a staging run.

## Rollback

**Partial only.**

Setting `BILLING_ENABLED=false` closes new acquisition. It does not refund
purchases already made, and the entitlements those purchases bought must
continue to be honoured — a seller who paid yesterday does not lose their plan
because the flag moved today.

Keep `GOOGLE_PLAY_LIFECYCLE_ENABLED=true` after any real purchase, so RTDN,
reconciliation, refunds, revocations, restore and acknowledgement keep working
for the purchases that exist. Do not deactivate mappings that are needed to
interpret an existing purchase.

**Do not open production billing before the dead-letter screen exists.** It
does now — **Commerce → Purchase verification** — but the reason stands: the
recovery path for a seller who has paid and received nothing must not run
through a terminal.

## What this rollout does not cover

Prices. `/api/v1/plans` returns what each plan includes and deliberately carries
no price: Play owns what a seller pays, in their own currency, and a second
number from the backend would disagree the moment Google applies a regional
price or a promotion.
