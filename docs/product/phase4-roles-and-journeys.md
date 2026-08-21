---
status: current
generated: false
owner: product
applies_to: [internal]
---
# Phase 4 roles, permissions, journeys, and responsibilities

## Role and permission baseline

| Role | Identity and scope | Allowed launch actions | Explicit limits / approval |
| --- | --- | --- | --- |
| Buyer / guest | Unauthenticated public visitor | Browse a public store; submit an order request; use public legal, support, and deletion resources | No seller/admin API; cannot confirm payment or fulfilment; rate and input controls apply |
| Seller | Firebase-verified phone plus active device secret; one store scope | Manage its store, catalog, orders, customers, payout display fields, settings, support, and deletion request | Never access another store; cannot grant itself plan entitlement; direct buyer funds remain outside Orderak |
| Support admin | Admin JWT; `support` role | View/manage sellers and support; view subscriptions; manage announcements and email; view content and ads | No plan, coupon, payout, entitlement, role, or production configuration management |
| Finance admin | Admin JWT; `finance` role | View sellers; manage subscription records, plans, coupons, affiliate/payout records and finance email | Paid acquisition remains disabled; no support seller mutation or system-owner powers |
| Read-only reviewer | Admin JWT; `readonly` role | View approved dashboard, seller, billing, content, support, analytics, and audit resources | No mutation; export only where the implemented permission explicitly allows it |
| DPO / compliance reviewer | Named business role, not a distinct technical role | Review approved evidence and cases using minimum necessary read-only access | Must not share owner credentials; dedicated role/export is a G6 gap if readonly is insufficient |
| Owner / platform admin | Admin JWT; `owner` role | All implemented admin permissions; account and release control | Named, individual account; MFA and audit required before production; break-glass key is not normal access |
| Service job | Worker scheduler or controlled backend handler | Retention cleanup, sync, and other documented system work | Binding-scoped access only; no interactive user identity or undocumented data export |

The implemented technical admin roles are `owner`, `finance`, `support`, and
`readonly`. Business titles such as DPO, compliance, QA, or release manager do
not automatically create technical access.

## Seller journey

1. Seller reads the current terms/privacy versions, records required consent
   evidence and an independent marketing choice, and verifies its phone by SMS.
2. New seller creates the store profile; an existing seller follows the
   protected recovery rules and restores only its own store.
3. Seller creates categories and products, enters accurate prices and stock,
   uploads permitted images, and publishes the catalog link.
4. Seller receives buyer order requests, verifies availability and buyer details,
   accepts or rejects operationally, and advances only through allowed statuses.
5. Seller arranges payment and fulfilment directly with the buyer, handles
   warranties, returns, cancellations, and refunds for its sale, and uses buyer
   data only for lawful order fulfilment and approved communications.
6. Seller can contact support, update settings, log out, or request account
   deletion. Network/provider failures show a truthful retryable state.

Failure branches requiring test evidence include invalid/expired OTP, duplicate
callback, recovery on a replacement device, offline store/product edit, media
failure, product limit, invalid order transition, cross-store attempt, stale
order data, support escalation, and deletion-provider failure.

## Buyer journey

1. Buyer opens a public store link and receives Arabic or English based on the
   supported browser-language rules.
2. Buyer reviews merchant-authored product, price, availability, contact,
   fulfilment, return, and payment information.
3. Buyer submits the minimum order and contact data to the merchant. The page
   states that submission is an order request and does not prove acceptance,
   payment, reservation, or delivery.
4. Merchant confirms availability, total, direct payment method, fulfilment,
   cancellation, warranty, return, and refund terms with the buyer.
5. Buyer directs sale disputes to the merchant first and may report platform,
   privacy, security, or prohibited-content concerns to Orderak.

## Responsibility baseline

| Topic | Merchant | Orderak | Buyer |
| --- | --- | --- | --- |
| Product/content | Accuracy, legality, ownership, price, stock, images, claims | Hosting, reporting, review, takedown, evidence, appeal process | Lawful use; report suspected abuse |
| Merchant sale | Seller/merchant of record; confirms order | Software and order relay only | Provides accurate details; contracts with merchant |
| Buyer payment | Selects and operates lawful direct payment method; issues required evidence | Does not custody, route, settle, or guarantee merchant funds | Pays merchant directly after confirming terms |
| Fulfilment | Availability, acceptance, delivery/collection, warranty, returns, refund | Communicates platform limitations and receives platform complaints | Supplies delivery details and raises sale issues promptly |
| Buyer personal data | Determines lawful merchant use and communications; secures access | Processes platform data under the approved role/contract model | Provides necessary data and can use rights/support routes |
| Subscription to Orderak | Accepts only an approved future offer | First launch is free; future digital SaaS billing needs approved compliant flow | Not applicable |

Counsel and the DPO must confirm the final controller/processor, consumer,
invoice, complaint, warranty, return, and refund language before G4 approval and
before the seller agreement or public notice is treated as final.
