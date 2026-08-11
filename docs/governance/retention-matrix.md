# Orderak Retention & Deletion Matrix

> **Status:** Proposed policy and implementation target — not proof of current enforcement
> **Last updated:** 2026-07-26
> **Governing documents:** current published Privacy Policy and Terms versions,
> Egypt PDPL No. 151/2020, Egypt Law No. 175/2018 (applicability TBD).
> **Legal review:** Retention periods, legal bases, and statutory citations must
> be confirmed by qualified Egyptian counsel before production reliance.
>
> **Ownership:** The following sections are owned by the listed roles. Each owner is responsible for ensuring their categories' retention rules are implemented, tested, and maintained.
>
> | Section | Owner |
> |---|---|
> | 1.1 Seller Account Data | Engineering (D1), Security (device secrets) |
> | 1.2 Legal & Consent Records | Legal / DPO |
> | 1.3 Product Catalog | Engineering (D1, R2) |
> | 1.4 Orders | Engineering (D1) |
> | 1.5 Billing & Payments | Finance & Tax, Engineering |
> | 1.6 Ads | Engineering (D1) |
> | 1.7 Admin & Operations | Security, Engineering |
> | 1.8 Support & Communication | Customer Support, Engineering |
> | 1.9 Local Device Data (Android) | Android Engineering |

## 1. Retention Rules by Data Category

### 1.1 Seller Account Data

| Data | Retention Period | Trigger | Authority | Disposal Method | Exceptions |
|---|---|---|---|---|---|
| `sellers.id` | Account lifetime | Account creation | Contract performance | Deleted from D1 on account deletion | Referenced in legal records only in de‑identified form |
| `sellers.phone` | Account lifetime | Account creation | Contract performance | Deleted from D1 on account deletion | Retained in `legal_acceptances` record (de-identified: `deleted:<request-id>`) |
| `sellers.secret` | Account lifetime or device removal | Account creation / device added | Contract performance | Deleted from D1 on account deletion or device removal | None |
| `seller_devices.secret_hash` | Account lifetime or device removal | Device added | Contract performance | Deleted from D1 on account deletion or device removal | None |
| `seller_devices.fcm_token` | Account lifetime or device removal | Device added | Contract performance | Deleted on account deletion or device removal | None |
| `seller_profiles.full_name`, `birth_year`, `email_private`, `email_verified_at` | Account lifetime | Account onboarding/profile update | Contract performance; birth-year necessity and optional-email basis require counsel confirmation | Deleted from D1 on account deletion | Birth year/private email are excluded from Store DTOs and public pages; birth year is also excluded from email variables, telemetry, and public contact data |
| `passkey_credentials.*` | Until seller revokes the Passkey or account deletion | Passkey registration | Contract performance + security | Revocation blocks use immediately; active and revoked rows are deleted on account deletion | No biometric template is collected |
| `onboarding_sessions.*` | 30 min idle, maximum 24 h functional access; purge 30 days after absolute expiry | Verified OTP for a new seller | Pre-contract steps + security | Daily cleanup after the purge window; deleted immediately with the verified phone's account deletion | Token and device-secret values are stored hash-only |
| `webauthn_challenges.*` | 5 min functional access; purge within 1 day after expiry | Passkey ceremony starts | Security | Consumed once; daily cleanup | Raw challenge is never stored |
| `recent_auth_proofs.*` | 10 min functional access; purge within 1 day after expiry | Successful OTP/Passkey authentication | Security | Daily cleanup; deleted on account deletion | Token stored hash-only |
| `email_verification_tokens.*` | 24 h functional access; purge within 30 days after expiry/use | Optional private email saved/resend | Contract performance + security | Single-use; daily cleanup; deleted on account deletion | Raw token appears only in transactional link |
| `sellers.store_name`, `slug`, `description`, `whatsapp`, `email`, `website`, `address` | Account lifetime | Shop setup / edit | Contract performance | Deleted from D1 on account deletion | None |
| `sellers.business_category`, `city_geoname_id`, `city_catalog_id`, `city_catalog_version`, `city_name` | Account lifetime | Shop setup / edit | Contract performance | Deleted from D1 on account deletion | The isolated public city catalogue contains no seller data |
| `sellers.store_code` | Account lifetime + 5 years | Store creation | Legal obligation (URL stability, redirect chain) | Retained as de-identified record 5 years post-deletion | Redirect handler needs the code for 301 responses |
| `sellers.public_identifier` | Account lifetime | Store creation | Contract performance | Deleted from D1 on account deletion | None |
| `sellers.instapay`, `vfcash` | Account lifetime | User input | Consent | Deleted from D1 on account deletion | May be retained in `payment_events.raw_json` if a payout was processed (see §1.5) |
| `sellers.referral_code` | Account lifetime + 5 years | Account creation | Legal obligation (referral audit trail) | De-identified after account deletion | Retained for referral program integrity |
| `sellers.status` | Account lifetime + 5 years | Account creation | Legal obligation (abuse/fraud evidence) | De-identified after account deletion | Needed if seller re-registers with same phone |

### 1.2 Legal & Consent Records

| Data | Retention Period | Trigger | Authority | Disposal Method | Exceptions |
|---|---|---|---|---|---|
| `legal_acceptances.*` (including phone_e164) | Account lifetime + 5 years | Sign-up OTP verification | Legal obligation (PDPL consent evidence) | De-identified: `phone_e164` and `ip_address` replaced with `deleted:<request-id>`; all other non‑essential metadata retained; `seller_id` set to NULL | Required as evidence of consent; never fully deleted |
| `deletion_requests.*` | Permanent | Deletion request submitted | Legal obligation (compliance evidence) | `phone_e164` and `email` de-identified after completion; record retained indefinitely | Proof of compliance with deletion obligation |

### 1.3 Product Catalog

| Data | Retention Period | Trigger | Authority | Disposal Method | Exceptions |
|---|---|---|---|---|---|
| `products.*` (all fields) | Account lifetime | Product creation / sync | Contract performance | Deleted from D1 on account deletion | None |
| `categories.*` (all fields) | Account lifetime | Category creation | Contract performance | Deleted from D1 on account deletion | None |
| `product_translations.*` | Account lifetime or until source product changes | Product change triggers stale row replacement | Legitimate interest | Deleted with product on account deletion; stale rows replaced on source edit | None |
| R2 product images, logos, covers | Account lifetime | Upload | Contract performance | Deleted from R2 (`stores/{uuid}/`) on account deletion | None |
| `product_variants.*` | Account lifetime | Product variant creation | Contract performance | Deleted from D1 on account deletion | None |
| `product_media.*` | Account lifetime | Image/file upload | Contract performance | Deleted from D1 on account deletion; R2 files also deleted | None |
| R2 digital product files | Account lifetime | Upload | Contract performance | Deleted from R2 on account deletion | None |

### 1.4 Orders

| Data | Retention Period | Trigger | Authority | Disposal Method | Exceptions |
|---|---|---|---|---|---|
| `orders.*`, `order_items.*` | Account lifetime | Order creation | Contract performance (seller's business records) | Deleted from D1 on account deletion | None; sellers are responsible for exporting their own records before deletion |
| `buyer_phone`, `buyer_name` in orders | Account lifetime | Order creation | Contract performance | Deleted on account deletion | Buyer data is the seller's business record; not independently retained |
| `buyer_address` (all fields) | Account lifetime | Order placement | Contract performance | Deleted with order on account deletion | Same as `buyer_phone` |
| `buyer_email` | Account lifetime | Order placement | Contract performance | Deleted with order on account deletion | If collected |

### 1.5 Billing & Payments

| Data | Retention Period | Trigger | Authority | Disposal Method | Exceptions |
|---|---|---|---|---|---|
| `subscriptions.*` | 5 years post-cancellation | Subscription cancellation | Legal obligation (Egyptian tax law — commercial records) | Deleted 5 years after `status='canceled'` | Tax/accounting inspection window |
| `payment_events.*` | 5 years | Payment event | Legal obligation (tax/accounting) | Deleted 5 years after `created_at` | Tax/accounting inspection window |
| `payment_events.raw_json` | Proposed 5 years | Mock/future provider event | Proposed legal obligation (payment evidence), counsel confirmation required | Remove prohibited payment data at ingestion; retain only after provider/legal approval | No live provider flow; must never contain full PAN/CVV |
| `webhook_events.*` | Proposed 90 days | Generic mock/future webhook processed | Operational | Auto-deleted at 90 days | Revalidate against the selected provider's retry/idempotency contract before activation |
| `coupons.*`, `coupon_uses.*` | 2 years post-expiry | Coupon expiry | Contract performance | Deleted 2 years after `expires_at` or last use | None |
| `referrals.*` | 2 years post-payout | Payout completed | Contract performance | De-identified after 2 years | Referral fraud investigation window |
| `affiliate_settings` | Permanent (single config row) | System seed | Operational | N/A | Single-row operational config |
| `invoices.*` | 5 years post‑issuance | Invoice generated | Legal obligation (tax) | Deleted 5 years after `created_at` | None |
| `seller_bank_accounts` | Account lifetime | Payout method set | Contract performance | Deleted on account deletion | None (if present) |

### 1.6 Ads

| Data | Retention Period | Trigger | Authority | Disposal Method | Exceptions |
|---|---|---|---|---|---|
| `ads.*` | Until deactivated + 1 year | Ad deactivated | Contract performance | Deleted 1 year after `active=0` or `ends_at` | None |
| `ad_impressions.*` | 90 days | Impression/click recorded | Legitimate interest | Auto-deleted at 90 days | Anonymized aggregates may be retained longer |

### 1.7 Admin & Operations

| Data | Retention Period | Trigger | Authority | Disposal Method | Exceptions |
|---|---|---|---|---|---|
| `admin_users.*` | Employment/contract period + 1 year | Admin removed | Security + legal obligation | `password_hash` and `totp_secret` cleared immediately; row retained 1 year | Audit trail integrity |
| `admin_sessions.*` (D1) | 30 days or until expiry | Session created | Security | Auto-deleted: expired sessions immediately, all sessions after 30 days | None |
| `admin_audit.*` | 2 years | Admin action | Security + legal obligation | IPs scrubbed after 30 days; records deleted after 2 years | Active investigations may extend |
| `error_logs.*` | 30 days | Error occurred | Operational | Auto-deleted daily by `retention.ts` | Active security investigations may preserve specific entries |
| `rate_limits.*` | 30 days (window-based) | Rate limit hit | Operational | Auto-deleted daily by `retention.ts` | None |
| `settings` | Permanent | System configuration | Operational | N/A | Single-row operational config |
| `content_pages` / `content_page_versions` | Permanent (versioned history) | Content update | Legal obligation (policy version history) | Retained indefinitely as policy change record; on admin user deletion, `content_page_versions.editor_id` set to NULL | Legal requirement to show what policy was in effect at any given time; keeps version history intact without PII |
| `announcements.*` | Until expiry + 90 days | Announcement expires | Operational | Deleted 90 days after `ends_at` | None |

### 1.8 Support & Communication

| Data | Retention Period | Trigger | Authority | Disposal Method | Exceptions |
|---|---|---|---|---|---|
| `support_tickets.*`, `support_messages.*` | 2 years post-closure | Ticket closed | Contract performance + legal obligation | Deleted 2 years after `status='closed'` | Active disputes extend retention |
| `email_events.*` | 90 days | Email event | Operational | Auto-deleted at 90 days | Private account-email sends store a redacted recipient marker, not the address |
| `email_template_history.*` | 2 years | Template change | Operational | IPs scrubbed after 30 days; records deleted after 2 years | None |
| `inbound_emails.*` | 2 years | Email received | Contract performance | Deleted 2 years after `received_at` | Active support cases extend retention |

### 1.9 Local Device Data (Android)

| Data | Retention Period | Trigger | Authority | Disposal Method | Exceptions |
|---|---|---|---|---|---|
| Room DB (products, categories, orders, order_items, customers, payments) | App session | Sync from backend | Performance of contract | Cleared on logout (`SessionStore.clear()` deletes Room DB) | Persisted during normal app use |
| DataStore session/profile metadata | App session | Sign-in | Performance of contract | Cleared on logout (`SessionStore.clear()`) | Device installation ID is retained for continuity |
| Encrypted device secret | App installation/device authorization | First launch/sign-in | Performance of contract + security | Retained across logout; removed with app data/uninstall | Backend stores only its hash |
| DataStore onboarding draft | Until completion, explicit reset/logout, or app removal | Onboarding field edit | Performance of contract | Cleared on logout; server token expiry does not discard the text draft so OTP can be repeated | Contains seller-entered profile/store data, including private birth year |
| Encrypted onboarding/recent-auth token | 24 h absolute / 10 min maximum | Worker issues bearer value | Security | Removed on completion, expiry handling, logout, or app removal | Stored in encrypted app-private preferences |

---

## 2. Retention Triggers (Summary)

| Trigger | Data Affected | Retention Clock |
|---|---|---|
| **Account creation** | All seller identity + store data | Starts immediately |
| **Account deletion request (verified)** | All seller-scoped data except legal records | 90-day fulfillment window; then deletion |
| **Subscription cancellation** | `subscriptions`, `payment_events` | 5-year clock starts on cancellation |
| **Ticket closure** | `support_tickets`, `support_messages` | 2-year clock starts on closure |
| **Ad deactivation** | `ads` | 1-year clock starts on deactivation |
| **Daily cron** | `error_logs` (30d), `admin_audit.ip` (30d), `admin_sessions` (30d), `rate_limits` (30d), `email_events` (90d), `webhook_events` (90d) | Rolling window from `created_at` |
| **Product edit** | Stale `product_translations` rows | Immediate (replaced on next translation generation) |

---

## 3. Account Deletion Flow

1. **Request intake**: Seller submits via in-app Settings → `POST /delete-account` (authenticated) or public web form `POST /delete-account` (unauthenticated).
2. **Identity verification**: For authenticated requests, identity is pre-verified. For public web requests, support verifies phone ownership.
3. **Fulfillment** (currently blocked for controlled production use; see
   `runbooks/account-deletion.md`. Target: tested automation):
   - a. Cancel active subscriptions with the configured provider. Billing is
     currently disabled and no production Stripe gateway is wired.
   - b. Deactivate all seller ads: set `ads.active = 0`, unlink seller.
   - c. Delete or unlink `coupons`, `coupon_uses`, and `referrals` if still present.
   - d. Delete all R2 objects under `stores/{seller-uuid}/`, including product images, logos, covers, and digital product files.
   - e. Delete D1 rows: `order_items` → `orders` → `product_variants` → `product_media` → `product_translations` → `products` → `categories` → `coupon_uses` → `referrals` → `support_tickets` → `seller_devices`.
   - f. Update: `payment_events.seller_id=NULL, raw_json=NULL`; `legal_acceptances` de-identified; `subscriptions.status='canceled'`.
   - g. Delete `sellers` row.
   - h. Update `deletion_requests.status='completed'`.
   - i. Admin deletion only: set `content_page_versions.editor_id = NULL` and `support_tickets.assignee_id = NULL` where referencing the deleted admin user.
4. **User notification**: Notify the seller only after every mandatory step is
   verified; explain any approved legal or accounting retention exception.
5. **Downstream propagation**: Delete the Firebase Authentication user, cancel
   any configured payment subscription, and process any applicable third-party
   deletion request. Provider scope and evidence must be determined from the
   actual production data flow, not assumed from this matrix.

---

## 4. Legal Hold Procedure

When a legal hold is issued, retention clocks are suspended for the affected data categories. The following fields must be recorded for every legal hold:

| Field | Description |
|---|---|
| Matter identifier | Unique case or investigation reference |
| Authorizing lawyer | Name and credentials of the Egyptian counsel issuing the hold |
| Data categories covered | Specific tables/fields from §1 subject to the hold |
| Relevant custodians | Users or entities whose data is preserved |
| Affected systems | D1 tables, R2 buckets, backup sets |
| Start date | Date the hold took effect |
| Review date | Scheduled date for hold reassessment |
| Access restrictions | Who may access the held data and under what conditions |
| Release authorization | Who may authorize release of the hold |
| Final deletion after release | Confirmation that held data is deleted or de-identified after release |

**Procedure:**

1. Legal hold request received from authorized Egyptian counsel.
2. Privacy lead or DPO records the hold in the legal-hold register with all required fields.
3. Engineering suspends retention cron jobs and deletion workflows for affected categories.
4. Affected data is flagged (e.g., `legal_hold = 1` on relevant rows) to prevent automated removal.
5. Access is restricted to authorized personnel only; all access is logged in `admin_audit`.
6. On release: deletion resumes per standard retention rules. Held data is deleted or de-identified as specified.
7. Completion is recorded in the legal-hold register and `deletion_requests` if applicable.

> **Status:** Process defined; legal-hold register schema and implementation are pending per Plan 5 Phase 4.

## 5. Law No. 175/2018 — 180-Day Compliance Log

> **Status:** Awaiting legal opinion on applicability.
>
> If counsel determines Orderak is a "service provider" under Article 2, a segregated compliance-log store must be created with:
>
> - Defined schema (user identifier, timestamp, action type, IP, device info)
> - 180-day auto-expiry
> - Immutability controls
> - Restricted administrative access
> - Separation from analytics and product debugging logs.
>
> Current `error_logs` and `admin_audit` are **not** sufficient — they are operational, not compliance-grade.

---

## 6. Deletion Evidence & Verification

Each disposal method must produce verifiable evidence that deletion occurred.
The following table is the required target evidence; the current fulfillment
code does not yet produce all of it and must not be treated as compliance proof.

| Category | Deletion Evidence |
|---|---|
| D1 rows (all seller-scoped tables) | Recorded in `deletion_requests` table with timestamp, request ID, and affected table list |
| D1 rows (cron-based: error_logs, admin_sessions, rate_limits, email_events, webhook_events) | `retention.ts` logs deletion counts per run; persistent aggregate evidence in `admin_audit` is a target requirement and must be verified/implemented |
| R2 objects (product images, logos, covers, digital product files) | `deletion_requests` records confirmation that `stores/{uuid}/` prefix was fully purged |
| De-identification (`legal_acceptances`, `sellers.store_code`, `sellers.referral_code`) | Original values replaced with `deleted:<request-id>`; verified by querying the affected rows post-deletion |
| Payment-provider subscriptions | Provider cancellation confirmation linked to the deletion request; target only—no live provider integration currently supplies this evidence |
| Firebase auth user | Firebase deletion confirmation logged in `admin_audit` |
| Local device data (Android Room DB + DataStore) | Client-side `SessionStore.clear()` confirmation logged to backend on next successful auth attempt |

All deletion evidence is retained in `deletion_requests` indefinitely as proof of compliance (see §1.2).

## 7. Backup Retention & Deletion

Backups may retain deleted data beyond the primary storage deletion date. The following rules apply:

| Backup Type | Retention After Primary Deletion | Expiry |
|---|---|---|
| D1 Time Travel (Cloudflare) | Up to 7 days on Workers Free or 30 days on Workers Paid | Plan-dependent recovery history rotates automatically; verify the active plan and current Cloudflare limits |
| R2 versioning (if enabled) | Per bucket versioning policy | Old versions expire per bucket lifecycle rules; must be configured to match primary retention |
| Off-platform exports (seller-initiated) | Seller's responsibility | Seller must delete exports independently; Orderak provides deletion instructions in the pre-deletion notification |
| Manual backups for legal hold | Duration of legal hold + standard retention | Released per §4 legal-hold release procedure |

**Restoration safety:** A restored D1 backup must not re-introduce deleted personal data. On restoration:

1. Cross-reference restored rows against `deletion_requests` to identify accounts deleted post-backup.
2. Re-apply de-identification or deletion for any re-introduced records.
3. Log the remediation in `admin_audit`.

## 8. Subscription-policy records (CHG-004)

Organization membership, effective subscription state, entitlement overrides,
Paid 3 approvals, and plan-change notices are retained while the organization
is active and then handled with the seller account-deletion workflow. Published
plan definitions/revisions and admin audit evidence are retained as non-customer
configuration history under the existing audit/legal requirements.

Encrypted Play purchase tokens, hashes, order IDs, lifecycle state, and billing
events are billing/fraud evidence. Their final statutory retention and deletion
period requires finance and Egyptian counsel approval before billing activation.
Until then billing remains disabled; test records must be deleted after the
test cycle and must not contain live customer purchases.

## 9. Final Mapping Checklist

The following checklist ensures that the account deletion procedure in Section 3 covers every personal data field identified in Section 1.

| # | Item | Covered in §3 Step | Verification |
|---|---|---|---|
| 1 | Delete `sellers` row (all fields including `sellers.id`) | g | All seller identity fields removed |
| 2 | Delete `seller_devices` rows (including `fcm_token`) | e | Device records fully removed |
| 3 | De-identify `legal_acceptances` (phone_e164 + ip_address → `deleted:<request-id>`) | f | Consent evidence preserved without PII |
| 4 | Delete `products`, `categories`, `product_variants`, `product_media` | e | Full product catalog removed |
| 5 | Delete R2 product images, logos, covers, and digital product files | d | All R2 objects under `stores/{uuid}/` removed |
| 6 | Delete `orders`, `order_items` (including `buyer_phone`, `buyer_name`, `buyer_address`, `buyer_email`) | e | Order history removed |
| 7 | Cancel subscriptions, scrub `payment_events`, delete `seller_bank_accounts` | a, f | Billing records handled per retention rules |
| 8 | Deactivate seller ads (`ads.active = 0`, unlink seller) | b | Ads deactivated; deleted after 1-year expiry |
| 9 | Delete or unlink `coupons`, `coupon_uses`, `referrals` | c | Promotional records cleaned up |
| 10 | `content_page_versions.editor_id` → NULL on admin deletion | i | Version history preserved without PII |
| 11 | `support_tickets.assignee_id` → NULL on admin deletion | i | Ticket history preserved without PII |

## Static city catalogue and taxonomy retention

| Data | Retention | Deletion/control | Notes |
|---|---|---|---|
| City search query/results | Request lifetime only | Not persisted by Orderak | No external runtime city provider |
| Confirmed source city ID/version/name in onboarding | Onboarding session lifetime | Existing onboarding cleanup/account deletion | Country is verified from phone context |
| Confirmed source city ID/version/name on seller | Account lifetime | Existing account deletion | Source ID/version internal; city may be public |
| Public city catalogue | Until a replacement snapshot is fully imported | Version activation and controlled old-version cleanup | Isolated ODbL data; contains no seller data |
| Global taxonomy/translations | Version lifecycle | Archive old versions | Contains no seller location or private profile data |
