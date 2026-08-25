## Summary

<!-- Brief description of what this PR does and why. -->

## Target branch

CI rejects any base/head combination that is not a declared route.

- [ ] `feature/*` `fix/*` `chore/*` `docs/*` into **`develop`** — squash
- [ ] `develop` into **`staging`** — merge commit (squash is not offered)
- [ ] `staging` into **`main`** — merge commit (squash is not offered)
- [ ] `hotfix/*` into **`main`** — merge commit, after dispatching `Deploy Staging` against the hotfix branch
- [ ] `main` into **`staging`** / **`develop`** — mandatory hotfix back-merge

## Type of change

- [ ] Bug fix
- [ ] New feature
- [ ] Refactor / code improvement
- [ ] Documentation update
- [ ] Infrastructure / tooling

## Testing

<!-- How did you test this change? Be specific. -->

- [ ] Backend: `pnpm test` passes
- [ ] Android: `gradlew.bat :app:assembleStagingDebug` succeeds
- [ ] Android unit tests: `gradlew.bat testStagingDebugUnitTest` passes
- [ ] Android lint: `gradlew.bat lintStagingDebug` clean
- [ ] Manual testing (describe below)

## Documentation checklist

<!-- These must be checked before the PR can merge. -->

- [ ] If this changes API behavior, I updated `docs/reference/api.md`
- [ ] If this changes product behavior, I updated `docs/product/app-plan.md`
- [ ] If this changes setup steps, I updated `docs/guides/setup.md`
- [ ] If this changes database schema, I added a migration and updated `docs/guides/database-migrations.md`
- [ ] If this changes bindings, hostnames, trust boundaries, or deployment environments, I updated both architecture documents
- [ ] If this touches UI resources, I ran `gradlew.bat verifyLocalizationContract` and it passed
- [ ] If this adds or changes screenshots, I ran `gradlew.bat validateStagingDebugScreenshotTest` or `updateStagingDebugScreenshotTest` (after visual review)

## Security

- [ ] No secrets or API keys are included in this PR
- [ ] Authentication and authorization are enforced where applicable
- [ ] Rate limiting is in place where applicable
