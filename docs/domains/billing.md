---
status: current
generated: false
owner: backend
last_verified: 2026-08-21
applies_to: [production, staging]
authoritative_for: [billing-domain]
---
# Billing domain

How Orderak takes money, and why it currently does not.

> **Runtime state: billing is off in both environments.** The code described
> here is implemented and tested, but no seller can buy anything today. Read
> [Two gates, not one](#two-gates-not-one) before assuming any behaviour below
> is reachable.

## Runtime state

Every claim in this document describes code that exists. Whether it *runs* is a
separate fact, controlled by the flags in `services/backend/wrangler.jsonc`:

| Flag | Production | Staging | Controls |
| --- | --- | --- | --- |
| `BILLING_ENABLED` | `false` | `false` | Paid-plan acquisition and sale visibility |
| `GOOGLE_PLAY_LIFECYCLE_ENABLED` | `false` | `false` | Play verification, RTDN, restore, reconciliation, acknowledgement |

The gate covers acquisition only. `BILLING_ACQUISITION_ROUTES` in
`services/backend/src/domains/commerce/billing.ts` holds exactly eight paths:

```text
/api/v1/subscribe
/api/v1/cancel
/api/v1/plans
/api/v1/coupons/validate
/api/v1/coupons/apply
/api/v1/referral/apply
/api/v1/referral/stats
/api/integrations/v1/payment
```

Each returns a non-retryable `403` with
`{"error":"feature_disabled","feature":"billing"}`. This is a product-policy
refusal, not an outage — clients must not retry it until the flag changes.

`/api/v1/cancel` and `/api/integrations/v1/payment` were added after this
document first described the set as six. Closing the front door while leaving a
public webhook that writes subscription status reachable was the gap worth
closing, and both stay closed.

`/api/v1/subscription/status` is deliberately **not** in that set. A seller can
always read their own subscription state, even while nothing can be bought;
closing billing must not blind a merchant to what they already have. It was
briefly gated alongside the other two and has been carved back out: it is an
authenticated GET that returns the caller's own state and grants nothing, so
closing it protected nothing and cost the rule above. The Play verification
routes are gated separately by `GOOGLE_PLAY_LIFECYCLE_ENABLED`.

`tooling/repository/verify-billing-gate.mjs` compares this list against the code
on every run. The drift it now prevents went unnoticed because no check read a
prose claim about a route set, and this document went on describing a carve-out
the code had removed.

The Free plan is unaffected. It activates instantly and indefinitely with no
payment, which is the entire commercial surface of the current launch. See
[ADR-004](../decisions/adr-004-free-launch-billing.md) for the approval and the
conditions under which this changes.

### Two gates, not one

`BILLING_ENABLED` is necessary but not sufficient. `handleBillingRoutes` in
`services/backend/src/domains/commerce/billing.ts` requires **both** the
deploy-time environment flag **and** a runtime control read from D1:

```text
env.BILLING_ENABLED === "true"  AND  settings.billing_enabled === true
```

The second gate is `runtimeControlEnabled(env, "billing_enabled", true)` in
`services/backend/src/platform/config/runtime-config.ts`, which reads the
`settings` table and falls back to its default when the row or the table is
missing. It is administrator-editable at runtime, so billing can be closed
without a deploy — but it cannot be *opened* without one, because the
environment flag is still false.

Turning billing on therefore takes a deploy **and** a control change. Do not
plan a launch that assumes either one alone is enough.

## Payment gateways

`services/backend/src/domains/commerce/payments.ts` defines a `PaymentGateway`
interface — `createSubscription`, `cancelSubscription`, `parseWebhook` — and the
billing logic never talks to a provider directly.

**The only implemented gateway is `MockGateway`.** `getGateway()` returns it
unconditionally. There is no Stripe, Paymob, or Fawry implementation in the
repository.

`STRIPE_SECRET_KEY` is a reserved name that the backend reads nowhere and acts
on never; the line that would select a Stripe gateway is commented out. Setting
it changes nothing. The
[third-party register](../governance/registers/third-party-and-permission-register.md)
records Stripe as `TP-009`, status **Dormant/unapproved**, with an open action
to either remove the misleading configuration or complete vendor and legal
approval before activation. Treat that register as authoritative on Stripe's
status, not this page.

### Webhook signature verification

`/api/integrations/v1/payment` is a public `POST`. When a webhook secret is
configured, `parseWebhook` requires a valid HMAC-SHA256 signature over the raw
body and throws `bad_signature` otherwise. Only when no secret is configured —
local development and tests — is the body trusted unverified.

This matters because `gateway_sub_id` is the only other identifier in the
payload: without signature verification, anyone who learned or guessed one could
flip a subscription to active. The webhook secret is a Worker secret and is
**not** a Stripe signing secret; the backend does not implement Stripe's native
webhook contract. See the [glossary](../reference/glossary.md) for the
distinction.

## Google Play billing

`services/backend/src/integrations/google-play/google-play.ts` is the largest
integration in the backend and the one intended to carry real money. It is
gated by `GOOGLE_PLAY_LIFECYCLE_ENABLED`.

Tables: `play_purchases`, `play_verification_jobs`, `play_billing_events`,
`play_product_mappings`, and `billing_verification_heads`. Transport is the
`orderak-play-billing` queue with a dead-letter queue; recovery is documented in
the [Play billing DLQ runbook](../runbooks/play-billing-dlq.md).

Four properties are worth knowing before changing anything here:

1. **RTDN is a hint, never evidence.** A Real-time Developer Notification
   triggers work; it does not supply the outcome. Every lifecycle event
   re-queries Google's Android Publisher API for the authoritative purchase
   state. See [ADR-006](../decisions/adr-006-authoritative-play-verification.md).
2. **Purchase tokens are encrypted at rest.** `encryptToken` / `decryptToken`
   wrap every token before it reaches D1. The job outbox stores ciphertext.
3. **Generation guards prevent stale writes.** `beginGeneration` increments
   `billing_verification_heads.latest_generation` per organization, and
   `applyVerifiedPurchase` records that generation on the row it writes. An
   older in-flight verification cannot overwrite a newer result.
4. **Work is leased, not locked.** `PLAY_VERIFICATION_LEASE_SECONDS` is `120`,
   sized to cover OAuth, the re-query, acknowledgement, and D1 margin.

Every entry path — RTDN, reconciliation sweep, and admin retry — creates the
same encrypted D1 job, so there is one code path to reason about rather than
three.

## Money

Amounts are integer minor units plus an explicit currency. Never floats, and
never an amount without its currency. `CheckoutRequest` carries
`amountPiasters` and `currency` together.

The reasoning and the migration that made currency explicit are in
[ADR-002](../decisions/adr-002-integer-piasters.md) and
[ADR-009](../decisions/adr-009-minor-units-with-explicit-currency.md); the
shared helpers live in `services/backend/src/platform/money/`. Do not restate
those rules elsewhere — link them.

## Boundaries

- **Plan limits and feature gating** are not billing. They belong to the
  [entitlements domain](./entitlements.md), which is separately flagged and has
  its own dual-system complication.
- **Admin-side plan approval and revision publishing** live in
  `services/backend/src/domains/admin/admin-entitlements.ts` and are part of the
  admin control plane, not this domain.
- **Ads, coupons, and referrals** share the `BILLING_ENABLED` gate for
  acquisition but are otherwise their own concern; they are not yet documented.

## Related

- [ADR-004 — Free launch billing](../decisions/adr-004-free-launch-billing.md)
- [ADR-005 — Versioned entitlements and Google Play](../decisions/adr-005-versioned-entitlements-google-play.md)
- [ADR-006 — Authoritative Play verification](../decisions/adr-006-authoritative-play-verification.md)
- [Google Play billing DLQ runbook](../runbooks/play-billing-dlq.md)
- [API reference — Subscriptions, Plans and Billing](../reference/api.md)
- [Third-party and permission register](../governance/registers/third-party-and-permission-register.md)
