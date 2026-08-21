---
status: current
generated: false
owner: backend
last_verified: 2026-08-20
applies_to: [production, staging]
authoritative_for: [deployment-environments]
---
# Deployment Environment Map

**Status:** source-of-truth for repository deployment names
**Source audit:** verified from repository configuration on 2026-08-01
**Live audit:** blocked until GitHub CLI and Wrangler are re-authenticated

This map records names only. Secret values must never be copied into documentation,
logs, issues, or CI artifacts. A live read-only audit must confirm the configured
resources before any rename, creation, deletion, or Production deployment.

## End-to-end mapping

| Link | Production | Staging |
|---|---|---|
| GitHub Environment | `production` | `staging` |
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

Workflows in this repository reference **five** environments — `staging`,
`production`, `staging-contract-tests`, and the two `backup-restore-*`
environments `restore-drill.yml` selects between. Earlier revisions of this
paragraph listed only the first three and omitted the restore pair.

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
Production approval cannot be provided solely by the change author." That control
was never configured, and on a single-maintainer repository it cannot be: there is
no second person to provide the approval. A rule nobody can satisfy is not a
control, and auditing against it produced a permanent false finding.

The rule is withdrawn. Production is gated by checks a machine performs on every
dispatch, all of which live in `production-deploy.yml` and none of which depend on
a second human being available:

| Gate | Prevents |
|---|---|
| Typed `DEPLOY_PRODUCTION` confirmation | An accidental dispatch |
| 40-character SHA, matched against `origin/main` | Deploying a side branch |
| SHA must have a successful `staging-deploy.yml` run | Deploying an unexercised commit |
| `require-deploy-owner` against `DEPLOY_OWNER` | Deploying from the wrong repository |
| `verify-deployment-map.mjs` | Deploying at the wrong resources |
| Full test, type-check, lint, and `wrangler --dry-run` | Shipping a broken build or config |
| Post-deploy smoke test on `/health` and the Admin origin | A silently dead deploy |

The `production` GitHub Environment is retained, and its purpose is credential
custody rather than approval: `ORDERAK_DEPLOY_PRODUCTION` is scoped to that
environment, so a workflow that does not declare it cannot reach production
Cloudflare resources. The same reasoning keeps `staging-contract-tests` separate
from `staging` — the nightly fuzzer needs seller credentials and must not also
inherit a deploy token.

Production accepts a full 40-character commit SHA, verifies that the checked-out SHA
has a successful `staging-deploy.yml` run, requires `DEPLOY_PRODUCTION`, and then enters
the protected `production` GitHub Environment. Staging migrations, deployments, and
smoke tests remain separate from Production.

## Cloudflare configuration to verify live

The read-only audit must enumerate Workers, Static Assets, routes/custom domains,
D1, R2, Queues/DLQs, cron triggers, service bindings, secret names, compatibility
dates, and latest deployment SHAs. It must produce a drift report only: no resource is
created, deleted, renamed, rebound, or migrated automatically.

Run `pnpm run verify:deployment-map` for the repository-level source check. Any live
drift requires a separate approved change with rollback steps.
