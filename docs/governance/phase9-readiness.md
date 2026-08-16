---
status: current
generated: false
owner: governance
last_verified: 2026-08-16
applies_to: [production]
---
# Phase 9 — decommissioning the old repository

What it contains, what gates it, and the earliest date it can start.

## What Phase 9 requires

From the plan, in its own order:

1. **Decide the history question explicitly.** Archiving makes a repository
   read-only; it removes nothing. `youo1/Orderak` is **public**, and its history
   still contains the `.wrangler` cache files that were dropped from the new
   repository. Either purge history or make it private/restricted, per the
   retention policy — the plan requires a decision, not a default.
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
| History decision | not made |
| Restore drill on an old-key object | not run since the key replacement |

Phase 9 cannot start before **2026-09-15**, and the delay is a property of the
backups, not of unfinished work.
