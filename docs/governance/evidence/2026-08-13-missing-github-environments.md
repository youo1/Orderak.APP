---
status: archived
generated: false
owner: backend
last_verified: 2026-08-15
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

## The auto-create hazard — tested 2026-08-15

GitHub creates an environment on first reference if it does not exist, with **no
protection rules and no secrets**.

An earlier version of this record said `restore-drill.yml` would therefore
"proceed with no approval gate at all". **That was wrong, and the test proves
it.** The drill was dispatched against `staging` with a deliberately
non-existent backup timestamp:

```text
Set up job
Run actions/checkout
Preflight required restore credentials   <- failed here
Wipe decrypted and encrypted material from the runner
Post Run actions/checkout
Complete job
```

Both halves of the concern are now measured, and they point opposite ways:

1. **The auto-create is real.** The repository went from 1 environment to 2.
   `backup-restore-staging` was created by the dispatch, and querying it
   returned `"protection_rules": []` — no required reviewers, exactly as
   feared.
2. **The consequence is contained.** The existing credentials preflight checks
   `CLOUDFLARE_RESTORE_READ_TOKEN`, `CLOUDFLARE_ACCOUNT_ID` and `AGE_IDENTITY`,
   and an auto-created environment has none of them. The job stopped there. age
   was never installed, no R2 object was downloaded, no D1 database was
   touched. The runner-wipe step still ran.

So the drill **fails closed**, and the approval gate's absence cannot by itself
cause an unapproved restore. The residual risk is narrower and worth stating
precisely: if someone later populates that environment with the three
credentials but forgets required reviewers, the preflight passes and nothing
else stops the restore. Reviewers are a configuration step, not an enforced
one.

The auto-created environment was **deleted** after the test. Leaving an
unprotected environment in place is the trap itself — it would let a future
secret-setting step silently produce a reviewer-less drill.

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
