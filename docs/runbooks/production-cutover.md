---
status: current
generated: false
owner: governance
last_verified: 2026-08-15
applies_to: [production]
---
# Production cutover runbook — Phase 8

Moving production ownership from `youo1/Orderak` to `youo1/Orderak.APP`.

**Nothing in this runbook has been executed.** It is the procedure and the
readiness assessment, written before the window rather than during it.

## Evidence Register, re-run 2026-08-15

The plan requires this before cutover, because *"'0 orders' was true on the day
it was measured"*.

| Claim | Result |
| --- | --- |
| Main DB ledger vs repo | repo has **45** migration files; production ledger **44**, staging **45**. The gap is `043_audit_signing_key_version`, deliberately not on production yet |
| Geo DB ledger vs its 1 file | **1** on both `orderak-geo` and `orderak-geo-staging` — matches |
| Production is empty | `orders 0`, `order_items 0`, `products 0`, `buyer_restrictions 0`, `buyer_privacy_requests 0`, `play_purchases 0`, `play_verification_jobs 0`, `sellers 1` |
| App never published | **Not verifiable from here.** Needs Play Console evidence — draft, internal and closed tracks are all invisible to git |
| GitHub repository state | See below |

**Production carries no customer data.** One seller row and nothing else. That
is the single most important input to how much risk this window carries, and it
is measured, not assumed.

## GitHub state, and what was fixed

| | `youo1/Orderak` | `youo1/Orderak.APP` |
| --- | --- | --- |
| Environments | 7 | **1** (`staging`) |
| Branch protection | present | present |
| Required status checks | 4, `strict: true` | **was none — now matches** |
| Force pushes / deletions | disabled | disabled |
| Actions | enabled, all actions allowed | same |
| Secret scanning / push protection | disabled | disabled — same, and worth revisiting separately |
| Webhooks, deploy keys | 0, 0 | 0, 0 |

**Required status checks were absent and are now set** to
`build-test-lint`, `protected-auth-contract`, `test`, `lint-and-links` with
`strict: true`, matching the old repository exactly.

Phase 3 deferred these until the job names existed here, and warned that a
path-filtered required check *"never reports and blocks merges permanently"*.
Checked before enabling: all four workflows trigger on bare `pull_request:`
with **no `paths:` filter**, so each reports on every pull request and the trap
does not apply.

## Blockers — the window cannot open until these are cleared

### 1. `Orderak.APP` has no `production` environment

The old repository's `production` environment holds four Cloudflare tokens:
`CLOUDFLARE_API_TOKEN`, `CLOUDFLARE_D1_BACKUP_TOKEN`,
`CLOUDFLARE_DRIFT_CHECK_TOKEN`, `CLOUDFLARE_ANALYTICS_TOKEN`. `Orderak.APP` has
none of them, and no environment to put them in. It cannot deploy production
today.

**This step cannot be performed by the assistant.** Entering API tokens into
any field is prohibited, without exception. The environment and its secrets
must be created by the repository owner.

### 2. There is no production rollback credential path

Phase 7a requires that when a repository's deploy credentials are withdrawn, a
rollback credential survives **outside Actions** — offline custody, or a
protected environment with required reviewers and a stated expiry.

`staging-rollback` exists for staging. **Nothing equivalent exists for
production.** Withdrawing the old repository's production tokens without one
means that if the first deploy from `Orderak.APP` fails, neither repository can
roll production back.

This must be established *before* step 1 of the window, not after.

### 3. Migration 043 is not applied to production

Recorded in `secret-rotation.md` as step 0 of 7c. Production's
`admin_audit_exports` has no `signing_key_version` column, so rotating
`ADMIN_AUDIT_SIGNING_KEY` would leave its 21 archives unverifiable.

### 4. The four remaining environments

`backup-restore-staging`, `backup-restore-production`, `staging-contract-tests`
and `staging-rollback` are all absent from `Orderak.APP`. See
`docs/governance/evidence/2026-08-13-missing-github-environments.md` — including
the tested finding that an unconfigured `backup-restore-*` fails closed rather
than running an unapproved restore, and the narrower residual risk that
replaces it.

## Order of the window

1. **Establish the production rollback credential** outside Actions, and
   confirm it works by listing production Worker versions with it.
2. **Create `production` in `Orderak.APP`** with the four tokens and the vars
   `CLOUDFLARE_ACCOUNT_ID`, `AGE_RECIPIENT`, `DEPLOY_OWNER=youo1/Orderak.APP`.
3. **Withdraw the old repository's production deploy credentials.** GitHub
   concurrency groups do not synchronise across repositories, so two
   repositories able to deploy the same Worker is the outage this step exists
   to prevent.
4. **Record pre-cutover provenance** — production Worker Version IDs, the
   source SHA, lockfile hash and toolchain versions, before anything changes.
5. **Deploy production from `Orderak.APP`**, applying migration 043 as part of
   it. Confirm the ledger reads 45.
6. **7c — rotate production runtime secrets**, in the order in
   `secret-rotation.md`, re-measuring the dependent row counts first rather
   than trusting the dated ones.
7. **Production soak, after the rotation, never before.** A soak validates one
   combination of code, config and secrets; rotating afterwards invalidates it.
8. **Re-run the Evidence Register** and record the post-cutover state.

## Artifact identity

The plan is explicit that staging and production artefacts **must not** be
required to match: the Worker script names differ so Version IDs can never be
equal, and the admin bundle embeds `VITE_SENTRY_DSN` at build time. Require
instead:

- the same source SHA, lockfile hash and toolchain (Node, pnpm, Java, Gradle,
  wrangler) and the exact build commands;
- artifact hashes and Worker Version IDs recorded **per environment**;
- a provenance mapping from each deployment back to its source;
- an explicit allowlist of environment-specific differences — anything outside
  it is a defect, not a variation;
- exact hash equality only where a build has no environment-specific inputs.

## What the assistant cannot do in this window

Entering credentials — API tokens, secrets, passwords — into any field is
prohibited regardless of who asks or how the request is framed. Steps 1, 2 and
6 therefore belong to the repository owner. The assistant can prepare
everything around them, verify each step afterwards against the live system,
and stop the window if a check fails.
