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

**Production: not proven.** The production half of the same backup run failed
before writing anything, because `orderak-backup-production` carries
`D1 → Read` where `d1 export` needs `D1 → Edit`. So:

| | staging | production |
| --- | --- | --- |
| New recipient set | yes | yes |
| New identity in environment | yes | yes |
| Backup under the new key | **yes** | **none** |
| Drill passed | **yes** | **nothing to drill** |

Production is therefore in a state worth naming precisely: **a new keypair
configured but never exercised, and existing backups openable only by the old
repository.** It is not broken, and it is not finished.

## What must happen before this is closed

1. Fix `orderak-backup-production` to `D1 → Edit`.
2. Run a production backup — it encrypts to the new recipient.
3. Run the drill against it. **Only that proves the production pair.**

## The old repository cannot be retired yet

It holds the only identity for every production and staging object encrypted
before 2026-08-16. Those objects sit under a **30-day retention lock**, so it
must stay able to run `restore-drill.yml` until the last of them ages out.

That is a second, independent block on Phase 9, alongside the plan's own rule
that nothing is deleted until two production releases have shipped from the new
repository — one has.
