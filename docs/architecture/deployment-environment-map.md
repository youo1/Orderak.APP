---
status: current
generated: false
owner: backend
last_verified: 2026-08-25
applies_to: [production, staging]
authoritative_for: [deployment-environments]
---
# Deployment Environment Map

**Status:** source-of-truth for repository deployment names
**Source audit:** verified from repository configuration on 2026-08-24
**Live audit:** blocked until GitHub CLI and Wrangler are re-authenticated

This map records names only. Secret values must never be copied into documentation,
logs, issues, or CI artifacts. A live read-only audit must confirm the configured
resources before any rename, creation, deletion, or Production deployment.

## End-to-end mapping

| Link | Production | Staging |
|---|---|---|
| GitHub Environment | `production` | `staging` |
| Deploying branch | `main` | `main` |
| Deployment trigger | Manual dispatch only | Push to `main`, path-filtered |
| Workflow | `.github/workflows/production-deploy.yml` | `.github/workflows/staging-deploy.yml` |
| Public Wrangler config | `services/backend/wrangler.jsonc` base | same file, `env.staging` |
| Admin Wrangler config | `services/backend/wrangler.admin.jsonc` base | same file, `env.staging` |
| Public Worker | `orderak-worker` | `orderak-worker-staging` |
| Admin Worker | `orderak-admin-worker` | `orderak-admin-worker-staging` |
| Admin Edge Worker | `orderak-admin-edge` | `orderak-admin-edge-staging` |
| Admin Static Assets | `apps/admin-web/dist` on `orderak-admin-edge` | `apps/admin-web/dist` on `orderak-admin-edge-staging` |
| Public/API domains | `orderak.app`, `www.orderak.app`, `api.orderak.app` | `staging.orderak.app`, `api.staging.orderak.app` |
| Admin domain | `admin.orderak.app` | `admin.staging.orderak.app` |
| Android application ID | `app.orderak.seller` | `app.orderak.seller.staging` |
| Android API base URL | `https://api.orderak.app` | `https://api.staging.orderak.app` |
| OpenAPI server | Production server entry | Staging server entry |

The base Wrangler configuration is the current Production configuration. An explicit
`env.production` is intentionally not added until a live read-only Cloudflare audit
proves that doing so will update the existing Workers rather than create new resources.

## Data and asynchronous resources

Bindings remain identical across environments; their resource targets are isolated.

| Binding/type | Production target | Staging target |
|---|---|---|
| D1 `orderak_db` | `orderak-db` | `orderak-db-staging` |
| D1 `orderak_geo` | `orderak-geo` | `orderak-geo-staging` |
| R2 `orderak_media` | `orderak-media` | `orderak-media-staging` |
| R2 `orderak_audit` | `orderak-admin-audit` | `orderak-admin-audit-staging` |
| Queue `PLAY_BILLING_QUEUE` | `orderak-play-billing` | `orderak-play-billing-staging` |
| Play billing DLQ | `orderak-play-billing-dlq` | `orderak-play-billing-dlq-staging` |
| Queue `ADMIN_EXPORT_QUEUE` | `orderak-admin-exports` | `orderak-admin-exports-staging` |
| Admin export DLQ | `orderak-admin-exports-dlq` | `orderak-admin-exports-dlq-staging` |
| Queue `EMAIL_QUEUE` | `orderak-email` | `orderak-email-staging` |
| Email DLQ | `orderak-email-dlq` | `orderak-email-dlq-staging` |
| Edge service binding | `ADMIN_WORKER` → `orderak-admin-worker` | `ADMIN_WORKER` → `orderak-admin-worker-staging` |

## GitHub configuration to verify live

Every environment is set to `deployment_branch_policy: {protected_branches:
true}`, so only a protected branch can deploy to one. From 2026-08-24 that couples
deployment to branch protection: `staging-deploy.yml` runs on the `staging`
branch, and if that branch loses its protection the deploy fails at the
environment gate rather than deploying from an unprotected ref.

Workflows in this repository reference **three** environments — `staging`,
`production`, and `backup-restore-production`.

Two were deleted on 2026-08-25. `staging-contract-tests` had never held a single
secret or variable, so the nightly contract suite failed its preflight every
night; `openapi-nightly.yml` no longer names it and is dispatch-only.
`backup-restore-staging` held the sole age identity for staging backups, so
deleting it made every existing staging export permanently undecryptable — the
staging export job was removed from `d1-backup.yml` in the same change rather
than left writing files nobody can open. `restore-drill.yml` is production-only
as a result, which means it is no longer a rehearsal: it reads real production
backups.

They reference the **variable** `CLOUDFLARE_ACCOUNT_ID` and the **secrets**
`ORDERAK_DEPLOY_STAGING`, `ORDERAK_DEPLOY_PRODUCTION`, `ORDERAK_BACKUP_STAGING`,
`ORDERAK_BACKUP_PRODUCTION`, `ORDERAK_DRIFT_CHECK`, `ORDERAK_ANALYTICS` and
`ORDERAK_RESTORE_READ`. Each is read into the `CLOUDFLARE_API_TOKEN` environment
variable, which is what wrangler reads — the secret name and the variable name are
different strings and only the secret name was renamed. Only their existence and
scope may be audited. The live
review must also confirm default branch, branch protection, required checks,
CODEOWNERS, workflow permissions, concurrency, and deployment URLs.

### Production approval: automated gates, not a second reviewer

An earlier revision of this section required the live review to confirm "that
Production approval cannot be provided solely by the change author." That is the
one thing this repository cannot confirm: there is no second person to provide
the approval. A rule nobody can satisfy is not a control, and auditing against it
produced a permanent false finding.

The requirement is withdrawn — but note that the *setting* exists. Measured
2026-08-24, the `production` environment carries `required_reviewers` with a
single reviewer, `User:youo1`, and `prevent_self_review: false`. It returned when
the repository became public again. So a dispatch does stop for an approval
screen; it stops for the change author, which is a confirmation step and not a
second pair of eyes.

What actually gates Production is checks a machine performs on every dispatch,
all of which live in `production-deploy.yml` and none of which depend on a second
human being available:

| Gate | Prevents |
|---|---|
| Typed `DEPLOY_PRODUCTION` confirmation | An accidental dispatch |
| 40-character SHA, matched against `origin/main` | Deploying a side branch |
| A successful `staging-deploy.yml` run on the SHA | Deploying an unexercised commit |
| `require-deploy-owner` against `DEPLOY_OWNER` | Deploying from the wrong repository |
| `verify-deployment-map.mjs` | Deploying at the wrong resources |
| Full test, type-check, lint, and `wrangler --dry-run` | Shipping a broken build or config |
| Post-deploy smoke test on `/health` and the Admin origin | A silently dead deploy |

The `production` GitHub Environment is retained, and its purpose is credential
custody rather than approval: `ORDERAK_DEPLOY_PRODUCTION` is scoped to that
environment, so a workflow that does not declare it cannot reach production
Cloudflare resources. The same reasoning had kept `staging-contract-tests`
separate from `staging` — the nightly fuzzer needed seller credentials and must
not also inherit a deploy token. That environment is gone, and the principle
still applies to any replacement: give the fuzzer its own environment rather
than reusing `staging`.

Production accepts a full 40-character commit SHA, verifies that a successful
`staging-deploy.yml` run exists for it, requires `DEPLOY_PRODUCTION`, and then enters
the protected `production` GitHub Environment.

The second-parent clause in that table dates from 2026-08-24, when Staging
deploys moved from `main` to the `staging` branch. A `staging` to `main`
promotion merge commit is a SHA Staging never deployed; the commit that was
exercised is the merge's second parent. Checking the release SHA alone would
have deadlocked Production permanently. The first parent — the previous
Production release — is deliberately not accepted, since that would pass a
promotion whose staging side had never deployed at all.

Staging migrations, deployments, and smoke tests remain separate from Production.

## Production freeze, 2026-08-24

**Delivery is staging-only while the project is in testing.** Production
remains deployed and serving — `api.orderak.app` and `admin.orderak.app` both
answer 200 — but nothing new ships to it.

| | |
|---|---|
| Mechanism | First step of `production-deploy.yml` requires repository variable `PRODUCTION_DEPLOYS_ENABLED` to equal `true` |
| Default | **Frozen.** The variable is absent, so the expression is empty and the gate fails closed |
| To lift | Set `PRODUCTION_DEPLOYS_ENABLED` to `true`; to re-freeze, unset it or set any other value |
| Not affected | The running production Workers, the production D1/R2/Queues, the nightly production backup, and the daily production drift check |

The freeze is a variable rather than a code edit so that lifting and re-applying
it are both single auditable settings changes, and neither requires a commit.

### The base Wrangler config is production

`wrangler deploy` with **no** `--env` flag deploys **production** — the base of
`services/backend/wrangler.jsonc`, `wrangler.admin.jsonc` and
`apps/admin-web/wrangler.edge.jsonc` is the production configuration, and
staging lives under `env.staging`. There is deliberately no `env.production`
(see the note under End-to-end mapping above), so the safe-looking bare command
is the dangerous one.

Both files now carry a header banner saying so. The package scripts are the
supported path and default to staging:

| Command | Target |
|---|---|
| `pnpm run deploy` | staging |
| `pnpm run deploy:staging` | staging |
| `pnpm run deploy:production` | production — frozen in CI, but **not** frozen from a local shell holding production credentials |

The freeze lives in the workflow, so it cannot stop a local `wrangler deploy`.
Anyone with account-wide Cloudflare credentials on their machine can still reach
production directly; that is a known limitation and the reason the banner exists.

### Backups now cover staging on a schedule

Until 2026-08-24 the nightly `d1-backup.yml` cron backed up **production only**
— `backup-staging` was gated on `workflow_dispatch`. With development happening
on staging, that left the active environment with no recent restore point for
`restore-drill.yml` to exercise. The nightly run now covers both, and the
dispatch default is `staging`.

## Cloudflare configuration to verify live

The read-only audit must enumerate Workers, Static Assets, routes/custom domains,
D1, R2, Queues/DLQs, cron triggers, service bindings, secret names, compatibility
dates, and latest deployment SHAs. It must produce a drift report only: no resource is
created, deleted, renamed, rebound, or migrated automatically.

Run `pnpm run verify:deployment-map` for the repository-level source check. Any live
drift requires a separate approved change with rollback steps.
