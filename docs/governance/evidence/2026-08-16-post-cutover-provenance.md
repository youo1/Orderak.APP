---
status: current
generated: false
owner: governance
last_verified: 2026-08-16
applies_to: [production]
---
# Post-cutover provenance — production's first traceable deployment

Production now runs code deployed from `youo1/Orderak.APP` through GitHub
Actions. Both surfaces answer 200.

## The mapping

Phase 8 requires *"a provenance mapping from each deployment back to its
source"*. This is that mapping.

| Worker | Version ID | Previous |
| --- | --- | --- |
| `orderak-worker` | `a7ed08ca-68f0-4350-b0fa-6b9ddde98ed8` | `31e55a78-0309-4c37-81f7-9646a2bc3807` |
| `orderak-admin-worker` | `c072ddd6-1530-4879-8c14-2a70d6f4109b` | `032d9193-6713-4287-93cf-c73b4237d9b9` |
| `orderak-admin-edge` | `40de88f0-33cc-4df7-ad14-d0d3bc9b64cd` | `3ed87dfc-5a62-408f-9a1a-08889a932fd4` |

```text
source SHA        e13aa9e21a263423254b37fb5ae421974d9429cf
repository        youo1/Orderak.APP
deploy run        31935783379
staging proof     31935610066  (same SHA, succeeded before the gate allowed production)
deployed          2026-08-16T08:13:58Z .. 08:14:07Z
lockfile          pnpm-lock.yaml sha256 dc1ad63711e88270f561a8ca24a1e039…
toolchain         node 24, pnpm 11.20.0, wrangler 4.119.0 (pinned)
migrations        d1_migrations ledger 45 on orderak-db, 1 on orderak-geo
```

## Cloudflare does not record this, and that is worth knowing

The obvious check after deploying through CI is that Cloudflare's own
deployment metadata now names the run. **It does not:**

```text
Author:  undefined
Source:  Unknown (deployment)
```

The same two fields as before the cutover. Cloudflare records `Source` from its
own GitHub integration (Workers Builds); a `wrangler deploy` authenticated with
an API token is opaque to it regardless of what invoked wrangler.

So **the provenance mapping is a record we keep, not a field Cloudflare
populates.** That is what this document is for, and why it has to exist rather
than be inferred from the dashboard later.

The genuine change is not in Cloudflare's metadata. It is that a run now exists
at all:

| | Before | Now |
| --- | --- | --- |
| Actions run for the deployment | **none — `production-deploy.yml` had never run** | `31935783379` |
| Commit SHA attached | none | `e13aa9e` |
| Build log | none | full |
| Gates passed | none | confirmation, deploy-owner, staging-SHA, main-tip, deployment map |
| Reviewer approval | none | required and given |

### One field does change, and it is a useful signal

`Author` moved from `ayman.abdellatif@proton.me` to `undefined`. The email was
the fingerprint of a **manual deploy from a personal OAuth session**; an API
token has no user to name. So on this account, `Author: <an email>` on a Worker
deployment means someone deployed by hand, and `Author: undefined` means it came
from automation. That is a cheap check worth remembering.

## What is not yet done

- **7c** — production runtime secret rotation. Migration 043 is applied
  (ledger 45, `signing_key_version` present), which was its blocking
  prerequisite.
- **Production soak**, which must run *after* the rotation, never before.
- **Phase 9** — decommissioning the old repository.
