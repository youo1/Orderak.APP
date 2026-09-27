---
status: current
generated: false
owner: backend
applies_to: [internal]
---
# Backend deletions — the decisions, and what was not deleted

G6 asks that "deletions are proposed as a grouped change with a migration and a
rollback plan". This is that grouped change, plus the candidates that were
**refused**, because a review of this kind is only useful if it records what it
declined as clearly as what it did.

The candidates come from
[`../recon/backend-inventory.md`](./recon/backend-inventory.md) §7. Every claim
below was re-verified against the code before being acted on; where the inventory's
verdict did not survive that, the correction is stated.

## Verification method

A table is dead when **no statement names it**. A text search for the name is not
enough and is actively misleading here: `items` appears 62 times in `src/` and
every one is the English word — `items: z.array(OrderItemSchema)`, a response
field, a loop variable. So the check is a SQL-context search:

```powershell
cd services/backend
$t = 'items'
Select-String -Path (Get-ChildItem src,scripts,test -Recurse -Include *.ts,*.mjs,*.sql -File).FullName `
  -Pattern "(FROM|INTO|UPDATE|JOIN|TABLE|DELETE FROM|DROP TABLE|ALTER TABLE)\s+$t\b"
```

An empty result means no statement reads or writes the table, which is the fact
that matters. It is not the same as "the table is empty", and that distinction
decides the first case below.

## Retired: `items`, `content_pages`

**Decision: renamed out of the way by `migrations/060_retire_dead_tables.sql`.**
Not dropped.

| Table | Created | Verified |
| --- | --- | --- |
| `items` | `001_init.sql:53` | Zero SQL-context references in `src/`, `scripts/` or `test/`. Migration 044 states it outright: "`items` is a dead table. No query in services/backend/src reads or writes it; `products` superseded it." |
| `content_pages` | `003_admin.sql:82` | Zero SQL-context references anywhere. Superseded by `content_page_versions` in migration 012; every query in `public-router.ts` has read the versions table all along. The only mention left was a **stale doc comment**, now corrected in place. |

**Why rename rather than drop.** "No code reads it" is a fact about
reachability. It is not a fact about emptiness: nobody has counted the rows, and
there is no verified backup in this repository to restore them from. Dropping
would be destroying data on the strength of an inference, and this repository's
applied migrations are immutable history, so a drop could not be undone by
editing the file afterwards. A rename clears every reader's path exactly as a drop
would, makes the name say what the table is, and leaves the data one statement
away from returning:

```sql
ALTER TABLE zz_retired_items RENAME TO items;
ALTER TABLE zz_retired_content_pages RENAME TO content_pages;
```

The migration also writes a `retired_tables` row per table, so the follow-up that
drops them has the date and the reason without reconstructing it from git history.
**The drop is the next step, after a backup has been taken and the row counts
recorded.** That is a second deliberate migration (061), not an oversight.

## Refused: `geo_city_names`, `geo_city_search`

The inventory groups these with the two above as "src-unreferenced". They are —
zero references in `src/` — but **refusing them is the correction this review
makes to that verdict.**

Deleting them is not deleting a table, it is retiring a subsystem, and the
evidence is the tooling that still treats them as live:

| Reference | What it does |
| --- | --- |
| `scripts/import-geonames.mjs`, wired as `pnpm run geo:build-geonames-rollback` | writes both tables, and the three `DELETE FROM` statements that clear them |
| `scripts/d1-search-index-rebuild.sql` | rebuilds the search index **from `geo_city_names`**; its own comment exists because `SELECT … FROM geo_city_search` fails on a database that has lost it |
| `scripts/d1-export-schema-extras.mjs` | names `geo_city_search` among the search tables it exports |

The runtime did move on — `src/domains/catalog/geo.ts:103,133,159` reads the
`city_catalog*` set — so the old pair is stale, but three recovery and
maintenance paths would break the moment it is renamed or dropped, and a rename
would surface as a failure during an incident, which is the worst time to discover
that a tool was pointed at a table nobody had touched in a year.

**Trigger to revisit:** when `city_catalog*` is confirmed to have replaced the geo
search index in production, retire the tables, the importer and the rebuild script
together, in one change. Half of that change on its own makes the other half
unsafe.

## Refused: the nine internal-project tables and their route

`roadmap_items`, `project_tasks`, `api_endpoints`, `ai_prompts`, `design_assets`,
`releases`, `bugs`, `project_docs` (all `010_project_admin.sql`) and the
`admin-project.ts` registrations behind them carry the inventory's **DELETE**
verdict on the grounds that they "exist only to serve the internal admin project".

**That is a statement about purpose, not about use, and it does not support a
deletion.** Every one of them is read by a live section an operator can open
today — Roadmap, Tasks, Releases, Bugs, Coverage manifests, AI prompts,
Docs & design, API endpoints, Storefront locales — which is why they appear in
[`../../admin/information-architecture.md`](../admin/information-architecture.md)
as ten sections of the Engineering branch. Deleting them deletes ten working
features.

The evidence that would justify it — that no administrator uses them — is not in
this repository, and cannot be obtained from it. So this is not an engineering
call to make on an inference: it is a product decision about whether Orderak keeps
an internal project tracker inside its admin panel.

**If the owner retires it, the change is three parts in one commit:** the route
registrations in `domains/admin/admin-project.ts`, the nine tables, and the ten
sections plus their manifest entries. Recorded here so that decision, when it is
made, starts from the full list rather than from a fresh survey.

## Deferred: the Play Billing queues and the duplicated pairs

Both are **deployment** changes, and in both the consequence is asymmetric — the
cost of being wrong is much larger than the benefit of being tidy.

| Candidate | Why not now |
| --- | --- |
| Play Billing queues while the flag is off | Removing a queue binding while it is idle saves nothing at runtime, and loses any in-flight purchase-verification message. Re-adding it needs a deployment, and the moment it is needed is the moment a seller has paid. Retire it when the Play lifecycle flag is turned on and the queues prove load-bearing, or when the owner confirms the Play path is abandoned. |
| The Durable Object rate limiter vs the D1 fallback | The code's own comment says the `RATE_LIMITER` binding "has never been deployed to production", so production runs the fallback — and the durable path is the one that was *intended*. Deleting the fallback would change behaviour on a path nobody has measured in production; deleting the durable path would abandon the design. The decision is to **deploy the binding or retire it deliberately**, which is a deployment decision with its own evidence. |
| The second entitlements engine, the legacy plan path | Both need the same check this document used on the tables before anything is removed: which one does a running release actually call? That is a reading task, not a deployment one, and it is the next step rather than a conclusion. |

## What this change contains

| File | Change |
| --- | --- |
| `migrations/060_retire_dead_tables.sql` | new: renames the two dead tables, writes one `retired_tables` row each, carries the `rollout:` marker the migration guard requires, and records its own inverse |
| `migrations.lock` | regenerated by `verify:migrations --update-lock` |
| `src/entrypoints/public-router.ts` | the stale comment that named `content_pages` now names `content_page_versions` and says why it changed |
| `docs/redesign/recon/backend-inventory.md` | §7.1 now points here |

Nothing else was deleted, and nothing was dropped.
