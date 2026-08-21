---
status: archived
generated: false
owner: governance
last_verified: 2026-08-19
applies_to: [production]
---
# Phase 9 — decommissioning the old repository

What it contains, what gates it, and the earliest date it can start.

## What Phase 9 requires

From the plan, in its own order:

1. **Decide the history question explicitly.** Archiving makes a repository
   read-only; it removes nothing. Its history still contains the `.wrangler`
   cache files that were dropped from the new repository. Either purge history
   or make it private/restricted, per the retention policy — the plan requires a
   decision, not a default. **Decided and taken 2026-08-16: restrict, do not
   purge.** `youo1/Orderak` is now **private**. See the record below.
2. **Revoke secrets, deploy keys, webhooks and GitHub App installations
   *before* archiving.** Archiving does not revoke anything.
3. **Keep the encrypted bundle** with checksum, two copies, and a proven
   restore.
4. **Point README and description at `Orderak.APP`**; close or move open issues.
5. **Delete nothing until two production releases have shipped from the new
   repository.**

## Gate 1 — two production releases: met, thinly

```text
2026-08-16T08:10:34  e13aa9e21a  success   (cutover)
2026-08-16T12:11:31  21bd46e56a  success   (7c key-version flip)
```

Two successful deploys from `Orderak.APP`, so the letter is satisfied.

**The spirit is not, and that is worth saying rather than counting to two and
moving on.** Both shipped within four hours on the same day, by the same
person, in the same window. The rule exists to show the new repository can ship
reliably over time, and two releases hours apart is not that evidence. Treat it
as a floor that has been reached, not as proof.

## Gate 2 — the old age key: **2026-09-15 at the earliest**

This is the binding constraint, and it is a clock, not a task.

Every backup written before today is encrypted to the **old** age recipient,
and the only identity that can open them lives in `youo1/Orderak`'s
`backup-restore-*` environments. It could not be copied across, because a
GitHub secret cannot be read back — that is the incident recorded in
`2026-08-16-age-key-replacement.md`.

The newest old-key object, taken from the pointer manifests and the run logs
rather than guessed:

```text
orderak-geo/2026-08-16T0258Z     written by the old repository's 02:58 UTC run,
                                 before its schedule was removed the same day
```

Objects under `d1/` carry a **30-day retention lock**. So the earliest date on
which no old-key object remains recoverable-and-needed is **2026-09-15**.

Until then, `youo1/Orderak` must keep `restore-drill.yml` runnable and its
`backup-restore-*` environments intact. Revoking its secrets before that date —
step 2 of Phase 9 — would make every pre-cutover backup permanently unopenable.

### Why the newest old-key object is a geo backup

Because production's main-database backups had been **failing for two days**
and nobody noticed:

```text
2026-08-16T02:55  failure     <- orderak-db failed, orderak-geo succeeded
2026-08-15T02:47  failure     <- same
2026-08-14T04:03  success     <- last successful orderak-db under the old key
```

The failing step was `Restore drill — prove the export is recoverable`, and the
cause is the row-loss guard defect fixed today: `admin_auth_challenges` going
1 → 0 is retention deleting expired MFA challenges, not data loss. The old
repository still carries the unfixed script.

**It is not being fixed there.** That repository no longer runs backups —
`Orderak.APP` owns the schedule and has the fix, and produced a verified
production backup today. Porting the fix would give a retired repository a
capability it should not exercise.

The finding that matters is not the bug, which is fixed. It is that production
backups were broken for two days and the only reason it surfaced is that
someone went looking for an unrelated date. A nightly job that fails silently
is the same failure class as the Semgrep gate that had been red since 08-12.

## Sequence when the date arrives

1. Run one restore drill in `youo1/Orderak` against an old-key object and
   confirm it still passes. **Nothing is revoked before that passes** — it is
   the last moment the old identity's usefulness can be checked.
2. Confirm no old-key object remains that anyone would want.
3. Revoke the old repository's secrets, deploy keys, webhooks, App
   installations.
4. Delete the five duplicate Cloudflare tokens listed in
   `credential-consolidation-plan.md`.
5. Decide and act on the history question in item 1 above.
6. Point README and description at `Orderak.APP`; close or move issues.
7. Archive.

## Summary

| Gate | State |
| --- | --- |
| Two production releases | met 2026-08-16, thinly |
| Old age key retention | **blocks until 2026-09-15** |
| History decision | **made 2026-08-16** — restrict, not purge; repository is private |
| Restore drill on an old-key object | not run since the key replacement |

Phase 9 cannot start before **2026-09-15**, and the delay is a property of the
backups, not of unfinished work.

---

## Execution log

### 2026-08-16 — everything except the two gated steps

Phase 9 was executed as far as it can go without destroying a capability that
cannot be rebuilt.

**Done:**

| Step | Result |
| --- | --- |
| Point description at `Orderak.APP` | set, and states *why* the repository still exists |
| README banner | added, naming the 2026-09-15 date and the reason |
| Close or move open issues | none open (`open_issues_count: 0`) |
| Revoke superseded secrets | 9 removed |

Revoked from `youo1/Orderak`:

```text
production   CLOUDFLARE_ANALYTICS_TOKEN, CLOUDFLARE_D1_BACKUP_TOKEN, CLOUDFLARE_DRIFT_CHECK_TOKEN
staging      CLOUDFLARE_D1_BACKUP_TOKEN, FIREBASE_APP_DISTRIBUTION_CREDENTIALS,
             FIREBASE_STAGING_GOOGLE_SERVICES_JSON, R2_ACCESS_KEY_ID, R2_ENDPOINT,
             R2_SECRET_ACCESS_KEY
```

Production answered 200 on both surfaces immediately afterwards.

### A naive check that would have caused damage

The first comparison asked "does `Orderak.APP` have a secret with this name",
and reported that it lacked `CLOUDFLARE_ANALYTICS_TOKEN`,
`CLOUDFLARE_D1_BACKUP_TOKEN`, `CLOUDFLARE_DRIFT_CHECK_TOKEN` and
`CLOUDFLARE_RESTORE_READ_TOKEN`. All four were false: the secrets were **renamed**
to `ORDERAK_*` earlier the same day, so the capability was present under a
different name.

Acting on that output would have concluded the opposite of the truth, and the
one case where the naming coincidence is genuinely dangerous is `AGE_IDENTITY` —
**the same name in both repositories holding different keys**, the old one
irreplaceable. A name match is not a capability match, in either direction.

### Three dead credentials found on the way

`R2_ACCESS_KEY_ID`, `R2_ENDPOINT` and `R2_SECRET_ACCESS_KEY` are referenced by
**no workflow in either repository**. S3-compatible R2 credentials sitting in an
environment with nothing to use them — pure exposure, no function. Revoked. The
underlying R2 API tokens should be deleted in Cloudflare too.

### Deliberately still in place

| Environment | Kept | Until |
| --- | --- | --- |
| `backup-restore-production` / `-staging` | `AGE_IDENTITY` (**old key**), `CLOUDFLARE_RESTORE_READ_TOKEN` | 2026-09-15 |
| `staging-contract-tests` | `CONTRACT_SELLER_PHONE`, `CONTRACT_SELLER_SECRET` | until `Orderak.APP` holds its own copies |

The contract-seller pair is the **only copy anywhere**. `Orderak.APP`'s
`staging-contract-tests` environment exists but is empty, and the secret cannot
be read back to move it — the same trap the age identity fell into. Revoking it
here would force recreating the staging seller.

### The history decision, made 2026-08-16: restrict, not purge

Phase 9 step 1 asks for an explicit decision between purging history and
restricting access. **`youo1/Orderak` was made private.** History was not
rewritten, and that is the decision rather than a deferral of it.

What its history actually contains was checked, not assumed: no credentials, no
tokens, no keys. The `.wrangler` cache files hold the Cloudflare account id, the
owner email, and an approximate location and ISP from a request-info blob —
personal information, and no longer public.

The trade flipped once the provenance cost was counted. **19 of the 25 `drop`
rows in `tooling/migration/manifests/pre-migration-freeze.json` cite
`youo1/Orderak@016e3207` as their sole evidence** — they are the record of files
deliberately absent from this repository, and that commit is the only place the
content they refer to exists. Rewriting history changes every SHA and orphans
all 19, destroying the provenance chain of the migration itself in order to
remove information that going private has already taken out of public view.

#### The side effect, measured rather than assumed

Going private **stripped `required_reviewers` from both `backup-restore-*`
environments** in that repository — recorded before and after: the rule was
present, and after the change both read `[]`. Environment reviewers are not
available on private repositories under this plan.

So restore drills there now run unapproved until the repository is archived.
Accepted rather than overlooked: the gate constrained access on a *public*
repository, the repository is private with a single owner, and the drill
decrypts to `/tmp` and shreds without touching a database.

The same plan limit applies to every environment in that repository, so the
`staging-rollback` reviewer named in the break-glass procedure is gone on the
same evidence. That is noted in
[the staging/production workflow guide](../guides/staging-production-workflow.md#break-glass-deploying-staging-from-the-source-repository);
it has not been separately measured, and the control that actually holds there
is that the environment carries no credential at all.

### Remaining, and why each waits

1. **Archive the repository** — blocks Actions, which takes `restore-drill.yml`
   with it. This is the reason the whole phase waits, not a formality.
2. ~~**The history decision**~~ — **closed 2026-08-16.** The repository was made
   private rather than history-purged, and the reasoning is recorded under
   [The history decision](#the-history-decision-made-2026-08-16-restrict-not-purge)
   below.
3. **Delete the five duplicate Cloudflare tokens** — after a restore drill
   passes here against an old-key object.
