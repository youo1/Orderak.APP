# Orderak AI Instructions

This repository is the master workspace for the Orderak platform. Android is the
current seller client; iOS and desktop are reserved future clients.

## Project Areas

- `apps/seller-android/`: Android Studio project. Use Kotlin and Jetpack Compose.
- `apps/admin-web/`: React and TypeScript administration application.
- `services/backend/`: Cloudflare Workers backend. Android should call this backend only.
- `contracts/openapi/`: Platform-neutral Seller, Admin, and Integrations API contracts.
- `contracts/typescript/`: Shared TypeScript types for server and web code.
- `design/`: Figma and Canva links plus exported design assets.
- `docs/`: Product plan, API notes, setup steps, and architecture notes.
- `quality/performance/`: Contract and API performance verification.
- `tooling/repository/`: Repository structure and deployment-map verification.

## Rules

- Never put DeepSeek, OpenAI, Claude, Gemini, Cloudflare, Firebase, Figma, or Canva API keys/secrets in the Android app.
- Store secret keys in Cloudflare Worker secrets or local environment variables.
- The Android app calls the Cloudflare backend.
- The Cloudflare backend calls OpenAI, Claude, Gemini, databases, and third-party APIs.
- Keep code beginner-friendly and avoid unnecessary abstraction.
- Update `docs/reference/api.md` when backend endpoints change.
- Update `docs/product/app-plan.md` when product behavior changes.
- Update `docs/guides/setup.md` when setup steps change.
- Update `docs/architecture/overview.md` when system architecture changes.
- Keep `docs/architecture/orderak-full-architecture.html` synchronized when
  system components, trust boundaries, integrations, queues, or data authority
  change. Treat it as internal engineering documentation unless the user
  explicitly approves public publication.
- Update `docs/architecture/security-model.md` when auth/security model changes.
- Treat `docs/contracts/auth-phase1-contract.md` as a versioned authentication safety
  contract. Provider, OTP state rules, timeout/error handling, logout behavior,
  backend token verification, consent evidence, throttling, or device-recovery
  semantics still require the user's explicit approval. Implementation names
  may evolve only when the invariant contract, Android profile, behavioral
  tests, and relevant security/API documentation are updated together.
- Run `gradlew.bat verifyAuthPhase1Contract` after authentication-related edits.
  If it fails, do not bypass, weaken, rename, or remove the guard; restore the
  protected behavior or obtain explicit approval for an intentional migration.
- Update `docs/guides/database-migrations.md` when migrations change.
- Treat `docs/architecture/localization-architecture.md` as a versioned architecture contract.
  Do not change the default locale, supported locale set, per-app language APIs,
  App Bundle language-split policy, translation lifecycle schema, or screenshot
  baselines without explicitly telling the user and updating that document, the
  localization invariants, Android profile, and verification evidence.
- Never restore a manual `locale_config.xml`. AGP generates LocaleConfig from
  `resources.properties` and the `values-*` directories.
- Run `gradlew.bat verifyLocalizationContract` after localization-related edits.
  If it fails, do not bypass or remove the guard; resolve the conflict or obtain
  explicit approval for an intentional architecture migration.

## Preferred Stack

- Android: Kotlin, Jetpack Compose, Android Studio.
- Backend: Cloudflare Workers, TypeScript when possible.
- AI providers: start with one provider first, then add routing for others.
- Design: Figma for app screens, Canva for marketing assets.

## First Milestone

Build the smallest working version:

1. Android app has one chat/order screen.
2. Android app sends text to the Cloudflare backend.
3. Backend returns a fake AI response.
4. Later, backend connects to one real AI provider.
