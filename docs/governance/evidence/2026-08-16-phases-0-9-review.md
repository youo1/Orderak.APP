---
status: current
generated: false
owner: governance
last_verified: 2026-08-16
applies_to: [production, staging]
---
# Phases 0–9 — verified review

Every line checked against the live system or the repository, not against
earlier notes. Where a check was run, its result is quoted.

## The finding that matters most

**All four required status checks have never run in `Orderak.APP`.**

| Required check | Workflow | Runs here |
| --- | --- | --- |
| `build-test-lint` | `android-ci.yml` | **0** |
| `protected-auth-contract` | `auth-phase1-contract.yml` | **0** |
| `test` | `backend-ci.yml` | **0** |
| `lint-and-links` | `docs-ci.yml` | **0** |

They were made **required** earlier today. Before enabling them I checked they
were not path-filtered — the trap Phase 3 names — and they are not. **I did not
check that they pass**, and they had no history here to check against, because
every change this session went straight to `main` and all four are
`pull_request`-triggered.

So four gates were armed on evidence of their existence, not their behaviour.
If any fails, every pull request is blocked until someone notices why. This
document is being merged through a pull request specifically to run them.

Five other workflows have also never run here: `ai-customizations-ci`,
`android-staging-distribution`, `openapi-ci`, `openapi-nightly`,
`skills-auto-update`. `openapi-ci` carries the schemathesis shards that
**Phase 0 item 7 left explicitly open** — "5 of 8 `schemathesis-changed` shards
fail … Treat it as open." That item was never closed and its state in this
repository is unknown.

## Phase 0 — verified

| Item | State |
| --- | --- |
| 1. Contract-suspension path deleted | `verify-contract-guards.mjs` passes: *"protected tasks have no suspension or bypass control path"* |
| 2. `docs/contracts/SUSPENDED.md` retired | absent |
| 3. Archive not published | `verify-built-site.mjs` passes |
| 4. `verify-d1-restore.mjs` fails on `foreign_key_check` | present and sets `failed = true`, with per-row detail |
| 5. `package.json` engines | `>=22.13` |
| 6. D1 backup regression | `backup` → `environment: production`, `backup-staging` → `staging`, two preflights, per-environment token. **Both paths have now succeeded**: staging in run 31937953569, production in 31943713427 |
| 7. PR #11 / CodeQL / schemathesis | **partly open** — see below |
| 8. `pre-migration-freeze` tag | present in `youo1/Orderak`, local and remote |

### Item 7, split honestly

- **CodeQL**: resolved by replacement, not by enabling it. `open-source-security.yml`
  states it is a *"temporary private-repository replacement for CodeQL"* and runs
  Semgrep instead. It passes. Code scanning itself is still not enabled, and no
  workflow depends on it.
- **Schemathesis shards**: **still open.** `openapi-ci.yml` has never run here.

### One item the plan got right and I got wrong today

Phase 0 item 6 says, in the plan, of the backup token: **"`D1:Read` is wrong,
export is a POST and needs Write."**

I specified `D1 → Read` for `orderak-backup-production` today, and the
production backup failed on exactly that. The correct answer was written down
in the plan the whole time. Two of the three token-scope errors this session
were of this kind — derived from what an operation sounds like rather than from
what it calls, when the answer already existed.

## Phases 1–6 — verified

| Phase | State |
| --- | --- |
| 1 — manifest from git objects | Gate runs here now: 705 files, **zero missing, zero drop violations**. 32 findings, all content changes with commits. Manifest carried into this repository; verifier compares blob ids after a CRLF defect was fixed |
| 2 — foundation | All required files present, `.gitleaks.toml` with no allowlist |
| 3 — CI ownership | Schedules correctly split; `DEPLOY_OWNER` gate **observed failing** with nothing deployed. **Required checks armed but unproven — see above** |
| 4 — deployable baselines | backend 216, admin-web 69, android 168, contracts 30; deltas explained |
| 5a — documented commands | recorded |
| 5b — code review | six criteria across four units; criterion 2 completed 2026-08-13 |
| 5c — documentation | eleven documented errors fixed, each confirmed by reading the file; UTF-8/mojibake gate added, the last one missing |
| 6 — data and parity | 60-minute soak: 71,992 requests, 0.00% failures, p95 145.48 ms, p99 274.90 ms |

## Phases 7–9 — verified

| Phase | State |
| --- | --- |
| 7a | complete |
| 7b | staging rotation, verified end to end |
| 7c | production: six secrets rotated, both key versions live, 22 archives verify under version 1 |
| 8 | four of five requirements evidenced; **production soak outstanding and not satisfiable — no traffic** |
| 9 | description, README, issues, nine secrets revoked, repository private. **Archiving blocked until 2026-09-15** |

## Open items

| # | Item | Blocked by |
| --- | --- | --- |
| 1 | **Four required checks never run** | nothing — this PR runs them |
| 2 | `openapi-ci` schemathesis shards, open since Phase 0 | needs a PR touching its paths |
| 3 | Production soak | no production traffic |
| 4 | `CONTRACT_SELLER_PHONE` / `_SECRET` in `Orderak.APP` | secret is unrecoverable; needs the staging seller's credentials |
| 5 | `ADMIN_RECOVERY_PEPPER` rotation | admins must regenerate ten codes |
| 6 | Delete five duplicate Cloudflare tokens | a restore drill in the old repository first |
| 7 | Archive the old repository | 2026-09-15 |
| 8 | Phase 10 backlog | after cutover, by design |

Items 3, 5, 6 and 7 are waiting on time or on people. Items 1, 2 and 4 are
work, and item 1 is the one that can block every future pull request.
