---
status: current
generated: false
owner: backend
applies_to: [production, staging]
---
# ADR-002: Store all monetary values as integer piasters

**Status:** superseded

**Superseded by:** [ADR-009](adr-009-minor-units-with-explicit-currency.md)

**Date:** 2026-07-07

> Superseded on 2026-08-21. The integer-minor-units decision below still holds.
> What does not hold is fusing the currency and the exponent into the unit name:
> `_piasters` pins EGP and a divisor of 100, and Kuwait, Bahrain and Oman use
> 1000 minor units. See [ADR-009](adr-009-minor-units-with-explicit-currency.md).

## Context

Orderak handles Egyptian Pounds (EGP) for plan pricing, order totals, coupons,
and commissions. EGP is a decimal currency (1 EGP = 100 piasters), and
JavaScript's `number` type is IEEE 754 double-precision floating-point.

Floating-point arithmetic in billing systems is a known source of bugs:
`0.1 + 0.2 !== 0.3` in JavaScript, and accumulated rounding errors break
financial reconciliation.

Alternatives evaluated:

1. **JavaScript `number` with EGP decimals** (e.g. `150.00`): natural to read
   and write, but floating-point errors accumulate in totals, taxes, and
   commissions.
2. **String-based decimals** (e.g. `"150.00"`): safe but requires parsing and
   string arithmetic for every operation, and breaks SQL aggregation.
3. **Integer piasters** (e.g. `15000`): all values multiplied by 100, stored
   as integers. Arithmetic is exact, SQL aggregates work, and the conversion
   is trivial (divide by 100 for display).

## Decision

All monetary values in the codebase will be stored, transmitted, and computed
as **integer piasters** (EGP × 100). The suffix `_piasters` will be used on
all API fields, database columns, and variable names that hold monetary values.

## Consequences

### Positive

- **Exact arithmetic**: addition, subtraction, and integer multiplication are
  always precise. No floating-point drift.
- **SQL-friendly**: `SUM`, `GROUP BY`, and comparison operators work correctly
  on integers.
- **Stripe compatibility**: Stripe's API also uses integer minor units
  ("amount" in piasters for EGP), so no conversion is needed at the payment
  gateway boundary.
- **Clear intent**: the `_piasters` suffix makes the unit explicit — no
  ambiguity about whether a value is in EGP or piasters.

### Negative

- **Conversion overhead**: every UI display must divide by 100.
- **Input parsing**: user-entered amounts must be parsed from locale-aware
  formats and multiplied by 100, with validation against fractional piasters.
- **Mental overhead**: developers must remember that `9900` means 99 EGP,
  not 9900 EGP.

### Mitigations

- All API fields use the `_piasters` suffix.
- The Android app has a `formatPiasters` helper that handles division and
  locale-specific formatting.
- The glossary (`docs/reference/glossary.md`) defines piasters explicitly.

## Alternatives considered

| Alternative | Rejected because |
|------------|-----------------|
| Floating-point EGP | Rounding errors in financial computations |
| String decimals | SQL aggregation breaks; parsing overhead on every operation |
| BigNumber / Decimal.js | Adds a dependency; D1/SQLite doesn't support it server-side |
