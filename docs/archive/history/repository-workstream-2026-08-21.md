# Repository and Contract Workstream — 2026-08-21

> **Status:** Historical point-in-time record. This page describes ONE
> workstream — the one that began with a review of the Git and GitHub setup and
> ended in a currency and API-contract migration — as it stood on 2026-08-21. It
> is not, and never was, a status page for the product. It was titled "Where the
> work stands" and published in the navigation as "Status", which is how it came
> to be read as one.

**Reviewed:** 2026-08-21
**Archived:** 2026-09-05
**Purpose:** Preserve what this workstream finished, what it did not, and the two
decisions it took without an ADR.

## What changed after this was written

Everything below is left as it was recorded. Four things are no longer true, and
are corrected here rather than edited into the record:

1. **The branch merged.** `followup/phases-0-9-review` no longer exists. The
   "Where the work lives" and "Read this before merging" sections describe a
   merge that has since happened; migration 044 has been applied to staging.
2. **The product is deployed.** "Deployed: **Nowhere**" was true of that branch,
   not of Orderak. Production has deployed from this repository since
   2026-08-16 — see the README, which is authoritative for deployment state.
3. **The route-coverage figure was wrong when written.** "100%, 252 operations"
   was measured by a scanner that could not read the dispatch expression in
   `phone-change.ts`, so two live POST routes were invisible to it and to the
   contract. Corrected on 2026-09-05: coverage is 100% across 255 operations,
   and the scanner now fails closed rather than skipping what it cannot parse.
4. **Route discovery and payload modelling moved on.** The figures in the
   Finished table are as of the review date.

The "Not finished" table is the part still worth reading; most of it remains
accurate, and the Android production release path is unchanged.

## Where the work lives

| | |
| --- | --- |
| Branch | `followup/phases-0-9-review`, ahead of `origin/main` |
| Merged | No |
| Deployed | **Nowhere.** The branch is unprotected, and all five environments require a protected branch |

Nothing in this workstream has reached staging or production. That is the
deployment branch policy working, not an oversight.

`git rev-list --count origin/main..HEAD` gives the commit count. It is not
written here on purpose: the first version of this page stated a number, and the
commit that added the page made it wrong. A figure that goes stale on the next
commit belongs in a command, not in prose.

## Finished

| Area | State | Proved by |
| --- | --- | --- |
| Dependency automation | Dependabot replaces a Renovate config that was never running | `.github/dependabot.yml`; manifest records the drop |
| Node version | One source of truth in `.nvmrc`; 17 workflows read it | zero numeric `node-version` literals |
| Worker size/startup budget | Guard added, wired into `backend-ci` | `verify-worker-budget.mjs` passes for 3 Workers |
| Route discovery | Understands `app.openapi(createRoute(...))` | route coverage 100%, 252 operations |
| Test database | Built from `migrations/`, not a hand-written copy | 249 backend tests against the real schema |
| Money representation | Minor units + explicit currency, all three platforms | [ADR-009](decisions/adr-009-minor-units-with-explicit-currency.md), migration 044 |
| API payload modelling | Machinery built; 2 of 244 operations modelled | [ADR-010](decisions/adr-010-schema-first-api-contract.md), contract `check` passes |
| Historical docs | 16 archived, 15 nav entries removed | `mkdocs build --strict` passes |

## Not finished

| Item | Where it stopped | Why |
| --- | --- | --- |
| **Payload modelling for the other 242 operations** | 2 modelled | Each needs its handler read. A schema invented without reading the handler is worse than `GenericSuccess`, which is visibly empty — a wrong schema looks authoritative and gets trusted by the fuzzer, the mock and every generated client |
| **Coverage thresholds** | Providers installed, no threshold set | `@vitest/coverage-istanbul` is in the backend (V8 coverage is unsupported under `vitest-pool-workers`). `@vitest/coverage-v8` for admin-web did not finish installing. No baseline measured, so no floor set |
| **Android production release path** | Not started | No `assembleRelease`, no signing config, no Play publishing, `versionCode`/`versionName` hardcoded. CI builds staging-debug only |
| **Pre-commit hooks and a formatter** | Not started | No husky, lefthook or prettier |
| **Tag protection ruleset** | Not created | Needed before the first `v*` tag, not after. There are currently zero tags |
| **`development` environment** | Agreed, not built | See [Decisions](#decisions-taken) |
| **`OpenAPI Nightly` failures** | Still failing | Pre-existing; not investigated in this workstream |

## Read this before merging

`staging-deploy` runs on **push to `main`** with no reviewer, and 34 of the
changed files match its path filters. It also runs:

```text
npx wrangler d1 migrations apply orderak-db-staging --env staging --remote
```

So merging applies **migration 044 to the live staging database** — renaming
nine money columns and adding currency — automatically and without approval.
Three consequences worth deciding on first:

1. **Any staging APK already on a tester's device will break.** It speaks the
   old wire format. `android-staging-distribution` is `workflow_dispatch` only,
   so a replacement build does not ship on its own.
2. **Migration 044 has no down migration.** It is verified locally against D1
   but has never met a database with data in it.
3. **Production is unaffected.** It is `workflow_dispatch` only, behind a typed
   confirmation, a required reviewer, and a SHA already verified on staging.

## Environments

| Environment | Branch policy | Reviewer | Deployments to date |
| --- | --- | --- | --- |
| `production` | Protected only | Yes | 16 |
| `staging` | Protected only | — | 34 |
| `staging-contract-tests` | Protected only | — | 45 |
| `backup-restore-production` | Protected only | Yes | 1 |
| `backup-restore-staging` | Protected only | Yes | 2 |

Only `main` is a protected branch, so only `main` can reach any of them.

## Decisions taken

Recorded where they belong rather than summarised here:

- [ADR-009](decisions/adr-009-minor-units-with-explicit-currency.md) — money is
  minor units plus a currency; supersedes ADR-002.
- [ADR-010](decisions/adr-010-schema-first-api-contract.md) — payload schemas
  are Zod at the route boundary.

Two decisions with no ADR yet:

- **`development` environment: agreed, not built.** It was argued against first,
  on the rule that an environment needs a distinct credential or a distinct
  approval gate. The reversal came from evidence: the cheaper alternative —
  per-PR Cloudflare preview URLs — is unavailable, because preview URLs are not
  generated for Workers implementing a Durable Object, and `orderak-worker`
  binds `RATE_LIMITER`. Its real value is a place to rehearse migrations before
  they meet the staging database.
- **Signed commits and `strict` up-to-date branches: deliberately off.** Both
  were considered and declined as cost without matching benefit at this team
  size.

## What makes this verifiable

Run these; they are what every "done" above rests on.

```bash
cd services/backend && pnpm test && pnpm run test:types && pnpm run lint
```

```bash
cd contracts/openapi && npm run check
```

```bash
node tooling/repository/verify-worker-budget.mjs
```

Plus, from the repository root: `verify-doc-frontmatter`, `verify-doc-claims`,
`verify-doc-links` and `verify-doc-encoding` under `tooling/repository/`, and
`python -m mkdocs build --strict`.

All of the above passed at the time of writing, on commit `6daff2c`.
