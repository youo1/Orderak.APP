---
status: current
generated: false
owner: governance
last_verified: 2026-08-24
applies_to: [production, staging]
authoritative_for: [release-workflow]
---
# Staging and Production Workflow

**Status:** Current  
**Audience:** Developers, operators, and release owners

This guide explains how Orderak uses GitHub, how Staging and Production stay
isolated, and how a tested change is promoted safely.

**This repository has one long-lived branch, `main`.** That is worth stating
with its history, because the answer has changed twice and a stale copy of this
guide is worse than none:

- Before 2026-08-24: `main` only.
- 2026-08-24: adopted `develop` -> `staging` -> `main`, with the Staging deploy
  moved onto the `staging` branch.
- 2026-08-25: collapsed back to `main` only. `develop` and `staging` were
  deleted after confirming neither held a commit `main` did not already contain,
  and the Staging deploy trigger moved back to `main`.

Environment isolation never depended on those branches and does not now. It comes
from configuration, credentials, service bindings, domains and data stores.

## Core model

Orderak has three long-lived branches and two isolated runtime environments.
Cloudflare carries Staging and Production only; there is no Dev environment.

```text
short-lived branch -> pull request -> main -> automatic Staging deployment
                                              |
                                              +-> test the exact commit SHA
                                                   |
                                                   +-> manual Production deployment
```

| Branch | Deploys to | Arrives by |
| --- | --- | --- |
| `feature/*`, `fix/*`, `hotfix/*` | nothing — the developer's own machine | branched from `main` |
| `main` | Staging automatically on push; Production by manual dispatch | squash merge from a short-lived branch |

- `main` is the source for releasable code and the only revision Production
  will deploy.
- Feature and fix branches are short-lived and merge into `main` through pull
  requests.
- Staging and Production are GitHub Environments with separate credentials.
- A Staging deployment does not deploy to Production.
- Production does not automatically follow the newest commit on `main`; its
  workflow checks out the exact 40-character commit SHA supplied by the release
  owner, and refuses any SHA that is not `main`'s current tip.
- Environment isolation is implemented through configuration, credentials,
  service bindings, domains, and data stores. The environment branches select
  *which revision* each environment runs; they are not what holds the
  environments apart.

### Everything squashes

A short-lived branch into `main` squashes: one branch, one commit, readable
history. With a single long-lived branch there are no promotion merges, so there
is no case where a squash costs anything.

This matters to `production-deploy.yml`, which requires the release SHA to have
a successful `staging-deploy.yml` run. Staging deploys fire on pushes to `main`,
so the release SHA *is* the commit Staging ran and the check is direct.

Between 2026-08-24 and 2026-08-25 that gate also accepted the release SHA's
second parent. It had to: promotions arrived on `main` as merge commits that
Staging had never itself deployed, and checking the release SHA alone would have
deadlocked Production permanently. That clause is gone with the branches that
needed it.

## Environment boundaries

| Area | Staging | Production |
| --- | --- | --- |
| GitHub Environment | `staging` | `production` |
| Deploying branch | `main` | `main` |
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

- One protected branch, `main`: pull request required, required CI checks, no
  force push, no deletion. `feature/*`, `fix/*` and `hotfix/*` are deliberately
  unprotected — they are one person's working area until a pull request exists,
  and force-pushing a rebase there is normal.
- `main` additionally enforces its rules on administrators, so the repository
  owner cannot push to it directly either, and requires conversation resolution
  before merge.
- Required approvals are zero on all three. On a single-maintainer repository an
  approval is a self-approval, which constrains nothing — the same reasoning the
  next section records for environment reviewers. The check suite is the gate
  that does the work.
- Separate `staging` and `production` GitHub Environments, both set to accept
  deployments from **protected branches only**
  (`deployment_branch_policy: {protected_branches: true}`). This is load-bearing,
  not incidental: `staging-deploy.yml` runs on `main`, so removing `main`'s
  protection does not merely relax a rule — it stops Staging deploying at all, at
  the environment gate.
- Environment-scoped secrets and variables; workflows do not share credentials
  implicitly.
- Separate concurrency groups so two deployments to the same environment do
  not overlap.
- A manual Production workflow requiring both a tested `release_ref` and the
  exact confirmation text `DEPLOY_PRODUCTION`.

**Production has a required-reviewer rule again. Corrected 2026-08-24.**

This paragraph has now been wrong in both directions, so the sequence is worth
keeping in full:

1. It originally said required reviewers were unavailable — true, because the
   restriction applies to *private* repositories on the current plan.
2. On 2026-08-15 this repository was public, and it was rewritten to say
   reviewers were available. That was verified empirically rather than inferred
   from the plan tier: a throwaway environment was created with a `reviewers`
   payload, the API accepted it and returned
   `protection_rules: ["required_reviewers"]`, and the environment was deleted
   immediately afterwards.
3. The repository then went **private**, and this paragraph was not revisited.
   Measured 2026-08-20: it reports `private=true`, and every environment reads
   `protection_rules: []`. The plan restriction applies once more.

4. `youo1/Orderak.APP` is **public again** — measured 2026-08-24,
   `private=false` — and the reviewer rules returned with it. Measured the same
   day: `production`, `backup-restore-production` and `backup-restore-staging`
   each report `protection_rules: ["required_reviewers", "branch_policy"]`, with
   a single reviewer, `User:youo1`, and `prevent_self_review: false`.

Each step was a correct measurement when taken; what kept going wrong was
treating a plan-tier consequence as a settled fact about the repository.
**Production has a reviewer gate today, and dispatching `Deploy Production`
pauses at an approval screen.**

What has not changed is what the gate is worth. The only reviewer is the change
author and self-review is not prevented, so the approval is a self-approval: a
confirmation step, not a second pair of eyes. No audit should record it as one.

The earlier plan — "set it on `production`, `backup-restore-staging`,
`backup-restore-production` and `staging-rollback` before their first dispatch" —
is withdrawn as a *plan*, though three of those environments now carry the rule
anyway. On a single-maintainer repository the gate could never have done the
work claimed for it: the sole reviewer is always the change author, so the approval is a
self-approval, and a control that one person can always satisfy alone constrains
nothing. Keeping it on the roadmap kept a permanent false finding in every audit.
(`staging-rollback` also does not exist in `Orderak.APP`; the five environments
present are `production`, `staging`, `staging-contract-tests`, and the two
`backup-restore-*`.)

What does the real work is what always did — checks a machine performs on every
dispatch, none of which need a second person to be available:
the typed `DEPLOY_PRODUCTION` confirmation, the 40-character SHA matched against
`origin/main`, the requirement that the SHA already have a successful
`staging-deploy.yml` run, `require-deploy-owner`, `verify-deployment-map.mjs`,
the full test/lint/`--dry-run` pass, and the post-deploy smoke test. Alongside
those sits credential custody: each deploy token is scoped to its environment, so
a workflow that does not declare the environment cannot reach its resources.

Do not describe this workflow as having a *meaningful* reviewer gate. It has the
setting, and the setting will stop and ask. It does not have a second reviewer,
and on a single-maintainer repository it cannot.

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

A fault already running in Production is not a special case any more: it also
branches from `main`, because `main` is what Production runs. Name it
`hotfix/<short-description>` so the intent is visible, and see
[Hotfixes](#hotfixes) for the release path.

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

### 4. Squash merge into `main`

Merge only after the pull request represents one coherent change and required
checks pass. Use **Squash and merge**. The resulting commit on `main` is what
triggers the Staging deployment, and it is the candidate Staging acceptance
verifies.

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

1. Identify the exact commit on `main` that passed Staging acceptance.
2. Confirm it is `main`'s current tip and has not been replaced by a later
   untested commit. The workflow enforces both: the release SHA must equal
   `origin/main`, and must itself have a successful `staging-deploy.yml` run.
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
5. Enter `main`'s current tip as a full 40-character SHA in `release_sha`. The
   input is a SHA: a tag or an abbreviated SHA is rejected.
6. Enter exactly `DEPLOY_PRODUCTION` in `confirm`.
7. Run the workflow, then **approve the `production` environment when GitHub
   asks**. The run waits at that gate and does nothing until it is approved.
8. Monitor every step until the smoke tests complete.

The workflow validates the backend and Admin again before it applies Production
migrations and deploys. It then smoke-tests the Production API and Admin URLs.

**The run pauses for approval.** The `production` environment carries a
required-reviewer rule naming `youo1`, so the dispatch stops at the environment
gate until someone approves it in the Actions UI. Because that reviewer is the
change author and `prevent_self_review` is false, this is a confirmation prompt
rather than review by a second person — but nothing deploys until it is clicked.

### Production verification

After a successful run:

- Confirm `https://api.orderak.app/health` is healthy.
- Confirm `https://admin.orderak.app` loads and the intended change works.
- Check Worker errors, queue failures, and migration status relevant to the
  release.
- Record the deployed SHA and the GitHub Actions run URL in the appropriate
  release or governance evidence.

## Hotfixes

A hotfix is an ordinary change in a hurry. It branches from `main` like
everything else, and its only distinction is the name and the urgency.

```text
main -> hotfix/<short-description> -> main -> Staging -> Production
```

1. `git switch main && git pull --ff-only && git switch -c hotfix/<short-description>`
2. Fix it, test locally, push, and open a pull request targeting `main`. The same
   required checks apply: a hotfix skips the queue, not the gates.
3. Squash merge it. The merge triggers `Deploy Staging` if it touched a path in
   that workflow's filter.
4. Verify on Staging, then dispatch `Deploy Production` with `main`'s new tip.

If the change touched no path in the Staging filter, no `staging-deploy.yml` run
exists for that SHA and the "Verify the exact SHA passed Staging" gate will
refuse the release. That is the gate working, not a bug: dispatch `Deploy
Staging` manually against `main` first, then dispatch Production.

## Rollback triggers

A trigger without a number cannot fire. These are numeric thresholds, not
adjectives, derived from a measured Staging baseline rather than assumed.

**Measured baseline** — Staging, `CACHE_BUST=1 PROFILE=soak`, 2026-08-13.
**60 minutes at a sustained 20 rps, 71,992 requests, cache-busted so every one
reached the Worker and D1.** All four k6 thresholds passed; the run completed
with 0 interrupted iterations.

| Metric | Measured | Trigger | Headroom | Window |
| --- | --- | --- | --- | --- |
| Error rate (`http_req_failed`) | **0.00%** (0 / 71,992) | **> 1%** sustained | — | 5 minutes |
| p95 latency | **145.48 ms** | **> 500 ms** sustained | 3.4x | 10 minutes |
| p99 latency | **274.90 ms** | **> 1500 ms** sustained | 5.5x | 10 minutes |

Supporting distribution: min 76.01 ms, median 121.24 ms, p90 131.34 ms,
mean 125.23 ms. 143,984 checks, 100% passed.

**This baseline replaces a 30-second, 2-VU, 480-request smoke run** that
previously stood in for it. That earlier figure measured an idle system, and
worse, it measured Cloudflare's edge cache rather than the application — see
"What the soak was actually measuring" below. The numbers above are the first
that describe this system under sustained load on the path a rollback trigger
needs to watch.

Two honest limits on the figures:

- **The tail is wider than the percentiles suggest.** `max` was 4.15 s. One
  request in 71,992 took 28x the p95. A 10-minute sustained window is what
  keeps that from firing a rollback, and is the reason the trigger is
  specified as sustained rather than as a single-sample bound.
- **Nine iterations were dropped** (0.0025/s) — the generator could not start
  them on schedule. That is a load-generator artifact, not a server response,
  and is excluded from the latency figures rather than counted as a failure.

Measured from a single client location against a single endpoint. It is a
real sustained measurement of one read path, not a representative traffic mix.

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

### What the soak was actually measuring

The first soak, 2026-08-11, reported **p95 1117.50 ms** — 2.2x its own
trigger — with zero errors across 43,890 requests. That was read as evidence
the latency triggers were unusable. It was not. The soak was not measuring
this application.

`GET /api/v1/theme` is edge-cacheable, and both Staging and Production serve
it from Cloudflare's cache: 30 consecutive requests returned
`CF-Cache-Status: HIT`. The Worker was never invoked and D1 was never queried.
Zero errors across 43,890 requests is what a CDN serving a cached object looks
like — a Worker that had regressed badly would not have appeared in the
numbers at all.

A two-arm experiment on 2026-08-13 separated the CDN from the application.
Same generator, same network path, 20 rps for 60 s each. The arms were
confirmed to differ before the numbers were trusted: the plain URL returns
`CF-Cache-Status: HIT` with an `Age` header, the cache-busted URL returns
neither and carries the Worker's own `public, no-cache`.

| Arm | n | median | p95 | max | failed |
| --- | --- | --- | --- | --- | --- |
| Cached URL (what the old soak hit) | 1,201 | 108.0 ms | 128.9 ms | 251 ms | 0.00% |
| Cache-busted, reaches Worker + D1 | 1,201 | 110.9 ms | 131.4 ms | 225 ms | 0.00% |

**2.5 ms apart.** The application is not the slow part, and the 1117 ms was
the GitHub Actions runner acting as load generator, not Orderak. The 500 ms
trigger was never the problem; the measurement behind it was.

`quality/performance/k6/api-load.js` now takes `CACHE_BUST=1`, set on the soak
profile only. The CI smoke gate keeps hitting the plain URL, which is right
for checking that the endpoint answers. A soak exists to produce a number a
rollback trigger can be set from, and that trigger has to fire when the
*Worker* regresses — which requires reaching it.

### Getting a full hour to complete

The corrected soak took five attempts. Three were killed by session teardown,
each time with the system under test healthy — steady at 20 iterations/second
with zero interrupted iterations right up to the kill.

| Run | Duration | Requests | p95 | Failed | Outcome |
| --- | --- | --- | --- | --- | --- |
| 1 | 36 min | 43,890 | 1117.50 ms | 0.00% | killed; measured the CDN, not the app |
| 2 | 23 min | 27,638 | — | — | killed before k6 wrote a summary |
| 3 | 8.6 min | 10,351 | 195.13 ms | 0.00% | killed; summary salvaged |
| 4 | 8.0 min | 9,601 | 105.22 ms | 0.00% | completed (foreground) |
| 5 | **60 min** | **71,992** | **145.48 ms** | **0.00%** | **completed, all thresholds passed** |

Runs 3 to 5 span 105–195 ms p95 at identical load. That spread is client
network variance, not application variance — the two-arm experiment put the
application's own contribution at 2.5 ms.

The durable place to run this is `openapi-nightly.yml`, which cannot run until
the `staging-contract-tests` environment exists.

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
Deploys reach the *same* Workers — which is the plan's own
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

## Rollback and forward fixes

For an application-code regression, run `Deploy Production` again with the last
known-good Production SHA and the same explicit confirmation. This redeploys
the older application code.

A code rollback does **not** reverse D1 migrations. Database migrations are
forward-only unless a reviewed recovery procedure explicitly says otherwise.
For migration problems, stop and follow the [database migration guide](./database-migrations.md)
and [D1 migration drift runbook](../runbooks/d1-migration-drift.md). Do not edit
the remote D1 migration ledger manually.

For a Staging regression, open a fix or revert pull request into `main`, run the
checks, and let the Staging workflow deploy the resulting commit.

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
| Fix something already live in Production | Create `hotfix/<name>` from current `main` |
| Test services/backend/Admin changes | Squash into `main` and use the automatic Staging deployment |
| Test Android changes | Run `Distribute Android Staging` for the intended `main` commit |
| Release services/backend/Admin | Dispatch Production with the exact Staging-tested SHA, which must be `main`'s tip |
| Release Android publicly | Use the separate, approved Google Play release process when available |
| Production code regression | Redeploy the last known-good SHA |
| Production migration problem | Use the migration runbook; do not assume code rollback reverses data changes |
