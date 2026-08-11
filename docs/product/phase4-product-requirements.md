# Phase 4 launch product requirements

| Control | Value |
| --- | --- |
| Document ID | `PRD-LAUNCH-001` |
| Version | 1.0 |
| Baseline date | 2026-07-18 |
| Product owner | Founder / CEO acting; named acceptance pending |
| Status | Engineering scope frozen; G4 approval pending |
| Launch market | Egypt (first market; MENA and global expansion follow separate readiness gates) |
| Launch model | Merchant SaaS and order relay; Orderak does not custody buyer funds |

This is the controlled launch PRD for Phase 4. It freezes what engineering may
prepare for the first public release. It is not legal approval. G4 remains open
until the product, counsel, privacy, security, and finance approvers sign the
[gate record](./phase4-traceability-and-gate.md).

## Product outcome

For the first commercial release, an adult Egyptian merchant can create a
store, publish a small catalog, receive
buyer order requests, manage products, customers, and order status, and share a
public catalog. Buyers transact with the merchant. Orderak provides software and
order relay and does not become merchant of record or hold, route, or settle the
merchant's buyer funds.

## Frozen launch scope

| Requirement | Launch behavior | Acceptance summary |
| --- | --- | --- |
| `PRD-AUTH-001` | Seller signs in with the protected Firebase SMS Phase 1 flow | The protected auth regression gate passes; failures and recovery follow the contract |
| `PRD-STORE-001` | Seller creates and edits one store profile and public identifier | Store-scoped authorization prevents cross-store read/write; required fields validate |
| `PRD-CATALOG-001` | Seller manages categories, products, prices, stock, and images | CRUD and sync are idempotent; integer piasters are used; plan limit is enforced server-side |
| `PRD-PUBLIC-001` | Buyer views an Arabic/English public catalog and submits an order request | Unsupported locale falls back; invalid or unavailable products cannot create a valid order |
| `PRD-ORDER-001` | Seller views orders and performs allowed status transitions | State machine rejects invalid transitions; duplicate sync does not duplicate orders |
| `PRD-CUSTOMER-001` | Seller views customers derived from its own orders | Only the owning seller can access buyer records; no broad contacts permission is used |
| `PRD-SETTINGS-001` | Seller manages store details, payout display fields, language, logout, and deletion request | Changes sync safely; logout follows the auth contract; deletion route remains functional |
| `PRD-ADMIN-001` | Authorized staff use the admin panel for approved support, finance, content, audit, and release work | JWT, role permission, and sensitive-action audit checks apply; break-glass remains restricted |
| `PRD-SUPPORT-001` | Support receives seller requests and routes complaints, privacy requests, and urgent reports | Every case has category, owner, timestamp, status, evidence, and escalation path |
| `PRD-CONTENT-001` | Public catalog content can be reported, reviewed, removed, appealed, and tied to seller action | Controls in the [content standard](./phase4-content-controls.md) are implemented before pilot |
| `PRD-BILLING-001` | First launch is free; acquisition of paid SaaS plans is unavailable | `BILLING_ENABLED` defaults to `false`; acquisition endpoints fail closed; no paid CTA is exposed |
| `PRD-AI-001` | Seller-facing AI assistant is deferred | `AI_ASSISTANT_ENABLED` defaults to `false`; the API fails closed; no Android screen exposes it |

## Required failure behavior

- Offline Android work remains local where supported and retries through the
  existing sync process without inventing a successful server result.
- Authentication failure, store mismatch, forbidden admin action, invalid order
  transition, plan limit, invalid input, rate limit, provider outage, and server
  failure return stable codes and do not leak secrets or another store's data.
- Billing acquisition returns non-retryable `403` with `feature_disabled` when
  its launch flag is not exactly `true`. AI requests remain temporarily
  unavailable with `503 feature_disabled` while their launch flag is off.
- A public order is a request to the merchant, not proof of merchant acceptance,
  payment, stock reservation, shipment, or fulfilment.
- Destructive or sensitive admin actions require the permission stated in the
  role matrix and an auditable event. Missing capability is a release gap, not a
  reason to broaden the owner role informally.

## Product quality requirements

- Android remains Kotlin and Jetpack Compose and calls the Cloudflare backend only.
- The protected Arabic/English/French seller localization architecture and
  Arabic/English public catalog architecture remain unchanged.
- Android release manifest permissions remain limited to `INTERNET` unless a
  separately approved requirement changes the permission contract.
- Launch currency is EGP and is currently stored and calculated as integer
  piasters. New shared features must treat this as an Egypt configuration, not
  a universal product invariant; explicit ISO currency and generic minor units
  are required before activating another market.
- Core seller and public journeys include Arabic/RTL, accessibility, network,
  timeout, empty, invalid, duplicate, unauthorized, and server-error tests.
- Every release requirement links to code, tests, evidence, documentation, an
  accountable owner, and any open risk in the traceability record.

## Explicitly deferred or prohibited

- Paid SaaS acquisition, Play Billing products, external digital purchase links,
  coupons, paid referrals, and paid entitlement changes.
- Seller AI chat and personal-data transfer to an AI assistant provider.
- Orderak custody, routing, settlement, escrow, wallet, lending, BNPL, insurance,
  or other regulated financial functionality.
- Buyer-facing French catalogs; production activation outside Egypt (while
  shared engineering remains MENA/global-ready); child-directed use;
  broad contacts, location, SMS, call-log, storage, or advertising permissions.
- Replacement of the protected authentication or localization contracts.

## Change rule

Any scope addition is out of launch until a change record states its business
value, roles, data, permissions, vendors, legal basis, billing effect, security
and operational controls, acceptance tests, rollback, approvers, and evidence.
Paid billing and AI additionally require their specific re-enable gates in
[ADR-004](../decisions/adr-004-free-launch-billing.md) and this PRD.
