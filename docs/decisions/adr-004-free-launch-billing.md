---
status: current
generated: false
owner: product
applies_to: [production, staging]
---
# ADR-004: Free launch with paid acquisition disabled

- Status: Accepted as engineering baseline; G4 business/legal/finance approval pending
- Date: 2026-07-18
- Owners: Product, finance, Egyptian counsel
- Scope: Play-distributed Android launch in Egypt

## Context

Orderak merchant subscriptions unlock digital cloud/app functionality. The
repository contains plan, coupon, referral, payment-gateway, and Android Billing
scaffolding, but it does not yet evidence a complete Play purchase-token to
backend verification, entitlement, acknowledgement, renewal, cancellation,
refund, and reconciliation lifecycle.

Google Play's current payments guidance treats cloud software, business
productivity software, app functionality, and subscriptions as digital services
that generally require an approved Play billing path for in-app sale, subject to
the policy and enrolled regional programs in effect at launch. Android's billing
security guidance places purchase verification and acknowledgement on a secure
backend. These current rules must be rechecked in Play Console before activation.

## Decision

The first public release is free. Paid acquisition is unavailable in the app and
through the public acquisition APIs:

- `BILLING_ENABLED` defaults to the string `false` in Worker configuration;
- `/api/v1/subscribe`, public plan acquisition, coupon, and referral acquisition
  endpoints fail closed with non-retryable `403 feature_disabled` unless the flag
  is exactly `true`; the route exists, but launch policy refuses acquisition, so
  clients must not treat this state as a temporary service outage;
- the unconnected Android Billing scaffold does not grant entitlement and no
  paid plan call-to-action is exposed;
- subscription status, cancellation, and signed webhook servicing remain
  available so a future rollback does not strand an existing payer;
- merchant-buyer payments for physical goods/services remain direct merchant
  transactions outside Orderak custody and are not Orderak subscription billing.

## Re-enable gate

Paid acquisition may be enabled only after a change record and written product,
finance, counsel, privacy, security, backend, mobile, QA, and release approval
confirm:

1. the then-current Play Console program and Egypt eligibility;
2. localized offer, price, renewal, cancellation, refund, tax, invoice, support,
   and account-deletion behavior;
3. purchase token submission to the backend; Google verification; account
   binding; acknowledgement; idempotent event handling; entitlement source of
   truth; renewal, grace, hold, cancel, revoke, refund, restore, and reconcile;
4. fraud, replay, cross-account, webhook, outage, rollback, monitoring, and
   evidence tests;
5. policy, terms, privacy, Data Safety, store listing, support SOP, and finance
   reconciliation alignment.

## Consequences

Launch revenue is deferred, but policy and entitlement risk is contained. Plan
tables and servicing code remain for controlled development. Setting the flag is
not sufficient approval; deployment evidence must point to the approved change
and G6 test pack.

## Authoritative references

- Google Play, Payments policy: https://support.google.com/googleplay/android-developer/answer/9858738
- Google Play, Understanding payments policy: https://support.google.com/googleplay/android-developer/answer/10281818
- Android Developers, Fight fraud and abuse: https://developer.android.com/google/play/billing/security
