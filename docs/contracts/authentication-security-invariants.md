---
status: current
generated: false
owner: security
applies_to: [production, staging]
authoritative_for: [auth-security-invariants]
---
# Authentication Security Invariants

**Contract version:** 1  
**Applies to:** every Orderak seller client and the public Worker  
**Change authority:** explicit owner approval plus an executable migration

This contract protects security outcomes rather than Android class names or a
specific identity SDK. The current Android implementation profile remains in
[`../platforms/android-auth-profile.md`](../platforms/android-auth-profile.md).

## Required invariants

1. A phone proof is bound to the exact normalized E.164 phone and active
   authentication attempt. Results from an older or cancelled attempt cannot
   mutate UI, credentials, onboarding state, or a seller session.
2. Every interactive authentication operation reaches a terminal success,
   failure, cancellation, or timeout state. Provider callbacks cannot leave the
   client indefinitely loading.
3. OTPs, verification identifiers, identity tokens, device credentials,
   onboarding tokens, raw provider errors, and full phone numbers are excluded
   from logs, analytics, crash metadata, URLs, and public DTOs.
4. The Worker verifies identity-provider proof server-side, fails closed when
   verification is unavailable, and requires the verified phone claim to match
   the requested E.164 phone.
5. Pre-authentication phone and source-IP throttles, replay protection, token
   expiry, account restrictions, and device-entitlement enforcement remain
   server-authoritative.
6. Legal acceptance is affirmative, versioned, attributable, and recorded at
   the approved product step. Authentication success alone is not consent.
7. Device secrets are random client credentials, stored only in protected local
   storage and hash-only at rest in D1. Device metadata cannot authenticate.
8. Logout invalidates provider state before clearing business, entitlement, and
   local session state. An intentional retention exception, such as an opaque
   installation identifier, must be documented and non-authenticating.
9. Recovery cannot weaken account restrictions or device limits. A successful
   recovery proof uses the same server-authoritative admission rules as sign-in.
10. Test credentials, fixed OTPs, disabled verification, and provider bypasses
    never ship in a production or staging-distributable client.

## Executable evidence

- Android OTP state, operation generation, timing profile, error mapping, and
  logout sequencing unit tests.
- Worker Firebase verification, onboarding, identity, throttling, and device
  admission integration tests.
- `verifyAuthPhase1Contract`, retained as the compatibility entry point, checks
  protected configuration and forbidden shipped-code patterns.

## Change procedure

An approved change must include the affected platform profile, behavioral and
Worker tests, security/API documentation, rollout controls, backward-
compatibility analysis, and a rollback plan in one change. A refactor that
preserves these invariants does not require freezing file names or source text,
but it must keep the executable evidence green.
