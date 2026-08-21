---
status: current
generated: false
owner: product
applies_to: [internal]
---
# Phase 4 data-to-feature and Android permission matrix

| Feature | Minimum data | Purpose | Access / recipient | Retention and control | Launch state |
| --- | --- | --- | --- | --- | --- |
| Seller authentication | Phone, Firebase ID token at registration/recovery, device secret, consent versions | Identity, account security, recovery | Firebase and Orderak backend | Protected auth rules; device secret never leaves approved client/backend path | In scope |
| Store profile | Store name, category, city/country, seller/contact and payout display fields, public ID | Operate and publish store | Seller, Orderak support as permitted, public fields to buyers | Seller update/delete; field classification and public preview required | In scope |
| Catalog | Product/category text, price minor units and currency, stock, images, translation provenance | Public catalog and order entry | Seller, public buyers, Cloudflare storage/processing | Source text controls; stale translation replacement; media deletion evidence | In scope |
| Buyer order | Buyer phone/name, items, quantity, price snapshot, payment-method label, note, status | Relay and manage order | Owning seller; minimum support access; buyer-facing submission | Store isolation; lawful retention and deletion rules pending DPO/counsel | In scope; legal retention pending |
| Customer view | Buyer identity/contact and order history derived from orders | Seller relationship and fulfilment history | Owning seller only; controlled support | No address-book ingestion; marketing requires separate lawful basis/suppression | In scope |
| Support/email | Contact, message/body, category, evidence, delivery events | Support, complaint, privacy and service communications | Support role and approved providers | Case retention, access, export and redaction rules required before pilot | In scope; operations gap |
| Admin/audit | Admin identity, role, session, action, entity, time, IP, error context | Security, accountability and operations | Authorized admins; security/compliance evidence | Least privilege, MFA, 30-day technical log cleanup where applicable | In scope |
| Merchant subscription billing | Plan, token/event, entitlement, cancellation/refund/reconciliation evidence | Charge for digital SaaS | Future Play/approved channel, backend and finance | Tax/refund/charge records after counsel/accountant approval | Deferred; acquisition disabled |
| Seller AI assistant | Prompt, reply, seller/account metadata and provider telemetry | Seller assistance | Future approved AI provider | Requires minimization, vendor/transfer, retention, security and notice approval | Deferred; API disabled |

## Android permission matrix

| Permission/capability | Launch decision | Reason / alternative |
| --- | --- | --- |
| `android.permission.INTERNET` | Allowed and required | Backend, Firebase auth, public links, and media use network access |
| Contacts | Prohibited | Buyer/customer data comes from orders or manual seller entry; no address-book collection |
| Fine/coarse/background location | Prohibited | City/country and address are seller-entered; no device location needed |
| SMS/read SMS/call log/phone state | Prohibited | Firebase verification uses its SDK flow without app access to message/call history |
| Camera/photos/storage | Not approved for launch as a manifest permission | Use system picker/capture contracts that grant scoped URI access if product image flow requires it |
| Notifications | Not approved in the frozen baseline | Current sync/pull flow operates without launch notification permission; add only by change request |
| Advertising ID | Prohibited | No behavioral advertising requirement is approved |

The release manifest must be inspected after dependency merging. A dependency
that introduces a permission is a scope change even when application source did
not declare it directly.

## Data and feature gates

- New fields require purpose, classification, visibility, lawful model, owner,
  validation, retention/deletion, export, incident, vendor, and Data Safety review.
- Public fields must be distinguishable from private seller/admin fields in the
  model and UI; payout display fields require a preview and seller warning.
- Buyer data must be store-scoped at every query and never used for marketing
  merely because it was provided for an order.
- AI and paid billing flags remain off until their vendor/data/retention and
  end-to-end control evidence is approved.
