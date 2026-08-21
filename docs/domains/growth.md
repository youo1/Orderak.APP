---
status: current
generated: false
owner: backend
last_verified: 2026-08-21
applies_to: [production, staging]
authoritative_for: [growth-domain]
---
# Growth domain

Ads, coupons and referrals — the three mechanisms that acquire or monetise a
seller without charging them directly.

They are grouped here because they share a purpose, not an implementation.
Coupons and referrals live in `services/backend/src/domains/commerce/billing.ts`
and are gated with billing; ads live in
`services/backend/src/domains/commerce/ads.ts` and are **not**.

## Runtime state: ads are live, acquisition is not

This is the distinction that matters most in this domain, and it is easy to get
backwards.

| Mechanism | Routes | Gated by `BILLING_ENABLED`? |
| --- | --- | --- |
| Ads | `/api/v1/ads/active`, `/api/v1/ads/track` | **No** — serving now |
| Coupons | `/api/v1/coupons/validate`, `/api/v1/coupons/apply` | Yes — `403` today |
| Referrals | `/api/v1/referral/apply`, `/api/v1/referral/stats` | Yes — `403` today |

`BILLING_ACQUISITION_ROUTES` contains the four coupon and referral paths but no
ads path. That is deliberate: the free launch model is that **free sellers see
ads**, so disabling paid acquisition must not disable the thing that pays for
free accounts. See [billing](./billing.md#two-gates-not-one) for the gate
itself and [ADR-004](../decisions/adr-004-free-launch-billing.md) for the
launch position.

Coupons and referrals are effectively dormant: both only matter at the moment
of a paid purchase, and no purchase can happen while billing is closed.

## Ads

Tables: `ads`, `ad_impressions`.

**Eligibility is decided by the backend, not the client.** `/api/v1/ads/active`
resolves the seller's plan — active subscription first, then a `?plan=` hint,
then `free` — and serves an ad only when the plan has `ads_enabled`, or when
the plan is `free`. An ineligible caller gets `404 ad_not_eligible`, not an
empty list.

The client asks for a placement; it never decides whether it should see one.
That keeps ad policy in one place and means a modified app cannot suppress ads
by lying about its plan.

**Impression tracking is idempotent.** `/api/v1/ads/track` writes with
`INSERT OR IGNORE` keyed on `event_key`, so a retried or duplicated track
request cannot inflate the count. This matters because impression counts are
the billing basis for any future advertiser relationship — an at-least-once
delivery path writing an exactly-once record.

`ad_impressions` is deleted after 90 days by the retention sweep; see
[identity](./identity.md#retention).

The Android side is `core/ads/AdManager.kt` with an `AdProvider` seam, so the
serving provider can change without touching feature code.

## Coupons

Tables: `coupons`, `coupon_uses`.

One validation core is shared by `validate`, `apply` and `subscribe`. That is
the important structural property: a coupon cannot validate as good in the
preview call and then be applied under different rules at purchase, because
there is one implementation of "is this coupon valid".

Coupon discounts reduce the amount passed to the gateway. With `MockGateway`
the only implemented gateway, any coupon exercised today reduces a *simulated*
amount — see [billing](./billing.md#payment-gateways).

## Referrals

Tables: `referrals`, `affiliate_settings`.

A referral is created `pending` and becomes `qualified` only **after the
referred seller's first paid payment** — not at signup. The qualification step
credits the referrer and writes a `referral.qualified` audit event.

Delaying the credit to first payment is what makes the programme resistant to
self-referral and to signup farming: creating accounts costs nothing, so
nothing is paid for creating them.

`affiliate_settings.min_payout_minor` carries the payout threshold, renamed from
`min_payout_piasters` by migration `044` and now accompanied by an explicit
`currency` column.

Because qualification requires a paid payment and no payment can complete while
billing is closed, **no referral can currently qualify.** The pending rows are
real; the credits are unreachable.

## Boundaries

- **Plan definitions and what `ads_enabled` means per plan** are the
  [entitlements domain](./entitlements.md).
- **The gate, the gateway and the money** are the [billing domain](./billing.md).
- **Ad campaign administration** — creating ads, targeting, placements — is an
  administrator operation in the admin control plane, not yet documented.
- **Impression retention** is the retention sweep in
  [identity](./identity.md#retention), with the legal position in the
  [retention matrix](../governance/retention-matrix.md).

## Related

- [Billing domain](./billing.md)
- [Entitlements domain](./entitlements.md)
- [ADR-004 — Free launch billing](../decisions/adr-004-free-launch-billing.md)
- [Retention and deletion matrix](../governance/retention-matrix.md)
