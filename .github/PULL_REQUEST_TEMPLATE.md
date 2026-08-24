## Summary

<!-- Brief description of what this PR does and why. -->

## Target branch

Tick the one that applies. The merge button matters: squashing a promotion or a
hotfix severs the link to its Staging run and the Production release gate will
refuse it. See
[the release workflow guide](../docs/guides/staging-production-workflow.md).

- [ ] `feature/*` or `fix/*` into **`develop`** — **Squash and merge**
- [ ] `develop` into **`staging`** promotion — **Create a merge commit**
- [ ] `staging` into **`main`** promotion — **Create a merge commit**
- [ ] `hotfix/*` into **`main`** — **Create a merge commit**, after dispatching
      `Deploy Staging` against the hotfix branch

## Type of change

- [ ] Bug fix
- [ ] New feature
- [ ] Refactor / code improvement
- [ ] Documentation update
- [ ] Infrastructure / tooling

## Testing

<!-- How did you test this change? Be specific. -->

- [ ] Backend: `npm test` passes
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
