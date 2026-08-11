# Changelog

All notable changes to Orderak are documented in this file.

Format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

## [Unreleased]

### Added

- Phase 0 launch-governance package with the program charter, RACI, operating
  cadence, evidence standard, temporary risk freeze, source-plan traceability,
  initialized control registers, and an objective G0 exit checklist.
- Phase 4 launch PRD, role/journey/responsibility matrix, data and Android
  permission matrix, content-control requirements, billing ADR, traceability,
  and G4 approval record.

### Changed

- Reorganized the repository into `apps/`, `services/`, `contracts/`,
  `packages/`, `quality/`, and `tooling/` boundaries without changing runtime
  behavior, API operation IDs, authentication, or localization contracts.
- Added the cross-platform application structure, deployment environment map,
  repository-path verification, and GitHub deployment safeguards that require
  Production to promote the exact commit SHA verified in Staging.
- Removed generated Cloudflare indexes, temporary probes, duplicate assets,
  Android artifact notes, and other obsolete workspace output while retaining
  useful historical summaries under `docs/archive/`.
- Repaired the canonical setup guide's text encoding, corrected the MkDocs
  navigation, added documentation standards, and strengthened documentation CI.
- Froze the first release as free and deferred seller AI; Worker billing
  acquisition and AI routes now fail closed behind default-off launch flags.

## [0.2.0] — 2026-07-12

### Added

- Localization architecture contract with automated build guard
  (`verifyLocalizationContract`).
- Translation lifecycle metadata: `source_locale`, `source_version` (SHA-256),
  `translation_status` (pending / machine / reviewed / rejected), `provider`,
  `model`, `reviewed_at`.
- Arabic and French UI resources with full Compose Preview Screenshot Testing
  goldens.
- `en-XA` and `ar-XB` pseudolocales in debug builds for localization QA.
- `resources.properties` with `unqualifiedResLocale=en`; AGP-generated
  LocaleConfig replacing the removed manual `locale_config.xml`.
- Seller-facing language picker (Arabic, English, French, system default).
- Android locale-sensitive formatters (dates, numbers, country names) derived
  from the active app locale.
- Backend catalog `Content-Language` + `Vary: Accept-Language` headers.

## [0.1.0] — 2026-07-07 to 2026-07-11

### Added

- Android seller app: Kotlin, Jetpack Compose, Hilt, Room, WorkManager,
  Retrofit, Firebase Phone Authentication.
- Store setup wizard (name, category, city/country, seller profile).
- Dashboard tab with order/customer/product counts and catalog sharing.
- Orders tab with list, detail, and status management.
- Products tab with CRUD, images, categories, and plan-based limits.
- Customers tab with list, detail, and order history.
- Settings tab with payout info (InstaPay / Vodafone Cash), plan, and language.
- Cloudflare Worker backend (TypeScript): D1 database, R2 media storage,
  KV sessions, and modular monolith routing.
- Chat/order AI assistant endpoint (`POST /api/chat`) via DeepSeek with
  rate-limiting and plan-based quotas.
- Product mirror-sync (`POST /api/products/sync`) with immutable `product_code`.
- Media upload to R2 (`POST /api/media/upload`).
- Public store, category, and product pages at `/<public_identifier>` with
  SEO metadata and JSON-LD.
- Customer order form on public store pages.
- Plans, subscriptions, coupons, referrals, and ad management (admin panel).
- Admin panel: RBAC (owner, finance, support, readonly), email + password
  login, optional TOTP 2FA, self-service password change, break-glass reset.
- Cloudflare Email Sending integration (`send_email` binding) with versioned
  Arabic/English templates and live admin editor.
- Cloudflare Email Routing inbound (`email()` handler) with admin Inbox tab
  and optional forwarding.
- Project-wide 10-token design system with one-click admin Theme editor.
- Server-driven app branding (`GET /api/theme`) with ETag-based caching.
- Immutable 8-character `store_code`, editable `slug`, and composite
  `public_identifier` for public URLs.
- UUID primary keys (never exposed); public identifiers for all external
  references.
- Legacy store URLs (`/c/<identifier>`, bare slug/store_code) 301-redirect
  to canonical `/<public_identifier>`.
- Multi-device access per plan (disabled on Free).
- Firebase ID token verification server-side on registration and device restore.
- PBKDF2-hashed device secrets (transparent re-hash of legacy plaintext).
- Rate-limiting: login (15/5min), MFA (5/challenge), register (10/min),
  orders (5/min/IP), upload (60/hr), chat (20/min + plan quota).
- Payment gateway idempotency via `webhook_events` ledger.
- Stripe integration (mock gateway fallback when `STRIPE_SECRET_KEY` is unset).
- Public legal pages (`/terms`, `/privacy`) with Arabic/English content
  versioning.
- App-screen tree hierarchy (admin panel navigation view).
- Worker static assets binding for brand files and PWA manifest.
- Android adaptive launcher icon with monochrome themed-icon support.

### Changed

- Android compileSdk/targetSdk 35, minSdk 24; Gradle 8.11.1 via wrapper.
- Backend auth model transitioned from plaintext secrets to PBKDF2 hashing.
- Store code size settled at 8 characters (from earlier 6-char prototype).

### Fixed

- Phone number uniqueness in slug generation.
- Order number uniqueness constraint (`order_no` per store).
- Inbound email forwarding logic (removed undefined guard).
- Product code returned in order items for client-side stock sync.
- Order endpoint reads credentials from headers only (no query string leakage).
- D1 migration ledger reconciliation after production drift.
- WCAG AA color contrast (DEFAULT_THEME `#127943`/`#D0333B`).

### Security

- Admin password change returns 403 on wrong current password (not 401, so the
  panel can display the error inline).
- Break-glass password reset guarded by `ADMIN_API_KEY` via header, never
  accepted in the browser session.
- Webhook HMAC verification with idempotency ledger.
- Device secrets hashed (PBKDF2), never stored plaintext.
- AI chat authenticated and rate-limited; never open to the public.
- Media served with `nosniff`; safe URL sanitization in public rendering.
