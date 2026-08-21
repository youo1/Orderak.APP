---
status: current
generated: false
owner: product
applies_to: [production, staging]
---
# Production Authentication Plan

This document defines the production-ready authentication architecture target,
Firebase console configuration, environment separation, and release gates.

> **Implementation state (2026-08-01):** the versioned safety contract is v7;
> the provider and runtime behavior remain the approved V6 Android profile. Hybrid
> Passkeys, inline manual-verify OTP, post-OTP onboarding consent, private
> profile/birth-year/email, and international phone/store onboarding are
> implemented in the repository behind
> `ONBOARDING_ENABLED=false` and `PASSKEY_ENABLED=false`. External
> release/Play signing, Digital Asset Links, static city-catalogue import, all-country
> Firebase policy/billing, migration publication, and physical-device evidence
> remain production release gates.

## Historical live production audit — 13 July 2026

- D1 migrations 021–023 are applied remotely. The legal-acceptance and
  deletion-request schemas were verified and Wrangler reports no pending
  migrations.
- Owner-confirmed version-2 Terms and Privacy content is published in Arabic
  and English. Independent review by a lawyer qualified in Egypt remains
  recommended before broad public launch.
- Firebase Phone Auth is enabled; the SMS policy is an allowlist containing only
  Egypt; the fictional test phone is configured console-side; the Android app
  has its debug SHA-1/SHA-256 fingerprints; and App Check is registered with
  Play Integrity.
- Release-upload and Google Play App Signing SHA-1/SHA-256 fingerprints remain
  a release gate because this workspace has no release signing configuration or
  Play signing certificate yet.
- The production Worker version `35aaa76b-d8bb-4c3d-b9bc-d897a889b2d8` serves
  the deletion resource and runs technical-log cleanup daily at 02:17 UTC.

## Target architecture

The approved production target uses:

- **Immutable account IDs** (UUID) — never the seller's phone number — as the
  stable internal identifier.
- **Opaque access tokens** — short-lived random server-stored credentials sent
  as `Authorization: Bearer` headers; they are not self-signed JWTs.
- **Rotating refresh tokens** — long-lived, stored in D1, used to obtain new
  access tokens without re-authentication.
- **Device management** — each device gets its own credential; revoking a
  device does not affect others.
- **Consent records** — GDPR/Play Store requirement: a record of when and how
  the seller agreed to data processing.
- **Account deletion** — in-app and public-web paths for full account and data
  deletion.

## Firebase console checklist (production)

Console completion evidence must include the project/environment, operator,
timestamp, screenshots or exported settings, and a physical-device SMS test.
Do not mark a checkbox complete from code review alone.

### Environments

| Environment | Firebase project | Purpose |
|-------------|-----------------|---------|
| Development | `orderatak-dev` (create/confirm) | Local development, debug builds |
| Staging | `orderatak-staging` (create/confirm) | Pre-release testing, internal testers |
| Production | `orderatak-eg` (current project; owner must confirm) | Published app, real sellers |

Each environment has its own Android app (`app.orderak.seller` with a matching
package or suffix), its own Phone Auth configuration, and its own
`google-services.json`.

### Fingerprints

| Fingerprint | Where to add it |
|-------------|----------------|
| Debug signing SHA-1 | Dev project → Android app |
| Debug signing SHA-256 | Dev project → Android app |
| Release upload key SHA-1 | Staging + Production → Android app |
| Release upload key SHA-256 | Staging + Production → Android app |
| Google Play App Signing SHA-1 | Production → Android app |
| Google Play App Signing SHA-256 | Production → Android app |

Obtain fingerprints with:

```cmd
cd apps/seller-android
gradlew.bat signingReport
```

### SMS region policy

Set an explicit Firebase SMS region policy for the approved all-country
phone-onboarding scope:

- Firebase console → Authentication → Settings → SMS region policy
- Enable Blaze billing, review current per-region availability/limits, document
  any deny-listed destinations, and capture the effective policy as release
  evidence. Do not treat an implicit default as approval.

### Test phone numbers

- Add fictional test numbers in the Firebase console (**Authentication →
  Sign-in method → Phone → Phone numbers for testing**).
- Never hardcode test numbers, OTP codes, or `disable app verification` in
  shipped code.
- The backend emergency bypass (`ALLOW_UNVERIFIED_REGISTRATION=true`) must
  never be set in production Worker secrets.

### Budget alerts

- Enable billing budget alerts in Google Cloud Console (Firebase projects are
  GCP projects).
- Set quota alerts for Phone Auth SMS usage.
- Enable authentication monitoring in Firebase console.

## Play Integrity and reCAPTCHA

- Enable **Play Integrity API** in the Google Cloud Console.
- The Android app must handle both the Play Integrity verdict and the
  reCAPTCHA fallback (for devices without Play Services).
- Test both paths before production release.

## Deletion requirements

Google Play requires in-app and public-web account deletion paths.

- **In-app:** Settings → Request account deletion records an authenticated,
  identity-verified request and opens the public status/information resource.
- **Public web:** `https://orderak.app/delete-account` accepts a request without
  requiring the installed app; support performs fresh phone verification before
  fulfilment.
- **Operations:** follow `docs/runbooks/account-deletion.md`. The published
  target is completion within 90 days, but fulfillment is a production blocker
  until the unscheduled processor, stub trigger, Firebase cleanup, and
  partial-failure behavior are fixed and independently tested (`FND-011`).

## Device restore and multi-device

- Returning to an already-authorized device works on every plan.
- Verified OTP recovery on Free rotates the primary device credential and logs
  all previous devices out. Reinstall and phone replacement therefore remain
  recoverable without enabling concurrent devices.
- Higher plans keep existing authorized devices and admit a new OTP/Passkey
  device only below the backend-resolved numeric concurrent-device cap.
- Plan changes are evaluated on every authenticated request; disabling
  multi-device access immediately blocks additional device credentials.

## Passkey release checklist

- Production RP ID: `orderak.app`; staging RP ID:
  `staging.orderak.app`.
- Production Asset Links and `WEBAUTHN_ANDROID_ORIGINS` contain only signed
  release and Play App Signing certificates. Debug belongs only to staging.
- Exercise Android Credential Manager registration/authentication,
  discoverable credential selection, cancellation, absent credential, UV
  enforcement, replay/expiry/origin/signature rejection, revocation, and device
  caps on physical devices.
- Confirm that logs and support tools never contain raw WebAuthn challenges,
  onboarding/email/recent-auth tokens, credential IDs, phones, or OTPs.
- Rollout order: migration/legal/static city catalogue and Asset Links → Worker with flags
  off → Android closed track → onboarding flag → Passkey flag → gradual Play
  rollout. Rollback sets both flags false and retains the additive tables.

## App Check (future)

- Enforce Firebase App Check on the Android app to ensure only the genuine
  Orderak app can obtain Phone Auth tokens.
- The backend would verify the App Check token alongside the ID token.
- Deferred until the app is stable on Play Store with Play Integrity.

## WhatsApp integration (future)

- WhatsApp Business API for order notifications and customer messaging.
- Backend would manage WhatsApp session tokens and message templates.
- Not part of the current scope; design placeholder only.

## Migration sequence

1. **Phase 1 / legacy rollback (implemented):** SMS-only Firebase UI; phone-bound
   resend/session state; stale callback protection; 90-second send timeout;
   stable error mapping; sanitized logs; Firebase logout; independent phone/IP
   throttles; append-only legal acceptance evidence; and new-account consent
   enforcement. Apply migration 021 and complete the console checklist before
   production release.
2. **Phase 2:** Introduce immutable account IDs plus server-stored opaque access
   and rotating refresh tokens. Keep D1 authoritative for session/revocation
   state; KV may cache non-authoritative data only.
3. **Phase 3:** Remove `x-orderak-phone` and `x-orderak-secret` headers from
   all Android API calls.
4. **Phase 4:** Add device management, phone-change recovery, account deletion,
   App Check monitor-then-enforce rollout, and minimum-app-version enforcement.
5. **Phase 5:** Add WhatsApp OTP only as a server-generated, hashed, expiring,
   attempt-capped challenge after Meta verification/template approval. It must
   produce the same account/session semantics as Firebase SMS.
6. **Phase 6 / modern auth rollout (implemented, default-off):** Welcome, Credential
    Manager Passkeys for returning sellers, Firebase OTP creation/recovery,
    conditional phone fallback, inline locked-phone OTP with explicit Verify,
    immediate post-OTP Passkey opt-in with the system ceremony deferred until
    Store step 2 succeeds, consent plus required private year of birth on
    Account step 1, atomic/idempotent Store step 2, encrypted resumable local
    draft, private-email verification, static city search, and recent-auth
    Passkey management. Apply migrations 033–034 and complete the guarded
    release checklist before enabling either flag.

No phase breaks backward compatibility; old and new auth methods coexist
until the Android app is fully updated.
