# D1 migration drift

> **Status:** Restricted production-recovery procedure
>
> **Owner:** Engineering lead
>
> **Rule:** Stop before any production write. Do not replay migrations or edit
> the migration ledger until the live schema, ledger, and recovery point have
> been independently verified.

Use this runbook when `wrangler d1 migrations list orderak-db --remote` reports
historical migrations as pending even though production appears to contain
their schema changes.

## 1. Immediate safety actions

1. Pause deployments and migration jobs for the affected database.
2. Open an incident/change record and record the database ID, environment,
   Wrangler version, operator, and UTC time.
3. Confirm the target with `npx wrangler d1 info orderak-db`.
4. Confirm that D1 Time Travel is available and record the current bookmark:

   ```cmd
   cd services/backend
   npx wrangler d1 time-travel info orderak-db
   ```

   Time Travel is plan-dependent: currently 7 days on Workers Free and 30 days
   on Workers Paid. Do not continue if a usable recovery point cannot be
   verified.
5. Export the production database to a protected location before any repair.

## 2. Read-only diagnosis

List the unapplied migrations:

```cmd
cd services/backend
npx wrangler d1 migrations list orderak-db --remote
```

Inspect the ledger and schema without changing either:

```cmd
npx wrangler d1 execute orderak-db --remote --command "SELECT * FROM d1_migrations ORDER BY id;"
npx wrangler d1 execute orderak-db --remote --command "SELECT name, sql FROM sqlite_schema WHERE type IN ('table','index') ORDER BY name;"
```

Compare the results with every file in `services/backend/migrations/`, including both
`015_*.sql` files and migrations through `023_publish_legal_v2.sql`. A single
telltale column is not sufficient evidence that an entire migration ran.

Classify the state:

| State | Meaning | Next action |
|---|---|---|
| Schema and ledger agree | No drift | Apply only genuinely pending migrations through Wrangler |
| Schema is missing an intended change | Schema drift | Create and test a new forward-only repair migration |
| Schema is exact but ledger is incomplete | Ledger drift | Escalate for an exceptional, reviewed ledger repair |
| State is ambiguous or partially applied | Unknown | Stop; restore a copy for forensic comparison before deciding |

## 3. Preferred repair: forward-only migration

For schema drift, create a new migration that moves the observed production
schema to the desired schema. Do not edit an already-deployed migration file.

1. Reproduce the production schema in an isolated database.
2. Write an idempotent or precisely guarded forward migration.
3. Test it against a restored/exported copy and verify data counts, constraints,
   indexes, and application queries.
4. Obtain engineering-lead approval and record the recovery bookmark.
5. Apply with Wrangler so the migration is recorded normally:

   ```cmd
   cd services/backend
   npx wrangler d1 migrations apply orderak-db --remote
   ```

Cloudflare documents that a failed migration is rolled back while earlier
successful migrations remain applied. Still verify the schema and application
health after every production apply.

## 4. Exceptional ledger-only repair

A ledger-only repair is allowed only when all of the following are true:

- The complete SQL effect of each affected migration is already present.
- Schema objects, constraints, indexes, and required data transformations were
  compared—not inferred from one column.
- A usable Time Travel bookmark and protected export exist.
- The cause of the missing ledger record is documented.
- A second qualified reviewer and the engineering lead approve the exact SQL.

This runbook intentionally provides no generic `INSERT` or `DELETE` command for
`d1_migrations`. The exact statement must be generated for the confirmed live
ledger schema, attached to the incident/change record, reviewed, and executed
once. Never bulk-mark the migration history as applied.

## 5. Verification and recovery

After an approved repair:

1. Run `npx wrangler d1 migrations list orderak-db --remote`.
2. Re-run the complete schema comparison.
3. Run backend smoke tests and verify critical seller, product, order, auth, and
   legal-version paths.
4. Record before/after evidence and close the change only after monitoring.

If data or schema is damaged, stop writes and use the verified Time Travel
bookmark under incident control. A restore overwrites the live database and
must not be attempted casually.

## 6. Prevention

- Apply migrations with `wrangler d1 migrations apply`, not by directly
  executing migration files.
- Treat applied migration files as immutable; correct defects with a new
  forward migration.
- Review the remote migration list before and after each deployment.
- Keep the generated reference in `docs/guides/database-migrations.md` aligned
  with `services/backend/migrations/`, but treat the SQL files as authoritative.

## References

- [Cloudflare D1 migrations](https://developers.cloudflare.com/d1/reference/migrations/)
- [Cloudflare D1 Wrangler commands](https://developers.cloudflare.com/d1/wrangler-commands/)
- [Cloudflare D1 Time Travel and backups](https://developers.cloudflare.com/d1/reference/time-travel/)
