---
status: current
generated: false
owner: security
last_verified: 2026-08-16
applies_to: [production, staging]
---
# Cloudflare API token inventory

The authoritative list. Eight tokens, each with a stated purpose, the exact
permission rows it needs, and where its value is consumed.

## Why eight, and why not four

Cloudflare permissions are scoped to **Zone**, **Account**, or **User**. `D1`,
`Workers Scripts` and `Queues` are **Account** permissions and cannot be
restricted to one database or one Worker.

That has a consequence worth stating plainly, because it is the opposite of
what the names suggest: **`orderak-deploy-staging` and
`orderak-deploy-production` have identical power.** Either can deploy any
Worker and export any database in the account. Splitting them buys **no
capability isolation** — the plan says the same thing: *"a token that can deploy
staging can reach the account's other resources."*

They are split for one real reason: **independent revocation**. If the staging
token leaks, it can be revoked and rotated without stopping production deploys.
That is a genuine operational benefit and the only one; it should not be
mistaken for a security boundary.

The splits that *do* reduce capability are the ones by **function**:

- `orderak-backup-*` has no `Workers Scripts` — a leaked backup token can copy
  data but **cannot deploy code**.
- `orderak-drift-check` is read-only — it cannot change anything.
- `orderak-rollback-breakglass` has only `Workers Scripts` — it cannot touch
  data.

## The eight

| # | Token | Permissions | Consumed as |
| --- | --- | --- | --- |
| 1 | `orderak-deploy-staging` | **Account:** Workers Scripts `Edit`, D1 `Edit`, Queues `Edit`, Workers R2 Storage `Edit`<br>**Zone:** Workers Routes `Edit`, Zone `Read` | `CLOUDFLARE_API_TOKEN` — `staging` |
| 2 | `orderak-deploy-production` | same as above | `CLOUDFLARE_API_TOKEN` — `production` |
| 3 | `orderak-backup-staging` | **Account:** D1 `Edit`, Workers R2 Storage `Edit` | `CLOUDFLARE_D1_BACKUP_TOKEN` — `staging` |
| 4 | `orderak-backup-production` | same as above | `CLOUDFLARE_D1_BACKUP_TOKEN` — `production` |
| 5 | `orderak-drift-check` | **Account:** D1 `Read`, Workers Scripts `Read`, Queues `Read`, Workers R2 Storage `Read` | `CLOUDFLARE_DRIFT_CHECK_TOKEN` — `production` |
| 6 | `orderak-analytics` | **Account:** Account Analytics `Read` | `CLOUDFLARE_ANALYTICS_TOKEN` — `production` |
| 7 | `orderak-restore-read` | **Account:** Workers R2 Storage `Read`, D1 `Edit` | `CLOUDFLARE_RESTORE_READ_TOKEN` — `backup-restore-*` |
| 8 | `orderak-rollback-breakglass` | **Account:** Workers Scripts `Edit` | **offline custody only — never in GitHub** |

`Zone` rows apply to the `orderak.app` zone.

## Two permissions that look wrong and are not

Both were learned by a failed production run, not from documentation.

**`d1 export` needs D1 `Edit`, not `Read`.** The export is a *job* Cloudflare
creates, not a read. A backup token with `D1 Read` fails with:

```text
A request to the Cloudflare API (/accounts/…/d1/database/…/export) failed.
```

**Deploying a Worker needs Zone `Workers Routes`, even for a Worker with no
`routes` block.** wrangler queries the zone to reconcile existing routes.
`wrangler.jsonc` survived on account permissions alone because its hostnames
are `custom_domain: true`, a different API surface; `wrangler.admin.jsonc`, with
no routes at all, did not:

```text
A request to the Cloudflare API (/zones/…/workers/routes) failed.
Authentication error [code: 10000]
```

The lesson for the next token: **derive the permission rows from the API paths
the command actually calls**, not from what the operation sounds like. Both of
the above were specified from memory and both were wrong.

## Duplicates awaiting deletion

Twelve tokens existed on 2026-08-16. Four are the same functions under an older
naming scheme, named after the GitHub secret rather than the purpose:

| Retire | Superseded by |
| --- | --- |
| `CLOUDFLARE_API_TOKEN` | `orderak-deploy-*` |
| `CLOUDFLARE_D1_BACKUP_TOKEN` | `orderak-backup-*` |
| `CLOUDFLARE_DRIFT_CHECK_TOKEN` | `orderak-drift-check` |
| `orderak-restore-read-production` | `orderak-restore-read` |

**Do not delete them yet.** The old repository still runs `restore-drill.yml`
against backups encrypted under the old age key, and its environments hold
whichever of these values it uses. They are deleted once that repository
retires — which is blocked on the old backups ageing past their 30-day lock,
and on the plan's rule that nothing is deleted until two production releases
have shipped from the new repository.

`CLOUDFLARE_ANALYTICS_TOKEN` is the fifth old-scheme name; it is the only one
with no `orderak-` counterpart yet, so it stays in use until one is created.
