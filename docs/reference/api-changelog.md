# API changelog

## 2026-08-10 — live-contract conformance

- Enforced the documented Seller compatibility headers before both public and
  authenticated `/api/v1/*` handlers: unknown platforms, invalid app-version
  lengths, and overlong request IDs now fail with `400` Problem Details.
- Documented the required business-category identifier and the supported search,
  language, and limit query parameters for business-subcategory discovery.
- Changed intentionally disabled billing-acquisition and Google Play lifecycle
  routes from retryable-looking `503` responses to non-retryable `403
  feature_disabled` responses.
- Constrained support-ticket path identifiers to numeric IDs and documented the
  existing `404` response for a missing or inaccessible ticket.
- Constrained Google Play verification identifiers to their canonical UUID form,
  and made business-subcategory discovery reject undocumented query parameters.
- Partitioned the live staging contract allowlist into eight disjoint, verified
  shards and capped their combined sequential rate at 30 requests per minute, so
  every operation remains covered below the shared edge rate window. The live
  policy check now fails if concurrency or the sustained request ceiling rises.

## 2026-08-01 — repository and client-context documentation

- Moved source contracts to `contracts/openapi/` without changing operation IDs,
  route paths, schemas, or runtime behavior.
- Documented the existing optional `x-orderak-platform` and
  `x-orderak-app-version` request headers on Seller operations.
- Added explicit Production server entries alongside Staging and local Prism.
  These are additive documentation changes; no live route was created or renamed.

## 2026-08-01 — pre-release v1 reset

- Established `/api/v1/*`, `/api/admin/v1/*`, and
  `/api/integrations/v1/*` as the only versioned JSON surfaces.
- Moved entitlements and Google Play billing into Seller v1; moved Google Play
  RTDN and payment callbacks into Integrations v1.
- Removed unversioned Seller aliases and all `/api/v2/*` routes. They now return
  `404` without redirect or compatibility behavior.
- Renamed internal rollout flags to remove feature-implementation `V2` suffixes;
  authentication, OTP, Passkey, onboarding, taxonomy, and billing behavior did
  not change.
- Adopted RFC 9457 Problem Details and `X-Request-ID` on JSON responses.
- Added OpenAPI 3.1.2 source contracts, Prism, Spectral, Redocly, route/spec
  coverage, public L0 filtering, Schemathesis CI tiers, k6 profiles, and an OAS
  3.0.3 Cloudflare Schema Validation projection.
