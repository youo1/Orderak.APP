---
status: current
generated: false
owner: governance
last_verified: 2026-08-12
applies_to: [production, staging]
---
# Pre-cutover baseline — 2026-08-12

Phase 8 opens with "re-run the Evidence Register", because *"0 orders was true
on the day it was measured"*. This is that re-run, plus the artifact and
toolchain identity Phase 8 requires recording per environment.

**Nothing here changed production.** Every figure is a read-only query, which
is the one production interaction the staging-only scope permits.

## Production data — still effectively pre-launch

| Table | Rows |
| --- | --- |
| `orders` | 0 |
| `order_items` | 0 |
| `products` | 0 |
| `buyer_restrictions` | 0 |
| `buyer_privacy_requests` | 0 |
| `play_purchases` | 0 |
| `play_verification_jobs` | 0 |
| `sellers` | 1 |
| `organizations` | 1 |

The zero counts are what make several Phase 7 rotations safe to perform
directly rather than through a dual-key migration. That safety expires the
moment real sellers arrive — **re-measure before relying on it.**

## Migration ledgers

| | Applied | Latest | Repository files |
| --- | --- | --- | --- |
| `orderak-db` (production) | **44** | `042_email_outbox.sql` | 45 |
| `orderak-db-staging` | 45 | `043_audit_signing_key_version.sql` | 45 |
| `orderak-geo` (production) | 1 | `001_csc_city_catalog.sql` | 1 |

**Production is one migration behind.** The gap is exactly
`043_audit_signing_key_version`, which is a *prerequisite* for rotating
`ADMIN_AUDIT_SIGNING_KEY` there: without it, production's 21 audit archives
carry no key version and rotating would leave them unverifiable — the failure
043 exists to prevent. Applying 043 to production must precede that rotation,
and both belong inside the cutover window.

Geo is aligned; nothing pending.

## Deployed artifacts

| Environment | Worker version | Deployed |
| --- | --- | --- |
| `orderak-worker` (production) | `31e55a78-0309-4c37-81f7-9646a2bc3807` | **2026-08-01T19:40:52Z** |
| `orderak-worker-staging` | `f472df48-274c-45c8-b9b4-02438bf08f5a` | 2026-08-12T07:54:50Z |

Production is running code from **eleven days before** this migration's work
began. That is correct — `production-deploy.yml` is manual and has not been
run — but it means production has none of it: not the encrypted backups, not
the audit key versioning, not the corrected migration commands.

## Toolchain identity

Phase 8 requires the same source SHA, lockfile and toolchain across
environments, and records artifacts per environment rather than requiring them
to match.

| | Value |
| --- | --- |
| Package manager | `pnpm@11.20.0` (pinned via `packageManager`) |
| `engines.node` | `>=22.13` |
| Node in both deploy workflows | `22` — identical for staging and production |
| Wrangler | `^4.118.0` |
| Hono | `^4.13.0` |
| Vitest | `^4.1.10` |
| `pnpm-lock.yaml` sha256 | `28249a2ddc73a35e…` |

Staging and production deploys read the same lockfile and pin the same Node
version, so a build difference between them would be a defect rather than an
expected variation.

## Allowlist of environment-specific differences

Anything outside this list is a defect, not a variation.

| Difference | Why it is expected |
| --- | --- |
| Worker script names (`orderak-worker` vs `orderak-worker-staging`) | Separate scripts by design; a name is part of the deployment identity |
| Worker Version IDs | Per-script and per-deploy; they can never match and are recorded rather than compared |
| D1 database IDs and names | Separate databases — that isolation is the point |
| R2 bucket names, queue names, hostnames | Same reason |
| `ADMIN_TOTP_KEY_CURRENT`, feature flags, AI budget | Deliberate per-environment configuration |

### A correction to the plan

The plan lists the admin bundle as expected to differ, because *"the admin
bundle embeds `VITE_SENTRY_DSN` at build time, so its hash differs by
design."*

**That is not true today.** `apps/admin-web/vite.config.ts:14` makes the Sentry
plugin conditional on `SENTRY_AUTH_TOKEN`, and no Sentry variable or secret is
configured in any environment — the plugin is a no-op. So the admin bundle
contains no environment-specific input and **must hash identically across
environments**. The allowlist is shorter than the plan assumed, and the
hash-equality check correspondingly stricter.

If Sentry is ever configured, this entry becomes valid and the check must be
relaxed **at that point**, not pre-emptively.

## What this baseline does not cover

- **Play Console publication status.** The plan already records this as not
  provable from git: no signing config and `versionCode = 2` do not rule out a
  draft, internal or closed track. It needs Play Console evidence, which is not
  reachable from here.
- **A live snapshot after cutover.** By definition this is the "before" half.
  The "after" half is taken during Phase 8 itself.
