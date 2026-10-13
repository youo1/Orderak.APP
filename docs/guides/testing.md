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
- The accessibility preview audit (`app.orderak.seller.a11y.AccessibilityPreviewAuditTest`)

```cmd
cd apps/seller-android
gradlew.bat testStagingDebugUnitTest
```

### Accessibility preview audit (`AccessibilityPreviewAuditTest`)

The audit compiles the screenshot preview declarations into the unit-test
artifact (`app/src/screenshotTest/java` is added to the `test` source set) and
renders every source `@PreviewTest` under Robolectric 4.17 with
`GraphicsMode.NATIVE`, SDK 35, and the `ar-w411dp-h891dp-xxhdpi` qualifiers. It
runs on a plain `Application` so Firebase/Hilt initialization never starts, and
the Gradle test tasks pin `user.language=en`, `user.country=US`, and
`user.timezone=UTC`, exactly like the screenshot tasks.

The source is the authority. The audit parses `app/src/screenshotTest/java` with
the anchored matcher `(?m)^\s*@PreviewTest\s*$` to decide which functions are
states and which locales they render; it parses the multipreview annotations in
`app/src/main/java/app/orderak/seller/core/ui` for their constituent locales.
Compose runtime's public `getDeclaredComposableMethod` resolves each parsed state
function; reflection never infers a `@Preview` or picks a neighbouring helper. A
missing source directory, an unresolvable state, or an unresolvable multipreview
locale fails loudly, and the runtime annotation count must equal the number of
audited cases. The observed figure is **280 `@PreviewTest` annotations in 22
source files**, against the manager's approximate 320-state estimate (a
discrepancy of ~40); the audit prints the measured values rather than hardcoding
either number.

One `@PreviewTest` declaration is one JUnit case, named for its compiled
`<File>ScreenshotTestKt` facade and function. A declaration with several locale
variants gets a single `setContent` call whose host reads a mutable locale
variant, copies the current configuration and applies the parsed locale (so the
SDK, size, and density qualifiers survive), and provides `LocalConfiguration`,
`LocalContext`, `LocalResources`, and `LocalLayoutDirection` from the same
locale context built with `createConfigurationContext`. `LocalResources` matters:
Compose UI reads `stringResource`/`pluralStringResource` from it, so without it
every `en`/`fr` preview would audit Arabic strings while reported as `en`/`fr`.
The host also re-provides `LocalActivityResultRegistryOwner` and
`LocalOnBackPressedDispatcherOwner` read from the test activity before the locale
context replaces `LocalContext`, because both have context-derived defaults and
the auth screens register activity-result launchers through them. The host proves
the switch by checking that a known string differs between the `ar` and `en`
variants of the same preview. Previews with no explicit locale use
the app default, and the audit never calls `RuntimeEnvironment.setQualifiers`
after the Compose activity starts and never calls `setContent` twice per rule.

`auditAccessibility(rule, preview)` audits content the caller has already set; it
never calls `setContent`. It returns one diagnostic per violation and every
diagnostic names the preview and locale, the rule (`Label`, `Target`, or
`Contrast`), the node text or position, and the measured value where applicable.
The rules run as follows:

| Rule | Tree | Check | Threshold |
|------|------|-------|-----------|
| 1 — `Label` | merged | every node with an `OnClick` action or `ToggleableState` exposes `ContentDescription` or `Text` | non-blank |
| 2 — `Target` | merged | Compose `touchBoundsInRoot` at least 48dp on both axes, and no overlap with another actionable node unless one is an ancestor | ≥ 48dp |
| 3 — `Contrast` | unmerged | for every semantics root (`onAllNodes(isRoot())`, so dialog windows are audited too) crop each text node's `boundsInRoot` from that root's `captureToImage()` and measure the WCAG contrast of the crop | ≥ 4.5:1 normal; ≥ 3:1 large (≥ 18sp, or ≥ 14sp at weight ≥ 700) |

Disabled nodes and zero-size nodes are skipped. Rule 2 uses Compose touch bounds,
never drawn component dimensions. Rule 3 measures one text node at a time, never
merged row pixels; the large-text decision comes from the node's
`GetTextLayoutResult`, and an unspecified size counts as normal. Empty or
out-of-image text crops are reported as audit failures with the preview and node
context. Image-only nodes produce no `Contrast` diagnostic, and the audit never
touches the network.

The three isolated proofs in `AccessibilityAuditRulesAcceptanceTest` (an
unlabelled `IconButton`, two adjacent 20dp clickables, and grey text on white
below 3:1) must each fail with a diagnostic naming its intended rule, with
accessible controls that produce no diagnostics, so an audit that fails
everything cannot satisfy them.

**Spike conclusion.** Compose accessibility checks (`enableAccessibilityChecks`,
`tryPerformAccessibilityChecks`) and ATF's `AccessibilityHierarchyAndroid` do not
inspect Compose semantics nodes under Robolectric, so they cannot back this
audit. The audit therefore reads the Compose semantics tree directly and uses
pixel capture only for contrast.

**LocalInspectionMode.** `LocalInspectionMode` is `false` under the Compose test
rule, while the screenshot preview renderer sets it `true`. Previews must not
branch onto inspection-only shortcuts that would hide a real state from the
audit; the shared string-resource and theme paths are exercised either way.

**Timing.** `:app:testStagingDebugUnitTest` elapsed time is measured before and
after adding the audit under comparable conditions: same machine/CI runner, warm
Gradle daemon, `--console=plain`, no other work in flight, staging debug variant.
The offline executor sandbox cannot run Gradle or the Android checks, so the
before/after figures and the incremental seconds are recorded by the full
Android run rather than invented here.

**Phase-R and blocked findings.** A pixel-changing finding cannot be corrected
until the supervisor supplies the exact affected reference PNG paths and each
path is individually added to `allowed_files`; `updateStagingDebugScreenshotTest`
is never run by hand. Findings that require only semantics (a missing label from
an existing string) are corrected in place. Findings that change pixels are
reported with the preview, rule, finding, and planned minimal fix, and are left
as a deferred phase-R redesign rather than weakening a rule, marking a node
`Disabled`, or skipping a preview. If a required label has no existing string,
the finding and the required string are reported because `src/main/res/**` is out
of scope.

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
approved goldens stored in
`app/src/screenshotTestStagingDebug/reference/`. Covers Arabic, English, and
French, and the locale/multipreview matrix described above.

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

Since 2026-09-25, `android-ci.yml` also runs this on every PR, in an
`instrumented-test` job via `reactivecircus/android-emulator-runner`. It is
deliberately not yet a required status check — see that job's own comment in
the workflow file for why — so a local run with a real device or emulator is
still the way to be sure before relying on it.

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

## Demo data (`verifyDemoDataContract`)

Staging and mock builds carry a demo shop for one account, so the app can be
reviewed with something in it. `DemoDataSeeder` fills the local database on the
first launch of the shell — 18 products against a limit of 20, all six order
statuses interleaved, three verified transfers, one order still waiting for
proof — and installs a plan snapshot that puts all three gate states on screen
at once.

**It never runs in production.** `DEMO_SELLER_PHONE` is empty for the
production flavour, and `isDemoSeller()` returns false on an empty constant
whatever phone is signed in.

The dangerous half is not the seed but the sync. `SyncRepository` pushes the
product catalogue as a full mirror, so a device in demo mode must not sync: it
would replace the account's real catalogue with the demo shop. `doSync` refuses
to run for the demo account, and `verifyDemoDataContract` fails the build if
either that refusal or the empty production constant is removed.

```cmd
gradlew.bat verifyDemoDataContract
```

To use it: install `assembleStagingDebug`, sign in as the demo account, complete
shop setup once, and the shell seeds on first open. Clearing app data is the way
back out.

## When to run each suite

| Before committing | Before release |
|-------------------|---------------|
| `pnpm test` | `pnpm test` |
| `npx tsc --noEmit` | `npx tsc --noEmit` |
| `gradlew.bat testStagingDebugUnitTest` | `gradlew.bat testStagingDebugUnitTest` |
| `gradlew.bat testStagingDebugUnitTest --tests app.orderak.seller.a11y.AccessibilityPreviewAuditTest` (accessibility audit) | `gradlew.bat testStagingDebugUnitTest --tests app.orderak.seller.a11y.AccessibilityPreviewAuditTest` (accessibility audit) |
| `gradlew.bat lintStagingDebug` | `gradlew.bat lintStagingDebug` |
| `gradlew.bat verifyLocalizationContract` | `gradlew.bat validateStagingDebugScreenshotTest` |
| `gradlew.bat verifyAuthPhase1Contract verifySellerApiContract` | `gradlew.bat verifyAuthPhase1Contract verifySellerApiContract` |
| | `gradlew.bat connectedStagingDebugAndroidTest` (with device) |
| | `gradlew.bat verifyLocalizationContract` |

## CI

Seventeen workflows. Grouped by what actually triggers them — verified against
the `on:` block of each file rather than assumed from the workflow name.

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

**Push to `main` only:**

- `staging-deploy.yml`: deploys to staging on merge, path-filtered. This
  repository owns staging deploys — see
  [staging-production-workflow.md](./staging-production-workflow.md).

**Scheduled, plus manual dispatch:**

- `openapi-nightly.yml`: nightly 00:20 UTC. Live-staging contract run against a
  read-only allowlist.
- `d1-backup.yml`: daily 02:00 UTC. Encrypted D1 export to R2, per environment.
- `infra-drift.yml`: daily 06:00 UTC. Compares declared Cloudflare resources
  against the account.
- `open-source-security.yml`: weekly, Mondays 04:00 UTC. Semgrep CE and Trivy
  filesystem scans.
- `skills-auto-update.yml`: weekly, Mondays 04:17 UTC.
- `supply-chain.yml`: weekly, Mondays 05:00 UTC. `pnpm audit`, CycloneDX SBOM.

`supply-chain.yml` and `open-source-security.yml` also ran on every PR and push
until 2026-08-24, when they were reduced to scheduled-only for solo pre-release
development. The header comment in each file records how to restore them.

**Manual dispatch only:**

- `restore-drill.yml`: downloads an encrypted backup, decrypts it under a
  separate environment that holds the AGE private key, and proves it restores.
- `android-staging-distribution.yml`: Firebase App Distribution.
- `production-deploy.yml`: requires an explicit release SHA already verified on staging.

> **Why `restore-drill` alone is dispatch-only.** `d1-backup`, `infra-drift`
> and `openapi-nightly` run on their own schedules here. `restore-drill` does
> not: it is the only path that decrypts a backup, and that must stay a
> deliberate, reviewed act rather than something that happens nightly.
