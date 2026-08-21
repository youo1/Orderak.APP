---
status: draft
generated: false
owner: backend
applies_to: [production, staging]
---
# ADR-009: Store monetary values as integer minor units with an explicit currency

**Status:** proposed

**Date:** 2026-08-21

**Supersedes:** ADR-002

**Superseded by:** none

## Context

ADR-002 decided that money is stored as integer minor units rather than
floating-point. That part was right and is not revisited here: floating-point
arithmetic in billing is a known defect source, integers aggregate correctly in
SQL, and payment gateways speak minor units.

What ADR-002 got wrong is that it fused two separate facts into one value. A
monetary amount needs three things to be interpreted: a number, a currency, and
the number of minor units per major unit (the *exponent*). ADR-002 fixed all
three at once by naming the unit `piasters`, which silently pins the currency to
EGP and the exponent to 2.

The roadmap makes both assumptions false. The product targets Egypt first, then
the Gulf. `Countries.kt` already ships a curated sign-in list of
`EG SA AE KW QA BH OM JO IQ`, so the client is further ahead than the money
model. Three of those markets do not have exponent 2:

| Currency | Market | Minor units per major |
| --- | --- | --- |
| EGP, SAR, AED, QAR | Egypt, Saudi Arabia, UAE, Qatar | 100 |
| **KWD, BHD, OMR** | **Kuwait, Bahrain, Oman** | **1000** |

Every `/ 100` and `* 100` in the codebase is wrong in Kuwait, Bahrain, and
Oman — not by a rounding error, but by a factor of ten. `Money.kt` divides by a
literal `100.0`.

### Present state, measured 2026-08-21

- **9 money columns across 9 tables**, every one suffixed `_piasters`, read
  from the schema after applying all 43 migrations to a local D1 rather than
  counted from the migration files: `affiliate_settings.min_payout_piasters`,
  `items.price_piasters`, `order_items.price_piasters`, `orders.total_piasters`,
  `payment_events.amount_piasters`, `plans.price_piasters`,
  `products.price_piasters`, `referrals.commission_piasters`,
  `subscriptions.amount_piasters`.

  A count taken from the migration files instead gives 19, because a table
  rebuilt by a later migration is declared more than once. The applied schema is
  the figure that matters, and `items` within it is dead — no query in
  `services/backend/src` reads or writes it.
- **192 code sites** mention piasters or EGP: 112 in the backend (heaviest:
  `commerce/billing.ts` 30, `catalog/catalog.ts` 23), 76 in the Android app,
  4 in admin-web.
- **A `currency` column exists on `plans` only**, as `TEXT NOT NULL DEFAULT
  'EGP'` — a default, not a dimension.
- **The API contract does not mention money at all.** A raw text search over
  the built specs finds zero occurrences of `price`, `amount`, `total`,
  `piaster`, or `currency`. Every success response is `GenericSuccess`
  (`{"ok": true}` with `additionalProperties: true`), so no client can learn a
  currency from the contract even if the server sent one.
- **`multi_currency` already exists as an entitlement** with
  `implementation_status: 'planned'`, disabled on every plan revision. The gap
  is known; it is simply not built.

### Two factual errors in ADR-002, recorded here rather than edited away

- ADR-002 states the Android app "has a `formatPiasters` helper". No such
  function exists. `core/money/Money.kt` defines `formatEgp(piasters: Long)`
  and `parseEgpToPiasters(text: String)` — names that hardcode the currency,
  which is the defect this ADR addresses.
- ADR-002 cites "Stripe compatibility" as a positive consequence. Stripe is not
  integrated: `commerce/payments.ts` ships a `MockGateway`, and `StripeGateway`
  exists only as a commented-out line and an optional `STRIPE_SECRET_KEY`. The
  live billing path is Google Play. The underlying claim — that gateways use
  integer minor units — is true and generalises, but it was not evidence for
  the `_piasters` naming.

### Why now

The cost of this change is at its minimum today and rises monotonically. There
are no users, no live money rows, and 45 migrations already exist. After launch
the same change is a migration of live financial records, which is the worst
class of migration to run.

`ALTER TABLE ... RENAME COLUMN` and `ALTER TABLE ... ADD COLUMN ... NOT NULL
DEFAULT` were both verified against a local D1 instance on 2026-08-21 and
succeed. The rename does not require the twelve-step table-rebuild procedure
used elsewhere in `migrations/`.

## Decision

A monetary value is a pair, never a bare number:

```sql
{ amount_minor: INTEGER, currency: TEXT }   -- currency is an ISO 4217 alpha-3 code
```

1. **The exponent is a property of the currency, never a literal.** A single
   currency table maps `EGP → 2`, `SAR → 2`, `AED → 2`, `QAR → 2`,
   `KWD → 3`, `BHD → 3`, `OMR → 3`. `/ 100` and `* 100` do not appear in
   application code. Adding a market means adding a row, not auditing call
   sites.

2. **Columns are named `{concept}_minor`**, not `{concept}_piasters`. The unit
   is "minor units of the accompanying currency"; the currency says which.

3. **Currency is stored once per owning entity, not once per amount.** A store,
   an order, a plan revision, and a subscription each transact in exactly one
   currency, so `orders.currency` covers `orders.total_minor` and every
   `order_items.price_minor` beneath it. Duplicating currency onto each amount
   column invites rows whose columns disagree.

4. **The API transmits money as an object**, never as a bare integer:

   ```json
   { "amount_minor": 15000, "currency": "EGP" }
   ```

   A client that receives an integer alone cannot format it, and a client that
   infers the currency from its own locale will be wrong for a seller serving
   customers abroad.

5. **Formatting and parsing are currency-driven at both edges.** `formatEgp` /
   `parseEgpToPiasters` are replaced by functions that take a `Money` and a
   locale. Formatting uses the platform's currency-aware formatter, which also
   fixes symbol placement and digit shaping for `ar-EG` versus `ar-SA`.

6. **`EGP` remains the only enabled currency until the second market opens.**
   This ADR changes the *representation*, not the set of supported markets.
   Enabling a currency is then a data change, gated by the existing
   `multi_currency` entitlement.

## Consequences

### Positive

- Kuwait, Bahrain, and Oman become reachable without touching arithmetic.
- The unit stops being encoded in identifiers, so a currency change is data,
  not a refactor.
- The `multi_currency` entitlement gains a real implementation to point at.
- Backfill is exact: every existing row is EGP, so `DEFAULT 'EGP'` is correct
  by construction rather than by assumption — a property that disappears the
  day a second currency exists.

### Negative

- 9 columns and 192 call sites change. The rename is mechanical, but the call
  sites need review rather than search-and-replace, because some divide by 100
  and some do not.
- Android and backend cannot share the implementation: one is Kotlin, one is
  TypeScript. The shared artefact is the API contract, which means this ADR
  depends on the contract actually modelling payloads — see the note below.
- Two representations coexist during the migration. The window must be short.

### Risks

- **The contract cannot express this today.** Every success response is
  `GenericSuccess` with `additionalProperties: true`, and `bootstrap-specs.mjs`
  regenerates `src/*.json` with a plain `writeFileSync`, so a hand-written
  schema is destroyed on the next run. Point 4 of this decision is unenforceable
  until payload modelling exists. That is a separate decision and this ADR does
  not pre-empt it; it does record that the two must land together, because both
  touch the same 9 columns and 192 call sites and doing them separately pays
  that cost twice.
- **Rounding rules are not specified here.** Percentage commissions and
  discounts on a 3-decimal currency need a stated rounding mode. That belongs
  in the implementation, and must be decided before the first non-EGP market,
  not after.

## Alternatives considered

| Alternative | Rejected because |
| --- | --- |
| Keep `_piasters`, add a currency column | The name still asserts exponent 2. A `price_piasters` holding 1000 fils is a lie in the schema, and every reader has to know it |
| Store a decimal string with the currency | Reintroduces parsing on every operation and breaks SQL aggregation — ADR-002 rejected this correctly and that reasoning still holds |
| Normalise everything to one currency at write time | Loses the transacted amount, which is the legally meaningful figure on an invoice |
| Defer until the Gulf launch is scheduled | The change is cheap only while there are no live money rows. Deferring converts a mechanical rename into a financial-data migration |
| Store the exponent per row alongside the amount | Redundant with the currency and lets a row contradict ISO 4217 |
