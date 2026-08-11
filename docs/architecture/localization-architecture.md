---
status: current
generated: false
owner: android
applies_to: [production, staging]
authoritative_for: [localization-architecture]
---
# Localization Architecture Contract

**Contract version:** 3

> **Approved evolution (1 August 2026):** Long-lived localization outcomes are
> now separated from the current Android implementation profile. The default
> locale, supported locale set, per-app language API, bundle split policy,
> translation lifecycle, and screenshot baselines did not change.
>
> **Protected setup:** Changes to the decisions below require explicit product
> approval, an update to this document, and successful localization verification.
> The Android build runs `verifyLocalizationContract` and fails with a warning
> when these invariants are accidentally broken.

Cross-platform-neutral outcomes live in
[`docs/contracts/localization-invariants.md`](../contracts/localization-invariants.md),
while the current Android resource/API choices live in
[`docs/platforms/android-localization-profile.md`](../platforms/android-localization-profile.md).
This separation permits an approved future platform or locale migration without
turning ordinary class/file refactoring into a product-contract change.

## Supported scope

| Surface | Languages | Source/fallback |
|---|---|---|
| Android seller UI | Arabic, English, French | English |
| Public buyer storefront | Arabic, English | Seller-authored source content |
| Admin panel | English | English |
| Cached product translations | Arabic, English | Seller-authored source content |
| Optional Paid 3 storefront locales | Only locales marked implemented in the server registry | Organization override |

French is an Android-interface language only. It is not an advertised public
catalog/content language until the Worker dictionaries, translation pipeline,
legal/email content, D1 constraints, and tests are deliberately extended.
Paid 3 does not bypass that requirement: administrators may enable only a
locale whose server registry state is `implemented`. Arabic and English remain
universal core storefront locales; the Android seller UI stays ar/en/fr.

## Protected Android decisions

1. `res/values/strings.xml` is the complete English engineering fallback.
2. Arabic lives in `values-ar`, explicit English in `values-en`, and French in
   `values-fr`. Every translatable key and resource type must match.
3. `res/resources.properties` contains `unqualifiedResLocale=en`.
4. AGP generates LocaleConfig. There must be no manual locale-config XML or
   `android:localeConfig` manifest attribute.
5. Locale changes use `AppCompatDelegate.setApplicationLocales`; an empty locale
   list means first-launch/system-following behavior. The app uses Arabic,
   English, or French when the system resolves to one of them and otherwise
   falls back to English. `MainActivity` must remain an `AppCompatActivity`.
6. The in-app `LanguageSheet` contains exactly `العربية`, `English`, and
   `Français`. It has no “System default” row. Selecting a row creates and
   persists an explicit app-language override; system-following behavior exists
   only while no override has ever been selected.
7. App Bundle language splitting is disabled so all three picker languages work
   immediately while offline.
8. `Orderak` is the canonical, non-translatable application name.
9. Dynamic names and mixed-direction content use content-based text direction or
   `BidiFormatter`; protocol identifiers use `Locale.ROOT` casing.
10. Fixed UI concepts are localized by Android. The backend returns stable codes,
    canonical values, and seller-authored dynamic content rather than English UI
    sentences.

## Protected backend decisions

- Seller-authored content remains the source of truth.
- Product translation is generated after synchronization and cached in D1. A
  storefront request must never call an AI provider.
- Missing translations fall back to source content, never an empty field.
- `product_translations` records source locale/version, lifecycle status,
  provider/model provenance, and review time.
- Lifecycle values are `pending`, `machine`, `reviewed`, and `rejected`.
- Seller-app locale and buyer-storefront locale remain independent.
- Regional `Accept-Language` values normalize to the small supported public set;
  raw header values are not used as unbounded cache variants.
- `storefront_locale_definitions` is the allowlist for optional organization
  storefront locales. Plan configuration cannot make a `planned` locale live.

The repository owner approved this registry-based Paid 3 extension in the
19 July 2026 subscription implementation task. It does not change the Android
locale set, English fallback, resource lifecycle, or current ar/en storefront.

Production migration `020_product_translation_lifecycle.sql` was applied on
2026-07-12. The remote migration ledger was reconciled for the already-existing
`001`–`019` schema before `020` was applied. Do not replay historical migrations
or execute migration files directly outside Wrangler's migration ledger.

## Required verification

From `apps/seller-android/`:

```cmd
gradlew.bat verifyLocalizationContract testStagingDebugUnitTest lintStagingDebug assembleStagingDebugAndroidTest validateStagingDebugScreenshotTest
```

Run this when an emulator or device is available:

```cmd
gradlew.bat connectedStagingDebugAndroidTest
```

From `services/backend/`:

```cmd
npm.cmd test -- --run
npx.cmd tsc --noEmit
npx.cmd wrangler d1 migrations list orderak-db --remote
```

Expected results:

- No localization lint violations.
- Matching translatable keys/types across Arabic, English, and French.
- Device-test APK covers `ar`, `en`, `fr`, `en-XA`, and `ar-XB`.
- Approved screenshot goldens validate for Arabic, English, and French.
- No pending remote D1 migrations after an authorized production release.

## Screenshot baseline record

On 2026-07-20 the Arabic, English, and French goldens were intentionally
regenerated from `LocalizationScreenshotTest.localizationSurfaceScreenshot`
after the approved operations-coverage roadmap added localized Support,
Announcements, Catalog Languages, Devices, and Restricted Account labels. The
three rendered previews were visually checked for text completeness, French
expansion, Arabic RTL alignment, and mixed-direction order text. This additive
coverage does not change the default locale, supported locale set, resource
fallback, language-split policy, or translation lifecycle.

On 2026-07-26 the protected ar/en/fr screenshot matrix was intentionally
expanded for the approved modern authentication and onboarding surfaces: Welcome, Passkey
sign-in and management, Account Information, private-email guidance, Store
Information, and the goal-oriented completion action. The preview includes the
longest French guidance and Arabic RTL labels. The supported locale set,
English fallback, per-app language API, generated LocaleConfig, and
language-split policy are unchanged.

On 2026-07-28 the owner approved exposing the existing three-language sheet on
Welcome and removing its “System default” row. First launch still follows a
supported system language and falls back to English for unsupported system
languages; after a user selects العربية, English, or Français, the explicit
`AppCompatDelegate` override persists. The supported locale set, English
fallback resources, generated LocaleConfig, and language-split policy are
unchanged. The shipped-locale screenshot surface was also updated to cover the
action-oriented Create Account title, revised subtitle, required Year of Birth
label, and longer private-email guidance in Arabic, English, and French.

On 2026-07-28 the screenshot acceptance matrix was intentionally expanded for
the generated design system: light/dark, standard/medium/high contrast, Cairo,
Tajawal, and Noto Arabic/Latin pairing across Arabic RTL, English LTR, and
French LTR samples. Existing locale resources and goldens are not silently
recolored; approved baseline updates must record the active fallback hash. The
default locale, supported locale set, per-app language API, generated
LocaleConfig, and language-split policy remain unchanged.

## Intentional change procedure

If a new language or different fallback is intentionally required:

1. Tell the user that the protected localization contract will change.
2. Update Android resources, `AppLocales`, build configuration, tests, screenshot
   goldens, backend support, and documentation together.
3. Update this contract and its Gradle guard in the same commit.
4. Run the complete verification matrix.
5. For backend schema changes, add a new sequential migration; never edit an
   already-applied migration.
6. Apply production migrations and deploy only with explicit authorization.

Do not “fix” a failed localization guard by deleting the task, weakening lint,
or duplicating fallback resources. Its failure is the requested warning that the
protected architecture has drifted.

## Version 3 contract-evidence migration approval

On 1 August 2026 the owner explicitly approved separating long-lived
localization outcomes from the Android implementation profile. Resource parity,
English fallback, Arabic/English/French support, generated LocaleConfig,
`AppCompatDelegate`, disabled language splitting, screenshot baselines, and the
translation lifecycle did not change. Future implementation refactoring may
change class/file layout only while the invariant contract, Android profile,
Gradle verification, lint, unit tests, and screenshots remain green.

## Localized city and business taxonomy surfaces

- City-catalogue requests send only `ar`, `en`, or `fr`; unsupported locale
  state uses English. Results display required ODbL attribution and manual
  entry preserves seller text. Arabic uses an Arabic native name when the
  pinned source supplies one; otherwise the canonical name is shown.
- The active global taxonomy stores canonical Arabic, English, and French
  names. Category search has no country/city variants.
- Compose resources cover loading, no results, retry, manual city, category,
  subcategory, and TalkBack actions in all shipped locales.
- This is a surface expansion only: the supported locale set, first-launch
  system behavior, explicit `AppCompatDelegate` override, and generated
  LocaleConfig remain unchanged.
