---
status: archived
generated: false
owner: governance
applies_to: [internal]
---
# Repository Restructure Review — 2026-08-01

**Branch:** `codex/repository-restructure`

**Pre-change checkpoint:** `35fe855`

**Production deployment:** not performed

## Baseline

Before moving files, the checkpoint passed 158 Backend tests, Backend TypeScript
checking, 9 Admin tests and build, OpenAPI validation with 231 covered operations,
Android Production/Staging/Mock unit tests, and the protected authentication,
localization, and Seller API guards.

## Mechanical review

- Active projects moved under `apps/`, `services/`, `contracts/`, `packages/`,
  `quality/`, and `tooling/`; legacy top-level project paths are rejected by
  `tooling/repository/verify-deployment-map.mjs`.
- GitHub workflows, CODEOWNERS, Gradle guards, npm commands, Wrangler entrypoints,
  OpenAPI route inventory, MkDocs navigation, and repository customizations use
  the new paths.
- Generated reports, raw audit outputs, temporary probes, duplicate static assets,
  tool artifacts, and tracked dependency cache files were removed. Historical
  conclusions and dispositions are preserved in the unpublished repository history.
- The local Markdown-link verifier reports no broken repository file links.
- `git diff --check` reports no whitespace errors.

## Behavioral and security review

- Backend: 24 files / 158 tests passed; `tsc --noEmit`, design-system fixture,
  and architecture-map verification passed.
- Admin: Oxlint, 4 files / 9 tests, TypeScript, and Vite production build passed.
- Android: Staging APK assembly, Staging/Production/Mock unit tests, Staging lint,
  and authentication/localization/Seller API contract guards passed.
- OpenAPI: Spectral, Redocly, examples, route coverage, bundles, public filtering,
  Cloudflare projection, and portals passed; the inventory remains 231 operations.
  Operation IDs and runtime routes were not changed. Optional existing platform
  context headers and Production/Staging servers are now documented.
- Wrangler dry-runs passed for Public, Admin, and Admin Edge Workers in Production
  and Staging. No deploy command ran without `--dry-run`.
- Review found that `send_email` is a non-inherited Wrangler binding and was absent
  from both Staging environments. The configs now declare `EMAIL` explicitly;
  repeated Staging dry-runs confirmed the binding.
- Production and Staging D1, R2, KV, Queue, DLQ, Worker, Pages, domain, Android ID,
  and API URL mappings are checked by `verify-deployment-map.mjs`. No secret value
  is read or recorded.
- No open source-review P0 or P1 finding remains.

## External gates still required

- GitHub CLI reports the configured `youo1` token is invalid.
- Wrangler reports its interactive authentication token expired.
- Therefore the live read-only inventory of GitHub Environments/protection and
  Cloudflare deployed resources remains blocked until both tools are re-authenticated.
- The pinned `oasdiff` comparison, MkDocs strict build, remote link check, GitHub
  approvals, Staging deployment/smoke tests, and CODEOWNER approval remain CI or
  reviewer gates. Production must not be promoted as part of this change.

The authoritative source mapping and exact live-audit checklist are in
[`deployment-environment-map.md`](../../architecture/deployment-environment-map.md).
