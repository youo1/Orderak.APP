# Security Model

> **Status:** Current implemented controls plus explicit open risks
>
> **Last verified:** 2026-07-31

Orderak handles seller identity, payment data, and buyer orders. This document
describes how authentication, authorization, and secret storage work.

## Environment separation

- Production and Staging use different Workers, D1 databases, R2 buckets,
  queues, Admin delivery, Firebase projects, Android application
  IDs, hostnames, sessions, and secrets.
- `app.orderak.seller.staging` accepts only the Staging Firebase configuration
  and points at `api.staging.orderak.app`. The production package remains
  `app.orderak.seller`.
- Staging does not inherit Cloudflare bindings or secrets. Email is intentionally
  No-op there until a test-only provider policy is approved; billing, Play
  lifecycle, entitlements V2, and AI stay default-off.
- Production data must never be copied into Staging unless it has been
  irreversibly anonymized under an approved migration procedure. Test accounts
  and Subscription Test Lab overrides are environment-scoped, audited,
  time-limited to at most 24 hours, and resettable; the route is absent outside
  Staging.

## Seller authentication

Authentication protection is versioned in
[`../auth-phase1-contract.md`](../contracts/auth-phase1-contract.md). Long-lived security
outcomes are separated into the
[authentication invariants](../contracts/authentication-security-invariants.md)
and the current [Android profile](../platforms/android-auth-profile.md). This
permits implementation refactoring only when behavioral and Worker evidence
continues to prove the same provider, OTP, verification, consent, logout,
throttling, and recovery behavior.

### Registration and recovery

1. **Android app**: Firebase Phone OTP via SMS receives a Firebase `id_token`.
   The transferred value is E.164, resend state is phone-bound, callbacks are
   generation-checked, requests time out after 90 seconds, and WhatsApp is not
   exposed as a client fallback. Phone and OTP share one visual screen: after
   SMS dispatch the exact phone is locked, Autofill only fills the six digits,
   explicit Verify submits them, and Change number/Back clears the OTP session.
2. **`POST /api/v1/auth/phone/complete`**: the Worker verifies the token, rejects a
   future/stale `auth_time`, and requires the Firebase phone claim to match.
   An existing seller receives a device session; a new seller receives an
   opaque onboarding token.
3. The Worker stores only the onboarding-token hash. Idle expiry rolls for 30
   minutes after each accepted step, with a 24-hour absolute cap. Android stores
   the opaque token in encrypted preferences and keeps only a resumable draft
   in DataStore.
4. **`POST /api/v1/onboarding/account`**: after OTP, the seller submits a 3–80
   character name, a required private integer birth year from 1900 through the
   current UTC year, optional private email, and affirmative acceptance of the
   Terms/Privacy links shown above Next. The Worker snapshots the currently
   published versions; no consent is recorded at OTP completion. Birth year is
   excluded from Store DTOs, public pages, email variables, and telemetry.
   Production schema support is supplied by the forward-only migration
   `039_add_private_birth_year.sql`; schema nullability exists only for legacy
   compatibility and does not relax request validation.
5. **`POST /api/v1/onboarding/complete`**: requires the matching app-generated
   device secret and an idempotency key, then atomically creates the seller,
   private profile, store identity, organization, owner membership, primary
   route, legal acceptance, and device session. D1—not the Android draft—is the
   final authority.
6. A verified OTP device replaces previous credentials on a single-device plan
   or is admitted under the same numeric device limit on higher plans. The
   legacy `/api/v1/auth/session` and `/api/v1/register` consent behavior remains
   available unchanged behind rollback routing.
7. If Passkeys are enabled for a new seller, Android shows the opt-in after OTP
    and caches the choice with the resumable draft. Credential Manager
    registration runs only after the atomic account/store completion succeeds.
8. Android serializes OTP and Passkey work through one cancellable operation
   controller. Each operation carries a generation that is checked after
   platform/backend suspension and before local credential/session side
   effects. Back and Change number invalidate the generation and clear the OTP
   session, so non-cooperative late callbacks cannot restore stale UI or finish
   an abandoned authentication attempt. Firebase token-refresh failures restore
   a retryable error state rather than leaving a loading indicator active.

### Passkey authentication

- Android Credential Manager is invoked directly from Welcome for a returning
  seller. Cancelling its system UI returns to Welcome without starting OTP.
  Unsupported/no-credential/failed states expose a conditional OTP fallback;
  Android 7–8 never attempts Passkeys.
- The production relying-party ID is `orderak.app`. Production Digital Asset
  Links contains only release and Play App Signing certificate fingerprints.
  Debug signing belongs to the separate `staging.orderak.app` environment.
- Registration creates a discoverable credential with
  `residentKey=required`, `userVerification=required`, and `attestation=none`.
  Authentication also requires the UV flag.
- WebAuthn challenges are cryptographically random, stored hash-only, valid for
  five minutes, bound to one ceremony, and consumed once. The Worker verifies
  the challenge, RP ID, exact configured Android APK origin, signature, and
  user-verification result.
- Orderak stores no fingerprint, face scan, or other biometric template. D1
  stores the credential public key, internal credential ID, counter, AAGUID,
  transports, device type, backup state, label, and lifecycle timestamps.
- Successful Passkey sign-in registers the app-generated device secret using
  the same account-status and device-limit rules as OTP. Renaming, revoking, or
  adding a Passkey requires a fresh OTP or Passkey proof not older than ten
  minutes.

### Ongoing requests

Every authenticated Android request includes two headers:

| Header | Value |
|--------|-------|
| `x-orderak-phone` | Seller's E.164 phone number |
| `x-orderak-secret` | Per-device random credential |
| `x-orderak-device-id` | Optional opaque installation UUID; not a hardware identifier |
| `x-orderak-device-label` | Optional display label for seller/admin identification |
| `x-orderak-platform` | Optional platform name |
| `x-orderak-app-version` | Optional app version for operational support |
| `x-request-id` | Opaque per-request correlation identifier; never authenticates or deduplicates a mutation |

The Worker looks up the phone and verifies the supplied secret against the
stored `sha256$<hex>` value in `sellers.secret` or
`seller_devices.secret_hash`. Legacy PBKDF2 and plaintext formats are supported
only for transparent migration and are upgraded after successful verification.
On mismatch → `401`.

### Device secrets

- Generated on first launch as a random string.
- Stored **hashed** in D1 (`seller_devices.secret_hash`).
- Legacy plaintext secrets in `sellers.secret` are transparently re-hashed on
  the seller's next authenticated request — no re-registration needed.
- Plan `multi_device_enabled` controls whether additional device credentials
  remain valid concurrently. On a single-device plan, a successful Firebase OTP
  recovery rotates the primary credential and revokes all previous devices, so
  reinstalling the app or replacing a phone cannot permanently lock out the
  account owner.
- New Android versions retain an opaque installation ID across logout and send
  it only after authentication. Device list/revoke endpoints are seller-scoped;
  additional credentials can be revoked, while the primary row cannot be
  removed through the ordinary device endpoint. Every admin revocation is
  permission-gated and audited.
- Seller `status` is checked on authenticated API traffic. Suspended/banned
  accounts receive `403 account_restricted`; the account/deletion status paths
  remain available so Android can render a stable recovery surface.
- Android centralizes root routing in an entry gate. Confirmed restrictions and
  the last successfully cached restricted status take precedence over setup;
  only a successful active response clears that cached restriction. A `401`
  from a registered seller credential returns to authentication, while the
  expected pre-registration `401` before a seller row exists does not discard
  the verified onboarding flow. Status unavailability never clears credentials
  or silently logs out an existing cached session.
- A Worker-issued new-seller onboarding token is paired with explicit local
  `PRE_REGISTRATION` state. Android enters setup directly and the entry gate
  treats that state as incomplete even if an older build left a stale
  `COMPLETE` marker. Cached seller-status evidence is cleared at this boundary;
  only an actual in-progress draft may retain its saved step. The verified
  phone, country, and routing stage use one atomic DataStore transaction.
  Credential signals produced by requests from the previous seller context are
  acknowledged rather than allowed to replace an active Auth/Shop Setup route.

### Firebase ID token verification

- `FIREBASE_WEB_API_KEY` is a Worker secret (never in the app).
- Registration and device restore both verify the token server-side.
- If the key is missing, registration fails closed with `503
  firebase_not_configured`.
- Token phone number must match the requested phone — no claiming another
  number.
- The verified Firebase UID is stored server-side for deletion fulfillment.
  General store-profile updates cannot change the verified phone; a future
  migration requires a dedicated OTP re-verification contract.
- Firebase client failures are mapped to stable UI categories; raw exception
  text, phone numbers, OTP codes, and tokens are not logged.
- Logout uses a behavior-tested sequence: Firebase sign-out first, then the
  local business database, entitlement cache, and seller session. The build
  guard protects the contract/profile while unit tests protect ordering.

## Admin authentication

### Login

- Email + password (PBKDF2-SHA-256 with the Cloudflare Workers-compatible
  100,000-iteration ceiling, a per-password random salt, and constant-time
  comparison in `admin_users.password_hash`).
- Mandatory TOTP 2FA (`admin_users.totp_secret_ciphertext`).
- Successful login sets an **HttpOnly, Secure, SameSite=Strict** opaque session
  cookie. D1 stores only its hash, idle/absolute expiry, and revocation state.

### Session

- The cookie contains no client-side identity or role claims and JavaScript
  cannot read it.
- All `/api/admin/v1/*` routes resolve the hashed D1 session and administrator,
  then apply CSRF/origin validation and RBAC.
- No long-lived API keys or static tokens for admin access.

### RBAC

| Role | Permissions |
|------|------------|
| `owner` | All (`*:*`) |
| `finance` | Billing, coupons, payouts, plans |
| `support` | Sellers, support tickets, announcements, content |
| `readonly` | View only |

Each admin route checks a `<resource>:<action>` permission derived from the
role. `ADMIN_API_KEY` is accepted **only** by break-glass endpoints (bootstrap
and password reset), never as a normal session.

Design-system permissions are explicit:

| Permission | Scope |
|---|---|
| `theme:view` | Read active source/snapshot, preview, and revision history. |
| `theme:manage` | Apply current configurations, name/rename checkpoints, and activate saved configurations; implies `theme:view`. |
| `theme:rollback` | Owner-only compatibility rollback and permanent inactive-revision deletion; implies manage/view. |

All design-system POST/PUT requests pass the normal same-origin and CSRF guard.
Preview is rate-limited even though it is non-persistent. Bodies are capped at
64KB, overrides at 128, and unknown roles are rejected. Activation trusts only
server generation/validation. Optimistic concurrency does not expose force
overwrite; stale clients must rebase and confirm again.

Revision names are normalized before a unique key is stored and do not alter
the immutable snapshot or content hash. The current revision cannot be
deleted. Inactive deletion is owner-only, limited to ten attempts/hour, and its
audit event retains metadata only rather than the deleted source or snapshot.

Public theme JSON and CSS are intentionally unauthenticated and contain no
session or administrator data. The isolated preview has `connect-src 'none'`,
validates origin/source/schema/size for `postMessage`, and receives generated
snapshots only. Local seven-day recovery is keyed by administrator and base
revision and never contains credentials.

### Break-glass recovery

- `POST /api/admin/v1/auth/bootstrap` — create the first owner (requires
  `x-admin-key: <ADMIN_API_KEY>`).
- `POST /api/admin/v1/auth/password/reset` — reset any admin's password by email
  (requires `x-admin-key`). Optionally clears TOTP.
- These endpoints are never accessible via browser session.

## Public pages

- No authentication required.
- Store, category, and product pages resolve from the URL's public identifier.
- Internal UUIDs never appear in public URLs or HTML. Seller-supplied WhatsApp,
  email, website, and address fields may appear in public catalog HTML. The
  public order response may return the seller's contact phone and configured
  InstaPay/Vodafone Cash instructions after a successful order.
- Cross-store access returns `404` (ownership is validated on every lookup).
- Public checkout uses a unique `(store_id,idempotency_key)` constraint and an
  atomic stock-claim trigger. Store-authored payment values are rendered as text,
  never executable HTML.

## Secret storage

| Location | How secrets are stored |
|----------|-----------------------|
| Production | Cloudflare Worker secrets (`npx wrangler secret put`) |
| Local development | `services/backend/.dev.vars` (git-ignored, never committed) |
| CI / testing | Runner secret store, never in config files |

**Never:**

- Store API keys, tokens, or signing secrets in the Android app
- Commit secrets to the repository
- Hardcode secrets in `wrangler.jsonc`, `build.gradle.kts`, or any source file
- Log or echo secret values in build output

## Launch feature controls

`BILLING_ENABLED`, `GOOGLE_PLAY_LIFECYCLE_ENABLED`,
`AI_ASSISTANT_ENABLED`, `ONBOARDING_ENABLED`, and `PASSKEY_ENABLED` are
non-secret Worker variables. All default to `false`
in production configuration. Acquisition and AI are compared to the
typed D1 admin controls. The effective state is an AND operation: an admin may
disable an environment-enabled capability but cannot enable a disabled
deployment gate. Admin mutation, seller status, deletion transitions,
translation decisions, support replies, device revocations, and manual job
runs are written to the audit log. Billing acquisition, Play lifecycle, and AI
routes fail closed when their deployment flag is absent or not exactly `true`.
Provider secrets never override a disabled flag.

Changing any deployment gate is a controlled release action requiring the Phase 4
approval, downstream test evidence, rollback plan, and configuration capture.
The D1 `billing_enabled` setting can narrow acquisition but cannot enable a
disabled deployment flag. Once a real payer exists, rollback keeps lifecycle
processing enabled while disabling acquisition so renewals, refunds,
revocations, acknowledgement, reconciliation, and restore continue.

## Rate limiting

| Endpoint | Limit |
|----------|-------|
| Login | 15 attempts / 5 minutes per phone |
| MFA | 5 attempts / challenge |
| Register | 10/minute per phone and 100/minute per source IP |
| Firebase session restore | 10/minute per phone and 100/minute per source IP |
| Phone completion | 10/minute per phone and 100/minute per source IP |
| Passkey authentication options/complete | Source-IP rate limited |
| Private email verification resend | 3/hour per seller |
| Static city search | Onboarding-session and source-IP rate limited; phone-country scoped; maximum 10 results |
| Public deletion request | 5/hour per source IP |
| Orders (public) | 5 / minute per IP |
| Upload | 60 / hour per seller |
| Chat | 20 / minute per seller + plan quota |
| Coupon validation | Rate-limited per phone |

## Privacy retention and deletion

- The authenticated Android deletion endpoint records an identity-verified
  request; the public web form requires support verification before fulfilment.
- Every request receives a deadline no later than 90 days after intake.
- A daily Worker cron deletes D1 error logs, expired admin sessions, and stale
  rate-limit buckets after 30 days and removes older IP values from audit rows.
- The same cleanup purges onboarding rows 30 days after absolute expiry,
  WebAuthn challenges and recent-auth proofs within one day after expiry, and
  used/expired email-verification tokens within 30 days. Their functional
  lifetimes remain five minutes, ten minutes, and 24 hours respectively.
- Account deletion removes active/revoked Passkeys, private seller profiles,
  onboarding sessions for the verified phone, recent-auth proofs, WebAuthn
  challenges, and email-verification tokens before deleting the seller record.
- The scheduled processor selects only verified, deadline-due requests. Billing
  cancellation, verified R2 prefix deletion, and Firebase Admin user deletion
  are mandatory; any failure prevents completion and the request is retried.
  Production enablement still requires migration 026, the documented Firebase
  service-account secrets, and staging evidence. See the account-deletion runbook.

## Payment webhooks

- Incoming webhooks from the payment gateway are verified via HMAC using
  `PAYMENT_WEBHOOK_SECRET`.
- A `webhook_events` idempotency ledger records every processed event by
  `event_id`. Replays return `{ idempotent: true }` with no side effects.
- Payment gateway secret is never exposed to the Android app.

## Subscription and Play Billing controls

- Client purchase state is never trusted to grant access. The authenticated
  Worker verifies the purchase token against Google and binds a token to one
  organization; reuse by another organization fails closed.
- Purchase tokens are stored as a SHA-256 lookup hash plus AES-256-GCM encrypted
  ciphertext. The encryption key and service-account private key are Worker
  secrets and never enter Android, D1 plaintext, logs, or Git.
- Active Play product mappings are an allowlist. Paid 3 additionally requires an
  unexpired owner approval and complete custom entitlement overrides.
- RTDN requires Google OIDC audience validation, deduplicates by message ID, and
  re-fetches the purchase. Notification content alone cannot grant access.
- D1 is the entitlement and verification-job authority. AES-256-GCM token
  ciphertext stays in D1; `orderak-play-billing` messages contain only
  `{version:1,jobId}`. A one-minute outbox sweep closes the database/queue gap.
- Every verification increments the organization's generation immediately
  before the authoritative Play query. D1 triggers abort the entire write batch
  if a newer generation has started. Linked-token replacement and old
  entitlement revocation are one transaction and cross-organization links are
  terminal security conflicts.
- `orderak-play-billing-dlq` persists dead-letter state, audit evidence, and an
  alert before acknowledging. Requeue requires `subscriptions:manage`, fresh
  action authorization, a reason, and never returns token ciphertext.
- Each consumer atomically claims a due job for 120 seconds. Active duplicates
  are acknowledged no-ops. State transitions require the current claim token;
  an expired claim may be reclaimed and increments PII-free evidence. A zombie
  can duplicate verification/acknowledgement after expiry, but those calls do
  not charge and stale tokens/generations reject stale Orderak writes. Each DLQ
  parent has at most one requeue child.
- Published revisions cannot be edited. Draft updates use optimistic concurrency;
  publishing and organization overrides are RBAC-gated and written to the admin
  audit log. Finance can draft but only an owner can publish or approve Paid 3.
- `ENTITLEMENTS_ENABLED`, `BILLING_ENABLED`,
  `GOOGLE_PLAY_LIFECYCLE_ENABLED`, and inactive product mappings are independent
  fail-closed rollout controls.
- Google Play real-time developer notifications are accepted only when the
  Google identity token is verified, its audience exactly matches
  `GOOGLE_PLAY_PUBSUB_AUDIENCE`, and its email exactly matches
  `GOOGLE_PLAY_PUBSUB_SERVICE_ACCOUNT_EMAIL`.

## Stable seller identity and phone change

`seller_auth_identities` owns the active Firebase subject and verified E.164
phone. Unique partial indexes prevent two active sellers from owning one phone
and prevent more than one active Firebase-phone identity per seller. The legacy
seller columns remain synchronized during the flag-controlled observation and
rollback period. Malformed/conflicting backfill rows are recorded only as
sanitized issue codes; production readiness requires zero unresolved issues and
zero active sellers without identities.

`POST /api/v1/auth/phone-change/challenges` and `/complete` default to disabled.
Creation requires an authorized device and a Firebase proof authenticated in
the last five minutes for the current phone. Completion uses a D1-backed,
ten-minute, single-use bearer challenge, a fresh proof for the unused target
phone, and a replacement device secret. The atomic change supersedes the old
identity, updates compatibility projections, rotates the primary credential,
and revokes all other device credentials without changing seller,
organization, routing, subscription, purchase, entitlement, or verification
job IDs.

## Inbound email

- Cloudflare Email Routing delivers messages to the Worker's `email()` handler.
- Messages are stored in D1 (`inbound_emails`). No auth on the receiving side
  (routing is configured in the Cloudflare dashboard).
- MIME input is capped at 10 MiB before buffering. Oversized messages are not
  parsed or stored in D1; when forwarding is configured they are forwarded to
  the verified destination so operators can handle them safely.
- Optional forwarding to `FORWARD_TO` (must be a verified Email Routing
  destination).
- Transactional messages emitted during requests are placed on the dedicated
  email Queue. The consumer uses `outbound_email_jobs` for leases and durable
  idempotency; failures retry with backoff and the DLQ marks terminal failure.

## Administrator security boundary

- Admin browser sessions are opaque random tokens hashed in D1, with a
  15-minute idle timeout and eight-hour absolute timeout. Login rotates session
  identity; access changes and credential issuance revoke older sessions.
- The cookie is `__Host-orderak_admin_session`, `HttpOnly`, `Secure`,
  `SameSite=Strict`, `Path=/`, with no Domain. Every mutation also requires a
  per-session CSRF token and exact `https://admin.orderak.app` Origin/Referer.
- TOTP is mandatory. Secrets use versioned AES-256-GCM Worker keys; recovery
  codes are single-use and independently peppered/hashed. Password/MFA/access
  changes and sensitive exports require fresh password plus TOTP. Critical
  authorization is action- and entity-bound, expires in five minutes, and is
  consumed once.
- MFA login and enrollment challenges are single-use D1 rows with atomic
  attempt increments and atomic consumption. They do not use eventually
  consistent KV, so replay protection remains correct across Cloudflare PoPs.
- The first session cannot access the control plane until the ten recovery
  codes are explicitly acknowledged and the seven-day one-time password is
  replaced. Recovery resets clear both MFA and that acknowledgement.
- Login, MFA, recovery, invitation, and bootstrap paths use progressive
  cooldowns and generate security alerts on suspicious recovery or privileged
  activity. Browser sessions have both idle and absolute expiry.
- Admin audit entries scrub credential-shaped fields. Scheduled batches include
  the previous batch hash, are written to private R2, and record their object
  hash/checkpoint in D1. Export requests, filters, actor, counts, authorization,
  one-use download, and expiry are audited.
- Objects below the R2 `audit/` prefix are protected by a seven-year bucket-lock
  rule. Export artifacts use a separate `exports/` prefix and a 24-hour lifecycle
  rule so compliance retention never turns short-lived downloads into archives.
- Large exports are queued, claimed with a D1 lease, read with 500-row keyset
  pages, and streamed to R2 multipart upload. They are capped at 100,000 rows
  and 250 MB; artifacts expire after 24 hours and download tokens after five
  minutes. CSV cells beginning with spreadsheet formula characters are escaped.
- The admin Worker has no public domain, preview URL, or `workers.dev` endpoint.
  Only the Admin Edge Worker's `ADMIN_WORKER` service binding is an intended
  privileged network path. The edge Worker serves compiled static assets and
  holds no database or provider bindings. The public API Worker returns
  not-found for all admin routes.
- All timestamps are stored/compared in UTC. The UI displays the administrator
  timezone (default `Africa/Cairo`) and keeps server time in session responses;
  TOTP verification permits only the bounded adjacent time window.
- Emergency access is an audited non-browser runbook. Use requires an incident
  ticket/evidence, post-use review, session revocation, credential rotation, and
  a scheduled recovery drill.

Admin key rotation is versioned: introduce the next AES key, switch
`ADMIN_TOTP_KEY_CURRENT`, retain old versions for decryption until every secret
has been re-encrypted, verify recovery in staging, then retire the old secret.
An owner performs and audits normal rotation; compromise invokes the incident
runbook and immediate session/recovery-code revocation.

## API contract and publication boundary

- OpenAPI 3.1.2 in `contracts/openapi/src/` is the internal authority for Seller, Admin,
  and integration routes. Removed unversioned and v2 routes return `404`; no
  compatibility code remains before launch.
- Errors use RFC 9457 and responses carry `X-Request-ID`. The identifier is
  opaque and non-authenticating.
- Every operation declares security, owner, rate-limit policy, stability, and
  data classification. `pending-review` is allowed only in internal drafts.
- The public build accepts L0 only and rejects Admin, integration, credential,
  L1-L3, or pending markers. Public Try it out is disabled.
- Prism accelerates Android development but is not security evidence. Worker
  tests, Schemathesis, tenant-isolation tests, and review remain release gates.
- Cloudflare API Shield receives the generated OAS 3.0.3 projection on Staging
  endpoint-by-endpoint after contract and before/after load evidence.

## Related documents

- [`threat-model.md`](./threat-model.md) — STRIDE-lite threat model covering
  account takeover, cross-store access, API abuse, device theft, privilege
  escalation, data leakage, injection, supply chain, and admin misuse.
- [`data-classification.md`](./data-classification.md) — four-level data
  classification standard (L0 Public through L3 Highly Sensitive) with
  per-table classification and handling requirements.
- [`logging-standard.md`](./logging-standard.md) — log categories, prohibited
  content, audit log requirements, access controls, and integrity rules.
- [`../governance/retention-matrix.md`](../governance/retention-matrix.md) —
  retention rules, deletion flow, legal-hold procedure, and backup policy.
- [`../runbooks/incident-response.md`](../runbooks/incident-response.md) —
  severity levels, response procedures, PDPL notification templates, and
  evidence preservation.
- [`production-auth-plan.md`](../product/production-auth-plan.md) — production Firebase
  console checklist, environment separation, SMS policy, Play Integrity, and
  the migration target for immutable account IDs + revocable tokens.
- [Security policy](https://github.com/youo1/Orderak.APP/blob/main/SECURITY.md) —
  vulnerability reporting, key rotation, and dependency update policy.

## Static city-selection boundary

- Android calls the Worker only; it contains no third-party location key and
  never downloads the 150k-row raw source database.
- An authenticated onboarding token identifies authoritative
  `phone_country_iso`; city requests cannot override it. Search and selection
  both filter the active city snapshot by that server-side country.
- Query text and result lists are transient. `orderak-db` stores only the
  confirmed source city ID, pinned dataset version, and city name. Logs contain
  failure signals, not search text, phone, onboarding token, or city ID.
- Public ODbL city rows live in the isolated `orderak-geo` D1 binding. That
  database contains no seller, phone, authentication, or onboarding data.
- Session/IP rate limits, bounded inputs, parameterized FTS queries, a maximum
  of ten results, checksum-pinned imports, and explicit attribution reduce
  abuse and supply-chain risk.
- Manual entry and retained GeoNames tables preserve availability/rollback
  without weakening Firebase OTP or store-identity guarantees.

The global category APIs accept no country/city authority. Onboarding verifies
that a selected subcategory belongs to the selected active category/version.
Older clients retain the legacy fixed-key category path.
