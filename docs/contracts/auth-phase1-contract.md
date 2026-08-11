---
status: current
generated: false
owner: security
applies_to: [production, staging]
authoritative_for: [auth-contract]
---
# Versioned Seller Authentication Contract

**Contract version:** 7
**Owner approval required:** Ayman Mohamed Abdellatif  
**Protected since:** 13 July 2026

**Approved evolution:** 1 August 2026 — protection moved from source-text and
class-name freezing toward executable security invariants and an explicit
Android platform profile. The active provider and runtime behavior below did
not change.

This document versions the production Firebase Phone Authentication behavior
that has been verified end to end. It is an architecture contract, not a
roadmap. No contributor, automation, or AI agent may alter the protected
security/product outcomes without the owner's explicit approval for the
specific authentication migration.

The long-lived outcomes are defined in
[`contracts/authentication-security-invariants.md`](./authentication-security-invariants.md).
Android-specific provider, timing, storage, and UI choices are recorded in
[`platforms/android-auth-profile.md`](../platforms/android-auth-profile.md). Class
names and source layout may be refactored when the executable evidence remains
green; provider, OTP state, timeouts, consent, verification, logout, throttling,
and recovery behavior remain unchanged in version 7.

## Protected guarantees

1. Firebase Phone Authentication by SMS remains the only account-creation and
   account-recovery channel. WebAuthn Passkeys are an additional independent
   sign-in channel for returning sellers. WhatsApp OTP and Google Sign-In are
   not implemented.
2. Fictional phone numbers and fixed codes exist only in Firebase Console. The
   shipped app must not contain test numbers, test OTPs, disabled app
   verification, or automatic test-code injection.
3. Phone values crossing the authentication boundary use E.164. OTP state,
   verification IDs, and resend tokens are bound to the exact phone number.
4. Every Firebase callback is checked against the active request generation.
   A stale callback cannot overwrite or complete a newer request.
5. The Firebase SMS retrieval timeout is 60 seconds. The complete send
   operation has a terminal 90-second timeout. The phone-bound verification
   session expires after ten minutes.
6. Firebase errors are mapped to stable categories. Logs must never contain a
   phone number, OTP, verification ID, Firebase ID token, or raw exception text.
7. Successful OTP verification produces a Firebase ID token. The Worker fails
   closed when Firebase verification is unavailable and requires the token's
   phone claim to exactly match the requested E.164 phone.
8. `POST /api/v1/auth/phone/complete` keeps independent phone and source-IP
   throttles. It issues a seller session for an existing seller or a hash-only
   onboarding bearer token for a new seller; it must not record legal consent.
   The legacy `POST /api/v1/auth/session` remains available unchanged for rollback.
   New-seller Terms and Privacy evidence is recorded only when the user presses
   Next on `POST /api/v1/onboarding/account`; marketing consent remains separate.
9. Device access is governed by the backend `max_concurrent_devices` numeric
   entitlement: Free 1, Paid 1 2, Paid 2 10, and Paid 3 requires an approved
   organization override. A verified recovery at a cap of one rotates the
   primary credential and revokes previous devices. At higher caps, existing
   authorized devices remain valid after a downgrade, new devices are blocked
   once the cap is reached, and a verified new device is added below the cap.
10. Logout signs out of Firebase before clearing the local database and session.
11. Firebase test-number configuration remains console-side. Production uses an
    explicit SMS region policy for the approved all-country onboarding scope,
    with Blaze billing, quota/cost alerts, and current regional deliverability
    reviewed before rollout. Release and Play signing fingerprints must be
    registered before a Play release.
12. After the exact phone match, the Worker records the stable Firebase UID so
    verified account deletion can remove the upstream identity. This is
    additive and does not change the provider, OTP state, timeout, or recovery.
13. The verified phone is read-only in general store settings and cannot be
    changed by `PUT /api/v1/store`. The approved V5 backend foundation exposes
    default-disabled, two-proof phone-change challenge/completion endpoints.
    Completion preserves seller/organization/billing ownership, supersedes the
    identity, rotates the initiating credential, and revokes other devices.
    Android UI, lost-all-access recovery, and production enablement remain
    separately gated by `PHONE_CHANGE_ENABLED=false`.
14. New app versions attach an opaque installation UUID and descriptive device
    metadata to authenticated requests. This is additive: legacy credentials
    continue to authenticate, no hardware identifier is used, and metadata is
    never accepted as identity proof.
15. Seller lifecycle status is checked after the existing credential proof.
    Suspended or banned accounts receive the stable `account_restricted` API
    error and Android restricted-account screen. Account status and verified
    deletion status remain readable; suspension does not alter the Firebase
    provider, OTP state, consent evidence, throttling, recovery caps, or logout.
    If status refresh is unavailable, an existing cached session may continue
    into offline UI; every backend operation still enforces the restricted state.
16. Passkeys use RP ID `orderak.app`, discoverable credentials,
    `residentKey=required`, `userVerification=required`, and `attestation=none`.
    The Worker validates a five-minute single-use challenge, RP ID, configured
    Android APK origin/signing association, and user verification with
    `@simplewebauthn/server`. It stores only the public credential material,
    counters, AAGUID, transports, device type, and backup state—never biometric
    data.
17. A successful OTP or Passkey proof may issue a hash-only recent-auth token
    valid for ten minutes. Sensitive Passkey add/rename/revoke operations require
    this proof and continue to enforce the existing numeric device limit.
18. A new-seller onboarding token is random, stored hash-only by the Worker and
    encrypted locally by Android. Its rolling lifetime is 30 minutes with an
    absolute 24-hour limit. Expiry returns the user to OTP while preserving the
    non-authoritative local draft.
19. When Passkeys are enabled, a new seller is invited immediately after OTP.
    Accepting records only a resumable local setup preference; Android must
    defer the Credential Manager registration ceremony until the account and
    store have been created successfully. Declining must not block onboarding.
20. Welcome presents store creation and Passkey sign-in as bottom-safe-area
    actions. Phone/SMS fallback is conditional on an unavailable, unsupported,
    or failed Passkey attempt; Android 7–8 expose it without attempting a
    Passkey. Cancelling the Credential Manager dialog returns to Welcome and
    must not start OTP automatically.
21. Phone entry and the six-digit OTP are stages of one visual screen. After
    code dispatch, the exact country and phone stay visible but locked. SMS
    Autofill may populate all six digits, but only an explicit Verify action may
    submit them. Change number or Back clears the active phone-bound OTP
    session. Firebase instant verification remains allowed to complete directly.
22. New-seller account step 1 requires a private `birth_year` integer from 1900
    through the current UTC year. Android collects only a year through a
    year-only dialog and caches it in the non-authoritative draft. The Worker
    validates and persists it in `onboarding_sessions` and `seller_profiles`;
    Store DTOs, public pages, emails, and telemetry must never expose it.
23. After the Worker returns a valid new-seller onboarding token, Android enters
    Account step 1 directly. Explicit `PRE_REGISTRATION` state always routes to
    resumable setup and can never be treated as a completed Main session because
    of a stale local onboarding marker. Renewing an expired token preserves a
    genuinely in-progress draft; unrelated cached account-status evidence is
    cleared. The verified phone, country, and pre-registration stage are written
    atomically. Credential signals from an older background seller request
    cannot override an active Auth or Shop Setup flow.
24. Android owns at most one in-flight OTP or Passkey operation. Starting a new
    operation cancels the previous job, while Back, Change number, and leaving
    an active authentication flow invalidate its operation generation. Every
    platform/backend result and every authenticated-session side effect must
    verify that generation before changing state. A late callback can never
    reopen an abandoned phone/OTP screen or complete an abandoned sign-in.
    Firebase ID-token refresh and other unexpected operation failures return the
    current screen to a retryable, non-loading error state. Phone-number hint
    cancellation remains a no-op; actual Google Play Services request/result
    failures show a non-blocking manual-entry message.

## Protected evidence surface

- `apps/seller-android/app/src/main/java/app/orderak/seller/data/auth/`
- `apps/seller-android/app/src/main/java/app/orderak/seller/feature/auth/`
- Logout policy in `feature/settings/LogoutSequence.kt` plus its behavioral test
- `services/backend/src/domains/stores/api-store.ts` Firebase session verification and device recovery
- `services/backend/src/domains/identity/auth-v2.ts`, `services/backend/src/domains/identity/seller-session.ts`, and WebAuthn tables
- Firebase-auth and OTP-state regression tests
- `docs/contracts/authentication-security-invariants.md` and
  `docs/platforms/android-auth-profile.md`
- `docs/reference/api.md`, `docs/product/app-plan.md`, and
  `docs/architecture/security-model.md`
- The `verifyAuthPhase1Contract` Gradle task, its CI workflow, and CODEOWNERS
  review assignment to `@youo1`

## Approval and migration procedure

An intentional change requires all of the following in the same work item:

1. Explicit owner approval describing the guarantee that may change.
2. An updated contract version and migration rationale in this document.
3. Updated Android and/or Worker regression tests covering the new behavior.
4. Updated API, product-plan, setup, and security documentation as applicable.
5. A passing `verifyAuthPhase1Contract`, Android unit test suite, Worker test
   suite, and an end-to-end test using a Firebase fictional number.

Do not silence a failure by weakening, renaming, skipping, or deleting the
guard. Restore the contract or complete the approved migration procedure.

## Version 2 migration approval

The repository owner explicitly approved the numeric 1/2/10/custom device-cap
migration in the 19 July 2026 subscription implementation task. Firebase, OTP,
consent, logout, timeout, token verification, throttling, and recovery proof
remain unchanged. The migration replaces the legacy boolean plan switch with a
server-resolved numeric entitlement and preserves already-authorized devices.

## Version 3 migration approval

The repository owner explicitly approved the backend-to-UI and admin coverage
roadmap on 20 July 2026, including the device/session metadata and seller-status
migration. The implementation adds opaque device identification, seller/admin
revocation views, post-authentication lifecycle enforcement, and a restricted
Android route. Existing credentials remain valid and device metadata cannot
authenticate a request. Firebase Phone Auth, OTP generation/state/timeouts,
token verification, consent evidence, numeric device admission, verified
recovery, and logout semantics are unchanged.

## Version 4 migration approval

On 21 July 2026 the repository owner explicitly approved the full Admin Control
Center and Android version-governance migration. Authenticated Android requests
add the non-secret `x-orderak-version-code` metadata header and consume the
Worker's governed warning/forced-update/denial/maintenance decision. A current
server response may route to a blocking update state; stale or offline policy is
warning-only. This does not change Firebase Phone Auth, OTP state/timeouts,
backend token verification, consent evidence, seller credential recovery,
device admission, or logout semantics. Admin browser authentication is a new,
separate opaque-session/TOTP boundary and is not an Android authentication
provider.

## Version 5 migration approval

On 22 July 2026 the repository owner explicitly approved pre-production stable
identity and shard-ready redesign, including edits to protected baselines to
avoid avoidable legacy coupling. Firebase Phone Auth remains the provider.
`seller_auth_identities` becomes the stable ownership record after an
idempotent backfill and flag-controlled read cutover; `sellers.phone` and
`firebase_uid` remain synchronized rollback projections. Registration creates
seller, active identity, organization, membership, routing, and Play account
hash atomically. The default-disabled phone-change endpoints require an
authorized device plus fresh proof of the current phone, then a single-use
challenge plus fresh proof of an unused new phone. They cannot create a new
organization and preserve purchases, subscriptions, entitlements, routes, and
in-flight jobs. No Android phone-change UI or lost-all-access recovery is
approved by this version.

## Version 6 migration approval

On 26 July 2026 the repository owner explicitly approved the production Auth &
Onboarding plan in this work item: full hybrid Passkeys for returning users,
new-user consent after successful OTP on the Account Information step, and
international phone/store onboarding. Firebase OTP remains the sole creation
and recovery proof and retains E.164 binding, six digits, generation-checked
callbacks, 60/90-second timeouts, ten-minute phone sessions, exact backend phone
matching, sanitized logs, throttling, logout ordering, and the existing numeric
device-recovery rules. The legacy session and registration endpoints remain
unchanged for rollback. The new Worker is authoritative; Android persists only
an encrypted bearer token and resumable, non-authoritative form draft.

On 28 July 2026 the owner approved the final pre-release V6 interaction and
private-profile amendment: bottom-pinned Welcome and form actions, the existing
three-language sheet on Welcome, conditional phone fallback, inline locked-phone
OTP with manual verification, removal of predictive-back OTP navigation, and a
required year-only birth-year field. Migration `033` had already been recorded
in the production migration ledger without the birth-year columns, despite the
earlier pre-release assumption. Migration `039_add_private_birth_year.sql`
therefore supplies the forward-only production repair; `033` remains aligned
with its applied historical shape. The seller-profile column is nullable only
for legacy compatibility, while every new V6 onboarding request and insert
still requires a validated year. Firebase provider, OTP generation and security
timeouts, exact-phone verification, numeric device recovery, Passkey ceremony
guarantees, legacy endpoints, and rollback behavior remain unchanged.

### V6.1 phone-country and post-OTP city amendment

This approved additive amendment changes no OTP timing, callback, Firebase
token, E.164, exact-phone, throttling, logout, recovery, or device-limit rule.

1. Phone completion may include the ISO country selected with the phone field.
   The Worker accepts it only when its calling code matches the
   Firebase-verified E.164 number.
2. Store Step 2 does not ask for country again. Static city search is post-OTP
   and Worker-scoped to that stored phone country.
3. A selected catalogue ID is resolved and country-checked in the isolated
   `orderak-geo` D1 database. Manual city entry and legacy GeoNames remain
   additive fallbacks.
4. Business-category selection is global and required on Store Step 2.
   Subcategory selection is deferred to authenticated Store Information
   settings, is validated against the selected category, and does not
   participate in authentication decisions.
5. Store URL generation, slug normalization, immutable eight-character
   `store_code`, public identifier, and routing remain unchanged.

On 30 July 2026 the owner approved client-side asynchronous-operation
hardening. This introduced cancellation plus generation checks for OTP and
Passkey work, retryable Firebase token-refresh failure handling, and explicit
Phone Hint service-failure feedback. It does not change the Firebase provider,
OTP timing, code rules, fallback policy, consent evidence, backend verification,
device limits, or Passkey cancellation behavior.

## Version 7 contract-evidence migration approval

On 1 August 2026 the owner explicitly approved evolving the protection model
without changing runtime authentication behavior. Long-lived security outcomes
now live in the authentication invariant contract; current Firebase, timing,
storage, Credential Manager, and logout choices live in the Android profile.
The timing constants and provider-first logout sequence moved into named,
behavior-tested policies. The existing Gradle task remains the compatibility
entry point and still rejects provider, verification, consent, throttling,
device-recovery, Passkey, or shipped-bypass drift.

The approved pre-release API reset now requires every Android Seller call to use
explicit `/api/v1/*` routes, including entitlements and billing. Unversioned and
v2 paths are rejected locally and return `404` at the Worker; a
non-authenticating request ID is attached for sanitized correlation. Internal
auth/onboarding flags dropped their implementation-version suffix only. No
Firebase, OTP, Passkey, consent, timeout, logout, recovery, locale, iOS, or PWA
behavior changed.
