---
status: current
generated: false
owner: backend
last_verified: 2026-09-23
applies_to: [production]
---

# Lifting the production freeze

> **Status:** Planned production release, not a recovery procedure
>
> **Owner:** Engineering lead
>
> **Rule:** This catches production up on code and schema. It does not, by
> itself, open production to real users — sign-in stays gated by
> `ONBOARDING_ENABLED`/`PASSKEY_ENABLED` per
> [production-auth-cutover.md](production-auth-cutover.md), and the
> entitlements engine stays off in production. Treat those as separate
> decisions; do not let this deploy carry them along by accident.

## What this runbook assumes — verify before acting, do not trust this section

Facts below were true as of `last_verified`. Re-check every one immediately
before dispatch; several are time-sensitive.

- Production has been frozen since 2026-08-24 by `PRODUCTION_DEPLOYS_ENABLED`
  in `.github/workflows/production-deploy.yml` — the gate fails closed when
  the repository variable is unset.
- The last successful **Deploy Production** run was 2026-08-16, deploying
  `21bd46e56aafb9058ca03bb1e0a6f2ab3ce0f5b9`. No `production/*` git tag exists
  for it despite that run succeeding — nothing durable records it as the
  released commit except this runbook.
- Production's last **applied** migration is `043` (stated by migration
  `059`'s own header). Migrations `044`–`059` — 16 files — have never touched
  production.
- `origin/main` at last check: `e5aef03ad55fba86aa08bd3448afce68a338223`,
  223 commits (137 non-merge) ahead of the live commit.
- Staging provenance for that main tip is already satisfied: `ad5ccb6`
  (main's second parent) deployed to staging successfully on
  2026-09-22T03:54, and migrations `044`–`059` have been running on staging
  since 2026-09-15 with no reported rollback.
- **D1 Backup is currently broken.** Scheduled runs on 09-19 through 09-22
  show `cancelled` with zero jobs executed; the 09-23 run sat `pending` for
  over an hour. Deploy Production hard-requires a *successful* D1 Backup run
  within the last 24 hours — right now there is none, and the workflow will
  refuse to run until this is fixed.
- **The D1 Backup Restore Drill is stale.** Last success: 2026-08-16, before
  any of the 16 pending migrations existed.

## 1. Fix the two infrastructure blockers first

Nothing past this point matters until both are green.

1. **D1 Backup.** Diagnose why scheduled runs are getting cancelled with no
   jobs (runner capacity, or something stuck in the `d1-backup` concurrency
   group holding the queue). Get one clean successful run.
2. **Restore Drill.** Dispatch `d1-restore-drill.yml` against current `main`
   and confirm it succeeds. A drill that only proves the old schema restores
   is not evidence the new one does.

## 2. Lock in a rollback anchor

Tag the commit currently live in production, now, before touching anything
else:

```bash
git tag production/2026-08-16T1211Z 21bd46e56aafb9058ca03bb1e0a6f2ab3ce0f5b9
git push origin production/2026-08-16T1211Z
```

Without this, "what's live right now" exists only in this document.

## 3. Confirm the mechanics

- Confirm `DEPLOY_OWNER` and `PRODUCTION_DEPLOYS_ENABLED` in
  Settings → Actions → Variables directly — they could not be read via the
  API in the session that drafted this runbook.
- Confirm production secrets haven't rotated or expired since 2026-08-16:
  `ORDERAK_DEPLOY_PRODUCTION`, `FIREBASE_WEB_API_KEY`, the TOTP/audit
  signing key (moved to v2 in the last live commit itself).

## 4. Migration safety

### 4a. What's already enforced automatically — don't redo this by hand

`services/backend/scripts/verify-migrations.mjs`
runs in both Backend CI and Deploy Production. It requires any migration that
renames, drops, or rebuilds a table to carry a
`-- rollout: expand-contract` marker stating *why the previous Worker still
works* against the changed schema during the gap between migrations applying
and the new Worker deploying (production-deploy.yml migrates first, deploys
second). Every one of the 16 pending migrations already passed this gate at
merge time — that part of the review the ChatGPT draft asked for is already
mechanical, not manual.

What it does **not** do: re-verify that the assumption a migration's author
made weeks ago is still true today (e.g., "zero live rows"). That's what the
rehearsal below is for.

### 4b. Rehearsal: prove it against a real copy, not staging's data

1. Restore the backup from step 1 into a **disposable** database — never the
   live one — per [d1-restore.md §3](d1-restore.md).
2. Apply migrations `044`–`059` against that copy.
3. Run the invariant checks in the table below against it.
4. Only dispatch once every check passes on the disposable copy.

### 4c. Per-migration invariant table

| # | Migration | Type | Precheck |
|---|---|---|---|
| 044 | money_minor_units_with_currency | renames 9 columns, adds `currency` (DEFAULT 'EGP') | Author's premise (2026-08-21): zero live money rows. Re-run `SELECT count(*)` on `orders`, `products`, `subscriptions`, `payment_events`, `referrals`, `affiliate_settings` against the disposable copy — must still be ~0, or the default backfill is wrong by assumption, not by construction. |
| 045 | unique_referral_code | UNIQUE INDEX | File supplies the exact duplicate-detection query and remediation. Run it first. |
| 046 | order_status_transitions | 2 triggers | Additive only, no existing read path changes. Low risk. |
| 047 | correct_entitlement_implementation_status | idempotent UPDATE | Metadata correction, not user data. No precheck. |
| 048 | app_screen_surface_and_transitions | 5 `ADD COLUMN` + index | Additive with defaults. Low risk. |
| 049 | delete_settings_route | idempotent UPDATEs | Screen-manifest metadata. No precheck. |
| 050 | catalog_baseline_version | `ADD COLUMN` default 0 | Author states nothing reads it until the new Worker deploys. Low risk. |
| 051 | manual_order_origin | `ADD COLUMN` default 'storefront' + index | Default is a stated fact about existing data (only path that could write a row), not a guess. Low risk. |
| 052 | stock_movements | new table + triggers | Table doesn't exist in production yet (confirmed by 059's header). Purely additive. |
| 053 | customers | new table | No existing column touched. Low risk. |
| 054 | play_mappings_per_package | carries its own `rollout:` marker | Read it directly before dispatch — it's the authority, don't re-derive it here. |
| 055 | media_objects | new table | Author states old Worker "does not know this table exists." Low risk. |
| 056 | subscription_idempotency | UPDATE (mark superseded dupes) + UNIQUE INDEX | Same shape as 045 — self-healing, but confirm on the disposable copy it doesn't supersede a row that matters. |
| 057 | product_discounts | 2 `ADD COLUMN` + 2 triggers | New columns null on every existing row. Low risk. |
| 058 | product_client_request_id | `ADD COLUMN` + partial UNIQUE INDEX | Existing NULLs are intentionally exempt (SQLite treats NULL as distinct). Low risk. |
| 059 | stock_movements_product_code_not_null | table rebuild, NOT NULL tightening | Carries the fullest `rollout:` analysis in the batch: verified 2026-09-15 that staging holds 0 movement rows and production hasn't reached 052, so there's no historical data to violate the constraint. One-statement-wide window where the table doesn't exist (DROP→RENAME); an order placed in that instant fails its INSERT rather than write a bad row. Re-verify "production hasn't reached 052" is still true, and that the abort-on-unresolvable-row branch never fires in the rehearsal. |

## 5. The old-Worker / new-schema window

`production-deploy.yml` applies migrations before deploying the Worker. For
the gap in between, the *currently live* Worker (five weeks stale) serves
traffic against the newly migrated schema. Section 4a's automated gate
already enforces that every structurally-risky migration in this batch
states why that's survivable — the remaining step is human: read the
`rollout:` notes on `045`, `054`, and `059` (and the equivalent reasoning in
`044`'s header, which predates the marker convention) and confirm nothing
has changed since they were written — specifically, that no real orders,
subscriptions, or referral codes have been written to production since
2026-08-16. Given sign-in has never been opened in production
(`ONBOARDING_ENABLED=false` throughout), this should hold, but it is a
factual claim to re-check, not to assume.

## 6. Deploy

1. Re-confirm `origin/main` hasn't moved since this runbook was last read.
2. Set `PRODUCTION_DEPLOYS_ENABLED=true`.
3. Dispatch **Deploy Production** with `release_sha` = current `origin/main`
   and `confirm=DEPLOY_PRODUCTION`.
4. Let the workflow's own gates run: deploy-owner check, staging provenance,
   main-tip check, deployment-map verification, backend+admin test/lint/
   build, `wrangler deploy --dry-run` for both, backup-freshness (now
   passing per step 1), migrations apply, Worker deploy, Admin deploy, smoke
   test, tag.
5. **Do not** flip `PRODUCTION_DEPLOYS_ENABLED` back off immediately after
   the smoke test passes. Leave it enabled through the observation window in
   step 7, then decide re-freezing as its own call — "did this deploy
   succeed" and "should new deploys keep being possible" are different
   questions.

## 7. Post-deploy observation window

- API/Admin health (covered by the workflow's own smoke test).
- Old catalogue-mirror routes return 405, not 200 — confirm no client in the
  wild still depends on the retired mirror path.
- Sentry (crash reporting added this window, commit `19c1cf5`) for any spike
  in the minutes after deploy.
- Explicitly probe the tenant-isolation fix (`84c966c`, "prove no seller can
  reach another seller's store") against production traffic patterns — it's
  a security property that has never faced production load.
- Confirm the TOTP/audit signing key v2 (already live since 2026-08-16)
  still verifies correctly against whatever the auth v8 contract now
  expects.
- `npx wrangler d1 migrations list orderak-db --remote` shows `059` as the
  latest applied — confirms the full chain landed, not a partial batch.

## 8. Rollback — paired, never independent

**Never** redeploy the old Worker on its own against the now-migrated
schema. Several of these migrations tighten constraints the old code was
never tested against; new schema + old code can be worse than the original
failure.

If something fails:

1. Restore the D1 database to the pre-deploy Time Travel bookmark or the
   backup from step 1 — into a **new** database first, verify it, then
   repoint bindings. Never restore over the live database
   ([d1-restore.md](d1-restore.md)).
2. Redeploy the tagged pre-deploy Worker SHA from step 2.
3. Verify old clients and API health before declaring the rollback done.

Rehearse this pairing once — against the disposable copy from step 4b, for
example — before relying on it under real pressure.

## Go/no-go

- [ ] D1 Backup: one clean successful run.
- [ ] Restore Drill: succeeds against current `main`'s schema.
- [ ] Rollback anchor tagged and pushed.
- [ ] `DEPLOY_OWNER` / `PRODUCTION_DEPLOYS_ENABLED` confirmed in repo settings.
- [ ] Production secrets confirmed current.
- [ ] Rehearsal (4b) run against a disposable restored copy; all 16
      invariants checked.
- [ ] `rollout:` notes on 044, 045, 054, 059 re-read and their assumptions
      re-confirmed against today's production data.
- [ ] Paired rollback rehearsed at least once.
- [ ] `origin/main` SHA re-confirmed immediately before dispatch.
