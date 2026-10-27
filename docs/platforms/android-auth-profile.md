---
status: current
generated: false
owner: android
applies_to: [production, staging]
---
# Android Authentication Profile

**Profile version:** 2  
**Safety contract:**
[`../contracts/authentication-security-invariants.md`](../contracts/authentication-security-invariants.md)

The current Android runtime behavior is intentionally unchanged by the
cross-platform-readiness and D-13 age-evidence migrations.

- Firebase Phone Authentication remains the account-creation and recovery
  provider. Passkeys remain an additional returning-seller channel.
- SMS auto-retrieval timeout is 60 seconds, send-operation terminal timeout is
  90 seconds, and the phone-bound OTP session is 10 minutes.
- Credential Manager owns Android Passkey UI and Android-specific origin
  association.
- Encrypted preferences protect the onboarding token and device credential;
  DataStore remains a resumable non-authoritative draft/cache.
- Logout calls `POST /api/v1/auth/logout` to retire the credential, signs out of
  Firebase, clears Room, the entitlement cache and the local seller session, and
  removes the encrypted device secret last. Revocation is best effort so an
  offline sign-out still completes locally. The opaque installation ID may remain
  for device continuity but cannot authenticate. One implementation
  (`SessionLogoutManager`) serves every account state; the settings screen
  delegates to it rather than repeating the sequence.
- The Worker verifies Firebase proof, legal evidence, device admission,
  restrictions, and session credentials exactly as documented in the versioned
  auth contract.
- The migrated Worker onboarding account contract requires affirmative age
  confirmation (`age_confirmed: true`) and records the exact canonical Arabic
  statement `عمري ١٨ عامًا أو أكثر`, source `android_onboarding_v2`, a Worker
  timestamp, and the accepted Terms version as confidential evidence on
  `legal_acceptances`. The current Android client sends `age_confirmed: true` from its one-step
store setup (plan item R3); installed clients may still send `birth_year`; the Worker
  accepts a valid legacy year only when `age_confirmed` is absent, records source
  `android_onboarding_v2_legacy_birth_year` with NULL statement text, and does
  not store the submitted year in `onboarding_sessions` or `seller_profiles`.
  A draft saved by the previous Worker with an account-saved status, a retained
  session birth year, and no source marker is marked by migration
  `063_clear_stored_birth_years.sql` as `android_onboarding_v2_legacy_birth_year`
  and then still completes as that legacy shape with NULL statement text. The
  stored session year is cleared by the same migration; the column and the
  consent evidence remain, and the year is never copied to a new field.
  The current Android runtime source, strings, and UI are unchanged for now;
  this profile does not require new Android strings or source.
- Every Seller request uses explicit `/api/v1/*`; `ApiRoutes` rejects
  unversioned and v2 paths before network I/O. All response decoding crosses
  `NetworkJson` with `ignoreUnknownKeys=true`, while missing required or
  wrong-typed fields remain failures.

Class names, dependency-injection wiring, and UI composition may be refactored
when the behavioral tests and security invariants continue to pass.
