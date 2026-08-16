---
status: current
generated: false
owner: security
last_verified: 2026-08-16
applies_to: [production, staging]
---
# The age keypairs were replaced, and why they had to be

## What went wrong

The private key decrypting every backup existed in exactly one place: an
`AGE_IDENTITY` GitHub secret, which cannot be read back. Migrating
`backup-restore-*` to `Orderak.APP` needed that value, and it could not be
produced from anywhere.

The cause was in our own runbook. `d1-restore.md` step 4 said to shred the
local identity file once the secret was set; step 6 said to keep the **old**
identity in offline custody. Together they destroy the only readable copy of
the **current** key. `d1-restore.md` is now corrected to require offline
custody *before* deletion, with the incident recorded inline.

**A GitHub secret is a deployment mechanism, not custody.** Write-only storage
is not a backup of the thing that opens your backups.

## What was done

New keypairs generated for both environments, private keys placed in offline
custody **first** this time. The public keys were read out of the identity
files with a match narrow enough that no secret material entered any log:

| Environment | New recipient |
| --- | --- |
| production | `age1m82wulejpecjfchqq2s6ppgje2d0dcrsxp7jyr2aldhrfw8s9cfqftz57e` |
| staging | `age1pqesjv5gley0q90uz3m7ajxh5g2w7tr8kp9lrcfcw4p9np9qxc3q3fdlq5` |

`AGE_RECIPIENT` was updated **on `Orderak.APP` only**. The old repository keeps
the old recipient deliberately — it also holds the old identity, and is the
only thing that can open the objects already in R2.

## Proven, and not proven

**Staging: proven end to end.** A backup was taken by `Orderak.APP` under the
new recipient (`2026-08-16T0902Z`, 807,932 bytes) and the drill decrypted it
with the new identity:

```text
RESTORE DRILL PASSED — this export is recoverable.
```

That is the whole chain — new recipient encrypts, new identity opens — and it
confirms the offline copy the owner saved is the matching key.

**Production: proven, after two intervening failures.** Backup
`2026-08-16T1114Z` (1,184,361 bytes) was written under the new recipient and
the drill decrypted it:

```text
RESTORE DRILL PASSED — this export is recoverable.
```

| | staging | production |
| --- | --- | --- |
| New recipient set | yes | yes |
| New identity in environment | yes | yes |
| Backup under the new key | **yes** | **yes** |
| Drill passed | **yes** | **yes** |

### The two failures on the way, because neither was the age key

**First: a token scope.** `orderak-backup-production` carried `D1 → Read`
where `d1 export` needs `D1 → Edit` — the export is a job Cloudflare creates,
not a read.

**Second: the row-loss guard, firing correctly on a wrong rule.**

```text
FAIL: table "admin_auth_challenges" lost rows: 1 -> 0.
```

Not data loss. That table holds MFA challenges with `expires_at` and
`consumed_at`, and `retention.ts` deletes them a day after either. The row
reached zero because the system worked. The guard compared every table against
the previous manifest and treated any decrease as failure, which is right for
`orders` and `sellers` and wrong for the fourteen tables retention deliberately
empties. `verify-d1-restore.mjs` now reads that list from `retention.ts` at
runtime, so it cannot go stale, and falls back to strict on any parse problem.

`orderak-geo` succeeding in the same run as `orderak-db`'s guard failure is
what separated the two causes — the token was already fixed by then.

## All eight tokens are now exercised, not assumed

| Token | Proven by |
| --- | --- |
| `orderak-deploy-staging` | staging deploys, 2026-08-16 |
| `orderak-deploy-production` | production deploy, run 31935783379 |
| `orderak-backup-staging` | staging backup `2026-08-16T0902Z` |
| `orderak-backup-production` | production backup `2026-08-16T1114Z` |
| `orderak-drift-check` | infra-drift, run 31944050943 |
| `orderak-analytics` | queue backlog report in the same run |
| `orderak-restore-read` | both restore drills |
| `orderak-rollback-breakglass` | production deployment list, by the owner |

Token permissions cannot be read back from Cloudflare, so every row above is a
successful run rather than an inspection.

## The old repository cannot be retired yet

It holds the only identity for every production and staging object encrypted
before 2026-08-16. Those objects sit under a **30-day retention lock**, so it
must stay able to run `restore-drill.yml` until the last of them ages out.

That is a second, independent block on Phase 9, alongside the plan's own rule
that nothing is deleted until two production releases have shipped from the new
repository — one has.
