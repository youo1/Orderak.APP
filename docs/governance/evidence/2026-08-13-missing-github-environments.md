---
status: current
generated: false
owner: backend
last_verified: 2026-08-13
applies_to: [staging, production]
---
# Orderak.APP is missing five GitHub environments its workflows reference

Found 2026-08-13 while looking for a way to run the soak somewhere that
outlives a local shell.

```text
youo1/Orderak       7 environments
youo1/Orderak.APP   1 environment  (staging)
```

`Orderak.APP` has only `staging`. Missing: `production`,
`backup-restore-staging`, `backup-restore-production`,
`staging-contract-tests`, `staging-rollback`.

## What this explains

Work believed to have been proven in the new repository was proven in the
**old** one. The restore drill that passed, the infrastructure-drift run, and
the queue-backlog measurement all executed against `youo1/Orderak`, because
that is where the environments and their secrets live. That was correct at the
time — Phase 3 keeps the old repository authoritative for scheduled work until
cutover — but it means the new repository's copies of those workflows have
**never been executed**, and their environment wiring is unverified.

| Workflow in Orderak.APP | Environment | Exists |
| --- | --- | --- |
| `staging-deploy.yml`, `android-staging-distribution.yml`, `d1-backup.yml` (staging job) | `staging` | yes |
| `d1-backup.yml` (production job), `infra-drift.yml` | `production` | **no** |
| `restore-drill.yml` | `backup-restore-staging` / `-production` | **no** |
| `openapi-nightly.yml` | `staging-contract-tests` | **no** |

`staging` currently holds `CLOUDFLARE_API_TOKEN` and
`CLOUDFLARE_D1_BACKUP_TOKEN`, with `AGE_RECIPIENT`, `CLOUDFLARE_ACCOUNT_ID` and
`DEPLOY_OWNER` as variables.

## The part that is a hazard, not just a gap

GitHub creates an environment on first reference if it does not exist, with **no
protection rules and no secrets**. For most of these that fails safely:
`infra-drift.yml` carries a credentials preflight that exits with a clear error
when the token is empty, which is exactly the case it was written for.

`restore-drill.yml` is different. Its entire safety model is a protected
environment with required reviewers — a human approving before a restore runs.
If dispatching it auto-creates `backup-restore-staging` unprotected, the drill
would proceed **with no approval gate at all**, and the protection would be
absent precisely when someone believed it was there.

This has not been tested, and deliberately so: verifying it means dispatching a
restore drill in a repository where the gate may not exist. The documented
GitHub behaviour is enough to treat it as real.

## Required before cutover

Not created now. An empty `production` environment in `Orderak.APP` is not
useful until it holds production credentials, and the plan holds production
untouched until the cutover window. Creating them early also risks the exact
auto-create hazard above being masked by a half-configured environment.

At cutover, each must exist with its contents before the corresponding workflow
is enabled:

1. `production` — `CLOUDFLARE_API_TOKEN`, `CLOUDFLARE_D1_BACKUP_TOKEN`,
   `CLOUDFLARE_DRIFT_CHECK_TOKEN`, `CLOUDFLARE_ANALYTICS_TOKEN`; vars
   `CLOUDFLARE_ACCOUNT_ID`, `AGE_RECIPIENT`, `DEPLOY_OWNER`.
2. `backup-restore-staging` and `backup-restore-production` — **required
   reviewers set before the first dispatch**, plus `CLOUDFLARE_ACCOUNT_ID`,
   which was the exact variable whose absence failed the drill in the old
   repository. Environment variables do not inherit from the repository level.
3. `staging-contract-tests` — `CONTRACT_SELLER_PHONE`, `CONTRACT_SELLER_SECRET`.
   `openapi-nightly.yml` already states in its header that a real run would fail
   preflight without these.
4. `staging-rollback` — the break-glass credential path from Phase 7a.

## Consequence for the soak

`openapi-nightly.yml` is the only durable way to run a 60-minute soak, and it
cannot run in `Orderak.APP` until item 3 exists. Until then the soak runs from a
local shell, where it has now been truncated twice by session teardown rather
than by any failure of the system under test.
