---
status: archived
generated: false
owner: governance
last_verified: 2026-08-12
applies_to: [production, staging, internal]
---
# Phase 5a — documented commands, executed

Phase 5a's rule is *"every documented command is run from the path the doc
states, and must succeed"*, with anything unrunnable marked
`unverified-by-design` with a reason.

Extracted from every fenced block in 86 documents, tracking the working
directory the surrounding prose states: **154 commands, 95
unverified-by-design, 59 runnable.**

## What the execution found

The plan warned specifically against a mechanical `npm` → `pnpm` substitution,
*"because it produces a differently-wrong document"*. **I made exactly that
mistake during this pass**, and running the command is what caught it — see
"A correction I had to make to my own fix" below.

### Two commands that could not succeed

| Location | Command | Why it fails |
| --- | --- | --- |
| `guides/openapi-development.md` | `npm --prefix contracts/openapi ci` | `npm ci` requires `package-lock.json` or `npm-shrinkwrap.json`. **Neither exists in any package** — checked at the root, `contracts/openapi`, `services/backend` and `apps/admin-web`. This is a pnpm workspace |
| `guides/troubleshooting.md` | `npm ci` | Same |

This is the identical defect the plan already caught in `setup.md`. It survived
in two other files because the earlier documentation pass verified that script
*names* exist, which `npm ci` passes — it is a built-in, not a script.

### One command with an undocumented prerequisite

`pnpm run cloudflare` was presented as standalone. On a clean checkout it
fails:

```text
Error: ENOENT: no such file or directory, open '…/contracts/openapi/dist/seller-v1.json'
```

It consumes the bundle that `pnpm run bundle` produces, and `dist/` is
git-ignored build output. Verified that `bundle` then `cloudflare` succeeds.
The document now shows both steps and says why the order matters.

### One command that named no directory

`pnpm run cloudflare` is declared in `contracts/openapi/package.json`, not the
workspace root, so it fails with "script not found" from the root. The document
gave no path. Now stated.

### Eleven that worked but contradicted the toolchain

`npm.cmd`, `npx.cmd` and bare `npm run` in
`localization-architecture.md`, `documentation.md`, `setup.md`,
`deployment-environment-map.md` and `openapi-development.md`. These execute —
npm can run scripts from a pnpm workspace — so they are inconsistency rather
than breakage, and are corrected as such.

## A correction I had to make to my own fix

I replaced `npm --prefix contracts/openapi ci` with
`pnpm --filter ./contracts/openapi install --frozen-lockfile` **without running
it**. It reports "Already up to date" and creates nothing, because
`pnpm-workspace.yaml` sets `nodeLinker: hoisted` — dependencies land in the
root `node_modules` and `contracts/openapi/node_modules` never exists by
design. A reader following it would find no dependencies where they looked.

The correct instruction is a root `pnpm install --frozen-lockfile`. Recorded
here rather than quietly amended, because it is the precise failure mode the
plan predicted, and it happened to the person doing the checking.

## Deliberately not changed

`governance/evidence/2026-07-18-repository-baseline.md:76` still reads
`npm.cmd test -- --run`. It is a dated record of *"checks that completed
successfully during the integrated-roadmap assessment on 18 July 2026"*, when
the repository used npm. Editing it would falsify evidence to satisfy a
consistency check. Evidence records state what happened; they are not
maintained to match current tooling.

## Executed, from the stated path

| Path | Command | Result |
| --- | --- | --- |
| root | `git --version` / `node --version` / `pnpm --version` | 2.54.0 / v24.18.0 / 11.20.0 |
| root | `pnpm run verify:deployment-map` | Pass — paths, environments, resources, bindings, clients, OpenAPI aligned |
| root | `pnpm run lint:markdown` | Pass — 122 files, 0 issues |
| root | `pnpm run openapi:check` | Pass — full chain through portals |
| root | `pnpm --filter ./services/backend test -- --run` | Pass — 35 files, 222 tests |
| `contracts/openapi` | `pnpm run bundle` | Pass |
| `contracts/openapi` | `pnpm run cloudflare` | Pass, after `bundle` |
| `services/backend` | `pnpm run cf-types:check` | Pass — generated types up to date |

## Unverified-by-design — 95 commands

Not run, with the reason each is excluded. **Owner: repository owner**, since
every category needs either a live credential, a device, or a state change.

| Category | Why |
| --- | --- |
| `wrangler deploy` / `secret put` / `d1 execute` / `d1 migrations apply` / `r2 object` / `queues create` / `rollback` | Touches live Cloudflare state or needs credentials |
| `gh secret` / `gh variable` / `gh workflow` / `gh api` | Changes GitHub state or needs a token |
| `gradlew` tasks | Needs the Android toolchain; `connected*` needs a device |
| `wrangler dev`, `mock:seller-v1` | Long-running servers |
| `k6 run` | Sustained load against a live environment |
| `git clone` / `push` / `commit` | Changes repository state |
| `openssl rand`, `age-keygen` | Generates key material |

The Android tasks are the largest single group and remain unverified for the
same machine-level reason recorded in Phase 4: the local Gradle daemon does not
start on this machine. They are exercised by `android-ci.yml` on every pull
request, which is the evidence that covers them.
