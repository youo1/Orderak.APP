---
status: current
generated: false
owner: governance
last_verified: 2026-08-15
applies_to: [staging, production]
---
# Plan vs. reality — full audit of Orderak.APP

Every claim below was re-checked against `Orderak.APP` on 2026-08-13, not
carried forward from earlier notes. The prompt for this audit was discovering
that work believed proven in the new repository had been proven in the old one.

## Phase 0-1 — baseline and manifest

**The manifest gate was run, and it is the strongest single result here.**

```text
Verifying 705 files from youo1/Orderak@016e3207
  verbatim=632  drop=25  rewrite=25  archive=20  regenerate=3
34 problem(s) — all of one kind: "verbatim content changed"
```

**Zero missing files. Zero drop violations.** Every file the manifest expects is
present, and every file marked `drop` is absent. Nothing was lost in the move.

The 34 findings are files that were to move byte-identical and have since been
edited. 31 have follow-up commits in `Orderak.APP` explaining them — this
session's `secrets.required`, key-version, soak, OpenAPI and documentation work.

The remaining three were a **defect in `verify-manifest.mjs`, not in the
migration**: `gradlew.bat`, `fix-scheduled.ps1`, `patch-scheduled.ps1`. Their
git blobs are byte-identical between the two repositories
(`a51ec4f5…`, `e89c2cab…`, `6c9c9af2…`). The manifest recorded hashes of git
blob content (LF), while the verifier hashed the working-tree file, which git
checks out with CRLF on Windows. Stripping CR reproduced the manifest's expected
hash exactly in all three cases.

**Both fixed 2026-08-15.** The verifier now compares the blob id the manifest
already records — exact and platform-independent — keeping the sha256 digest as
the documented fallback for checking a destination without git. Findings drop
from 34 to **32**, and every remaining one is a genuine content change with a
commit in this repository explaining it.

`pre-migration-freeze.json` also existed only in the old repository, so
`Orderak.APP` could not run the gate that proves nothing was lost in its own
move. It is now carried at
`tooling/migration/manifests/pre-migration-freeze.json` here.

## Phase 2 — foundation: complete

All required files present: `package.json`, `pnpm-lock.yaml`,
`pnpm-workspace.yaml` (with `nodeLinker: hoisted`, `allowBuilds`, `overrides`
preserved), `turbo.json`, `mkdocs.yml`, `.editorconfig`, `.gitattributes`,
`.gitignore`, `AGENTS.md`, `.github/CODEOWNERS`,
`.github/PULL_REQUEST_TEMPLATE.md`, `renovate.json`, and a `.gitleaks.toml`
carrying no allowlist, as the plan required.

## Phase 3 — CI ownership: one requirement outstanding

Scheduled workflows: `d1-backup`, `infra-drift` and `openapi-nightly` correctly
carry **no schedule** in `Orderak.APP`; the old repository still owns them.

Three workflows *do* carry schedules here — `open-source-security`,
`skills-auto-update`, `supply-chain`. Read literally that breaches "every
scheduled workflow stays disabled or manual". Read against the stated reason —
"never leave both repositories acting on the same resources" — it does not:
each was checked and contains **zero** references to Cloudflare, wrangler, or
any shared resource. They scan the repository they run in. Recorded as a
deliberate reading, not an oversight.

**The `DEPLOY_OWNER` negative test — done 2026-08-15.** The gate was observed
failing, which the plan and the action's own header both require before it
counts as a gate.

`DEPLOY_OWNER` on the `staging` environment was temporarily set to
`youo1/Orderak`, `Deploy Staging` was dispatched from `youo1/Orderak.APP`, and
the variable was restored immediately afterwards.

```text
##[error]This environment is owned by 'youo1/Orderak', not 'youo1/Orderak.APP'. Refusing to deploy.
##[error]Process completed with exit code 1.
```

**Nothing deployed.** The `deploy` job's entire step list was:

```text
Set up job
Run actions/checkout
Require deploy owner        <- failed here
Post Run actions/checkout
Complete job
```

No wrangler invocation, no migration, no deploy step ran. The `validate` job
succeeded, so the failure was the gate and not a broken build.

**What this does and does not prove.** It proves the gate's logic fires: the
step compares `vars.DEPLOY_OWNER` against `github.repository` and stops the job
before any Cloudflare call. It does **not** exercise the cross-repository
scenario end to end, because that would require the old repository to hold a
usable staging deploy token — which it deliberately does not, that being the
actual control the plan names. The variable is defence in depth, and defence in
depth is what was tested.

## Phase 4 — deployable baselines: complete

| Unit | Old repo | Orderak.APP | Delta |
| --- | --- | --- | --- |
| backend | 214 | 216 | +2: migration 043 and its test |
| admin-web | 69 | 69 | none — tree is identical |
| seller-android | 168 | 168 | none |
| contracts | 30 | 30 | none |

The plan's figures (206 / 68 / 168) were a point-in-time count that both
repositories have since grown past. The only real delta is the two files added
by this session's audit-key-versioning work.

**Note for Phase 7c:** migration 043 exists only in `Orderak.APP`. The runbook
requires it applied to Production *before* rotating the production audit key,
and the repository that currently deploys Production does not have it.

## Phase 5 — review

- **5a — documented commands:** recorded in
  `2026-08-12-phase5a-documented-commands.md`.
- **5b — code review:** all six criteria closed across all four units in
  `2026-08-12-phase5b-backend-review.md`. Criterion 2 was completed 2026-08-13.
- **5c — documentation: incomplete.** 146 tracked `.md` matches the plan's
  count. Of 97 under `docs/`, **25 carry frontmatter and 72 do not**. Excluding
  `docs/archive/` (11), **61 non-archive documents are missing frontmatter.**
  The frontmatter verifier passes because it validates documents that *have*
  frontmatter; it does not require it. This is the largest single piece of
  unfinished work in the plan.

All six repository verifiers pass: `verify-built-site`,
`verify-contract-guards`, `verify-deployment-map`, `verify-doc-claims`,
`verify-doc-frontmatter`, `verify-doc-links`. Backend type-check and
`openapi:check` pass.

## Phase 6 — data verification and staging parity: complete

Closed this session with the 60-minute soak: 71,992 requests at a sustained
20 rps, 0.00% failures, p95 145.48 ms, p99 274.90 ms, all four k6 thresholds
passed. Rollback triggers now rest on a measured baseline rather than a
30-second idle smoke run. Auth-failure-rate and queue-backlog triggers remain
underived — staging carries no organic traffic — and are recorded as such.

## Phase 7 — credential rotation

- **7a:** complete.
- **7b:** complete and verified end to end — seven secrets rotated, additive
  key rotation proven in both directions, `secrets.required` declared per
  environment and observed failing.
- **7c:** not started. Production, out of scope until cutover.

Outstanding within 7: `ADMIN_RECOVERY_PEPPER`, deferred until admins are
scheduled to regenerate their ten codes.

## Phases 8-10

Not started, and correctly so — the plan holds production untouched until the
cutover window.

## The outstanding list

1. **61 non-archive documents missing frontmatter** (Phase 5c).
2. ~~`DEPLOY_OWNER` negative test~~ — **done 2026-08-15**, gate observed
   failing with nothing deployed.
3. **Five GitHub environments missing from `Orderak.APP`** — see
   `2026-08-13-missing-github-environments.md`. Blocks the nightly soak, and
   `restore-drill.yml`'s reviewer gate would be absent on first dispatch.
4. ~~`verify-manifest.mjs` CRLF false positives~~ — **fixed 2026-08-15**, now
   compares blob ids.
5. ~~Manifest missing from `Orderak.APP`~~ — **fixed 2026-08-15**, carried at
   `tooling/migration/manifests/pre-migration-freeze.json`.
6. **`ADMIN_RECOVERY_PEPPER` rotation** — needs admins scheduled.
7. **Migration 043 is absent from the repository that deploys Production**, and
   is a prerequisite for 7c.
