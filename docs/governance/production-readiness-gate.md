---
status: current
generated: false
owner: governance
last_verified: 2026-09-06
applies_to: [production]
---
# Production readiness gate

Every row must be **yes**, with the named evidence, before production sign-in
opens ([production-auth-cutover.md](../runbooks/production-auth-cutover.md)).

This is deliberately broader than the feature work. It covers the cross-cutting
concerns no single item owns, and it is the reason the last item of the
programme is a three-line configuration change that nonetheless takes longer
than anything before it.

**A row is not closed because the code exists.** It is closed when someone has
looked at the named evidence. Several rows below can only be closed by a person
with a physical device or a Cloudflare account, and are marked accordingly.

## State

| Area | Required proof | State |
|---|---|---|
| **Migrations** | Staging applied and tested. Production applied by the deploy workflow and **verified read-only**. | **Open** — needs `wrangler d1 migrations list orderak-db --remote`. See the note below; this row is not a licence to mutate production |
| **Rollback** | Rehearsed for every irreversible step; 02 and 07b documented as *partially* irreversible | **Partial** — both documented ([auth cutover](../runbooks/production-auth-cutover.md), [billing rollout](../runbooks/play-billing-rollout.md)); neither rehearsed |
| **Backup / restore** | Restore drill against the production database | **Open** — runbook exists, drill unrecorded |
| **Auth** | Physical-device sign-up, sign-in, passkey register, passkey sign-in, wrong-code refusal | **Open** — device only |
| **Billing** | Purchase → server verification → entitlement applied; full 07b matrix | **Open** — needs Play Console setup, then the matrix in the rollout runbook |
| **Sync** | Device A → server → Device B, including the stale and concurrent cases (I-1) | **Code closed, evidence open** — `cross-store-isolation.spec.ts`, `store.spec.ts`; two-device evidence outstanding |
| **Orders** | Offline → sync → server → Device B; failed stock claim leaves no order (I-2) | **Code closed, evidence open** — `order-status.spec.ts`; two-device evidence outstanding |
| **Stock** | Order, cancellation and manual adjustment each write a causal ledger row; reconciliation clean (I-3) | **Closed in code** — `stock-ledger.spec.ts`; `scripts/reconcile-stock.mjs` runs and reports |
| **Entitlements** | Snapshot non-empty on all four plans, engine off **and** on, identical shape (I-4) | **Closed engine-off** — `entitlement-projection.spec.ts`. Engine-on is item 03b and has not been enabled in any environment |
| **Localisation** | Arabic and English verified end to end, RTL included | **Guard holds** — locale parity is enforced in `android-ci.yml`; end-to-end RTL evidence outstanding |
| **Money** | EGP plus one non-2-decimal currency, through the receipt path | **Closed in code** — `money.spec.ts`, `money-wire.spec.ts`, and the Android exponent guard |
| **Cross-store isolation** | A suite proving no seller-facing route crosses a store boundary | **Closed** — `cross-store-isolation.spec.ts` covers the mirror, reads, store-scoped writes and the admin boundary; `customers.spec.ts` covers the customers resource added later |
| **API contract** | Route inventory = OpenAPI = implementation, with the scanner failing closed (I-7) | **Closed** — `pnpm -C contracts/openapi run check`, 100% over 259 operations, scanner fails on an expression it cannot read |
| **Observability** | `SENTRY_DSN` required and present in both environments; Crashlytics proven from a release build; detection responsibility named | **Partial** — see below |
| **Release artifact** | Signed AAB, verified signature, installs and runs | **Pipeline closed, artifact open** — `android-release.yml` builds and verifies the signature; no key material yet |
| **Data integrity** | Reconciliation reports clean on staging | **Open** — the script runs; it has not been run against staging |

## Three rows that need expanding

### Migrations — not a licence to mutate production

Migrations are applied by `wrangler d1 migrations apply --remote` **inside the
deploy workflows**, never by hand. Production sits behind five gates: the
fail-closed freeze (`PRODUCTION_DEPLOYS_ENABLED`), a typed `DEPLOY_PRODUCTION`
plus a 40-character SHA, the `production` GitHub environment, a deploy-owner and
staging-provenance check, and a verified backup under 24 hours old. The workflow
states its own reason: *a Worker rolls back; a dropped column does not.*

So this row is satisfied **read-only**: `wrangler d1 migrations list orderak-db
--remote`, per [d1-migration-drift.md](../runbooks/d1-migration-drift.md) §2,
whose standard of evidence is worth keeping — a single telltale column is not
sufficient evidence that an entire migration ran.

Two caveats to record when closing it. `d1 execute --remote --command "SELECT …"`
is read-only in effect but not enforced as such. And there is precedent for
staging running ahead of production (44/45 in the secret-rotation evidence),
with migration `039b` existing precisely because the ledger said applied while
the tables were not.

**Verify before the launch decision; do not deploy to satisfy a checkbox.**

### Observability — what holds and what does not

More exists than the audit assumed. Sentry is wired in both Workers and in
admin-web, with source-map upload and Workers Logs at 10% head sampling.
`error_logs`, `operational_job_runs` and latency sampling all exist.

`SENTRY_DSN` is now in `secrets.required` for both Workers in both
environments, and `verify-deployment-map.mjs` fails if that is dropped. Before
2026-09-06 it was required nowhere, so Sentry would have no-opped silently if
the secret had never been set — the failure mode of an absent observability tool
is that everything looks quiet.

Whether the secret is actually **set** is an account fact this repository cannot
assert. Confirm with `wrangler secret list` per environment before closing.

On Android, Crashlytics and Performance are forced off in `debug`, and until the
release pipeline landed the only distributed build was `stagingDebug` — so crash
reporting had never been exercised by anyone. Staging distribution now ships
`stagingRelease`, which has it on. A deliberately-triggered non-fatal, arriving
symbolicated, still has to be produced from a real install.

There is **no automated alerting anywhere**. `recordBillingAlert()` writes to D1
and pages nobody. Launching on manual detection is an accepted residual risk
under five conditions recorded in
[incident-response.md](../runbooks/incident-response.md) §2.1. Four hold. The
fifth — *a named person responsible, on a stated cadence* — does not, and it is
the one that matters: the other four only put information somewhere.

### Cross-store isolation — what the suite actually proves

The highest-value case is covered: seller B's `POST /api/v1/products/sync`
payload cannot touch seller A's `store_id`, under any field. That endpoint is
the destructive one, which is why the suite was written alongside item 04.

It also covers a seller credential being refused on `/api/admin/v1/*`, which had
no test before.

Coverage lives in two files rather than one — `cross-store-isolation.spec.ts`
for the mirror, reads, store-scoped writes and the admin boundary, and
`customers.spec.ts` for the customers resource, which was added afterwards. A
new seller-facing route belongs in one of them; the row is closed on the
property, not on the filename.

## What "yes" costs

Nine of the sixteen rows are closed or closed-in-code. The remainder need a
physical device, a Cloudflare account, a Play Console, or a decision about who
is responsible — and none of them can be closed by writing more code, which is
the useful thing this table says.
