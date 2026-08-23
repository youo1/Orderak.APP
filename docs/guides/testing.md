---
status: current
generated: false
owner: backend
applies_to: [production, staging]
---
# Testing Guide

Orderak has independent backend and Android suites plus versioned authentication,
localization, seller-API, and design-system build guards.

## Backend tests

### `pnpm test` (Vitest, Workers pool)

Runs all backend unit and integration tests. Covers:

- Identity helpers (slug generation, transliteration, store codes)
- Store registration and device restore
- Explicit Seller v1 routing plus 404/no-redirect checks for removed unversioned
  and v2 routes
- RFC 9457 Problem Details and response request-ID correlation
- OpenAPI route/spec coverage, examples, public leakage, Prism, Schemathesis,
  and k6 tiered checks
- Category CRUD
- Product sync and code generation
- Order fetch with cursor
- Chat endpoint (authenticated + rate-limited + plan quota)
- Public store/category/product pages + SEO metadata
- Legacy URL redirects
- Billing (subscriptions, coupons, referrals, ads)
- Admin authentication (login, 2FA, RBAC, password change)
- Email templates (seeds, overrides, preview, test-send)
- Webhook idempotency

Run before every commit:

```cmd
cd services/backend
pnpm test
```

### `npx tsc --noEmit` (TypeScript type-check)

Catches type errors across the entire Worker codebase. No runtime — pure
static analysis.

```cmd
cd services/backend
npx tsc --noEmit
```

## Android tests

### Unit tests (`testStagingDebugUnitTest`)

JVM unit tests. No emulator needed. Covers:

- Versioned seller route policy (`ApiRoutesTest`)
- OTP timing/state, authentication-operation generation, and logout ordering
- Data formatting helpers
- ViewModel logic

```cmd
cd apps/seller-android
gradlew.bat testStagingDebugUnitTest
```

### Lint (`lintStagingDebug`)

Enforces:

- `HardcodedText` — all user-facing strings must be in `strings.xml`
- `RtlHardcoded` — no hardcoded left/right in layouts
- `SetTextI18n` — no string concatenation in UI
- `MissingTranslation` — all languages have matching string keys
- `ExtraTranslation` — no stale strings in any language

```cmd
gradlew.bat lintStagingDebug
```

### Screenshot validation (`validateStagingDebugScreenshotTest`)

Compose Preview Screenshot Testing. Compares rendered screenshots against
approved goldens stored in `app/src/screenshotTestDebug/reference/`.
Covers Arabic, English, and French.

```cmd
gradlew.bat validateStagingDebugScreenshotTest
```

**Only use `updateStagingDebugScreenshotTest` after visually reviewing an intentional
UI change** — it replaces the approved reference images:

```cmd
gradlew.bat updateStagingDebugScreenshotTest
```

Never approve a blank or corrupted reference image just to make validation
pass. Updating goldens without reviewing the rendered differences defeats
the test.

### Instrumented tests (`connectedStagingDebugAndroidTest`)

Runs on an attached emulator or physical device. Covers the locale matrix:

| Locale | What it tests |
|--------|--------------|
| `en` | English LTR resources |
| `ar` | Arabic RTL resources |
| `fr` | French LTR resources |
| `en-XA` | English pseudolocale (expanded text, LTR) |
| `ar-XB` | Arabic pseudolocale (expanded text, RTL) |

The APK can be compiled without a device, but execution requires one:

```cmd
gradlew.bat connectedStagingDebugAndroidTest
```

## Localization guard (`verifyLocalizationContract`)

Runs automatically before `preBuild`. Also available as an explicit task.
Checks:

- `unqualifiedResLocale=en` (English is the fallback)
- Generated LocaleConfig remains enabled (no manual `locale_config.xml`)
- Supported packaged locales are exactly `ar`, `en`, `fr`
- App Bundle language splitting is disabled
- No manual LocaleConfig file or manifest attribute exists
- `AppLocales.DEFAULT_TAG` remains English
- `Orderak` is the canonical non-translatable app name
- Translatable resource names and types match in every language

```cmd
gradlew.bat verifyLocalizationContract
```

**If it fails, do not bypass the guard.** Read
[`../localization-architecture.md`](../architecture/localization-architecture.md) for the
protected contract and resolve the drift.

## Authentication and seller API guards

`verifyAuthPhase1Contract` is retained as the compatibility task name. Contract
v7 verifies the authentication invariant/profile evidence, protected Worker and
Android configuration, and forbidden shipped-code patterns; the Android and
Worker test suites prove behavior.

`verifySellerApiContract` verifies that seller requests cross the central v1/v2
route boundary, branding uses v1 explicitly, and request/platform metadata stays
behind `ClientContextProvider`.

```cmd
gradlew.bat verifyAuthPhase1Contract verifySellerApiContract testStagingDebugUnitTest
```

## When to run each suite

| Before committing | Before release |
|-------------------|---------------|
| `pnpm test` | `pnpm test` |
| `npx tsc --noEmit` | `npx tsc --noEmit` |
| `gradlew.bat testStagingDebugUnitTest` | `gradlew.bat testStagingDebugUnitTest` |
| `gradlew.bat lintStagingDebug` | `gradlew.bat lintStagingDebug` |
| `gradlew.bat verifyLocalizationContract` | `gradlew.bat validateStagingDebugScreenshotTest` |
| `gradlew.bat verifyAuthPhase1Contract verifySellerApiContract` | `gradlew.bat verifyAuthPhase1Contract verifySellerApiContract` |
| | `gradlew.bat connectedStagingDebugAndroidTest` (with device) |
| | `gradlew.bat verifyLocalizationContract` |

## CI

Seventeen workflows. Grouped by what actually triggers them here — verified
against the `on:` block of each file, because several are configured
differently in this repository than in the one it was migrated from.

**Runs on every PR, path-filtered:**

- `backend-ci.yml`: Worker tests and architecture verification.
- `android-ci.yml`: staging assembly, unit tests, lint, and all build guards.
- `auth-phase1-contract.yml`: auth/API guards plus focused Android and Worker
  behavioral tests.
- `docs-ci.yml`: Markdown lint, links, MkDocs strict build, architecture map,
  frontmatter and subject authority, documented-claim checks, and the
  generated-migration-reference drift check.
- `openapi-ci.yml`: spec lint/validate, Prism mock contract tests, Schemathesis.
- `ai-customizations-ci.yml`: validates `AGENTS.md` and `.github/{agents,skills,instructions}/**`.

**Runs on every PR and on push to `main`:**

- `security-scan.yml`: gitleaks secret scan, dependency review.
- `supply-chain.yml`: `pnpm audit`, CycloneDX SBOM. Also weekly, Mondays 05:00 UTC.
- `open-source-security.yml`: Semgrep CE and Trivy filesystem scans. Also
  weekly, Mondays 04:00 UTC.

**Push to `main` only:**

- `staging-deploy.yml`: deploys to staging on merge, path-filtered. This
  repository owns staging deploys — see
  [staging-production-workflow.md](./staging-production-workflow.md).

**Scheduled:**

- `skills-auto-update.yml`: weekly, Mondays 04:17 UTC.

**Manual dispatch only:**

- `d1-backup.yml`: encrypted D1 export to R2, per environment.
- `restore-drill.yml`: downloads an encrypted backup, decrypts it under a
  separate environment that holds the AGE private key, and proves it restores.
- `infra-drift.yml`: compares declared Cloudflare resources against the account.
- `openapi-nightly.yml`: live-staging contract run against a read-only allowlist.
- `android-staging-distribution.yml`: Firebase App Distribution.
- `production-deploy.yml`: requires an explicit release SHA already verified on staging.

> **Why `restore-drill` alone is dispatch-only.** `d1-backup`, `infra-drift`
> and `openapi-nightly` run on their own schedules here. `restore-drill` does
> not: it is the only path that decrypts a backup, and that must stay a
> deliberate, reviewed act rather than something that happens nightly.
