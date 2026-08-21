---
status: current
generated: false
owner: governance
applies_to: [internal]
---
# Orderak Data Map

> **Status:** Draft inventory — legal bases, retention, transfers, and vendor
> terms require counsel/DPO approval before production reliance.
>
> **Last updated:** 2026-07-26
> **Covers:** Android app (Room + DataStore), Cloudflare Workers (D1 + R2 + Queues),
> Firebase Auth/Analytics, DeepSeek, dormant payment schema, and Cloudflare
> Email Routing.

## 1. Data Categories

### 1.1 Seller Identity & Authentication

| Field | Source | Purpose | Legal Basis | Storage | Retention | Access |
|---|---|---|---|---|---|---|
| `phone` (E.164) | User input during sign-up | Unique account identifier; auth credential and fallback seller contact | Performance of contract; public-contact basis requires counsel review | D1 `sellers.phone` | Until account deletion | Backend; authorized admin; never a public URL/HTML identifier, but returned to a buyer after a successful order when no WhatsApp number exists |
| `secret` (`sha256$` hash; legacy PBKDF2/plaintext migration supported) | App-generated, sent as `x-orderak-secret` | Per-device bearer credential | Performance of contract | D1 `sellers.secret` (original device); `seller_devices.secret_hash` (additional devices) | Until account deletion or device removal | Backend auth handlers only |
| `seller_devices.secret_hash` | App generates per-device, hashed server-side | Multi-device auth (Starter/Pro plans) | Performance of contract | D1 | Until device removed or account deleted | Backend auth handlers only |
| Firebase Auth UID + phone | Firebase Phone OTP SDK | Verify phone ownership during sign-up | Consent + performance of contract | Firebase Auth (Google-managed) | Firebase-managed; our `legal_acceptances` ties the verified phone to our record | Firebase SDK only; server verifies ID token once |
| `legal_acceptances` (terms_version, privacy_version, marketing_consent, locale, source, app_version, accepted_at) | App sends on sign-up after OTP verification | Versioned acceptance evidence | Proposed legal obligation/consent basis under Egypt Law No. 151/2020; counsel confirmation required | D1 | Proposed account lifetime + 5 years after deletion; counsel confirmation required | Backend auth flow; admin panel (restricted) |
| `onboarding_sessions` (hash-only token, phone, Firebase UID, device-secret hash, name, birth year, private email, legal versions, expiry) | Worker after verified OTP; account fields from seller | Resume a new-seller flow and bind its final atomic creation | Pre-contract steps + security; legal basis requires counsel confirmation | D1 | Functional idle/absolute expiry 30 min/24 h; purged 30 days after absolute expiry | Backend onboarding handlers only; birth year is never returned publicly |
| `seller_profiles.full_name`, `birth_year`, `email_private`, `email_verified_at` | Seller account step; required year-only birth year and optional private email | Private account profile, invoices, and account notices | Performance of contract; age-data necessity and optional-email basis require counsel confirmation | D1 | Account lifetime; deleted on account deletion | Seller-authenticated account UI and restricted services/backend/admin; birth year/private email excluded from Store DTOs, public pages, email variables, telemetry, and public contact data |
| `passkey_credentials` public key and credential metadata | Android credential provider after seller-authorized registration | Passwordless returning-seller authentication | Performance of contract + security | D1 | Until revoked/account deletion; revoked rows deleted on account deletion | WebAuthn handlers and seller settings; credential IDs never logged or returned by list API |
| `webauthn_challenges.challenge_hash` | Worker-generated random challenge | One-use registration/authentication ceremony | Security | D1 | Five-minute functional lifetime; purged within one day after expiry | WebAuthn handlers only; raw challenge is not stored |
| `recent_auth_proofs.token_hash` | Successful OTP or Passkey authentication | Ten-minute step-up authorization | Security | D1 | Ten-minute functional lifetime; purged within one day after expiry | Sensitive account/passkey handlers only |
| `email_verification_tokens` (email + token hash) | Worker when optional email is saved/resend requested | Verify private notification address; not account recovery | Performance of contract + security | D1 + transactional email link | 24-hour functional lifetime; purged within 30 days after expiry/use | Email verification handler only |
| `sellers.lang` | User preference or device default | UI language selection | Consent | D1 | Until account deletion | Backend; public catalog ignores this field |

### 1.2 Store Profile

| Field | Source | Purpose | Legal Basis | Storage | Retention | Access |
|---|---|---|---|---|---|---|
| `store_name` | User input during shop setup | Public store identity | Performance of contract | D1 | Until account deletion | Public catalog pages; backend API |
| `slug` | Derived from store_name or user-set | URL-friendly store identifier | Performance of contract | D1 | Until account deletion | Public catalog pages |
| `store_code` | Server-generated (8-char, immutable) | Permanent public store key | Performance of contract | D1 | Immutable; retained 5 years post-deletion for redirect chain | Public catalog pages (canonical); redirect handler |
| `public_identifier` | Server-computed: `{country_code}-{slug}-{store_code}` | Canonical public store URL | Performance of contract | D1 | Until account deletion | Public catalog pages |
| `country_code` (ISO2) | User input during shop setup | Country context for public URL | Performance of contract | D1 | Until account deletion | Public catalog pages |
| `business_category`, `city_geoname_id`, `city_catalog_id`, `city_catalog_version`, `city_name` | Seller input; city may be selected from the static catalogue or entered manually | Store category and public location context | Performance of contract | D1 `orderak-db` | Until account deletion | Store API and public profile where product design exposes it |
| Countries States Cities Database pinned snapshot | Checksum-verified public release | Phone-country-scoped city suggestions | Public ODbL-1.0 dataset | Isolated D1 `orderak-geo` | Replaced by an approved versioned import | Authenticated onboarding search API; maximum ten results with attribution |
| `description` | User input | Store bio/description | Consent | D1 | Until account deletion | Public catalog pages |
| `whatsapp`, `email`, `website`, `address` | User input (optional) | Store contact info | Consent | D1 | Until account deletion | Public catalog pages |
| `logo_url`, `cover_url` | User upload → R2 | Store branding | Consent | R2 `stores/{uuid}/` | Until account deletion | Public catalog pages; CDN-cached |
| `instapay`, `vfcash` | User input (optional) | Seller payout instructions | Consent; legal basis requires counsel review | D1 | Until account deletion | Seller-authenticated store API and returned to an unauthenticated buyer after a successful public order; not rendered in catalog HTML |
| `referral_code` | Server-generated | Affiliate/referral tracking | Consent | D1 | Until account deletion | Backend referral logic |
| `status` | Server-set | Account lifecycle: active, suspended, banned | Performance of contract + legal obligation | D1 | Until account deletion + 5 years | Backend auth; admin panel |

### 1.3 Product Catalog

| Field | Source | Purpose | Legal Basis | Storage | Retention | Access |
|---|---|---|---|---|---|---|
| `products.id` (UUID) | Server-generated | Internal product identity | N/A (internal) | D1 | Until store deletion | Backend only; never in URLs |
| `product_code` (p-XXXXXX) | Server-generated (immutable) | Public product URL key | N/A (internal) | D1 | Until store deletion | Public catalog pages |
| `products.name`, `description`, `slug`, `price_minor`, `currency`, `stock`, `available`, `image_url` | Seller input via app | Product listing data | Performance of contract | D1 + R2 (images) | Until store deletion | Public catalog pages; app (Room cache) |
| `categories.name`, `category_code`, `slug`, `sort_order` | Seller input via app | Product categorization | Performance of contract | D1 | Until store deletion | Public catalog pages; app (Room cache) |
| `product_translations.*` | AI-generated (DeepSeek) then cached | Customer-facing translations (ar/en) | Legitimate interest (improving buyer experience) | D1 | Until source product changes (stale rows replaced) or store deletion | Public catalog pages; never in seller app |

### 1.4 Orders

| Field | Source | Purpose | Legal Basis | Storage | Retention | Access |
|---|---|---|---|---|---|---|
| `orders.id` (UUID) | Server-generated | Internal order identity | N/A (internal) | D1 | Until store deletion | Backend only |
| `order_no` | Server-sequenced per store | Human-readable order number | N/A (internal) | D1 | Until store deletion | App (Room sync); admin panel |
| `buyer_phone`, `buyer_name` | Buyer input via public catalog form | Order fulfillment contact | Performance of contract | D1 `orders` | Until store deletion (seller's business record) | Seller app; admin panel |
| `status`, `pay_method`, `total_minor`, `currency`, `note` | System + seller updates | Order lifecycle tracking | Performance of contract | D1 | Until store deletion | Seller app; admin panel |
| `order_items.product_name`, `qty`, `price_minor` | Buyer input + product snapshot | Denormalized order line items | Performance of contract | D1 | Until store deletion | Seller app; admin panel |

### 1.5 Billing & Payments

| Field | Source | Purpose | Legal Basis | Storage | Retention | Access |
|---|---|---|---|---|---|---|
| `subscriptions.*` | System + mock billing flow; future provider events | Dormant plan-management schema; paid acquisition currently disabled | Proposed contract/legal basis pending counsel | D1 | Proposed 5 years post-cancellation; counsel confirmation required | Backend; admin panel |
| `payment_events.*` | Mock billing events; future provider events | Dormant payment-audit schema | Proposed legal obligation pending counsel | D1 | Proposed 5 years; counsel confirmation required | Admin panel (finance role) |
| `payment_events.raw_json` | Mock/future provider payload | Dormant payment evidence | Proposed legal obligation pending counsel | D1 | Proposed 5 years; counsel confirmation required | Admin panel (finance role); ingestion must remove prohibited payment data |
| `coupons.*`, `coupon_uses.*` | Admin-created | Discount tracking | Performance of contract | D1 | 2 years post-expiry | Backend; admin panel |
| `referrals.*`, `affiliate_settings` | System + admin | Affiliate program tracking | Consent + performance | D1 | 2 years post-payout | Admin panel (finance role) |
| `webhook_events` | Mock/future provider event IDs | Idempotency ledger for the generic webhook contract; no native Stripe contract exists | N/A (operational) | D1 | Proposed 90 days | Backend |
| Android `BillingManager` / Play purchases | Google Play Billing (not yet wired) | In-app subscription purchase | Performance of contract | Google Play-managed; server validates token | Per Google Play policy | Google Play; server verification endpoint |

### 1.6 Ads

| Field | Source | Purpose | Legal Basis | Storage | Retention | Access |
|---|---|---|---|---|---|---|
| `ads.*` (title, image_url, click_url, type, target_plan, frequency, weight) | Admin-created | In-app advertising for free-tier sellers | Performance of contract | D1 + R2 (ad creatives) | Until ad deactivated or 1 year post-expiry | Backend `/api/v1/ads/active`; admin panel |
| `ad_impressions.*` | App reports impression/click | Ad performance tracking | Legitimate interest (ad delivery measurement) | D1 | 90 days | Backend; admin panel (anonymized aggregation) |

### 1.7 Admin & Operations

| Field | Source | Purpose | Legal Basis | Storage | Retention | Access |
|---|---|---|---|---|---|---|
| `admin_users.*` | System (initial seed) + admin panel | Admin authentication + RBAC | Performance of contract + security | D1 | Until admin removed + 1 year audit | Admin panel (owner role only for user management) |
| `admin_users.password_hash` | Admin input (PBKDF2 hashed) | Admin credential | Security | D1 | Until password change or admin removal | Admin auth handler only |
| `admin_users.totp_secret` | Admin enrollment | 2FA for admin panel | Security | D1 | Until TOTP disabled or admin removed | Admin auth handler only |
| `admin_sessions.*` | Worker on admin login | Session management | Security | D1 | Until expiry (configurable) or 30 days max | Admin auth middleware |
| `admin_audit.*` | System on every admin action | Admin activity ledger | Security + legal obligation | D1 | 2 years; IPs scrubbed after 30 days | Admin panel (owner role) |

### 1.8 Support & Communication

| Field | Source | Purpose | Legal Basis | Storage | Retention | Access |
|---|---|---|---|---|---|---|
| `support_tickets.*` | Seller via app or email | Customer support | Performance of contract | D1 | 2 years post-closure | Admin panel (support role); seller's own tickets |
| `support_messages.*` | Seller/admin messages | Support conversation | Performance of contract | D1 | 2 years post-closure | Admin panel (support role); seller's own tickets |
| `email_events.*` | Email sending service | Email delivery tracking | Operational | D1 | 90 days | Admin panel |
| `email_template_history.*` | Admin panel on template edit | Email template audit trail | Operational | D1 | 2 years; IPs scrubbed after 30 days | Admin panel |
| `inbound_emails.*` | Cloudflare Email Routing | Inbound support/customer email | Performance of contract | D1 | 2 years | Admin panel (support role) |

### 1.9 Technical & Operational

| Field | Source | Purpose | Legal Basis | Storage | Retention | Access |
|---|---|---|---|---|---|---|
| `error_logs.*` | Worker on error | Debugging + reliability monitoring | Legitimate interest (service quality) | D1 | 30 days (auto-deleted by `retention.ts`) | Admin panel (Errors tab) |
| `rate_limits.*` | System on every rate-limited endpoint | Abuse prevention | Legitimate interest (security) | D1 | 30 days (auto-deleted by `retention.ts`) | Backend only |
| Android Room DB (products, categories, orders, order_items, customers, payments) | Sync from backend | Offline-first local cache | Performance of contract | Android device (Room/SQLite) | Cleared on logout or app uninstall | Seller app only |
| Android DataStore (profile/session metadata + onboarding draft) | App on sign-in/onboarding edits | Session routing and resumable text draft | Performance of contract | Android device (DataStore/Preferences) | Session data cleared on logout; draft retained across token expiry so the seller can re-verify OTP | Seller app only |
| Android encrypted preferences (device secret, onboarding/recent-auth tokens) | App/Worker auth flow | Bearer credential and short-lived auth persistence | Security + performance of contract | Android app-private encrypted preferences | Auth tokens removed on expiry/completion/logout as applicable; device secret retained for installation continuity | Seller app only |
| R2 product images, logos, covers | Seller upload | Product + store media | Performance of contract | R2 `stores/{uuid}/` | Until store deletion | Public CDN-cached; backend media handler |

### 1.10 Third-Party Processors

| Processor | Data Shared | Purpose | Hosting Countries | DPA Status |
|---|---|---|---|---|
| **Firebase Auth** (Google) | Phone number and authentication/device signals defined by the Firebase SDK/configuration | SMS OTP verification | Global (Google-managed; exact locations/transfer path require confirmation) | Standard terms may be available; Orderak acceptance, configuration, transfer basis, and evidence are not yet approved here |
| **Firebase Analytics** (Google) | Automatically collected and configured app events; event/parameter inventory and PII exclusion are not yet verified | Product analytics dependency is included; collection behavior requires verification | Global (Google-managed; exact locations/transfer path require confirmation) | Standard terms may be available; Orderak evidence and data mapping remain open |
| **DeepSeek** | Product text (name, description) for translation; prompt text for AI chat | AI-powered translations + chat assistant | Per DeepSeek's infrastructure | Review required |
| **Stripe** | No current production flow; environment variable and archived planning only | Future payment processing, subject to approval | Not active | Assessment required before implementation |
| **Cloudflare** (Workers, D1, R2, Queues, Email Service, CDN) | All application data | Hosting infrastructure | Per Cloudflare resource configuration | Cloudflare DPA covers Enterprise and Self-Serve agreements; Orderak acceptance, transfer, sub-processor, and country mapping still require evidence |
| **GeoNames** | No seller data is sent; Orderak downloads public city files | City suggestion dataset | GeoNames export hosting | CC BY attribution and monthly provenance must be preserved |
| **Google Play Billing** | Purchase tokens, subscription state | In-app purchase processing (not yet wired) | Google-managed | Google DPA |

## 2. Data Classification

| Classification | Examples |
|---|---|
| **Restricted** | `phone`, `secret` (hashed), `admin_users.password_hash`, `admin_users.totp_secret`, `seller_devices.secret_hash`, `instapay`, `vfcash` |
| **Confidential** | `buyer_phone`, `buyer_name`, seller `email`, `admin_users.email`, `payment_events.raw_json`, `support_messages.body`, `inbound_emails.*` |
| **Internal** | `admin_audit.*`, `error_logs.*`, `rate_limits.*`, `email_events.*`, `webhook_events` |
| **Public** | `store_name`, `slug`, `public_identifier`, `store_code`, product `name`/`description`/`price`/`image_url`, category `name`, `logo_url`, `cover_url` |

## 3. Data Flow Diagrams

> [TODO: Generate the 9 required diagrams per Plan 5 Phase 2. Priority: context-level system diagram, data-flow diagram, cross-border transfer diagram, authentication flow, account-deletion flow.]

## 4. Vendor & SDK Inventory

> [TODO: Complete with formal DPA status, sub-processor lists, and risk ratings per Plan 5 Phase 7.]

## 5. CHG-004 subscription data flow

Android sends a Google Play purchase token over HTTPS to the authenticated
Worker. The Worker sends it to the Google Play Developer API, stores only a
SHA-256 lookup hash and AES-GCM ciphertext in D1, maps the verified lifecycle to
the organization subscription, acknowledges the purchase, and returns a typed
entitlement snapshot. Pub/Sub RTDN sends message ID, notification type, and a
token; the Worker validates OIDC, deduplicates, then re-queries Google. No Play
service-account credential or decrypted token is returned to Android or admin.

## 6. Open Data-Discovery Issues

1. **Firebase Analytics**: Inventory automatic collection and configured events,
   confirm consent/disablement behavior, and verify that no phone, email, or
   other PII is sent as event parameters.
2. **DeepSeek data handling**: Confirm whether prompts and translations are retained by DeepSeek for training. If yes, obtain DPA or restrict to non-personal product text only.
3. **Future payment provider**: Select and approve a provider before enabling
   billing; then document region, data fields, DPA, webhook contract, retention,
   and cross-border transfer treatment.
4. **Cloudflare regions**: Document exact Workers/D1/R2/Queues processing regions; assess against Egyptian cross-border transfer requirements.

## 7. Static city catalogue and taxonomy addition

| Processor/data | Sent or stored | Purpose | Retention/access |
|---|---|---|---|
| Countries States Cities Database snapshot | Public city/state names, source IDs, native names, population, timezone, and ISO country | City search and selected-city validation | Isolated `orderak-geo` D1; pinned/versioned ODbL import with visible attribution |
| D1 seller/onboarding | Confirmed source city ID, dataset version, and city name | Resume and complete store setup | Session/account lifetime; deletion path removes it |
| D1 business taxonomy | Versioned global canonical categories and translations | Consistent seller classification | Independent of seller country/city |
