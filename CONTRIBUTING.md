# Contributing to Orderak

## Getting started

Follow [`docs/guides/setup.md`](./docs/guides/setup.md) to get a local development environment
running.

## Workflow

1. **Branch from `develop`** — use a descriptive name:
   `feature/chat-screen`, `fix/order-sync-crash`, `docs/migration-guide`.
   A fault already live in Production is different: branch it from `main` and
   name it `hotfix/<name>`. The full branch model, including which merge button
   to use where, is in
   [the release workflow guide](./docs/guides/staging-production-workflow.md).
2. **Keep PRs small.** One feature, fix, or doc change per pull request.
3. **Test before submitting.** See the testing section below.
4. **Update documentation** in the same PR as the code change.
   Use the PR template checklist.
5. **Request review** from a maintainer.

## Code style

### Kotlin (Android)

- Follow the project's existing Compose patterns.
- Use the lint rules already enabled: `HardcodedText`, `RtlHardcoded`,
  `SetTextI18n`, `MissingTranslation`, `ExtraTranslation`.
- Do not hardcode strings or colors; use `strings.xml` and theme tokens.
- Run `lintStagingDebug` before committing.

### TypeScript (Backend)

- Follow the existing modular monolith structure in `services/backend/src/`.
- Type-check with `npx tsc --noEmit`.
- All routes, billing, and email logic must have Vitest coverage.

## Testing

Run these from the repository root before requesting review:

```cmd
:: Backend
pnpm --filter orderak-worker test
pnpm --filter orderak-worker run test:types

:: Admin web
pnpm --filter @orderak/admin-web test -- --run
pnpm --filter @orderak/admin-web run lint
pnpm --filter @orderak/admin-web run build

:: OpenAPI and repository contracts
pnpm run openapi:check
pnpm run verify:deployment-map
pnpm run verify:doc-links

:: Android
apps\seller-android\gradlew.bat -p apps\seller-android :app:assembleStagingDebug
apps\seller-android\gradlew.bat -p apps\seller-android :app:testStagingDebugUnitTest :app:lintStagingDebug
apps\seller-android\gradlew.bat -p apps\seller-android :app:verifyAuthPhase1Contract :app:verifyLocalizationContract
```

If your change touches UI or resources, also run:

```cmd
apps\seller-android\gradlew.bat -p apps\seller-android :app:validateStagingDebugScreenshotTest
:: Only use :app:updateStagingDebugScreenshotTest after visually reviewing changes
```

## Review expectations

- Keep mechanical moves separate from behavioral refactoring whenever possible.
- Review repository moves for rename detection, stale paths, imports, build
  inputs, workflow filters, and generated output before reviewing behavior.
- Security-sensitive changes require review of authentication, secrets,
  Cloudflare bindings, environment isolation, API compatibility, and client
  contract guards.
- Resolve all P0/P1 findings and obtain the relevant CODEOWNER approval before
  merge. The author of a Production-impacting change must not be its only
  approver.

See [`docs/guides/testing.md`](./docs/guides/testing.md) for the full test suite
documentation.

## Database migrations

- Always use `npx wrangler d1 migrations apply` — **never** run individual
  migration files with `wrangler d1 execute`.
- Every schema change gets its own migration file in `services/backend/migrations/`.
- Do **not** hand-edit [`docs/guides/database-migrations.md`](./docs/guides/database-migrations.md) —
  it is generated from the migration files by `services/backend/scripts/generate-migration-docs.mjs`.
  Regenerate it after adding a migration; the file's own header says the same thing, which
  this instruction previously contradicted.
- See the runbook at [`docs/runbooks/d1-migration-drift.md`](./docs/runbooks/d1-migration-drift.md)
  if the migration ledger gets out of sync.

## Documentation

Documentation is part of the definition of done. The PR template checklist
maps changes to the documents that must be updated:

Follow the [documentation guide](./docs/guides/documentation.md) for writing,
linking, source-of-truth, and validation conventions.

| If your PR changes… | Update… |
|---------------------|----------|
| API endpoints, request/response shapes, error codes | [`docs/reference/api.md`](./docs/reference/api.md) |
| Product behavior, features, screen flow | [`docs/product/app-plan.md`](./docs/product/app-plan.md) |
| Setup steps, prerequisites, secrets, deployment | [`docs/guides/setup.md`](./docs/guides/setup.md) |
| Database schema | Migration file + [`docs/guides/database-migrations.md`](./docs/guides/database-migrations.md) |
| Architecture, hostnames, data flows | [`docs/architecture/overview.md`](./docs/architecture/overview.md) |
| Auth model, secret handling | [`docs/architecture/security-model.md`](./docs/architecture/security-model.md) |
| UI strings, locales, translations | Run `verifyLocalizationContract` |

## Secret handling

Never commit API keys, tokens, or signing secrets. See
[`SECURITY.md`](./SECURITY.md) for the full policy. In short:

- Production secrets → Cloudflare Worker secrets (`wrangler secret put`)
- Local secrets → `services/backend/.dev.vars` (git-ignored)
- CI secrets → runner secret store

## Getting help

- Check [`docs/guides/troubleshooting.md`](./docs/guides/troubleshooting.md) for common issues.
- Review [`docs/reference/glossary.md`](./docs/reference/glossary.md) for domain terminology.
