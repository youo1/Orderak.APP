# Changelog

All notable changes to Orderak are documented in this file.

Format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

## [Unreleased]

### Added

- Redesign review pack under `docs/redesign/`: a master execution prompt, a
  decision log, an Arabic executive summary, and four evidence reports (backend
  inventory and necessity review, Android UI audit, admin panel audit, and an
  open-source evaluation). Each report carries a *Verification pass* section
  recording which findings were confirmed and which did not survive re-reading;
  three claims in the original recon did not.
- `tooling/repository/verify-theme-authority.mjs` — the committed token bundle
  must stay in a cascade layer, so the published design-system revision outranks
  it. It was silently losing before this.
- `tooling/repository/verify-admin-token-conformance.mjs` — the admin panel's own
  stylesheets must not invent a font size, radius or duration, and must not name
  a custom property nothing declares.
- `tooling/repository/verify-android-motion-tokens.mjs` — no hand-written
  animation duration and no hand-written pill radius in the Android app.
- `tooling/repository/verify-admin-primitives.mjs` — the admin panel has one
  component kit. `shared/ui/*` is it, and the files that hand-roll `.button`,
  `.field`, `.panel` and `.modal` are recorded in a per-file ceiling that may only
  go down. Counts are token matches, so `modal-backdrop` and `button-row` are not
  conflated with the primitives they sit beside.
- `tooling/repository/verify-android-spacing-tokens.mjs` — every distance and
  every corner in the Android app names a design-system token. It checks
  positions rather than values, so a `size(96.dp)` image or a 720dp breakpoint is
  left alone; the allowed values are read out of `OrderakSpacing` rather than
  restated, so adding a token needs no second edit.
- `OrderakSpacing.iconSmall` / `iconMedium` / `iconHero` and a new
  `OrderakLayout` (`contentMaxWidth` 560dp, `wideLayoutMinWidth` 720dp). The icon
  group replaced `14.dp` at two sites and `18.dp` at two more, which is not a
  scale; the layout pair replaced eight copies of `560.dp` and one `720.dp`.
- `RestartableRead` in the Android app: a local read that can be run again after
  it throws. The surface-level `catch` it replaces ended the stream, so one
  failed Room read left Orders, Store and Customers empty for the life of the
  process.
- `LocalOrderakMotion` and `Shapes.full`, plus reduced-motion support on Android
  through `ValueAnimator.areAnimatorsEnabled`. The app previously had exactly one
  duration, `tween(300)` at six sites, and no other.
- One shared owner-only step-up rule (`apps/admin-web/src/shared/api/step-up.ts`)
  and one shared confirmation dialog (`apps/admin-web/src/shared/ui/confirm.tsx`),
  replacing four copies of the first and thirteen `window.confirm` calls of the
  second.
- A *Forbidden* state in the admin panel. A 403 rendered as "Could not load this
  section" with a retry button, so a page the operator's role excludes was
  indistinguishable from one that failed to load.

- Per-product write routes — `POST /api/v1/products`, `PUT` and `DELETE
  /api/v1/products/{product_code}`, and `PATCH
  /api/v1/products/{product_code}/stock` — replacing the catalogue mirror, which
  deletes any product absent from a submitted payload. The create is idempotent
  under retry via `client_request_id`. Product discounts now have a server
  column and travel on both write routes. See
  [ADR-012](docs/decisions/adr-012-server-authoritative-catalogue.md).

- Phase 0 launch-governance package with the program charter, RACI, operating
  cadence, evidence standard, temporary risk freeze, source-plan traceability,
  initialized control registers, and an objective G0 exit checklist.
- Phase 4 launch PRD, role/journey/responsibility matrix, data and Android
  permission matrix, content-control requirements, billing ADR, traceability,
  and G4 approval record.

### Changed

- **The five seller surfaces are destinations, not a `when` over an enum.** Each
  one now has a route in a `NavHost` inside the shell, navigated with
  `popUpTo(start) { saveState = true }` / `restoreState = true`. Before, a
  composable that left the composition had nowhere to keep its state, so every tab
  switch discarded the product search query, the customer query, the scroll
  position and any open dialog — the screens had been written with
  `rememberSaveable` all along, and it had nothing to attach to. The shell's own
  TODO for this, quoted in the Android audit, is gone.
- **System back inside the shell means "go home".** A surface is not a pushed
  destination, so the back stack was one entry deep and the button every Android
  seller presses to go up closed the app from any surface but اليوم. Back now
  returns to اليوم from the other four, and still leaves the app from اليوم
  itself, which is the platform's convention. Both rules are asserted in
  `MainShellNavigationTest`.
- **The admin panel now has one implementation of every primitive, and the second
  one is gone.** 127 hand-rolled `className="button"`, `"field"`, `"panel"` and
  `"modal"` usages across 13 files ran beside the kit, and they had drifted: the
  class-based `.button` was 38px with a hover lift where the kit's `Button` is 40px
  with a background change, and five of six modals were hand-rolled
  `div.modal-backdrop` layers with no focus trap while the kit exported a Radix
  dialog the whole time. Every one is the kit's now, the ratchet guard's ceiling
  map is empty, and the duplicate CSS is deleted — 20 rules removed and 3 mixed
  selectors rewritten to the live part they shared with `.resource-group`,
  `.search-box input` and `.drawer header`. Two primitives the kit was missing were
  added: `Field`, and `Textarea` with `NativeSelect` — a styled native `<select>`
  rather than Radix's, because every call site was a plain form control with an
  `onChange` and swapping it would have been a behaviour change dressed as a
  consolidation.
- **The admin panel's destructive buttons are heavier than they were.** The old
  `.button.danger` was a soft red-tinted button; the kit's `destructive` variant is
  filled red. That is the mapping the migration prescribed rather than a drift, and
  it is the one deliberate visual change the consolidation carries. Everything else
  the migration touched is layout-equivalent: `panel spaced` became `mt-5` and
  `field grow` became `flex-1`, both the same measurements as the rules they
  replaced.
- **The admin panel had three bolds that no type role had chosen.** The scale says
  "Weight is 400 or 500 — there is no bold display type in this product", and 21
  rules used 650, 700, 800 or 900 while the component kit used Tailwind's
  `font-semibold` (600) in five more places. Each element now takes the weight of
  the role whose size it already uses, so §"never mix one role's size with
  another's weight" holds. Emphasis comes from colour and tracking, which is how
  the rest of the system already does it.
- **Two of the six hand-rolled modals are the kit's now, not a fourth
  implementation.** `shared/ui/confirm.tsx` — part of the kit — drew its own
  `div.modal-backdrop` with a `section.modal`, its own Escape listener and no
  focus trap, while the kit exported a Radix dialog the whole time; the same was
  true of `shared/ui/ActionDialog.tsx`, which collects owner credentials for an
  audited export. Radix supplies `aria-modal`, a real focus trap, scroll lock and
  portalled rendering; the Escape handling in `confirm.tsx` was a workaround for a
  layer Radix owns. Focus is still placed on the action the dialog was opened to
  ask about, rather than on the close cross.
- `apps/admin-web/components.json` aliases corrected. They claimed the kit lived
  at `@/components/ui`, `@/lib` and `@/hooks`; none of those directories existed,
  so the next `shadcn add` would have written a third parallel component set into
  `src/components/ui`.
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

### Fixed

- **A taken catalogue name stopped the entire sync, and the app said it saved.**
  Two surfaces edited the slug. `StoreInfoScreen` owns it properly — it queries
  `/api/v1/slug/check`, reports available / taken / reserved / network, and keeps
  Save disabled until the name is free. The account surface carried a second field
  with no check: it wrote to local storage, `savePayout` triggered a refresh, and
  `SellerRefresher` pushed the value through `api.register`, which returns early on
  failure — so one unvalidated slug failed the whole registration, **stopping every
  pull and push behind it**, while the snackbar said "Payout details saved". The
  duplicate field is gone and the account surface shows the published link
  read-only; editing belongs to the store surface, which is also where
  `docs/ux/feature-surface-map.md` files `custom_catalog_slug`. Guarded by
  `verify-slug-authority.mjs`.
- **A paying seller who reinstalled while billing was closed could not restore
  their plan — on the screen whose own copy told them to.** "Use purchase recovery
  after reinstalling or changing devices" and "Recover Play purchases" both sat
  inside `if (purchaseOpen)`, and the banner directly above them promised "Nothing
  you have changes". That flag is the backend's `BILLING_ENABLED` launch gate, and
  recovery does not pass through it: it re-queries Play and re-verifies on
  `/api/v1/billing/google/verify`, which is absent from
  `BILLING_ACQUISITION_ROUTES`, while Play itself connects on
  `GOOGLE_PLAY_LIFECYCLE_ENABLED` — a separate flag — so the machinery could be
  running and open with the only control that used it hidden. Guidance and
  recovery now render in both states; only the banner and the buy affordance stay
  gated. `PurchaseEntryPointsTest` pins it and was verified to fail when the
  control is put back behind the gate.
- **Two account groups announced themselves wrongly.** The store group's header
  was also the label of the row directly beneath it, and the devices group named
  one of its three rows. Both headers now use the screen contract's own names for
  those groups — "المتجر والهوية" and "الأجهزة والاشتراك" — and deletion status
  moved into the account-actions group, beside the control that creates a deletion
  request.
- **The account surface showed two app bars and two snackbar hosts.** It drew its
  own `Scaffold` and `TopAppBar` inside the shell's, so the seller read the shop's
  name directly above the word "Settings" — and the only thing the inner bar
  carried was the language switch, which is a row in the account-actions group
  now.
- **A plan without AI saw nothing at all, where the gate exists to say which.**
  `aiAvailable == false` omitted the row, so "your plan does not include this" and
  "this product has no AI" looked identical. It draws `FeatureGate(LockedByPlan)`
  now, and the upgrade control appears only when `purchaseOpen` says there is
  somewhere for it to go — with billing closed, the notice states the lock and
  offers nothing to press.
- **The account surface's sixth group had no header, and its two rows were under
  the 48dp floor.** The contract names six groups; the last one — request account
  deletion and log out — was two error-coloured `Text` lines at the end of a long
  scroll, with 12dp of padding, which is 24dp around a 20dp line. They are labelled
  list rows now, and `SettingsListItem` guarantees the 48dp minimum for every row.
- **`lint:markdown` was already failing on four documents in the redesign pack**,
  so the CI step was red for anyone who touched them. Three were formatting slips;
  the fourth was structural — the admin panel audit's "Verification pass" section
  had been inserted into the middle of the twenty-opportunity findings table, so
  the table's column count changed halfway through and an `h4` followed an `h2`
  with no `h3` between them. The section now follows the table it was cut into.
  Repo-wide: 0 issues in 166 Markdown files.
- **152 distances and 14 corners in the Android app were written by hand, most of
  them off the design system's scale.** `padding(6.dp)`, `spacedBy(18.dp)` and
  `Spacer(Modifier.height(30.dp))` are distances between two things, and the
  system has exactly one set of those; 46 of the 152 sat in the two flows a new
  seller meets before the app itself (authentication and shop setup), so the
  first thing they saw was the least consistent. A literal is now snapped to the
  nearest token — ties round up the scale, because a hair more room never clips an
  Arabic ascender while a hair less can — and every affected screenshot baseline
  is regenerated for review. Guarded by `verify-android-spacing-tokens.mjs`.
- **The published design system was losing to a committed snapshot.** `/theme.css`
  and `apps/admin-web/src/orderak-tokens.css` declare the same custom properties on
  `:root`, and the bundler always parses the application stylesheet last, so
  pressing "Apply as current" in the Theme Builder changed nothing for anybody but
  the administrator who pressed it. The bundle is now imported into a cascade
  layer. Guarded by `verify-theme-authority.mjs`.
- **Orders, Store and Customers went blank for the life of the process after one
  failed local read.** `catch` ends a flow rather than skipping an emission, so
  the empty list it emitted was the last value the surface would ever see, and the
  error screen had no retry. The read is restartable and the retry is wired.
- **A new seller's first product screen told them to press a control that was not
  drawn.** The empty-catalogue branch returned before the floating action button,
  while the copy in all three locales named it.
- **A customer edit that the server refused was silent.** `saveFailed` was set and
  its reset had no caller, so the seller closed the screen believing the
  correction was kept. It now reports the refusal and offers the retry.
- **The AI assistant's "Try again" erased the conversation.** The error card's
  retry was wired to `resetChat`. Retrying now re-asks the last question, and
  clearing the conversation has its own confirmed control.
- **Saving an order with two currencies in it crashed the screen.** The repository
  refuses a mixed order by design and its comment claimed the caller filtered to
  one currency; no caller did. The screen now disables Save and says why.
- **A missing order spun forever, with no way out.** "Not read yet" and "no such
  row" were the same `null`, and the state that renders the back button is drawn
  after that check, so the only way back was the system gesture.
- **Four silent failures on seller-facing writes** — store info save, image
  upload, support reply, and the reply's own text, which was cleared before the
  server had it.
- **Device revoke had no confirmation while passkey revoke did**, and it is the
  one that ends a session on hardware the seller may not be holding.
- **An admin page a role excludes read as a page that failed to load**, retry
  button included. A 403 now says so.
- **Three admin screens collected a password and a fresh TOTP code from operators
  who could not use them**, then refused with `owner_required`. The rule lives in
  one place and the credentials are never asked for.
- `var(--border)` was referenced twice and declared nowhere, so the design-system
  generator's diff table rendered with no frame or row separators.
- The admin panel's image upload, motion durations, pill radii, font sizes and
  border radii were all written by hand; 8 of the font sizes were below the
  system's own 12px floor for text a user reads, the smallest at 9.9px.

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
