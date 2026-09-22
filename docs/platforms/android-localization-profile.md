---
status: current
generated: false
owner: android
last_verified: 2026-09-16
applies_to: [production, staging]
authoritative_for: [android-localization-profile]
---
# Android Localization Profile

**Profile version:** 1  
**Invariant contract:**
[`../contracts/localization-invariants.md`](../contracts/localization-invariants.md)

The current Android runtime configuration remains:

- seller UI locales: Arabic, English, and French;
- unqualified/default resource locale: English;
- AGP-generated LocaleConfig with no manual locale XML;
- `AppCompatDelegate.setApplicationLocales` for per-app selection;
- language splits disabled so the explicit picker works offline;
- complete resource-key parity across `values`, `values-ar`, `values-en`, and
  `values-fr`;
- `Orderak` is the sole canonical non-translatable app name;
- quantities are formatted through `core/money/Money.kt` (amounts) and
  `core/text/Counts.kt` (counts), both of which take the composition locale
  rather than the ambient default.

## Numerals

Invariant 9 of the contract is implemented by passing
`LocalConfiguration.current.locales[0]` into `formatAmountLabel`,
`formatCount` and `formatCountOfLimit`. A quantity in a string resource is
therefore `%s` and never `%d`, which matters for two reasons beyond tidiness:

- `String.format` picks its digits from
  `Configuration.getLocales().get(0)`, so a `%d` under `ar` is Arabic-Indic on
  a device — but Layoutlib's `Resources.getString(id, args)` formats without a
  locale, so the same `%d` is Latin in a screenshot render. A `%d` quantity is
  therefore invisible to the screenshot harness, which is how المتجر shipped
  `فاضل 2` beside `٤٥٠ ج.م.` in its own reference PNG. `%s` plus an explicit
  formatter makes the render agree with the device.
- Arabic-Indic digits are bidi class `AN`, so a composite figure such as
  `٤ / ٢٠` reverses to `٢٠ / ٤` unless the separator is fenced with
  left-to-right marks. `formatCountOfLimit` does that fencing; `CountsTest`
  holds both halves of it against `java.text.Bidi`.

Three `%d` resources remain, and are outside invariant 9 rather than
exceptions to it: `order_details_title` (an order number), `auth_otp_digit_box`
and `auth_otp_progress` (a position within the code being typed). None of them
is a quantity and none mixes forms inside its own string.

`verify-money-locale.mjs` enforces the locale argument for the money
formatters. The count formatters need no guard: their `locale` parameter has no
default, so the compiler enforces it.

This profile is an implementation record, not a permanent limit on adding
languages. An approved locale migration must satisfy the invariant contract
and update the protected localization architecture and tests.
