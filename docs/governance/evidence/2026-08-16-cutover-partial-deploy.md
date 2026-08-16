---
status: current
generated: false
owner: governance
last_verified: 2026-08-16
applies_to: [production]
---
# Cutover: the first production deploy failed part-way

Run `31934706790`, 2026-08-16. **Production is serving normally throughout** —
`api.orderak.app/health` and `admin.orderak.app/` both return 200.

## What happened

The deploy passed every gate — confirmation text, deploy-owner, staging-SHA
check, main-tip check, deployment map, both builds — then failed inside
**"Deploy production API and Admin Worker"**:

```text
A request to the Cloudflare API (/zones/a80d99fee381bfb8b12e44d60616af94/workers/routes) failed.
Authentication error [code: 10000]
```

## Cause: my error in specifying the token

The four permission rows I gave for `CLOUDFLARE_API_TOKEN` were **all
account-level**: Workers Scripts, D1, Queues, Workers R2 Storage — each `Edit`.

Deploying a Worker also **reconciles its zone routes**, which is a call to
`/zones/{zone}/workers/routes` and needs **`Zone → Workers Routes`**. I omitted
it. The token is exactly as specified and the specification was incomplete.

The public Worker deployed anyway because `wrangler.jsonc` declares its three
hostnames as `custom_domain: true`, a different API surface. `wrangler.admin.jsonc`
declares **no** `routes` block at all, so wrangler queries the zone to reconcile
what is already there — and that query is what was rejected. The asymmetry is
why one Worker succeeded and the next did not.

## State after the failure

| | Before | After | |
| --- | --- | --- | --- |
| `orderak-worker` | `31e55a78` | **`691d5297`** | deployed |
| `orderak-admin-worker` | `032d9193` | `032d9193` | unchanged |
| `orderak-admin-edge` | `3ed87dfc` | `3ed87dfc` | never attempted |
| `d1_migrations` ledger | 44 | **45** | migration 043 applied |
| `admin_audit_exports.signing_key_version` | absent | **present** | |

**Migration 043 landed**, which was step 0 of 7c and a prerequisite for rotating
the production audit key. That part of the window is genuinely complete.

## Why fix forward rather than roll back

Rollback is available and was deliberately not used:

1. **Production is healthy.** Both surfaces answer 200. Nothing is degraded.
2. **The failure is a credential scope, not a code defect.** The same commit
   deployed cleanly to staging minutes earlier, on the same toolchain.
3. **Rolling back the public Worker would not restore the prior state anyway.**
   Migration 043 is applied and is not reversed by a Worker rollback, so a
   rollback produces a *different* mixed state — old code against a newer
   schema — rather than the state recorded before the window.
4. **The mixed state is benign.** 043 adds one column with a default. The old
   admin Worker ignores a column it does not know about; the public Worker
   never reads `admin_audit_exports` at all.

The honest description is a **partial deploy that is safe to hold briefly**,
not an incident requiring reversal. It is not a state to leave standing, and
the fix is a single permission row.

## Fix

Add to the production `CLOUDFLARE_API_TOKEN`:

```text
Zone → Workers Routes → Edit      on orderak.app
Zone → Zone → Read                (to resolve the zone)
```

Then re-run the deploy on the same SHA. The steps that already succeeded are
idempotent: `d1 migrations apply` skips what the ledger records, and
`wrangler deploy` re-uploads the same build.
