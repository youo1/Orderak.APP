---
status: current
generated: false
owner: security
last_verified: 2026-08-19
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

| # | Token | Permissions | GitHub secret — environment |
| --- | --- | --- | --- |
| 1 | `orderak-deploy-staging` | **Account:** Workers Scripts `Edit`, D1 `Edit`, Queues `Edit`, Workers R2 Storage `Edit`<br>**Zone:** Workers Routes `Edit`, Zone `Read` | `ORDERAK_DEPLOY_STAGING` — `staging` |
| 2 | `orderak-deploy-production` | same as above | `ORDERAK_DEPLOY_PRODUCTION` — `production` |
| 3 | `orderak-backup-staging` | **Account:** D1 `Edit`, Workers R2 Storage `Edit` | `ORDERAK_BACKUP_STAGING` — `staging` |
| 4 | `orderak-backup-production` | same as above | `ORDERAK_BACKUP_PRODUCTION` — `production` |
| 5 | `orderak-drift-check` | **Account:** D1 `Read`, Workers Scripts `Read`, Queues `Read`, Workers R2 Storage `Read` | `ORDERAK_DRIFT_CHECK` — `production` |
| 6 | `orderak-analytics` | **Account:** Account Analytics `Read` | `ORDERAK_ANALYTICS` — `production` |
| 7 | `orderak-restore-read` | **Account:** Workers R2 Storage `Read`, D1 `Edit` | `ORDERAK_RESTORE_READ` — `backup-restore-*` |
| 8 | `orderak-rollback-breakglass` | **Account:** Workers Scripts `Edit` | **offline custody only — never in GitHub** |

`Zone` rows apply to the `orderak.app` zone.

### The secret name and the environment variable are not the same string

The column above is the **GitHub secret** each token value is stored in. It is
not the name the workflow step sees. Every one of these is read into the
environment variable **`CLOUDFLARE_API_TOKEN`**, because that is what wrangler
looks for:

```yaml
CLOUDFLARE_API_TOKEN: ${{ secrets.ORDERAK_DEPLOY_STAGING }}
```

Only the `secrets.*` half was renamed. `CLOUDFLARE_ANALYTICS_TOKEN` is the one
exception — `infra-drift.yml:96` keeps that environment variable name because the
script reading it expects it, fed from `secrets.ORDERAK_ANALYTICS`.

Conflating the two is not academic: it is what broke the first production backup
after the rename, which failed with *"CLOUDFLARE_D1_BACKUP_TOKEN is not set"* — a
true message about a secret that no longer existed under that name.

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

These old-scheme names are superseded. Delete each one once no workflow in
this repository still reads it — check before removing, because the name a
workflow reads is not always the name the token carries.

`CLOUDFLARE_ANALYTICS_TOKEN` is the fifth old-scheme name; it is the only one
with no `orderak-` counterpart yet, so it stays in use until one is created.
