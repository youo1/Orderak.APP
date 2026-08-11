---
status: current
generated: false
owner: android
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
- `Orderak` is the sole canonical non-translatable app name.

This profile is an implementation record, not a permanent limit on adding
languages. An approved locale migration must satisfy the invariant contract
and update the protected localization architecture and tests.
