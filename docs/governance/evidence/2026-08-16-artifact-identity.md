---
status: archived
generated: false
owner: governance
last_verified: 2026-08-16
applies_to: [production, staging]
---
# Artifact identity — Phase 8

The plan is explicit that staging and production artefacts **must not** be
required to match, and equally explicit about what must be required instead.
This records each of those five requirements against evidence.

## Same source SHA, lockfile hash, and toolchain

```text
source SHA        e13aa9e21a263423254b37fb5ae421974d9429cf  (production deploy)
lockfile          pnpm-lock.yaml sha256 dc1ad63711e88270f561a8ca24a1e039…
node              24
pnpm              11.20.0
wrangler          4.119.0 (pinned in every invocation)
build commands    pnpm run deploy:production / deploy:production:admin / admin-web deploy
```

Staging deployed the same SHA before production was permitted to — that is the
gate `production-deploy.yml` enforces, not a convention.

## Artifact hashes and Worker Version IDs, per environment

**Version IDs** — recorded per environment, never compared, because the script
names differ and they can never match:

| Worker | Production version |
| --- | --- |
| `orderak-worker` | `a7ed08ca-68f0-4350-b0fa-6b9ddde98ed8` |
| `orderak-admin-worker` | `c072ddd6-1530-4879-8c14-2a70d6f4109b` |
| `orderak-admin-edge` | `40de88f0-33cc-4df7-ad14-d0d3bc9b64cd` |

**Bundle hashes** — built with `wrangler deploy --dry-run --outdir` for each
environment from the same checkout:

| Bundle | Production | Staging | |
| --- | --- | --- | --- |
| `public-worker.js` | `ff743c50d7339084` | `ff743c50d7339084` | **identical** |
| `admin-worker.js` | `fec2d06cffb309a0` | `fec2d06cffb309a0` | **identical** |

## Exact hash equality where there are no environment-specific inputs

Both Worker bundles satisfy this, and the reason they can is worth stating: on
Workers, environment configuration arrives as **runtime bindings**, not
build-time substitutions. The same source produces the same bytes for both
environments, and the difference between them is entirely in what is bound to
those bytes at deploy time.

So a hash mismatch between the two Worker bundles would mean the source or
toolchain differed — which is precisely the signal the plan wants, and it is
now checkable rather than assumed.

## The allowlist of environment-specific differences

Already recorded in `2026-08-12-pre-cutover-baseline.md`: Worker script names,
Version IDs, D1 database IDs and names, R2 bucket and queue names, hostnames,
and the deliberate per-environment vars. Anything outside it is a defect.

### One entry in the plan's reasoning does not currently apply

The plan names the admin bundle as an expected difference, because it *"embeds
`VITE_SENTRY_DSN` at build time, so its hash differs by design."*

**`VITE_SENTRY_DSN` is not set in any environment** — checked against both
`staging` and `production` secrets and variables, in both repositories. The
build reads `import.meta.env.VITE_SENTRY_DSN` (`main.tsx:14`) and gets nothing,
so admin-web currently has **no** environment-specific build input and the
stated exception is dormant.

This matters in one direction only: the day someone sets `VITE_SENTRY_DSN`, the
exception becomes real and the admin bundle's hashes legitimately diverge. Until
then, treating that divergence as expected would excuse a difference that has
no cause. Recorded so the exception is claimed when it applies, not before.

It also connects to a finding already recorded in the Phase 5b review: setting
that DSN activates Sentry Session Replay at `replaysOnErrorSampleRate: 1.0`
over an admin DOM containing seller and buyer data. The masking prerequisites
there apply before that variable is ever set.

## Provenance mapping

In `2026-08-16-post-cutover-provenance.md`, including the finding that
Cloudflare does not populate `Source` for a token-authenticated `wrangler
deploy` — so the mapping is a record kept here, not a field read from the
dashboard.

## Outstanding

**The production soak.** Phase 8's final requirement, and the only one still
open. `api-load.js` forbids running against production by design, and a cutover
soak means observation under real traffic, which production does not have
(0 orders, 1 seller). An 8-minute observation at ~0.17 rps after the 7c
rotation showed 160 samples, zero non-200 — evidence the rotation did not break
production, and explicitly **not** a soak.
