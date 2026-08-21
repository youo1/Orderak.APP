---
status: current
generated: false
owner: backend
applies_to: [production, staging]
---
# OpenAPI development and release guide

## Current lifecycle

Orderak has no production users. The three contracts in `contracts/openapi/src/` are
OpenAPI 3.1.2 with JSON Schema 2020-12 and `x-stability: draft`. No compatibility
or Sunset period applies. Git history is the only fallback for removed
pre-release routes.

| Surface | Prefix | Source |
| --- | --- | --- |
| Seller and Android | `/api/v1/*` | `contracts/openapi/src/seller-v1.json` |
| Admin | `/api/admin/v1/*` | `contracts/openapi/src/admin-v1.json` |
| External integrations | `/api/integrations/v1/*` | `contracts/openapi/src/integrations-v1.json` |

`/health`, Digital Asset Links, public HTML, `/media/*`, `/api/theme.css`, and
content-hashed theme CSS are intentionally outside these contracts.

## API-first workflow

1. Edit the target OpenAPI source and record the intent in
   `docs/reference/api-changelog.md`.
2. Obtain Product, Engineering, and Security/Privacy review appropriate to the
   data classification.
3. Add success, empty/pagination, validation, authentication, rate-limit, and
   retryable examples where applicable.
4. Run `pnpm run openapi:check` from the repository root.
5. Run `pnpm run mock:seller-v1`; Android Emulator uses
   `http://10.0.2.2:4010` through the non-releasable `mockDebug` variant.
6. Implement Android DTOs and Worker routes, then rerun Worker, Android, and
   route/spec coverage tests.
7. Delete replaced pre-release routes; tests require `404`, not redirects.
8. Update API, product, setup, architecture, security, and threat-model docs.
9. Attach sanitized CI reports as release evidence.

The `bootstrap` script was used once to capture the existing implementation as
a GAP inventory. It is not a normal authoring command: future contract changes
start in the OpenAPI source, not in route discovery.

## Local commands

From the repository root:

```powershell
pnpm install --frozen-lockfile
pnpm run openapi:check
pnpm run mock:seller-v1
.\apps\seller-android\gradlew.bat -p apps/seller-android testMockDebugUnitTest verifySellerApiContract verifyAuthPhase1Contract
pnpm --filter ./services/backend test -- --run
```

The install is a **root** install, not a per-package one. `pnpm-workspace.yaml`
sets `nodeLinker: hoisted`, so dependencies land in the root `node_modules` and
`contracts/openapi/node_modules` never exists — filtering the install to that
one package reports "Already up to date" and leaves nothing where a reader
would look for it.

The internal portal may expose Swagger UI with Local Prism and Staging servers
behind Cloudflare Access. A future public Redoc build uses only
`contracts/openapi/dist/public-v1.json`, disables Try it out, and cannot be published until
Privacy and Security approve the L0-only leakage scan.

## Required extensions and wire rules

Every operation declares `x-owner`, `x-data-classification`, `x-rate-limit`,
`x-stability`, security, and response examples. JSON uses `snake_case`; money is
integer minor units in `*_minor` fields with an explicit `currency`; timestamps
are RFC 3339 UTC; cursor pages use `cursor`,
`limit`, `next_cursor`, and `has_more`. RFC 9457 Problem Details is the only v1
error envelope. Seller operations also document optional `x-orderak-platform`
and `x-orderak-app-version` compatibility context; neither header grants access.
Request schemas should set `additionalProperties: false` after
their domain shape is reviewed; response schemas remain additive.

| Classification | Approval |
| --- | --- |
| L0 public | Product Owner after Privacy and Security review |
| L1 internal | Engineering Lead with Security |
| L2 personal | Privacy Lead/DPO with Security |
| L3 secrets/credentials | Security Lead with Privacy |
| Downgrade or public publication | Privacy and Security together |

Engineering may use `pending-review` while authoring internal drafts. Stable and
public builds may not. The public bundle builder includes L0 operations only and
fails on internal/admin/integration markers or secret credential names.

## CI tiers

- Pull requests: Spectral, Redocly, examples, route/spec coverage, public leakage
  scan, generated Cloudflare projection, oasdiff changelog, mock DTO tests, four
  Schemathesis shards with three cases per changed operation, and a 30-second k6
  smoke. The Schemathesis job is capped at eight minutes.
- Nightly: all Seller operations, four workers, 50 cases per operation,
  stateful phase, sanitized JUnit/HAR, and low Staging load; hard timeout 60
  minutes.
- Protected pre-release: 200 cases, recreatable Staging data, and pilot/spike/
  soak k6 profiles. Schema mismatch, unexpected 5xx, tenant leakage, duplicate
  mutation, or public-data leakage blocks release. Fuzz and load tests never run
  on Production.

The k6 gates are failure rate below 0.5%, p95 below 500 ms, and p99 below 1500
ms. Pilot is 20 requests/second for 15 minutes with at most 50 VUs; spike is 50
requests/second for two minutes; soak is 20 requests/second for 60 minutes. Run
the same profile before and after Cloudflare Schema Validation and use
`quality/performance/compare-schema-validation.mjs`; p95 overhead must not exceed 10%.

## Cloudflare Schema Validation

OpenAPI 3.1.2 remains authoritative. From `contracts/openapi/`:

```powershell
pnpm run bundle
pnpm run cloudflare
```

This creates an explicit OAS 3.0.3 projection in `contracts/openapi/dist/` for
API Shield import.

Both steps are required and in that order. `cloudflare` reads
`dist/seller-v1.json`, which `bundle` produces and which is git-ignored build
output — so on a clean checkout, running `cloudflare` alone fails with
`ENOENT: no such file or directory ... dist\seller-v1.json`. `pnpm run check`
runs the whole chain and is the usual entry point; the two commands above are
for when only the Cloudflare projection is wanted.

Neither script is declared in the workspace root, so both fail with
"script not found" if run from there. Enable it on
Staging endpoint-by-endpoint, in log mode first when available. If only blocking
mode is available, wait until contract and load evidence passes. Do not add Kong
or AWS API Gateway.

## Stability promotion

- `draft`: breaking changes allowed with changelog.
- `beta`: breaking changes require Engineering and Android approval.
- `stable`: oasdiff fails on WARN/ERR breaking changes; a breaking change needs
  a new API version.

Promote to `stable` only after all clients use the final prefixes, classifications
and reviewed domain schemas are complete, RFC 9457 is universal, mock/contract/
load gates pass, the L0 public bundle is clean, and all product/architecture/
security documents are synchronized.
