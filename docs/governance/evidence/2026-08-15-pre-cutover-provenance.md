---
status: archived
generated: false
owner: governance
last_verified: 2026-08-15
applies_to: [production]
---
# Pre-cutover provenance snapshot

Phase 8 step 4: record what production is running **before** anything changes.
Captured 2026-08-15, read-only. This is the state a rollback would target.

## Production Worker versions

| Worker | Config | Version ID | Deployed |
| --- | --- | --- | --- |
| `orderak-worker` | `services/backend/wrangler.jsonc` | `31e55a78-0309-4c37-81f7-9646a2bc3807` | 2026-08-01T19:40:52Z |
| `orderak-admin-worker` | `services/backend/wrangler.admin.jsonc` | `032d9193-6713-4287-93cf-c73b4237d9b9` | 2026-08-01T19:41:41Z |
| `orderak-admin-edge` | `apps/admin-web/wrangler.edge.jsonc` | `3ed87dfc-5a62-408f-9a1a-08889a932fd4` | 2026-08-01T19:42:36Z |

**The first capture of this table listed two Workers and production has three.**
`orderak-admin-edge` lives under `apps/admin-web/`, not beside the other two,
and was missed by a sweep of `services/backend/wrangler*.jsonc`. A rollback set
that is missing a member is worse than none, because it looks complete. Found
by reading what `production-deploy.yml` actually deploys rather than by
listing config files in one directory.

All three carry `Source: Unknown (deployment)` and the same author, so the
provenance finding below applies to the whole set.

## Source and toolchain

```text
HEAD                45ff6d4fbbe63d0fab453d0e66a018a9b1dd3cc2
pnpm-lock.yaml      sha256 dc1ad63711e88270f561a8ca24a1e039…
node                v24.18.0
pnpm                11.20.0
wrangler            4.119.0 (pinned)
```

## The finding: production has no provenance, and never has

Phase 8 requires *"a **provenance mapping** from each deployment back to its
source"*. **For the currently-running production deployment, that mapping does
not exist and cannot be reconstructed.**

Three facts establish it:

1. **`production-deploy.yml` has never run.** Not "no runs in the retained
   window" — the workflow's run count is **0**. It has never been dispatched.
2. **Cloudflare records the deployment's origin as `Source: Unknown
   (deployment)`**, not an Actions run.
3. **The author is `ayman.abdellatif@proton.me`** — the account owner's OAuth
   session, not a scoped CI token.

Production was therefore deployed **by hand from a local shell**. There is no
commit SHA attached to version `31e55a78`, no build record, no lockfile hash,
and no way to determine from the outside which source produced what is serving
traffic today. `/health` returns `{"ok":true,"service":"orderak-worker"}` and no
version identifier.

**The rollback target is a version whose source is unknown.** That is the
honest description of the safety net this cutover would be falling back to.

## Why this changes what the cutover must do, rather than excusing it

The available argument is that production has always been deployed this way, so
one more manual deploy is consistent with precedent. That is the wrong
conclusion. The cutover is the single most consequential deployment production
will receive, and Phase 8 names provenance as a requirement of it specifically.
Repeating the pattern would mean the cutover itself lands with no source
mapping, and the next person asking "what is production running?" would be no
better off than today.

So the cutover routes through GitHub Actions, which produces a run id, a commit
SHA, a build log and an environment gate — and gives production its **first
provenanced deployment**.

## A credential note

The OAuth session available in this working environment carries account-wide
`workers`, `workers_scripts`, `d1`, `queues` and `secrets_store` **write**
scopes. Every step of the cutover — the deploy, migration 043, the 7c rotation
— is technically executable from here right now.

It was not used for any of them, and should not be. Deploying production from a
local shell with the owner's personal session bypasses the deploy-owner gate,
the environment gate, the required reviewers, the Actions audit trail, and the
provenance mapping above — every control the migration built. The only
production interactions in this session were `SELECT` queries and `GET`
requests.
