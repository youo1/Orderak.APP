# ADR-008: Evolvable safety contracts and Android-first portability seams

**Status:** accepted

**Date:** 2026-08-01

**Supersedes:** source-text freezing portions of authentication contract v6 and localization contract v2

**Superseded by:** none

## Context

Orderak is shipping an Android seller app and has no approved iOS or seller PWA
implementation. Authentication and localization guards prevented accidental
regressions, but several checks were tied to Kotlin class names, literal source
lines, and file layout. That made safe refactoring look like a product-contract
violation and would encourage either permanent Android coupling or deletion of
valuable protections.

The API documentation also required new clients to use `/api/v1/*`, while
Android still constructed most v1 calls with unversioned `/api/v1/*` paths.

## Decision

Keep Android as the only implemented seller client. Do not create speculative
iOS/PWA code. Replace permanent implementation freezing with layered,
versioned evidence:

1. Long-lived authentication and localization outcome invariants.
2. Current Android platform profiles for provider/configuration choices.
3. Behavioral unit/integration tests for OTP state, timing, logout, Worker
   verification, resource parity, and other protected outcomes.
4. Static guards only for configuration, forbidden shipped code, documented
   profiles, and boundaries that cannot be demonstrated cheaply at unit level.
5. A central Android API route policy that accepts explicit Seller v1 paths
   only. Because the product remains pre-release, unversioned and v2 routes have
   no installed-client compatibility requirement and are removed.
6. Platform-specific device metadata behind `ClientContextProvider`; metadata
   remains non-authenticating.

An approved migration must update contracts, platform profiles, tests, security
and API docs, rollout/rollback analysis, and affected CI in one change.

## Consequences

- Security and localization protections remain enforceable without freezing
  class names or DI structure.
- Current Firebase, OTP, logout, locale, and bundle behavior do not change.
- Android traffic uses the documented versioned API boundary.
- Future clients can be evaluated later against stable server and behavioral
  contracts, but no current build cost is added for Swift, Xcode, web offline,
  or multiplatform UI.
- Seller call sites use explicit v1 paths; the transport boundary fails closed
  on unversioned or v2 input.

## Alternatives considered

- **Delete the contracts:** rejected because it removes protection around the
  highest-risk auth/localization behavior.
- **Keep exact source freezing indefinitely:** rejected because it blocks safe
  refactoring and confuses implementation with product guarantees.
- **Create KMP/iOS/PWA targets now:** rejected because there is no current
  delivery need and the extra toolchains would slow Android work.
