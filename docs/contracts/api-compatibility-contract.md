---
status: current
generated: false
owner: backend
applies_to: [production, staging]
authoritative_for: [api-compatibility]
---
# Seller API Compatibility Contract

**Contract version:** 2  
**Lifecycle:** pre-release / no production users  
**Current client:** Android; iOS and desktop names are reserved but not implemented

## Pre-release route policy

- `/api/v1/*` is the only Seller/Android JSON surface and will become the first
  production contract.
- `/api/admin/v1/*` and `/api/integrations/v1/*` are independently versioned.
- Unversioned Seller JSON routes and every `/api/v2/*` route are removed and
  return `404`; the Worker must not redirect or provide compatibility payloads.
- `/health`, `/.well-known/assetlinks.json`, content-hashed media/assets, and
  public HTML pages are intentionally outside JSON API versioning.
- While `x-stability` is `draft`, breaking changes are allowed with an API
  changelog entry. `beta` requires Engineering and Android approval. Once
  `stable`, oasdiff blocks breaking changes unless a new API version is created.
- No Sunset clock applies before the first production release. A future
  deprecation policy starts only after real users and production clients exist.

## Payload rules

1. Errors use RFC 9457 Problem Details with stable `code` and `request_id`;
   the legacy `{error}` shape is not part of v1.
2. JSON fields use `snake_case`; money is integer minor units in `*_minor`
   fields, always carried with an explicit ISO 4217 `currency`, per
   [ADR-009](../decisions/adr-009-minor-units-with-explicit-currency.md);
   timestamps are RFC
   3339 UTC; cursor pages expose `next_cursor` and `has_more`.
3. Common Seller DTOs contain no Android-only fields. Provider proof belongs to
   provider-specific operations.
4. Android uses the central `NetworkJson` decoder with `ignoreUnknownKeys=true`.
   Stable additive response fields are optional; required fields missing or of
   the wrong type still fail decoding.
5. Secrets never appear in URLs, response bodies, examples, logs, analytics, or
   the public OpenAPI bundle.
6. `X-Request-ID` is correlation metadata, not authentication or idempotency.
   Retry-safe mutations use `Idempotency-Key` independently.
7. `x-orderak-platform` and `x-orderak-app-version` are optional compatibility
   metadata. They are represented in OpenAPI and must never affect authorization.

## Enforcement

- `ApiRoutes` accepts explicit `/api/v1/*` Seller paths only and rejects
  unversioned, v2, and non-API paths locally.
- `verifySellerApiContract` guards the central transport boundary and
  `verifyAuthPhase1Contract` protects authentication behavior.
- Worker tests assert removed routes return `404` with no redirect.
- OpenAPI 3.1.2 is authoritative; Spectral, Redocly, examples, route/spec
  coverage, Prism DTO tests, Schemathesis, and public leakage scans run in CI.
- All OpenAPI descriptions remain `draft` until the release gates documented in
  `docs/guides/openapi-development.md` pass.
