---
status: current
generated: false
owner: backend
applies_to: [production, staging]
---
# API changelog

## 2026-09-12 — cross-layer audit remediation

Behaviour changes, in the order a client is most likely to notice them.

- **Plan limits that reset now answer `429` with `Retry-After`.** Exceeding
  `max_orders_per_month` or `max_ai_requests_per_month` previously answered
  `409` through the legacy plan model and `429` through the entitlements
  engine — the same condition, a different status, decided by
  `ENTITLEMENTS_ENABLED`, which staging and production sit on opposite sides
  of. Both paths now read one rule: a resetting allowance is `429`, a
  structural cap such as `max_products` stays `409`. The `code` is
  `plan_limit_reached` either way and was always the stable identifier.
- **`PATCH /api/v1/customers/{customer_key}` enforces its entitlement.** The
  catalogue has sold `customers_crm.editable_customer_profiles` as a paid
  feature since migration 025 and the Android client gates its editor on it; the
  API accepted the write from any authenticated seller. A seller without the
  entitlement now receives `403 plan_feature_unavailable`. The check runs
  before the record lookup, so the refusal cannot be used to probe which
  customer keys exist.
- **Credentialed writes are refused for a client the version policy blocks.**
  `governance.version` has always reported `force_update`, `blocked` and
  `maintenance`; nothing acted on them. Those three now answer `403
  client_version_refused` on credentialed non-GET requests, carrying the
  decision as `version_status` and the full policy as `version`. Reads are
  unaffected, and the pre-auth surface — register, phone completion, onboarding,
  the plan catalogue — is deliberately exempt, because it carries no device
  headers and gating it would close sign-in entirely.
- **`x-orderak-version-code` is validated.** A malformed value now answers
  `400 invalid_version_code` instead of being coerced to `NaN`, and an
  absent one no longer satisfies a configured minimum. Both are the same fix:
  the input the version policy is evaluated against was the one input nothing
  checked.
- **`POST /api/v1/orders` adds `total` as a Money object.** It was the only
  money field on the Seller API sent as a bare `total_minor` beside a separate
  `currency`, against ADR-009. Both existing keys are still sent; installed
  builds read them.
- **French is a supported response locale.** `LOCALES` is now
  `ar, en, fr`. The Android app has shipped `fr` as a selectable UI language
  throughout and sends `Accept-Language: fr`, which previously matched nothing
  and fell through to the Arabic default — including when selecting the legal
  version recorded against a seller's consent.
- **Public `404` bodies follow the resolved locale** instead of always being
  Arabic.

Contract and CORS:

- Documented `Governance`, `AppVersionPolicy`, `GovernedFeature`,
  `PlanLimits`, `PlanFeatures` and `ClientConfig`, and added `config` to
  the `GET /api/v1/orders` response schema. Both were sent on every call the
  Android client makes most often and neither was described, so Schemathesis,
  the Prism mock and every generated client were blind to the fields the app
  depends on most.
- `Access-Control-Allow-Methods` gained `PATCH`, and
  `Access-Control-Allow-Headers` gained `x-orderak-version-code`,
  `If-None-Match` and `x-lang` — all of which the API already reads.
- `localhost` origins are allowed only outside production.

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
