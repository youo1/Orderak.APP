---
status: current
generated: false
owner: product
last_verified: 2026-08-10
applies_to: [production, staging]
---
# Orderak App Plan

> **Status:** Current implemented product summary plus explicitly listed gaps
>
> **Last verified:** 2026-08-10

## What Orderak Is

Orderak is an Android app for **small sellers/merchants** to run their shop
from their phone: set up a store, manage
a product catalog, take and track orders, and share a public catalog link with
customers. The Android app talks only to the Cloudflare Workers backend; the
backend owns the database, media, billing, and any AI/third-party calls.

- **App:** `apps/seller-android/` — Kotlin + Jetpack Compose, package `app.orderak.seller`.
- **Backend:** `services/backend/` — Cloudflare Worker (`api.orderak.app`) + public store
  pages (`orderak.app`) + admin panel (`admin.orderak.app`).

## Android-first portability policy

Android remains the only implemented seller client. There is no iOS target or
seller Web/PWA in the current product scope. New work nevertheless preserves
low-cost portability seams:

- the Worker remains the authority for identity, entitlements, billing,
  inventory reconciliation, legal evidence, and account state;
- Android sends every Seller JSON call through the explicit `/api/v1/*`
  pre-release contract; unversioned and v2 routes are rejected locally;
- Android device/app metadata is supplied through a platform boundary and never
  authenticates a request;
- authentication timing and logout ordering are behavior-tested policies;
- offline-capable entities define revision, idempotency, retry, and conflict
  behavior explicitly rather than sharing one last-write-wins rule;
- authentication/localization contracts protect outcomes and current platform
  profiles without freezing ordinary class names or source layout.

The active policy and deferred work are documented in
[cross-platform readiness](../architecture/cross-platform-readiness.md). No Swift,
Xcode, StoreKit, APNs, PWA, Service Worker, IndexedDB, or multiplatform UI work
is required while Android remains the delivery focus.

## Market strategy: Egypt first, then MENA, then global

Egypt is Orderak's **first commercial launch market**, not the product's
geographic limit. The approved expansion sequence is:

1. Validate the launch product and operating model in Egypt.
2. Expand through MENA using country readiness gates.
3. Expand globally after the MENA operating model is proven.

Engineering must preserve that direction during the Egypt launch:

- Shared product and domain logic must not assume `EG`, EGP, piasters,
  InstaPay, Vodafone Cash, Egyptian addresses, or Egyptian tax/legal rules.
- Launch-specific providers, payment methods, legal content, pricing, and
  operational rules must be selected by country configuration or replaceable
  adapters.
- Country, currency, timezone, language, address format, tax treatment,
  payment capabilities, and market availability are separate concepts; none
  should be inferred from another.
- Amounts remain integer minor units, but the currency and its fraction digits
  must become explicit before a non-Egypt market is activated.
- Phone and store-location onboarding continue to support all ISO countries,
  while production availability is controlled independently by an auditable
  country-readiness allowlist.
- Each new market requires product, localization, payments, privacy, legal,
  tax, support, hosting/data-transfer, and release readiness approval. Global
  architecture does not mean every country is commercially enabled at once.

The present implementation is only **partially market-portable**. Global phone
country selection, localized country presentation, country-scoped city data,
country-prefixed public identifiers, and Arabic/English/French Android
resources are already useful foundations. Money is no longer one of those constraints: migration 044 moved every amount
to `*_minor` with an explicit currency. Egypt-specific seller payment fields
(InstaPay, Vodafone Cash) and EGP-assuming catalog rendering remain launch-era
constraints and must not be copied into new shared features.

## Generated design-system behavior

Orderak branding is source-driven and Material You remains disabled. An owner
manually applies color seeds, scheme variant, contrast, typography, spacing,
and shapes from the admin Theme Builder. Each **Apply as current** action
creates an unnamed higher-ID immutable checkpoint. Administrators can name or
rename checkpoints as saved configurations, make an older configuration
current by copying it to a new checkpoint, and owners can permanently delete
inactive checkpoints. Historical snapshots are never regenerated after a
generator upgrade.

The active snapshot applies to Android, the React admin, landing pages,
catalogs, and public/legal pages. Transactional email, motion, elevation,
iconography, breakpoints, image extraction, and code export are outside v1.
Seller-selected storefront colors remain domain data, with readable
foregrounds validated at their actual use sites.

Android retains system/light/dark and accessibility preferences. It selects the
highest of the published, saved, and system contrast using
`standard < medium < high`. Downloads become `pendingRevision` and activate
only at the next foreground transition, so an active interaction never changes
theme. Compiled Compose tokens remain the offline/startup fallback.

The admin desktop shell has a top-bar navigation control that fully hides or
restores the 268px sidebar and remembers `visible`/`hidden` locally per
administrator. Below 860px the same control opens the existing overlay drawer;
the desktop preference is preserved but ignored until the viewport returns to
desktop.

## Core Screens (implemented)

- **Welcome and auth** — returning sellers can invoke Credential Manager
  Passkey sign-in directly; account creation and recovery use Firebase Phone OTP
  (SMS), with OTP fallback shown only when applicable. Welcome includes the
  existing explicit العربية/English/Français language sheet.
- **Account setup (step 1/2)** — full name, required private birth year,
  optional private email, and versioned Terms/Privacy acceptance after phone
  verification.
- **Store setup (step 2/2)** — store name, read-only preview of the unchanged
  canonical URL, one required global business-category dropdown, and
  static-catalogue city search restricted by verified phone country with manual
  fallback. Country, subcategory, and logo are not requested here; subcategory
  and logo remain editable later in Store Information/Profile Settings.
- **Main shell** with tabs:
  - **Dashboard** — today / unpaid / to-ship counts + "share catalog" link.
  - **Orders** — list + order details, status updates.
  - **Products** — catalog CRUD, images, categories, plan-based product limit.
  - **Customers** — customer list + details/history.
- **Settings** — payout info, plan/subscription recovery, language, store and
  category management, support, announcements, translation review, devices,
  deletion status, gated AI, and logout.

## App Screen Tree & Screen Sequences

The admin panel (`📱 App Screens`) shows a tree view representing navigation flow
sequences. Each screen has a `parent_id` linking to its navigation source.

```text
├── Splash
│   └── Welcome
│       ├── Passkey sign-in (returning seller)
│       └── Phone + inline OTP
│           └── Account information (1/2)
│               └── Store information (2/2)
│                   └── Dashboard (MainRoute)
│                       ├── Orders
│                       │   ├── New Order
│                       │   └── Order Details
│                       ├── Products
│                       │   └── Product Editor
│                       ├── Customers
│                       │   └── Customer Details
│                       └── Settings
│                           ├── Store Information
│                           ├── Categories
│                           ├── Support → Ticket thread
│                           ├── Announcements
│                           ├── Catalog Languages
│                           ├── Devices and Passkeys
│                           ├── Deletion Status
│                           ├── Subscription
│                           └── AI Assistant (gated)
```

**Sequence flow:** a valid cached server session goes directly from Splash to
Dashboard. Otherwise the flow is `Welcome → Passkey → Dashboard` for a
returning seller, or
`Welcome → Phone/OTP → Account 1/2 → Store 2/2 → Dashboard` for a new seller.
Returning sellers may also recover through OTP. Settings and its sub-screens
branch from Dashboard.

- **Splash**: server-session-aware startup routing (parent of all)
- **Welcome**: top-end language control plus bottom-pinned create-store, direct
  Credential Manager sign-in, and conditional phone fallback actions
- **Phone/OTP**: one visual screen with all-country E.164 entry; after SMS
  dispatch the phone is locked and six OTP boxes, Change number, and the
  60-second resend countdown appear inline. SMS Autofill fills but never submits
  before the user presses Verify. Back/Change number invalidate any in-flight
  auth operation so late platform callbacks cannot restore an abandoned screen;
  an unavailable Phone Hint shows manual-entry guidance without blocking OTP.
- **Account/Store setup**: resumable local draft with server-authoritative,
  idempotent completion. Successful new-seller OTP enters Account step 1
  directly; the account action remains tappable and reports the first invalid
  required field instead of failing silently. Account step 1 has a top Back
  action (and matching system Back behavior) that returns to Welcome without
  deleting the resumable draft.
- **Dashboard**: main shell
- **Dashboard tabs**: Orders, Products, Customers — each with detail/create screens
- **Settings**: Store/category management plus seller operations screens listed above

## Backend Capabilities (implemented)

- Store identity: UUID + immutable `store_code` + slug → `public_identifier`.
- Store info, categories, product mirror-sync, R2 media upload.
- Public store/category/product pages with SEO + a customer order form. One
  checkout accepts at most 50 unique product lines.
- Public catalogs automatically follow the customer's browser language (Arabic
  or English). Sellers enter product text once; backend-generated translations
  are cached in D1 and original text is always the fallback.
- Global business-subcategory discovery accepts only its documented category,
  search, language, and limit parameters; unknown query inputs fail closed.
- Orders pulled to the app via paginated `/api/v1/orders` (cursor = per-store
  `order_no`, 50 rows per page).
- Billing data and servicing code: plans, subscriptions, coupons,
  referral/affiliate, and ads. Paid acquisition is disabled for the free launch;
  acquisition and Google Play lifecycle routes reject that policy state with a
  non-retryable `403 feature_disabled` response.
- Admin panel: Workers Static Assets, opaque D1 sessions + RBAC + mandatory
  TOTP 2FA. Transactional email and large exports run through dedicated Queues;
  inbound email remains on Email Routing.
- AI assistant endpoint `/api/v1/chat` (DeepSeek) and an entitlement-gated Android
  route exist; deployment and D1 runtime gates default it off.

## Data & Sync

- Room is the local source of truth; `SyncRepository` + WorkManager push the
  store/products and pull new buyer orders on a 15-minute cadence and on demand.
- Product metadata remains mirror-synced, but inventory uses optimistic
  `stock_version` checks and a local `stockDirty` marker. Only a seller's
  explicit stock edit can change existing server stock; stale edits rebase and
  retry. Pending and failed sync is visible on the dashboard.
- Session/profile and the account-scoped entitlement snapshot are cached in
  DataStore; an unfinished onboarding draft is also cached there after a
  debounce. The opaque onboarding token is encrypted at rest and a selected
  logo is copied into app-private storage immediately. A random per-device
  secret is the backend credential (sent as
  `x-orderak-phone` / `x-orderak-secret`). Entitlements render from cache first,
  then revalidate by ETag on launch/foreground, manual dashboard refresh,
  periodic sync, and successful Play purchase verification. Network failure
  keeps the last snapshot active and shows a non-blocking offline indicator.
- A retryable Play verification returns a verification ID rather than failing
  the purchase. Android persists only that ID and retry time, resumes unique
  network-constrained WorkManager polling after restart/offline periods, and
  accepts only the authoritative entitlement snapshot. It never persists the
  purchase token or grants from a local pending purchase. Cached paid access
  stops at the server-provided current-period expiry.
- One Android entry gate now resolves Auth, Restricted, Shop Setup, or Main
  after app launch, successful login, completed setup, restriction recheck,
  logout, and stable mid-session authentication errors. Restriction takes
  priority over setup. A registered credential rejection requires sign-in,
  while a verified seller who has not created a server store remains in the
  pre-registration flow. Network/status failures preserve cached offline access.
- A newly issued onboarding token writes explicit pre-registration state and
  routes directly to Shop Setup. A stale local `COMPLETE` marker cannot send a
  new seller through Main and back to Welcome; only an in-progress draft is
  eligible for step restoration. Phone/country and pre-registration routing are
  committed atomically, and obsolete background-session signals are discarded
  while Auth or Shop Setup owns the screen.
- DataStore persists explicit registered/pre-registration state, onboarding
  progress and draft fields (including private birth year), and the last
  confirmed account status. A cached
  restricted status remains blocking until a successful active response;
  existing installations infer compatible defaults from their saved store
  identity and profile.
- After OTP on a new phone, the backend verifies the Firebase ID token. Existing
  sellers restore their device session and may create a Passkey before the
  dashboard; new sellers receive a short-lived onboarding token and accept the
  displayed legal versions on account step 1. When Passkeys are enabled, the
  new seller sees the opt-in immediately after OTP; Android persists that
  choice, but does not open the system registration ceremony until the Worker
  has completed store step 2. The Worker atomically creates the profile, store,
  identity, organization, owner membership, route, consent, and device session
  only after store step 2. An opted-in seller may then create the discoverable
  credential. Starter and Professional sellers can add devices without
  signing out an old phone. On Free, verified recovery replaces and logs out the
  previously authorized device, preserving single-device access after reinstall
  or phone replacement.

## Auth and onboarding release state (API v1)

### Store setup city and taxonomy revision

- Step 2 contains store name, a read-only `https://orderak.app/…` preview of the
  existing canonical URL, one category dropdown, and a searchable city
  dropdown. Subcategory selection is deferred to authenticated Store
  Information settings, where choices are limited to the store's selected
  category. Logo upload remains available after onboarding in Profile Settings.
- The country is captured with the verified phone and is not asked again. The
  Worker uses that country for static city search and rejects a selected
  catalogue ID from another country.
- City search supports Arabic, English, and French, loading/empty/error/retry
  states, and manual entry. It requires no paid location API or key, and Android
  requests no location permission.
- The versioned category catalog is global and independent of country/city.
  Low-confidence source categories are excluded from v1 and retained in the
  internal audit workbook.
- The existing `ISO2-slug-eight-character-code` identity, slug formatter, and
  route resolution are unchanged.

- `ONBOARDING_ENABLED` and `PASSKEY_ENABLED` are fail-closed Worker flags and
  remain `false` in the checked-in production baseline.
- The production Passkey RP is `orderak.app`. Only release and Play App Signing
  certificate fingerprints belong in the production Digital Asset Links
  statement. Debug builds use the separate `staging.orderak.app` environment.
- Passkeys use Credential Manager on Android 9+; Android 7–8 and devices without
  a usable credential show an explicit OTP option. Cancelling the system sheet
  returns to Welcome without an automatic redirect.
- When no app-language override exists, first launch follows a supported system
  Arabic, English, or French locale and otherwise falls back to English. The
  Welcome language sheet contains only العربية, English, and Français; every
  selection is persisted as an explicit app override.
- Orderak never receives a fingerprint or face template. The Worker stores only
  WebAuthn public-key material and credential metadata, and applies the same
  seller status and numeric device-limit policy as OTP.
- Passkey settings use a compact list on phones and an adaptive list-detail
  layout from 720dp, with recent-auth-gated add, rename, and revoke actions.
- Phone and store-country selection support the full ISO country list. Country
  defaults come from the network country and then the device locale. No GPS
  permission is requested during registration.
- Store city suggestions use a pinned Countries States Cities Database snapshot
  in isolated D1 storage, are scoped to the phone country, and are limited to
  ten; manual city entry remains available.
- Account email is optional, private, and verified by a non-blocking
  transactional link. It is used for invoices and account notices, but is not
  an account-recovery credential in this version.
- Account step 1 requires a year of birth selected from the current UTC year
  down to 1900. It is private profile data and never part of a Store DTO or
  public storefront/contact surface.

## Pre-production identity and routing foundation

- Android has explicit `staging` and `production` product flavors. The
  installable Staging app uses `app.orderak.seller.staging`, a separate Firebase
  project, and only the Staging API/site hosts; Production retains
  `app.orderak.seller` and the production hosts.
- Staging and Production use separate Cloudflare Workers, Admin delivery, D1,
  D1, R2 and queues. Admin Staging includes a Subscription Test Lab that mirrors
  one implemented plan onto a test organization through expiring entitlement
  overrides (maximum 24 hours), audit and one-click reset. Its backend route
  returns `404` outside Staging and it is not a shipped Android bypass.
- Merges to `main` are eligible for automatic Staging deployment after CI.
  Production promotion is manual and uses the exact commit already verified in
  Staging, supplied as a full 40-character SHA. Before 2026-08-24 the Staging
  trigger was `main`, and the promotion input was documented as accepting a
  release tag; it does not.
- Firebase Phone Auth stays the provider. Stable active identities own the
  seller; phone/UID fields on the seller remain synchronized rollback
  projections until the rollout observation period ends.
- Registration atomically creates identity, organization, owner membership,
  primary routing, and Play account hash. Identity backfill is resumable and
  quarantines malformed/conflicting sellers without stopping other batches.
- Backend phone change exists behind `PHONE_CHANGE_ENABLED=false`; Android UI
  and lost-all-access recovery remain deferred. A successful change preserves
  organization and billing ownership and revokes prior devices.
- One D1 remains the physical authority. Tenant writes resolve through the
  primary `TenantContext`; future cross-shard exports/maintenance are queued and
  dashboards use materialized summaries rather than scatter queries.

## Language Architecture

The seller's Android interface language and a buyer's public-catalog language
are independent:

- Android interface text is packaged locally in Arabic, English, and French
  resources. English is the complete engineering fallback; sellers can select
  Arabic, English, French, or follow the device setting. AGP generates the
  Android locale configuration from the resource folders.
- Android sends its effective BCP 47 language tag in `Accept-Language`, but API
  behavior uses stable error/status codes rather than translated text.
- Public catalogs currently support Arabic and English. The Worker normalizes
  the buyer's browser `Accept-Language` preference to that small supported set.
- Seller-authored product text remains the source of truth. After a product
  changes, the backend generates missing/stale Arabic and English translations
  once and caches them in D1. Page views only read cached rows; AI is never
  called in the storefront request path.
- If a requested or generated translation is unavailable, the catalog displays
  the seller-authored original. Unsupported browser languages use the platform
  default rather than creating unbounded translation work.
- Cached translation rows record their source locale and SHA-256 source version,
  machine provider/model provenance, and a `pending`, `machine`, `reviewed`, or
  `rejected` lifecycle state. A source edit replaces stale machine output and
  clears any obsolete review timestamp.

This keeps seller UI preferences separate from customer presentation and bounds
AI cost, D1 storage, cache variants, and page latency. Add another public catalog
language only as an explicit product decision with a Worker dictionary, D1
support, translation prompt/output, email/legal coverage, and tests.

Localization is enforced by Android lint (`HardcodedText`, `RtlHardcoded`,
`SetTextI18n`, `MissingTranslation`, and `ExtraTranslation`). Debug builds enable
the `en-XA` and `ar-XB` pseudolocales. Locale-sensitive dates, numbers, country
names, and country sorting are derived from the active app locale rather than
cached globally.
All three packaged languages are included in the base App Bundle so the in-app
picker continues to work offline without waiting for a Play language split.

## Known Gaps / Next

- **AI activation is formally deferred.** The Android route, quota display,
  reset/error UX, `/api/v1/chat`, and published admin prompt selection are wired,
  but `AI_ASSISTANT_ENABLED` and the D1 control remain fail-closed. Production
  activation still requires a configured monthly budget and governed evidence
  gates. Calls use a 20-second timeout, 512-token output cap, shared D1 circuit,
  organization-attributed usage, threshold alerts, and stable `503` fallback;
  catalog/order/non-AI workflows and seller-authored translation fallback remain available.
- **Auth model:** new-store creation (`/api/v1/register`) and device restore
  (`/api/v1/auth/session`) both verify the Firebase ID token server-side (phone must
  match). Ongoing seller requests authenticate with phone + device-secret. This
  requires `FIREBASE_WEB_API_KEY` on the Worker in production. The current app
  offers Firebase SMS only: OTP requests time out after 90 seconds, resend state
  is bound to the exact phone, stale callbacks are rejected, and logout signs
  out of Firebase as well as clearing local data. Verified sign-in records the
  published Terms/Privacy versions and the separate marketing choice before a
  new account may be created. Settings provides an authenticated account-deletion
  request and the public post-uninstall resource remains available. Repository
  code now schedules deadline-due fulfillment, deletes the Firebase identity
  through service-account OAuth, verifies R2 cleanup, and fails closed on every
  mandatory external error before D1 records completion. Production activation
  remains deployment-gated on migration 026, Worker secrets, staging evidence,
  and the checks in `runbooks/account-deletion.md`. Technical IP/error records are automatically deleted or
  de-identified after 30 days. WhatsApp OTP remains a future server-owned channel.
- **Tiered subscriptions are implemented but not activated in production.** The
  Worker contains four organization-scoped plans, immutable revisions, 242
  typed feature rows, strict quotas, numeric device caps (1 / 2 / 10 / custom),
  audited overrides, and renewal-safe restrictive changes. Android reads the
  dynamic entitlement snapshot and Play purchases are verified server-side.
  `ENTITLEMENTS_ENABLED=false`, `BILLING_ENABLED=false`,
  `GOOGLE_PLAY_LIFECYCLE_ENABLED=false`, and inactive Play mappings preserve the
  governed Free launch until approval. D1 verification jobs, a token-free
  billing queue, outbox sweep, generation guards, and audited DLQ requeue are
  implemented behind those gates. See
  [ADR-005](../decisions/adr-005-versioned-entitlements-google-play.md).
- Features marked `planned` in
  [`product/orderak-plan-catalog.json`](./orderak-plan-catalog.json) are
  displayed in the comparison but are unavailable and cannot be activated by
  an administrator until application-level enforcement is implemented.
- Product discounts remain hidden in the MVP editor because the backend and
  public catalog do not yet share an authoritative discount contract. This
  prevents a local-only discount from being advertised at a different price.
- Shop-setup city suggestions are curated and offline. Android makes no direct
  geocoding-provider request; adding live search requires a backend-owned
  provider contract, privacy review, caching, and rate limits.
- Later: production Play Console products and pricing, authorized rollout,
  multi-provider AI routing, and richer analytics.

## Tier behavior

Free supplies the core seller/catalog/order utility with 20 products, five
categories, 50 orders/month, 20 AI requests/month, one owner device, and ads.
Paid 1 raises the starter limits to 200 / 20 / 500 / 200 with two devices and
removes ads. Paid 2 targets power sellers and growing teams with 2,000 / 100 /
5,000 / 1,000 and ten devices. Paid 3 is sales-approved and requires explicit
organization overrides for custom capacity before purchase approval.

Existing data is never deleted on downgrade. Existing devices remain valid;
existing products remain viewable and editable, while only new growth is
blocked at the effective limit. The product header shows current/limit usage;
at or over the limit the add action becomes a lock that explains whether to
reduce usage or upgrade. Free changes apply immediately.
Additive paid changes apply immediately, while restrictive or mixed paid
changes are scheduled for the next renewal (or a 30-day fallback where a legacy
renewal date is unavailable) with a recorded notice.

The Dashboard supports pull-to-refresh, plan-usage meters, and non-blocking
offline, billing-grace, and pending-plan notices. Google Play Billing remains
the source of localized subscription prices: Settings resolves the mapped
product/base-plan through `ProductDetails` and never renders a backend-authored
currency amount.

## Operations coverage delivered 2026-07-20

Android Settings now links to seller-scoped support tickets and replies,
targeted announcements, Arabic/English catalog translation review, device and
session management, deletion-request status, a dedicated subscription status
and Play-purchase recovery screen, and the deployment-gated AI assistant. The
Dashboard displays an unread-announcement entry point. The shared entry gate
checks backend account status and routes suspended/banned accounts to a stable
restricted screen; credentialed API responses with stable `auth` or
`account_restricted` codes re-enter the same gate during an active session.
Store Information validates slugs live. Eligible Free-plan surfaces
render scheduled, frequency-aware, weighted first-party campaigns; external ad
SDK adapters remain off.

The canonical admin panel now exposes stores and seller lifecycle,
subscriptions, coupons/referrals/payouts, first-party ads, transactional email
and inbound mail, deletion requests, support, announcements, translation
review, scheduled-job observability, and typed effective runtime controls.
Navigation is permission-aware while Worker RBAC remains authoritative.

The screen manifest includes `RestrictedAccountRoute`, `SupportRoute`,
`SupportTicketRoute`, `AnnouncementsRoute`, `CatalogLanguagesRoute`,
`DevicesRoute`, `DeletionStatusRoute`, `SubscriptionRoute`, and
`AiAssistantRoute` so admin screen synchronization reflects the Compose graph.

Billing and AI remain governed: Android exposure does not activate them.
`BILLING_ENABLED`/`AI_ASSISTANT_ENABLED`, D1 admin controls, entitlement rollout,
Play mapping, and the existing legal/privacy/security/release approvals all
remain required.

## Canonical Admin Control Center delivered 2026-07-21

The Admin Control Center is the canonical control plane for all operational,
commercial, configuration, entitlement, content, security, and internal admin
capabilities across Orderak. The standalone React/TypeScript application is
served from `admin.orderak.app`; embedded Worker HTML panels have been removed.

All three delivery waves are represented as functional permission-aware
workspaces: account and trust operations; plan, entitlement, rollout, commerce,
buyer privacy, and exports governance; and communication, content, jobs,
security, settings, manifests, prompts, bugs, releases, docs, and design assets.
Controls marked `planned` or `display_only` cannot be mutated. Active controls
identify their runtime consumer and remain below deployment hard gates.

Android consumes governed app-version policy with warning, grace, forced-
update, emergency-denial, and maintenance states. Blocking state is accepted
only from a current response; stale/offline blocking policy becomes a visible
warning so an unavailable network cannot permanently lock out the seller.
`MainRoute#version-governance` is included in the screen manifest.

## Rules (from AGENTS.md)

- Never store DeepSeek, OpenAI, Claude, Gemini, Cloudflare, Firebase server,
  Figma, or Canva keys in the app.
- The app calls the backend; the backend calls AI providers and third-party APIs.
- Keep code beginner-friendly; avoid unnecessary abstraction.
- Update this file when product behavior changes.
