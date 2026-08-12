---
status: current
generated: false
owner: governance
last_verified: 2026-08-11
applies_to: [production, staging]
authoritative_for: [release-workflow]
---
# Staging and Production Workflow

**Status:** Current  
**Audience:** Developers, operators, and release owners

This guide explains how Orderak uses GitHub, how Staging and Production stay
isolated, and how a tested change is promoted safely. It describes the current
repository and deployment workflows; it is not a proposal for separate
long-lived environment branches.

## Core model

Orderak has one authoritative code line and two isolated runtime environments:

```text
short-lived branch -> pull request -> main -> automatic Staging deployment
                                              |
                                              +-> test the exact commit SHA
                                                   |
                                                   +-> manual Production deployment
```

- `main` is the source for releasable code.
- Feature and fix branches are short-lived and merge into `main` through pull
  requests.
- Staging and Production are GitHub Environments with separate credentials.
- A Staging deployment does not deploy to Production.
- Production does not automatically follow the newest commit on `main`; its
  workflow checks out the exact commit SHA or release tag supplied by the
  release owner.
- Environment isolation is implemented through configuration, credentials,
  service bindings, domains, and data stores, not by maintaining divergent
  Staging and Production branches.

## Environment boundaries

| Area | Staging | Production |
| --- | --- | --- |
| GitHub Environment | `staging` | `production` |
| Backend deployment | Automatic after relevant changes merge to `main`; manual dispatch is also supported | Manual dispatch only |
| Public API | `https://api.staging.orderak.app` | `https://api.orderak.app` |
| Public site | `https://staging.orderak.app` | `https://orderak.app` |
| Admin | `https://admin.staging.orderak.app` | `https://admin.orderak.app` |
| Android application ID | `app.orderak.seller.staging` | `app.orderak.seller` |
| Firebase | Separate Staging project and test users | Production project and real users |
| Cloudflare | Staging Workers, Static Assets, D1, R2, and Queues | Production Workers, Static Assets, D1, R2, and Queues |
| Data | Test data only | Real operational data |

Never copy Production database contents, seller phone numbers, admin sessions,
service-account keys, or Production API tokens into Staging.

## GitHub controls

The repository currently uses these controls:

- Protected `main` branch with required CI checks and force-push/deletion
  protection.
- Separate `staging` and `production` GitHub Environments.
- Environment-scoped secrets and variables; workflows do not share credentials
  implicitly.
- Separate concurrency groups so two deployments to the same environment do
  not overlap.
- A manual Production workflow requiring both a tested `release_ref` and the
  exact confirmation text `DEPLOY_PRODUCTION`.

The current GitHub plan does not support Environment required reviewers for
this private repository. Consequently, the typed confirmation and restricted
manual dispatch are the current Production approval boundary. Do not describe
the workflow as having a GitHub reviewer gate unless the plan and Environment
configuration are changed and verified.

## Daily development workflow

### 1. Start from a clean, current `main`

Do not switch branches while uncommitted work could be lost or mixed into a
new change.

```powershell
git status
git switch main
git pull --ff-only
git switch -c feature/<short-description>
```

Use `fix/<short-description>` for human-authored fixes. Branches created by
Codex normally use `codex/<short-description>`.

### 2. Implement and verify locally

Run the checks appropriate to the files changed. At minimum, follow the
[testing guide](./testing.md). Authentication and localization changes must also
run their protected contract checks as required by `AGENTS.md`.

Do not place provider or infrastructure secrets in the Android application.
Android calls the Cloudflare backend, and the backend accesses external
providers using Worker secrets.

### 3. Commit, push, and open a pull request

```powershell
git add <intended-files>
git commit -m "Describe the change"
git push -u origin HEAD
```

Open a pull request targeting `main`. Review the changed files and wait for all
required GitHub Actions checks to pass. Fix failures on the same branch; do not
bypass or weaken a protected contract check.

### 4. Merge into `main`

Merge only after the pull request represents one coherent change and required
checks pass. The merge commit SHA becomes the candidate that Staging verifies.

## Deploying and testing Staging

### Backend and Admin

`Deploy Staging` runs automatically when a merge to `main` changes:

- `services/backend/**`
- `apps/admin-web/**`
- the Staging deployment workflow itself

The workflow:

1. Installs dependencies.
2. Runs backend tests, type checks, Admin tests, builds, and Wrangler dry runs.
3. Applies both migration streams to the Staging D1 databases.
4. Deploys the public Worker, private Admin Worker, and Admin Edge Worker with
   Workers Static Assets using the `staging` GitHub Environment.
5. Smoke-tests the Staging API and Admin URLs.

Documentation-only and Android-only merges do not cause an unnecessary backend
deployment.

### Android Staging

Run `Distribute Android Staging` manually from GitHub Actions after the intended
commit is on `main`. It builds `StagingDebug`, runs the protected contract and
unit checks, and uploads the APK to the configured Firebase App Distribution
tester group.

The Staging APK can coexist with the Production app because it uses the
`.staging` application ID suffix and points only to Staging URLs.

### Staging acceptance checklist

Before promotion, record the exact successful commit SHA and verify:

- `Deploy Staging` completed successfully for that SHA when the change affects
  the backend or Admin.
- `https://api.staging.orderak.app/health` responds successfully.
- The relevant Admin and Android journeys work with Staging accounts and data.
- Any D1 migration behaved as expected and its rollback/forward-fix strategy is
  understood.
- No Production credentials, personal data, or live payment actions were used.
- Feature-specific release gates and documented blockers are satisfied.

## Promoting the tested version to Production

Production promotion is deliberate and manual. It currently deploys the
backend and Admin surfaces; it does **not** publish the Android application to
Google Play.

### Preconditions

1. Identify the exact commit SHA that passed Staging acceptance.
2. Confirm the SHA is reachable from `main` and has not been replaced by a
   different untested commit.
3. Confirm required secrets and variables exist in the `production` GitHub
   Environment.
4. Review pending Production migrations and operational impact.
5. Choose a monitored deployment window and ensure a known-good SHA is
   available for application rollback.

### GitHub Actions procedure

1. Open the repository on GitHub.
2. Select **Actions**.
3. Select **Deploy Production**.
4. Select **Run workflow** and keep the workflow branch set to `main`.
5. Enter the tested commit SHA or approved release tag in `release_ref`.
6. Enter exactly `DEPLOY_PRODUCTION` in `confirm`.
7. Run the workflow and monitor every step until the smoke tests complete.

The workflow validates the backend and Admin again before it applies Production
migrations and deploys. It then smoke-tests the Production API and Admin URLs.
Because there is currently no supported required-reviewer rule, dispatching the
workflow starts this process without a second GitHub approval screen.

### Production verification

After a successful run:

- Confirm `https://api.orderak.app/health` is healthy.
- Confirm `https://admin.orderak.app` loads and the intended change works.
- Check Worker errors, queue failures, and migration status relevant to the
  release.
- Record the deployed SHA and the GitHub Actions run URL in the appropriate
  release or governance evidence.

## Rollback triggers

A trigger without a number cannot fire. These are numeric thresholds, not
adjectives, derived from a measured Staging baseline rather than assumed.

**Measured baseline** (Staging, `k6 run --env PROFILE=smoke`, 2026-08-11,
2 VUs / 30s / 480 requests against `api.staging.orderak.app`):

| Metric | Measured | Trigger | Window |
| --- | --- | --- | --- |
| Error rate (`http_req_failed`) | 0.00% (0/480) | **> 1%** sustained | 5 minutes |
| p95 latency | 150.61 ms | **> 500 ms** sustained | 10 minutes |
| p99 latency | 222.57 ms | **> 1500 ms** sustained | 10 minutes |

The p95/p99 triggers match the gates `quality/performance/k6/api-load.js`
already enforces during load tests (`p(95)<500`, `p(99)<1500`) — the same
bound serves both as a pre-release gate and a live rollback trigger, so
promoting past the first never means shipping something that would already
fail the second. The error-rate trigger is set above the script's own
`rate<0.005` build gate, wide enough that a single transient blip does not
fire it while a real regression still does inside the 5-minute window.

**Not yet measurable with the tooling available:**

- **Auth failure rate.** Staging carries no organic traffic before launch —
  only the synthetic seller used by nightly contract fuzzing. There is
  nothing to derive a rate from yet. Set this trigger from real traffic
  during the pre-launch soak, before relying on it.
- **Queue backlog.** Now measurable, and measured — but still not settable.

  `wrangler queues info` reports producers and consumers, not depth. Depth
  lives only in the GraphQL Analytics API, so `infra-drift.yml` now queries it
  every run via `services/backend/scripts/queue-backlog-report.mjs`.

  The 2026-08-12 reading over a 24-hour window: **no backlog samples at all —
  no queue carried traffic.** There is nothing to derive a threshold from,
  which is the same pre-launch problem as the auth-failure rate. The
  difference is that the number now appears automatically the moment traffic
  exists, instead of waiting for someone to remember to go looking.

  **Two limits worth knowing before setting a bound from it.** The dataset
  exposes `avg` only — there is no `max` — so an average over the window hides
  a short spike, and any threshold built on it detects a sustained plateau
  rather than a burst. And oldest-message age is not in this dataset at all.

  Until a number exists, the trigger remains **any message landing in a DLQ**.
  That is a late signal — by the time a message dead-letters, the backlog that
  caused it already happened — but it is unambiguous, and a non-empty DLQ is a
  failure regardless of what the healthy backlog number turns out to be.

Re-measure the baseline before relying on these numbers for a real
production rollback decision — this table is dated, not evergreen.

### The smoke baseline does not survive sustained load

A 60-minute soak was run against Staging on 2026-08-11 at the `soak` profile
(20 requests/second) and stopped after ~36 minutes and 43,890 requests. It
did not fail the way a soak is supposed to fail:

| Metric | Smoke (2 VUs, 30s) | Soak (20 rps, ~36 min) | Trigger |
| --- | --- | --- | --- |
| Error rate | 0.00% | **0.00%** | > 1% |
| Failed checks | 0 | **0 of 87,780** | any |
| p95 latency | 150.61 ms | **1117.50 ms** | > 500 ms |
| max latency | 363.9 ms | 5190.86 ms | — |

Zero errors, zero failed checks, and **p95 2.2x over its own trigger**. The
`p(95)<500` and `p(99)<1500` thresholds both reported breached.

Two things follow, and neither is "raise the threshold":

1. **The p95 and p99 numbers in the table above were derived from a 30-second
   two-user smoke run.** That is a measurement of an idle system, not a
   baseline. Any trigger set from it describes behaviour that does not occur
   under load.
2. **This says nothing yet about Production.** Staging is not provisioned to
   match it, and 20 rps sustained against Staging may simply be past what
   Staging is sized for — self-inflicted, not a defect. Distinguishing the two
   requires load figures from Production, which do not exist pre-launch.

So the latency triggers are **not usable for a production rollback decision
as they stand**, and are marked as such rather than quietly widened until the
observed number fits underneath. The error-rate trigger is unaffected: zero
failures across 43,890 sustained requests is a real result and the 1% bound
holds.

### What the parity check actually covered, and what it could not

The plan asks for deterministic read-only requests compared with timestamps
and IDs normalized. What was captured at the ownership transition on
2026-08-11 was narrower, and the reason is worth recording rather than
implying a fuller comparison happened:

**Captured:** k6 smoke before and after (0.00% error rate both sides, p95
150.61 ms then 147.51 ms), and direct status/header checks on `/health`,
`/api/v1/theme` and the admin app — all `200`, `application/problem+json`
content types intact, `x-request-id` present and distinct per request.

**Not captured:** a normalized response-body diff between the two deploys.
Both repositories deploy to the *same* Workers — which is the plan's own
requirement, since parallel `orderak-migration-*` resources would put
different data on each side and make comparison meaningless. The consequence
is that the new deploy overwrote the old one, so there is no second live
endpoint left to diff against. The window for that comparison closed at the
moment of cutover and cannot be reopened retrospectively.

The forward-looking equivalent is a recorded baseline: snapshot normalized
responses now, and diff against them on future deploys. That is a Phase 8
control and belongs with the production cutover, not here.

### Rehearsed, not assumed

The rollback path below was exercised end to end on Staging on 2026-08-11,
before anything depended on it:

1. Deployed an older commit (`4ea5f98`, four commits behind `main`) to
   Staging via `workflow_dispatch` — both `validate` and `deploy` green.
2. Rolled forward to `main` the same way — both green, `/health` and the
   admin app back to `200`.

Two things that surfaced only by doing it, worth knowing before a real
incident:

- **`workflow_dispatch` needs a ref that exists on the remote.** Passing a
  bare commit SHA to `gh workflow run --ref` fails with
  `HTTP 422: No ref found`. A rollback to an arbitrary older commit
  therefore needs a branch or tag pushed at that commit first. Under
  incident pressure that is an extra step nobody will remember — push a
  tag at each known-good release so the ref already exists.
- **A code rollback does not touch Durable Object state.** `RateLimiter`
  instances keep their storage and class identity across the redeploy. That
  is fine for a pure code regression, and it is exactly why a change to a
  Durable Object's class name or storage layout is *not* rollback-safe: the
  older code would meet newer state. Treat DO lifecycle changes as
  forward-fix-only.

## Break-glass: deploying Staging from the source repository

`youo1/Orderak` no longer deploys Staging. Its `CLOUDFLARE_API_TOKEN` was
removed from the `staging` environment, and its `staging-deploy.yml` is
dispatch-only behind a typed `BREAK_GLASS` confirmation plus a required
reviewer on the `staging-rollback` environment.

**That environment deliberately holds no credential.** The plan's requirement
is a rollback credential kept *outside* Actions — "a deliberate human act, not
an automated path" — and a token sitting permanently in a repository that
should not deploy is neither outside Actions nor deliberate. So the token
lives in the owner's password manager, and the environment stays empty until
someone decides an emergency justifies filling it.

### Using it

1. Confirm the emergency is real: `youo1/Orderak.APP` cannot deploy, and
   rolling forward or back from there has already been tried. A Staging
   rollback within Orderak.APP is the normal path and is rehearsed above.
2. Add the deploy token from offline custody:

   ```bash
   gh secret set CLOUDFLARE_API_TOKEN --repo youo1/Orderak --env staging-rollback
   ```

3. Dispatch `Deploy Staging (break-glass only)` with
   `confirm_break_glass=BREAK_GLASS`, and approve the environment when GitHub
   asks.
4. **Delete the secret again when the incident closes:**

   ```bash
   gh secret delete CLOUDFLARE_API_TOKEN --repo youo1/Orderak --env staging-rollback
   ```

### Stated expiry

The credential's lifetime is **the incident**. It is added when one starts and
removed when it closes — step 4 is not optional tidying, it is the control.
An emergency token left behind is just a second deploy path nobody
remembers, which is the situation Phase 7a existed to remove.

Review this path whenever the migration reaches a new phase, and retire it
entirely at Phase 9 when the source repository is decommissioned.

## Rollback and forward fixes

For an application-code regression, run `Deploy Production` again with the last
known-good Production SHA and the same explicit confirmation. This redeploys
the older application code.

A code rollback does **not** reverse D1 migrations. Database migrations are
forward-only unless a reviewed recovery procedure explicitly says otherwise.
For migration problems, stop and follow the [database migration guide](./database-migrations.md)
and [D1 migration drift runbook](../runbooks/d1-migration-drift.md). Do not edit
the remote D1 migration ledger manually.

For a Staging regression, create a fix or revert pull request, run the checks,
merge it into `main`, and let the Staging workflow deploy the resulting commit.

## What does not move between environments

Promotion moves a tested code revision and applies environment-specific
migrations. It does not transfer:

- D1 rows or R2 objects
- Firebase users or configuration files
- queue messages
- GitHub or Cloudflare secret values
- Admin accounts or recovery codes
- Android APKs from Firebase App Distribution to Google Play

Any required Production configuration must be provisioned separately, with
least privilege, before the release that needs it.

## Quick decision guide

| Situation | Correct action |
| --- | --- |
| Start a feature | Create a short-lived branch from current `main` |
| Test services/backend/Admin changes | Merge a reviewed PR and use automatic Staging deployment |
| Test Android changes | Run `Distribute Android Staging` for the intended `main` commit |
| Release services/backend/Admin | Manually deploy the exact Staging-tested SHA to Production |
| Release Android publicly | Use the separate, approved Google Play release process when available |
| Production code regression | Redeploy the last known-good SHA |
| Production migration problem | Use the migration runbook; do not assume code rollback reverses data changes |
