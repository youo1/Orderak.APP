---
status: current
generated: false
owner: product
last_verified: 2026-09-16
applies_to: [production, staging]
authoritative_for: [localization-invariants]
---
# Localization Invariants

**Contract version:** 1  
**Applies to:** current Android seller UI and every future seller surface

This contract protects localization outcomes. The current Android resource and
locale API profile is documented in
[`../platforms/android-localization-profile.md`](../platforms/android-localization-profile.md).

## Required invariants

1. Every shipped UI locale has complete string/plural key and resource-type
   parity with the engineering fallback, excluding explicitly non-translatable
   brand assets.
2. Unsupported locales resolve to a documented fallback and never produce
   missing keys or mixed-language critical flows.
3. RTL and LTR layout behavior is tested; hardcoded directional layout and UI
   text are prohibited.
4. Seller-authored dynamic content remains the source of truth. The Worker uses
   stable codes and locale-aware dynamic content rather than embedding client UI
   sentences in API decisions.
5. Locale, storefront-content language, country, currency, and commercial
   market availability are independent concepts.
6. An advertised offline language remains available without a network fetch.
7. Adding a locale requires resources, legal and email content where applicable,
   backend dictionaries/schema support, tests, screenshots, and an explicit
   product-readiness decision.
8. Locale preferences contain no authentication authority and cannot change
   tenant, entitlement, or data ownership.
9. Quantities follow the locale's numeral system. Every amount, count, limit
   and date a seller reads uses the digits the active locale writes numbers
   with — Arabic-Indic under `ar` — and no surface shows two numeral systems
   for quantities. Figures that are not quantities (an order number, a dial
   code, a one-time code, the contents of an editable field) are outside this
   invariant and follow their own screen; no single string may mix the two
   forms.

## Change procedure

Platform locale sets and implementations may evolve through an approved
migration. The change must update the applicable platform profile, this
contract when an invariant changes, automated verification, screenshots, and
the product/API documentation in the same change.
