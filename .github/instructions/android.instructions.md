---
description: Kotlin and Jetpack Compose rules for the Orderak Android application.
applyTo: "apps/seller-android/**"
---

# Android instructions

- Use Kotlin and Jetpack Compose; follow existing ViewModel, state, navigation,
  repository, and dependency patterns.
- Keep composables focused and hoist mutable state where the existing design
  expects it.
- Keep network calls behind the existing backend API layer. Never call AI
  providers, Firebase administration APIs, Cloudflare administration APIs, or
  third-party secret-bearing services directly from Android.
- Put user-visible text in string resources and maintain all supported locale
  files when text changes.
- Never add a manual `locale_config.xml`.
- Add focused unit or UI tests for changed behavior.
- For authentication-related edits, run
  `.\gradlew.bat verifyAuthPhase1Contract`.
- For localization-related edits, run
  `.\gradlew.bat verifyLocalizationContract`.
- Do not change protected auth or localization semantics without explicit user
  approval and synchronized contract documentation.
