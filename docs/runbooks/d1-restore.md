# D1 restore from backup

> **Status:** Restricted production-recovery procedure
>
> **Owner:** Engineering lead
>
> **Rule:** Never restore over a live database. Restore into a new database,
> verify it, then repoint bindings. A restore that overwrites the only copy of
> production removes the option to try again.

Use this runbook to recover a D1 database from the R2 backups produced by the
`.github/workflows/d1-backup.yml` workflow. To prove a backup is recoverable
without doing a real restore, dispatch
`.github/workflows/restore-drill.yml` instead — it runs the same decrypt and
verify steps below under a reviewer-gated environment, without touching any
live database.

For accidental writes within the Time Travel window, prefer
[Time Travel](#appendix-time-travel) — it is faster and loses nothing. Use this
runbook when Time Travel cannot reach the point you need, or when the account
or database itself is gone.

## What the backup does and does not contain

| Contained | Not contained |
| --- | --- |
| Every ordinary table, with schema and rows | FTS5 search indexes |
| `d1_migrations` ledger | R2 objects (media, audit exports) |
| A `.sha256` checksum and a row-count manifest | Durable Object storage, including rate-limit counters |

**FTS5 indexes are excluded deliberately.** `wrangler d1 export` fails outright
on a database containing virtual tables:

```text
D1_ERROR: cannot export databases with Virtual Tables (fts5)
```

The backup therefore passes an explicit table allowlist computed by
`scripts/d1-exportable-tables.mjs`. The indexes are derived data — Step 5
rebuilds them from their source tables. **A restore is not complete until
Step 5 runs**, or city and taxonomy search will return no results while the
rest of the application appears healthy.

Affected indexes:

| Database | Virtual table | Source | Defined in |
| --- | --- | --- | --- |
| `orderak-db` | `geo_city_search` | `geo_cities` | `migrations/033_auth_onboarding_v2.sql` |
| `orderak-db` | `business_taxonomy_search` | `business_taxonomy` | `migrations/037_places_and_business_taxonomy.sql` |
| `orderak-geo` | `city_catalog_search` | `city_catalog` | `geo-migrations/001_csc_city_catalog.sql` |

## 1. Immediate safety actions

1. Pause deployments, migration jobs, and the backup workflow for the affected
   database.
2. Open an incident record. Note the database ID, environment, Wrangler
   version, operator, and UTC time.
3. Record the current recovery point *before* changing anything:

   ```bash
   npx wrangler d1 time-travel info orderak-db
   ```

4. Decide and write down the target point in time, and who approved it.

## 2. Select and verify a backup

Backups are encrypted. Every object under `d1/` is AGE ciphertext — the
export never touches R2 in plaintext. List the available backups:

```bash
npx wrangler r2 object get orderak-backups/pointers/orderak-db/latest.manifest.json --file=./latest.manifest.json --remote
```

Backups are keyed `d1/<database>/<TIMESTAMP>.sql.age`, each with a
`.sql.age.sha256` beside it. Download the chosen set:

```bash
TS=2026-08-08T0200Z
npx wrangler r2 object get "orderak-backups/d1/orderak-db/${TS}.sql.age" --file=./restore.sql.age --remote
npx wrangler r2 object get "orderak-backups/d1/orderak-db/${TS}.sql.age.sha256" --file=./restore.sql.age.sha256 --remote
npx wrangler r2 object get "orderak-backups/d1/orderak-db/${TS}.manifest.json" --file=./restore.manifest.json --remote
```

Verify the checksum on the ciphertext before decrypting anything:

```bash
sha256sum --check restore.sql.age.sha256
```

**Decrypt.** The private key is not in this checkout, this machine's normal
environment, or any workflow the backup job can reach. It lives only as the
`AGE_IDENTITY` secret in the `backup-restore-staging` /
`backup-restore-production` GitHub Environment, both of which require a
reviewer to release it. Retrieve it there (Settings → Environments → the
matching `backup-restore-*` environment), save it to a file that never gets
committed, and decrypt:

```bash
age -d -i ./age-identity.txt -o ./restore.sql ./restore.sql.age
shred -u ./age-identity.txt   # or `rm -f` if shred is unavailable
```

Then prove it is restorable *before* creating anything in the account:

```bash
cd services/backend
node scripts/verify-d1-restore.mjs ../../restore.sql --compare ../../restore.manifest.json
```

Stop if this fails. A backup that does not replay is not a recovery option, and
you still have Time Travel. Delete `restore.sql` once the drill or the actual
restore is done — it is plaintext containing seller phone numbers.

## 3. Restore into a NEW database

Never restore into the live database.

```bash
npx wrangler d1 create orderak-db-restore-YYYYMMDD
npx wrangler d1 execute orderak-db-restore-YYYYMMDD --remote --file=./restore.sql
```

There is no `wrangler d1 import` command — `d1 execute --file` is the restore
path.

If the export exceeds D1's 100 MB import ceiling, split it per table and
restore in dependency order (parents before children).

## 4. Reconcile

```bash
npx wrangler d1 execute orderak-db-restore-YYYYMMDD --remote \
  --command "SELECT COUNT(*) FROM sellers; SELECT COUNT(*) FROM orders; SELECT COUNT(*) FROM order_items;"
```

Compare against `restore.manifest.json`. Investigate **any** shortfall before
proceeding — do not treat a lower count as acceptable rounding.

Then check referential integrity:

```bash
npx wrangler d1 execute orderak-db-restore-YYYYMMDD --remote --command "PRAGMA foreign_key_check;"
```

## 5. Rebuild FTS5 indexes (REQUIRED)

The restored database has no search indexes. Re-create and repopulate each one
using the definition from its migration, for example:

```sql
CREATE VIRTUAL TABLE geo_city_search USING fts5(/* columns per migration 033 */);
INSERT INTO geo_city_search(/* columns */) SELECT /* columns */ FROM geo_cities;
```

Verify each index returns rows before continuing:

```bash
npx wrangler d1 execute orderak-db-restore-YYYYMMDD --remote \
  --command "SELECT COUNT(*) FROM geo_city_search;"
```

## 6. Cut over

1. Point the `orderak_db` binding in `wrangler.jsonc` at the restored
   `database_id`.
2. Deploy to **staging** first and run the smoke checks.
3. Confirm search, ordering, and authentication all work — search is the
   failure mode Step 5 protects against.
4. Deploy to production through the normal promotion workflow.
5. Keep the damaged database. Do not delete it until the incident is closed.

## 7. After the incident

- Record the actual RTO and RPO achieved against the target.
- Confirm the backup workflow is unpaused and its next run is green.
- File follow-ups for anything that made this slower than it should have been.

## Appendix: what protects the backups themselves

The `d1/` prefix of `orderak-backups` carries a retention lock:

```text
name:       d1-backups-30d
prefix:     d1/
condition:  after 30 days
```

Objects under it cannot be deleted or overwritten for 30 days after upload —
including by a compromised deploy token, which is the case the lock exists for.
Verified rather than assumed: an object under `d1/` survives a delete with its
content intact, while an identical object under `pointers/` is removed.

**`wrangler r2 object delete` prints "Delete complete" even when the lock
refuses it.** The CLI is reporting that the request was sent, not that the
object is gone. Confirm a deletion by trying to `get` the key afterwards; do
not trust the delete output.

Two consequences worth knowing before changing anything here:

- `pointers/<db>/latest.manifest.json` is deliberately outside `d1/`. It is
  overwritten every run, and a locked object cannot be overwritten, so moving it
  back under `d1/` would fail every backup after the first.
- 30 days, not indefinite. A deletion request carries a 90-day deadline
  (`deletion_requests.deadline_at`), so a backup holding data someone has asked
  to erase must become deletable inside that window. An indefinite lock would
  put the retention policy in direct conflict with the erasure obligation, and
  would grow storage without bound.

What is still missing: a copy outside this Cloudflare account. The lock defends
against deletion within the account; it does not defend against losing the
account.

## Appendix: encryption key custody and rotation

Every backup is encrypted with [age](https://age-encryption.org) to a
recipient (public key) held by the backup job. Staging and production use
**separate keypairs** — a staging identity cannot decrypt a production
backup, and vice versa.

| | Backup job (`d1-backup.yml`) | Restore drill / manual restore |
| --- | --- | --- |
| Holds | `AGE_RECIPIENT` (public key) — a GitHub **variable**, `staging` and `production` environments | `AGE_IDENTITY` (private key) — a GitHub **secret**, `backup-restore-staging` and `backup-restore-production` environments |
| Can | Encrypt new backups | Decrypt existing backups |
| Cannot | Decrypt anything — the public key alone cannot | Write backups — no D1 or R2-write credential in scope |
| Gated by | Whatever already gates the backup job | A **required reviewer** on the `backup-restore-*` environment — every decrypt is a deliberate, reviewed act, never an automatic one |

This split is the actual control. If the backup job's credentials leak, the
attacker can write bogus future backups but cannot read a single past one —
recipient-only access grants no decryption capability. If the restore
environment's reviewer gate is ever bypassed, that is what exposes history,
which is why it is a separate, narrower-audience environment rather than a
convenience shared with the nightly job.

### Rotating a key

Rotation applies going forward only — age has no re-encryption-in-place.
Existing objects stay decryptable with the old identity until they age out
under the 30-day lock; there is nothing to migrate.

1. Generate a fresh keypair for the affected environment:

   ```bash
   age-keygen -o new-identity.txt
   ```

2. Update the GitHub **variable** `AGE_RECIPIENT` (staging or production
   environment) to the new public key printed above.
3. Update the GitHub **secret** `AGE_IDENTITY` in the matching
   `backup-restore-*` environment to the full contents of `new-identity.txt`.
4. Securely delete the local `new-identity.txt` once both are set —
   `shred -u new-identity.txt` or equivalent.
5. Dispatch `d1-backup.yml` once for the affected environment and confirm the
   run succeeds — that proves the new recipient is live.
6. Keep the **old** identity file in offline custody (a password manager or
   equivalent, never in this repository or any Action) until every backup
   encrypted under it has aged past the 30-day lock and a fresh backup exists
   under the new key. Only then is the old identity safe to discard — losing
   it earlier makes every backup still under the old key unrecoverable.

### Recovery: what happens if the identity is lost

An encrypted backup whose only private key is gone is equivalent to no
backup. There is no recovery path around this — it is why step 6 above exists,
and why the identity's offline copy is a real requirement, not a suggestion.
If both the GitHub secret and the offline copy are lost simultaneously, every
backup encrypted to that recipient is permanently unreadable; the next
successful backup under a freshly rotated key is the first recoverable point
going forward.

## Appendix: Time Travel

For recent accidental writes, Time Travel is the first choice — no export is
involved and nothing is lost:

```bash
npx wrangler d1 time-travel info orderak-db
npx wrangler d1 time-travel restore orderak-db --timestamp=<unix-seconds>
```

Retention is plan-dependent (currently 7 days on Workers Free, 30 on Workers
Paid). Time Travel lives inside the same Cloudflare account, so it does **not**
protect against account loss or a compromised account — that is what the R2
backups in this runbook are for.
