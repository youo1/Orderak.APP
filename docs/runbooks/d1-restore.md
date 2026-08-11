# D1 restore from backup

> **Status:** Restricted production-recovery procedure
>
> **Owner:** Engineering lead
>
> **Rule:** Never restore over a live database. Restore into a new database,
> verify it, then repoint bindings. A restore that overwrites the only copy of
> production removes the option to try again.

Use this runbook to recover a D1 database from the R2 backups produced by the
`.github/workflows/d1-backup.yml` workflow.

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

List the available backups:

```bash
npx wrangler r2 object get orderak-backups/pointers/orderak-db/latest.manifest.json --file=./latest.manifest.json --remote
```

Backups are keyed `d1/<database>/<TIMESTAMP>.sql`, each with a `.sql.sha256`
and a `.manifest.json` beside it. Download the chosen set:

```bash
TS=2026-08-08T0200Z
npx wrangler r2 object get "orderak-backups/d1/orderak-db/${TS}.sql" --file=./restore.sql --remote
npx wrangler r2 object get "orderak-backups/d1/orderak-db/${TS}.sql.sha256" --file=./restore.sql.sha256 --remote
npx wrangler r2 object get "orderak-backups/d1/orderak-db/${TS}.manifest.json" --file=./restore.manifest.json --remote
```

Verify the checksum before trusting the file:

```bash
sha256sum --check restore.sql.sha256
```

Then prove it is restorable *before* creating anything in the account:

```bash
cd services/backend
node scripts/verify-d1-restore.mjs ../../restore.sql --compare ../../restore.manifest.json
```

Stop if this fails. A backup that does not replay is not a recovery option, and
you still have Time Travel.

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
