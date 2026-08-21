---
status: current
generated: false
owner: security
applies_to: [production, staging]
---
# Data Classification Standard

> **Status:** Draft for review
> **Last updated:** 2026-08-01
> **Scope:** All personal and operational data processed by Orderak
> **References:** `docs/governance/retention-matrix.md` §1 for per-field classification

## 1. Classification Levels

| Level | Label | Definition | Examples |
|---|---|---|---|
| **L0** | Public | Intentionally visible to anyone; no auth required | Store name, product names/prices, category names, public identifiers, store code |
| **L1** | Internal | Not public but low sensitivity if exposed; operational data | Plan names, feature flags, affiliate settings, settings rows, error counts, ad creative text |
| **L2** | Confidential | Personal data requiring access control; exposure may harm individuals | Phone number (hashed or E.164), email, device secret hash, IP address, order history, buyer contact data |
| **L3** | Highly Sensitive | Secrets, credentials, or data whose exposure would cause severe harm | Plaintext passwords, TOTP seeds, API keys, signing keys, JWT secrets, raw payment events, plaintext device secrets |

## 2. Data Classification by Table

### 2.1 Seller Data — L2 Confidential (PII)

| Table | Fields | Classification | Notes |
|---|---|---|---|
| `sellers` | `phone`, `email`, `whatsapp`, `instapay`, `vfcash` | L2 | Personal contact and financial identifiers |
| `sellers` | `store_name`, `slug`, `description`, `website`, `address`, `logo_url`, `cover_url` | L0 | Public store profile |
| `sellers` | `store_code`, `public_identifier`, `referral_code` | L0 | Public-facing identifiers |
| `sellers` | `secret` | L3 | Legacy plaintext secret; being migrated to hashed |
| `sellers` | `id` (UUID) | L1 | Internal identifier; not exposed in URLs |
| `seller_devices` | `secret_hash` | L2 | Hashed device credential |
| `seller_devices` | `fcm_token` | L2 | Push notification token |
| `seller_profiles` | `full_name`, `birth_year`, `email_private`, `email_verified_at` | L2 | Private account profile; birth year and private email are excluded from Store DTOs, public pages, email variables, telemetry, and public contact data |
| `sellers` | `business_category`, `city_geoname_id`, `city_name` | L0 | Public store classification and location |

### 2.1.1 Auth and onboarding implementation (v1 API)

| Table/location | Fields | Classification | Notes |
|---|---|---|---|
| `onboarding_sessions` | phone, Firebase UID, name, birth year, private email, legal versions | L2 | Resumable pre-account record; never exposed publicly |
| `onboarding_sessions` | `token_hash`, `device_secret_hash` | L2 | High-entropy hashes used only by backend auth handlers |
| `passkey_credentials` | credential ID, public key, user ID, counter, AAGUID, transports, backup/device metadata | L2 | Public-key material is not biometric data, but credential identifiers remain confidential and must not be logged |
| `webauthn_challenges` | challenge hash, ceremony, seller/user binding, timestamps | L2 | Raw challenge is returned once and never stored |
| `recent_auth_proofs` | token hash, seller, method, expiry | L2 | Ten-minute step-up evidence |
| `email_verification_tokens` | email, token hash, timestamps | L2 | Raw token is returned only in the transactional link |
| `geo_cities`, `geo_city_names`, `geo_city_search` | all imported fields | L0 | Public GeoNames data; CC BY attribution required |
| Android encrypted preferences | onboarding token, recent-auth token, device secret | L3 | Opaque bearer values; never in logs, URLs, screenshots, or backups |
| Android DataStore | onboarding text draft including birth year, category pair, and confirmed/manual city | L2 | Device-local resumable draft; logo is not collected during onboarding |

### 2.2 Order Data — L2 Confidential (Buyer PII)

| Table | Fields | Classification | Notes |
|---|---|---|---|
| `orders` | `buyer_phone`, `buyer_name` | L2 | Buyer personal data; store-scoped |
| `orders` | `order_no`, `status`, `pay_method`, `total_minor`, `currency`, `note` | L1 | Operational; visible to seller |
| `order_items` | All fields | L1 | Operational order details |

### 2.3 Legal & Consent — L2 Confidential

| Table | Fields | Classification | Notes |
|---|---|---|---|
| `legal_acceptances` | `phone_e164`, `seller_id` | L2 | Consent evidence with PII |
| `legal_acceptances` | `terms_version`, `privacy_version`, `locale`, `marketing_consent` | L1 | Consent metadata |
| `deletion_requests` | `phone_e164`, `email` | L2 | De-identified on completion |

### 2.4 Admin — L3 Highly Sensitive

| Table | Fields | Classification | Notes |
|---|---|---|---|
| `admin_users` | `password_hash`, `totp_secret` | L3 | Authentication secrets |
| `admin_users` | `email`, `role` | L2 | Admin identity |
| `admin_audit` | `ip` | L2 | Scrubbed at 30 days |
| `admin_audit` | `action`, `entity`, `admin_id` | L1 | Operational audit trail |

### 2.5 Secret Storage — L3 Highly Sensitive

| Location | Classification | Notes |
|---|---|---|
| Cloudflare Worker secrets | L3 | `FIREBASE_WEB_API_KEY`, admin/payment/provider keys, and any future signing/encryption keys |
| `.dev.vars` (local) | L3 | Git-ignored; never committed |
| `wrangler.jsonc` | L1 | No secrets; only non-sensitive config |
| CI/CD runner secrets | L3 | GitHub Actions secrets or equivalent |

### 2.6 Operational — L1 Internal

| Table | Fields | Classification | Notes |
|---|---|---|---|
| `error_logs` | All fields | L1 | IP scrubbed via retention; no PII in context |
| `admin_sessions` | `id`, `admin_id`, `expires_at` | L2 | Session identifiers |
| `rate_limits` | `bucket`, `count` | L1 | No PII |
| `email_events`, `webhook_events` | All fields | L1 | Operational telemetry; private-account verification sends replace `to_addr` with `[private-account-email]` |
| `content_pages`, `content_page_versions` | All fields | L0 | Public legal documents |
| `announcements` | All fields | L0 | Public announcements |

## 3. Handling Requirements

| Level | Storage | Transmission | Access | Deletion |
|---|---|---|---|---|
| **L0 — Public** | Any | Any (HTTPS) | No auth required | Per retention matrix |
| **L1 — Internal** | D1, R2 | HTTPS only | Role-based | Per retention matrix |
| **L2 — Confidential** | D1 (encrypted at rest) | HTTPS + per-request auth | Least privilege; store-scoped | De-identified or deleted on account deletion; evidence preserved |
| **L3 — Highly Sensitive** | Worker secrets or hashed in D1 | Never in URLs, logs, or client code | Named individuals only; MFA required | Rotate on compromise; never export |

## 4. Rules

1. **L3 data never leaves the backend.** Secrets, plaintext credentials, and raw auth tokens must not appear in:
   - Client-side code (Android app)
   - URLs or query parameters
   - Logs (application, error, or audit)
   - Support tickets or email bodies
   - Source code repositories

2. **L2 data must be store-scoped.** Any query returning buyer or seller personal data must filter by `store_id` or `seller_id`. Cross-store access must return empty results or 404.

3. **L1 data may be used for operations** but must not contain PII. If operational data incidentally contains PII (e.g., IP addresses), it must be scrubbed per the retention schedule.

4. **New fields and API operations require classification.** Before adding a
   column or publishing an OpenAPI operation, classify it as L0-L3 and document
   purpose, lawful basis, retention, and deletion. Engineering may use
   `pending-review` only inside a draft internal specification.

5. **Classification downgrades are blocked.** Once classified, a field may only be upgraded or reclassified by formal review. Downgrading or public publication requires Privacy and Security approval together.

## 5. OpenAPI approval ownership

| Classification | Required approval |
| --- | --- |
| L0 | Product Owner after Privacy and Security review |
| L1 | Engineering Lead with Security |
| L2 | Privacy Lead/DPO with Security |
| L3 | Security Lead with Privacy |

Internal specifications can contain reviewed L0-L3 operations. The public
bundle contains L0 only; any L1, L2, L3, `pending-review`, Admin route,
integration route, or credential marker fails its build.

## CHG-004 subscription additions

- `play_purchases.purchase_token_encrypted` and the Worker encryption/private
  keys are L3. Plain purchase tokens must never appear in logs, Android storage,
  admin responses, URLs, or source control.
- Purchase-token hashes, Play order IDs, subscription state, organization
  membership, overrides, approvals, usage reservations, and billing events are
  L2 store/organization-scoped operational records.
- Plan definitions, immutable revision values, implementation status, and
  inactive product identifiers are L1 configuration; public product names and
  localized prices returned by Play may be L0.

> **Approval:** This standard is ready for security lead review (Plan 7 Phase 2).

### Static city catalogue and global taxonomy additions

| Store | Data | Class | Rule |
|---|---|---|---|
| `onboarding_sessions` | `phone_country_iso` | L1 | Server authority for city restriction; never accepted from city query parameters |
| `onboarding_sessions` | confirmed `city_catalog_id`, `city_catalog_version`, `city_name` | L1 | Temporary onboarding selection |
| `sellers` | `city_catalog_id`, `city_catalog_version`, `city_name` | L1/L0 | Source/version IDs internal; city label may be public |
| isolated `orderak-geo` D1 | pinned city catalogue | L0 | Public ODbL data only; no phone, onboarding token, seller, or account data |
| `business_taxonomy_*` | global categories and ar/en/fr translations | L0 | Versioned catalog with no seller location |

Search input and result lists are transient and not persisted.
