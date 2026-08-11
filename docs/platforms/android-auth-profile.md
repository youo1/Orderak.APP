# Android Authentication Profile

**Profile version:** 1  
**Safety contract:**
[`../contracts/authentication-security-invariants.md`](../contracts/authentication-security-invariants.md)

The current Android runtime behavior is intentionally unchanged by the
cross-platform-readiness migration.

- Firebase Phone Authentication remains the account-creation and recovery
  provider. Passkeys remain an additional returning-seller channel.
- SMS auto-retrieval timeout is 60 seconds, send-operation terminal timeout is
  90 seconds, and the phone-bound OTP session is 10 minutes.
- Credential Manager owns Android Passkey UI and Android-specific origin
  association.
- Encrypted preferences protect the onboarding token and device credential;
  DataStore remains a resumable non-authoritative draft/cache.
- Logout signs out of Firebase before clearing Room, entitlement cache, and the
  local seller session. The opaque installation ID may remain for device
  continuity but cannot authenticate.
- The Worker verifies Firebase proof, legal evidence, device admission,
  restrictions, and session credentials exactly as documented in the versioned
  auth contract.
- Every Seller request uses explicit `/api/v1/*`; `ApiRoutes` rejects
  unversioned and v2 paths before network I/O. All response decoding crosses
  `NetworkJson` with `ignoreUnknownKeys=true`, while missing required or
  wrong-typed fields remain failures.

Class names, dependency-injection wiring, and UI composition may be refactored
when the behavioral tests and security invariants continue to pass.
