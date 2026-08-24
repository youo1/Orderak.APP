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

**Long-lived environment branches were adopted on 2026-08-24.** Every revision
of this guide before that date said the opposite — "it is not a proposal for
separate long-lived environment branches" — and that was accurate for the model
it described. Under that model `main` was simultaneously the integration line
and the Staging trigger, which left the repository with a branch named for
production that deployed staging, and no branch named for either of the other
two stages. The three branches below replace it.

## Core model

Orderak has three long-lived branches and two isolated runtime environments.
**There is no Dev environment.** `develop` is an integration line that CI
proves; nothing deploys from it. Cloudflare carries Staging and Production only.

```text
feature/*   ->   develop   ->   staging   ->   main
    |               |              |             |
  local          CI only        Staging      Production
  machine                      (on push)   (manual dispatch)
```

| Branch | Deploys to | Arrives by |
| --- | --- | --- |
| `feature/*`, `fix/*` | nothing — the developer's own machine | branched from `develop` |
| `develop` | nothing; runs the full pull-request check suite | squash merge |
| `staging` | Staging, automatically on push | merge commit from `develop` |
| `main` | Production, by manual dispatch only | merge commit from `staging` |
| `hotfix/*` | Staging by dispatch, then Production | branched from `main` |

- `main` is the source for releasable code and the only revision Production
  will deploy.
- Feature and fix branches are short-lived and merge into `develop` through
  pull requests.
- Staging and Production are GitHub Environments with separate credentials.
- A Staging deployment does not deploy to Production.
- Production does not automatically follow the newest commit on `main`; its
  workflow checks out the exact 40-character commit SHA supplied by the release
  owner, and refuses any SHA that is not `main`'s current tip.
- Environment isolation is implemented through configuration, credentials,
  service bindings, domains, and data stores. The environment branches select
  *which revision* each environment runs; they are not what holds the
  environments apart.

### Why promotions merge and features squash

`feature/*` into `develop` squashes: one branch, one commit, readable history.

`develop` into `staging`, and `staging` into `main`, must **not** squash. A
squash hands the target branch a commit that shares no ancestry with the source,
so the next promotion re-diffs the whole branch from the original fork point and
conflicts on changes it already carries. Merge commits keep the branches
related, so each promotion pull request shows only what is new.

This is also what keeps Production deployable. `production-deploy.yml` requires
the release SHA to have a successful `staging-deploy.yml` run, and Staging
deploys now fire on `staging` — so the commit that was actually exercised is the
promotion merge's **second parent**, and that parent exists only because the
promotion was a merge. Required linear history on `main` was removed on
2026-08-24 for the same reason: it forbids exactly the merge commit this
depends on.

## Environment boundaries

| Area | Staging | Production |
| --- | --- | --- |
| GitHub Environment | `staging` | `production` |
| Deploying branch | `staging` | `main` |
| Backend deployment | Automatic after relevant changes merge to `staging`; manual dispatch is also supported | Manual dispatch only |
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

- Three protected branches — `main`, `staging`, `develop` — each requiring a
  pull request, the same required CI checks, and no force push or deletion.
  `feature/*`, `fix/*` and `hotfix/*` are deliberately unprotected: they are
  one person's working area until a pull request exists, and force-pushing a
  rebase there is normal.
- `main` additionally enforces its rules on administrators, so the repository
  owner cannot push to it directly either, and requires conversation resolution
  before merge.
- Required approvals are zero on all three. On a single-maintainer repository an
  approval is a self-approval, which constrains nothing — the same reasoning the
  next section records for environment reviewers. The check suite is the gate
  that does the work.
- Separate `staging` and `production` GitHub Environments.
- Environment-scoped secrets and variables; workflows do not share credentials
  implicitly.
- Separate concurrency groups so two deployments to the same environment do
  not overlap.
- A manual Production workflow requiring both a tested `release_ref` and the
  exact confirmation text `DEPLOY_PRODUCTION`.

**Required reviewers are unavailable again, and the reviewer gate is now
withdrawn as a plan rather than deferred. Corrected 2026-08-20.**

This paragraph has now been wrong in both directions, so the sequence is worth
keeping in full:

1. It originally said required reviewers were unavailable — true, because the
   restriction applies to *private* repositories on the current plan.
2. On 2026-08-15 both repositories were public, and it was rewritten to say
   reviewers were available. That was verified empirically rather than inferred
   from the plan tier: a throwaway environment was created on `Orderak.APP` with
   a `reviewers` payload, the API accepted it and returned
   `protection_rules: ["required_reviewers"]`, and the environment was deleted
   immediately afterwards.
3. Both repositories then went **private** — `youo1/Orderak` on 2026-08-16 — and
   this paragraph was not revisited. Measured 2026-08-20:
   `youo1/Orderak.APP` and `youo1/Orderak` both report `private=true`, and every
   environment in `Orderak.APP` reads `protection_rules: []`. The plan
   restriction applies once more.

So step 2's finding still stands as a measurement; it just no longer describes
the repository as it is. **A reviewer gate is unavailable, not merely
unconfigured.**

The earlier plan — "set it on `production`, `backup-restore-staging`,
`backup-restore-production` and `staging-rollback` before their first dispatch" —
is withdrawn, and not only because the platform now refuses it. On a
single-maintainer repository the gate could never have done the work claimed for
it: the sole reviewer is always the change author, so the approval is a
self-approval, and a control that one person can always satisfy alone constrains
nothing. Keeping it on the roadmap kept a permanent false finding in every audit.
(`staging-rollback` also does not exist in `Orderak.APP`; the five environments
present are `production`, `staging`, `staging-contract-tests`, and the two
`backup-restore-*`.)

What replaces it is what was always doing the real work — checks a machine
performs on every dispatch, none of which need a second person to be available:
the typed `DEPLOY_PRODUCTION` confirmation, the 40-character SHA matched against
`origin/main`, the requirement that the SHA already have a successful
`staging-deploy.yml` run, `require-deploy-owner`, `verify-deployment-map.mjs`,
the full test/lint/`--dry-run` pass, and the post-deploy smoke test. Alongside
those sits credential custody: each deploy token is scoped to its environment, so
a workflow that does not declare the environment cannot reach its resources.

Do not describe this workflow as having a GitHub reviewer gate. It does not have
one, and by current design it is not getting one.

## Daily development workflow

### 1. Start from a clean, current `develop`

Do not switch branches while uncommitted work could be lost or mixed into a
new change.

```powershell
git status
git switch develop
git pull --ff-only
git switch -c feature/<short-description>
```

Use `fix/<short-description>` for human-authored fixes. Branches created by
Codex normally use `codex/<short-description>`.

**A fault already running in production branches from `main` instead** — see
[Hotfixes](#hotfixes). `develop` may already hold unreleased work, and
branching the fix from it would ship that work alongside the fix.

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

Open a pull request targeting `develop`. Review the changed files and wait for
all required GitHub Actions checks to pass. Fix failures on the same branch; do
not bypass or weaken a protected contract check.

### 4. Squash merge into `develop`

Merge only after the pull request represents one coherent change and required
checks pass. Use **Squash and merge**. Nothing deploys — `develop` has no
deployment workflow.

### 5. Promote `develop` to `staging`

Open a pull request from `develop` to `staging` and merge it with **Create a
merge commit**, not a squash — see
[Why promotions merge and features squash](#why-promotions-merge-and-features-squash).
The push to `staging` is what triggers the Staging deployment, and the commit it
deploys is the candidate Staging acceptance verifies.

## Deploying and testing Staging

### Backend and Admin

`Deploy Staging` runs automatically when a merge to `staging` changes:

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
commit is on `staging`. It builds `StagingDebug`, runs the protected contract and
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

1. Identify the exact commit on `staging` that passed Staging acceptance.
2. Open a pull request from `staging` to `main` and merge it with **Create a
   merge commit**. Nothing deploys: `main` has no push trigger.
3. Use `main`'s new tip — the promotion merge commit — as `release_sha`. That
   is the SHA the workflow requires. It checks the release is `main`'s current
   tip, and separately that the merge's second parent, the staging commit from
   step 1, has a successful `staging-deploy.yml` run.
4. Confirm required secrets and variables exist in the `production` GitHub
   Environment.
5. Review pending Production migrations and operational impact.
6. Choose a monitored deployment window and ensure a known-good SHA is
   available for application rollback.

### GitHub Actions procedure

1. Open the repository on GitHub.
2. Select **Actions**.
3. Select **Deploy Production**.
4. Select **Run workflow** and keep the workflow branch set to `main`.
5. Enter `main`'s current tip — the full 40-character promotion merge SHA — in
   `release_sha`. The input is a SHA: a tag or an abbreviated SHA is rejected.
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

## Hotfixes

A hotfix branches from `main`, because the fault is in the revision Production
is running. `develop` may be several promotions ahead; branching from it would
carry unreleased work into an emergency release.

```text
main -> hotfix/<short-description> -> main -> back down to staging and develop
```

1. `git switch main && git pull --ff-only && git switch -c hotfix/<short-description>`
2. Fix it, test locally, push, and open a pull request **targeting `main`**. The
   same required checks apply: a hotfix skips the queue, not the gates.
3. Validate it on Staging before merging. Dispatch `Deploy Staging` with the
   workflow ref set to the hotfix branch. This does two jobs — it puts the fix
   in front of you on a real environment, and it creates the successful
   `staging-deploy.yml` run that the Production gate will look for.
4. Merge the pull request with **Create a merge commit**, so the hotfix commit
   becomes the merge's second parent and carries that Staging run with it. A
   squash here discards the link and Production will refuse the release.
5. Dispatch `Deploy Production` with `main`'s new tip.
6. Merge `main` down into `staging`, then `staging` into `develop`, both as
   merge commits. Skipping this is how a hotfix gets silently reverted by the
   next ordinary promotion.

If you merge a hotfix to `main` without step 3, the "Verify the exact SHA passed
Staging" gate fails and Production will not deploy. That is the gate working.
Recover by dispatching `Deploy Staging` against the hotfix commit, then
dispatching Production again.

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

The durable place to run this is `openapi-nightly.yml`, which cannot run in
`Orderak.APP` until the missing `staging-contract-tests` environment exists.
See `docs/governance/evidence/2026-08-13-missing-github-environments.md`.

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
dispatch-only behind a typed `BREAK_GLASS` confirmation.

> **The required reviewer on `staging-rollback` is almost certainly gone, and
> this procedure no longer relies on it.** Making `youo1/Orderak` private on
> 2026-08-16 stripped `required_reviewers` from both its `backup-restore-*`
> environments — measured before and after. Environment reviewers are not
> available on private repositories under that plan, so the same applies to
> `staging-rollback`. **That specific environment has not been re-queried**, so
> this is stated as the consequence of a measured plan limit, not as its own
> measurement. Confirm it before relying on the gate.
>
> What still holds is the stronger control, and it was always the real one: the
> environment carries **no credential**, so the break-glass path cannot run until
> a human deliberately puts one there. The reviewer was defence in depth on top
> of that, not the thing preventing a deploy.

That environment name still gates the dispatch, so the steps below are unchanged.

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

For a Staging regression, open a fix or revert pull request into `develop`, run
the checks, then promote `develop` to `staging` as a merge commit and let the
Staging workflow deploy the resulting commit.

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
| Start a feature | Create a short-lived branch from current `develop` |
| Fix something already live in Production | Create `hotfix/<name>` from current `main` |
| Test services/backend/Admin changes | Squash into `develop`, then promote to `staging` as a merge commit |
| Test Android changes | Run `Distribute Android Staging` for the intended `staging` commit |
| Release services/backend/Admin | Promote `staging` to `main` as a merge commit, then dispatch Production with `main`'s tip |
| Release Android publicly | Use the separate, approved Google Play release process when available |
| Production code regression | Redeploy the last known-good SHA |
| Production migration problem | Use the migration runbook; do not assume code rollback reverses data changes |
