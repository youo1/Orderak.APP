---
status: current
generated: false
owner: governance
last_verified: 2026-08-15
applies_to: [production]
---
# Production cutover runbook — Phase 8

Moving production ownership from `youo1/Orderak` to `youo1/Orderak.APP`.

> **Phase 8 has NOT started, and this document does not start it.**
>
> The plan holds it closed: *"No production change is in scope right now …
> Phases 7c, 8 and 9 are **documented but deliberately not started**, and
> require a **separate explicit go-ahead**."* Writing the procedure is the
> "documented" half. The go-ahead is a decision, and it has not been given.
>
> Nothing here has been executed. Production was last deployed 2026-08-01; its
> migration ledger reads 44 and its admin Worker carries 7 secrets, all
> unchanged.

## What was done while preparing this, and why each was in scope

Distinguishing this precisely matters, because "we started the cutover" and
"we prepared for a cutover we have not started" are different claims and only
the second is true.

| Action | Scope |
| --- | --- |
| Production row counts and migration ledger | The plan's own named exception: *"read-only production evidence-gathering … which reads and writes nothing"* |
| Reading both repositories' GitHub settings | Read-only |
| **Enabling required status checks on `Orderak.APP`** | **Phase 3**, not Phase 8 — *"Required checks are enabled only once the job names actually appear in the new repo"*. A change to the new repository, not to production |
| Writing this runbook | The "documented" half of "documented but deliberately not started" |

No production secret was set, no production deploy ran, no production schema
changed.

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

## Before any of the below: the go-ahead itself

The plan requires a **separate explicit go-ahead** for Phases 7c, 8 and 9. The
blockers listed next are what must be true *once that decision is taken*. They
are not a checklist that, once ticked, opens the window on its own.

## Blockers — the window cannot open until these are cleared

### 0. Where the production credentials actually are

Re-checked 2026-08-15 at every level, because the owner recalled adding them
and a single narrow query is not evidence of absence:

| | `Orderak.APP` | `Orderak` |
| --- | --- | --- |
| Repository-level secrets / variables | 0 / 0 | 0 / — |
| Environments | **1** (`staging`) | 7 |
| `production` environment | **does not exist** | 4 tokens + 2 vars |

The recollection was right and the location was not. The four production tokens
— `CLOUDFLARE_API_TOKEN`, `CLOUDFLARE_D1_BACKUP_TOKEN`,
`CLOUDFLARE_DRIFT_CHECK_TOKEN`, `CLOUDFLARE_ANALYTICS_TOKEN` — are in the **old**
repository, which is correct for now: it still owns production. Two of them
were created during this migration, which is why adding them is a real memory.

The query method was validated against a known-good case in the same pass: the
same call returns `staging`'s two secrets and three variables in `Orderak.APP`.

### 1. `Orderak.APP` has no `production` environment

The old repository's `production` environment holds four Cloudflare tokens:
`CLOUDFLARE_API_TOKEN`, `CLOUDFLARE_D1_BACKUP_TOKEN`,
`CLOUDFLARE_DRIFT_CHECK_TOKEN`, `CLOUDFLARE_ANALYTICS_TOKEN`. `Orderak.APP` has
none of them, and no environment to put them in. It cannot deploy production
today.

**This step cannot be performed by the assistant.** Entering API tokens into
any field is prohibited, without exception. The environment and its secrets
must be created by the repository owner.

### 1b. Production backups have never been proven restorable

Found 2026-08-15 while answering "where does `AGE_RECIPIENT` come from".

The backups themselves are healthy. `orderak-backups` holds current pointers
for both databases, and `pointers/orderak-db/latest.manifest.json` is dated
**2026-08-14T04:04:21Z** with per-table row counts.

The restore path is not. Comparing the two restore environments in the old
repository:

| Environment | Secrets |
| --- | --- |
| `backup-restore-staging` | `AGE_IDENTITY`, **`CLOUDFLARE_RESTORE_READ_TOKEN`** |
| `backup-restore-production` | `AGE_IDENTITY` only |

`restore-drill.yml` preflights all three of `CLOUDFLARE_RESTORE_READ_TOKEN`,
`CLOUDFLARE_ACCOUNT_ID` and `AGE_IDENTITY`, so a production drill fails closed
before it starts. **The drill that passed was the staging one.** Production has
encrypted backups, a private key to decrypt them, and no demonstrated path from
one to the other.

This matters for the cutover specifically: "restore from backup" is part of the
safety story, and for production it is currently an assumption rather than a
tested capability. The staging drill proves the *mechanism* works; it does not
prove production's objects decrypt with production's identity.

**Add `CLOUDFLARE_RESTORE_READ_TOKEN` to `backup-restore-production` and run
the drill once against production before the window opens.** The token needs
R2 read on `orderak-backups` and D1 access for the target database.

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

   **`AGE_RECIPIENT` is copied, never regenerated.** It is a *public* key —
   which is why it is a variable rather than a secret, and why its value can be
   read straight across:

   ```text
   production  age179jkg4anwc37myta0knnvxgcyw7ptt2gyas7svhm5gpr0pfu9qpqs8hffn
   staging     age1lky0gkvv47y9y66yelsuz87wwevku43r24rau4n8g6kzxm2mgvnqema9ze
   ```

   `Orderak.APP`'s `staging` already matches the old repository's, so a backup
   taken by either is decryptable by the same identity. Generating a fresh
   keypair for production would **orphan every existing production backup**:
   they are encrypted to the recipient above, and only the matching
   `AGE_IDENTITY` — held in the old repository's `backup-restore-production`
   environment — can open them.

   The four Cloudflare **secrets** are the opposite case: GitHub secrets cannot
   be read back, so they are re-created as fresh least-privilege tokens rather
   than copied. That is also cleaner, since the old repository's are revoked at
   step 3 anyway.

   **Set required reviewers at the same time.** These are now available —
   the old constraint applied to private repositories and both repositories are
   public, verified on 2026-08-15 by creating a throwaway environment, having
   the API accept a `reviewers` payload, and deleting it. Neither repository's
   `production` environment uses them today; the old repository's carries only a
   `branch_policy` rule.

   Note also that the old repository has **no owner gate on production at all** —
   no `.github/actions/` directory, no `DEPLOY_OWNER` variable on its
   `production` environment. Its approval boundary is the typed
   `DEPLOY_PRODUCTION` confirmation, which stops an accident but not a decision.
   `Orderak.APP` should not inherit that gap.
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
