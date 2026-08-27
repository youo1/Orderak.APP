---
status: draft
generated: false
owner: security
applies_to: [production]
---
# ADR-011: A copy of the D1 backups outside this Cloudflare account

**Status:** proposed — Tiers 1 and 3 need an engineering-lead decision; Tier 2 is blocked on `R-003`

**Date:** 2026-08-27

**Supersedes:** none

**Superseded by:** none

> **Naming note.** Resources this ADR proposes but has not created are written
> without backticks on purpose. `tooling/repository/verify-doc-claims.mjs`
> requires every backticked `orderak-*` name to exist in a wrangler config or in
> its declared-exception list, and a proposal is not an exception — it is a name
> that is not real yet. Backtick them in the same change that creates them.

## Context

Three layers protect the production databases today, and each was checked
against Cloudflare's documentation on 2026-08-27 rather than assumed:

- **Time Travel.** Always on, no configuration, no additional cost. 30 days on
  Workers Paid, 7 on Free. All four databases in the account report
  `version: production`, so all four qualify. Restore is destructive and
  in-place — it overwrites the database and cancels in-flight queries — and it
  cannot clone or fork to a new database. Capped at 10 restores per 10 minutes
  per database.
- **`orderak-backups`.** A nightly encrypted export per database, with a
  checksum and a row-count manifest, under a 30-day retention lock on the `d1/`
  prefix.
- **Split key custody.** `.github/workflows/d1-backup.yml` holds the age
  recipient only; the identity that decrypts lives in a separate GitHub
  environment the backup job cannot enter.

That is a strong set of controls against the failures it was designed for, and
one it does not address at all: **every copy lives in the same Cloudflare
account.** `docs/runbooks/d1-restore.md` already records the gap in as many
words — "What is still missing: a copy outside this Cloudflare account. The lock
defends against deletion within the account; it does not defend against losing
the account." This ADR is the decision that sentence has been waiting for.

The failure modes actually in scope:

| Failure | Covered today | By what |
| --- | --- | --- |
| Accidental write, inside 30 days | Yes | Time Travel |
| Accidental write, older than 30 days | Yes | R2 export |
| Backup-job credential compromise | Yes | Retention lock + recipient-only key |
| Restore-drill credential compromise | Yes | No D1 or R2-write credential in scope |
| Database deleted | Yes | R2 export — Time Travel dies with the database |
| **Account suspended (billing, ToS)** | **No** | — |
| **Account takeover at full-admin level** | **No** | — |
| **Bucket deleted by an actor holding the account** | **No** | The lock binds objects, not an account holder |

The last three are one scenario wearing three hats: an actor or an event that
holds the account defeats every control at once, because every control is inside
it.

Scale makes this cheap to fix. Measured 2026-08-27: `orderak-db` is 2.4 MB and
`orderak-geo` is 39 MB.

## The constraint that shapes this decision

The obvious answer — push a copy to Backblaze B2 or S3 — is **not available
today**, and proposing it as step one would produce a decision that cannot ship:

- `R-003` in `docs/governance/registers/risk-register.md` is open and rated
  Critical: "Western Europe hosting or another vendor transfer is not approved."
  A new storage provider is exactly the vendor transfer that risk is about.
- `docs/legal/privacy-policy.md` tells sellers "The Platform runs on
  Cloudflare's global network." A second provider is a new sub-processor and a
  new cross-border transfer, requiring a policy update and counsel sign-off
  before a single byte moves.

The backups contain seller phone numbers. Adding a custodian is a privacy
decision before it is an infrastructure one.

## Decision

Three tiers, deliberately separated by what each one needs in order to proceed.

### Tier 1 — a second Cloudflare account. Ship now; no new approval.

A second Cloudflare account, with its own R2 bucket (proposed name:
orderak-backups-offsite) and its own API token (proposed name:
orderak-backup-offsite).

- `.github/workflows/d1-backup.yml` gains a final step that pushes the same
  `.sql.age` ciphertext and its `.sha256` to that bucket.
- A new repository secret, `ORDERAK_OFFSITE_BACKUP_WRITE`, scoped to that
  account's bucket only. It must not reuse `orderak-backup-production`.
- The same 30-day retention lock on the `d1/` prefix, for the same erasure
  reason recorded in the restore runbook.

Cloudflare is already the disclosed processor, so this adds **no sub-processor,
no cross-border transfer, and no privacy-policy change**. That is the entire
reason it can ship this week while Tier 2 cannot. It covers account takeover and
operator error, and partly covers suspension. It does not cover a
Cloudflare-wide action against the account holder.

### Tier 2 — a genuinely independent provider. Blocked on `R-003`.

Backblaze B2 or S3: an application key restricted to write-only on one bucket
(no delete, no list), and Object Lock set to 30 days to mirror the R2 lock.

**Do not implement ahead of approval.** This tier proceeds only once `R-003`
closes and the privacy policy names the vendor.

### Tier 3 — an offline copy. Ship now; manual.

Monthly, download the latest ciphertext pair into the same offline custody that
already holds the age identity under the rotation procedure. No vendor, no
transfer, no CI credential, and no shared failure domain with anything above.
Weakest automation, strongest independence — it complements Tier 1 rather than
competing with it.

## Invariants this must not break

1. **Ciphertext only.** The copy is the `.sql.age` file. The second location
   never receives plaintext and never receives the age identity. Adding a
   custodian must not widen who can read a seller's phone number — this is what
   keeps the privacy delta of Tier 1 near zero, and it is the property that
   makes Tier 2 arguable at all.
2. **Write-only credential.** A compromised CI token must not be able to delete
   the offsite copy, for the same reason the R2 retention lock exists.
3. **30 days, not indefinite.** `deletion_requests.deadline_at` gives a
   deletion request a 90-day deadline. An unbounded offsite copy would put
   retention in direct conflict with the erasure obligation — the identical
   reasoning already recorded for the R2 lock.
4. **Verified, not assumed.** An unverified second copy repeats the exact
   mistake this repository already fixed once, when a backup job that could
   never have produced an artifact still reported green.
   `.github/workflows/restore-drill.yml` gains a source input so the drill can
   run against the offsite copy. **A green drill against the offsite copy is the
   definition of Tier 1 being done.** Until it runs, the copy is a claim.

## Consequences

- RPO is unchanged at 24 hours. RTO for the account-loss case moves from
  "unrecoverable" to "restore from the second account."
- Cost is negligible: roughly 42 MB of database per day sits inside R2's free
  allowance for a 30-day window, and the added CI time is seconds per run.
- **A second account is a second thing to keep paid and keep recoverable.** If
  both accounts share one email, one password manager, and one payment card,
  Tier 1 buys far less than it appears to. The recovery factors must genuinely
  differ. Record which factors differ as the evidence that Tier 1 is real —
  otherwise this ADR produces a second copy inside the same blast radius and a
  false sense that the gap is closed.
- **This does not fix the age identity being a single point of failure.** The
  offline custody step in the rotation procedure is a prerequisite for this ADR
  to mean anything. A second copy of something nobody can decrypt is not a
  second backup.
- Tier 2 remains open work. Closing `R-003` is the gating action, not more
  engineering.

## Alternatives considered

- **Do nothing; rely on Time Travel.** Rejected on the evidence above: Time
  Travel is scoped to the database object and the account containing it,
  restores destructively in place, and cannot fork. It is an excellent undo and
  should stay the first move for recent accidental writes. It is not a backup,
  because it dies with the thing it protects.
- **Third-party provider first.** Rejected for now, not on merit — it is the
  strongest option — but because `R-003` and the privacy policy block it.
  Sequencing it first would stall the whole change behind an approval that has
  been open since 2026-08-14.
- **GitHub Actions artifacts or a release asset.** Rejected. Retention caps
  aside, it stores backup ciphertext in the same system that already holds the
  credentials that write it. That is not a second custodian.
- **Accept the risk and record it.** A legitimate choice if the owner decides
  account-level loss is out of scope for a pre-launch product. It is listed here
  because the status quo is currently this option chosen by default rather than
  on purpose, and that is the part worth fixing regardless of which tier is
  approved.

## Approval

| Tier | Approver | Blocking dependency |
| --- | --- | --- |
| 1 | Engineering lead | none |
| 2 | CTO + privacy lead | `R-003`, privacy-policy update |
| 3 | Engineering lead | offline custody of the age identity |
