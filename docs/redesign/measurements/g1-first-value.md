---
status: current
generated: false
owner: product
applies_to: [internal]
---
# G1 — a new seller reaches first value faster

The criterion, from `docs/redesign/master-redesign-prompt.md`:

> the count of taps and required fields between first launch and a published
> product with an image is measured before and after, and the after number is
> lower with no required field removed that a contract or a legal obligation
> requires. The onboarding draft stays resumable.

This is that measurement. Every number below is traced to the code that decides
it, because a tap count nobody can check is an opinion.

## The path, tap by tap

| # | Where | What the seller does | Taps | Required fields |
| --- | --- | --- | --- | --- |
| 1 | Splash | nothing — the entry decision routes itself | 0 | — |
| 2 | `AuthScreen` — `EnterPhone` | types the phone number, taps **Send code** | 1 | phone |
| 3 | `AuthScreen` — `EnterOtp` | types the code, taps **verify** | 1 | OTP |
| 4 | Passkey invite sheet | dismisses it (**conditional**) | 1 | — |
| 5 | Shop setup, step 1 (account) | types full name and birth year, taps **Next** | 1 | full name, birth year |
| 6 | Shop setup, step 2 (store) | types the shop name, slug and city, picks a category, taps **Start selling** | 2 | name, slug, category, city |
| 7 | اليوم | taps the **المتجر** surface in the navigation bar | 1 | — |
| 8 | المتجر | taps **➕** | 1 | — |
| 9 | `ProductEditScreen` | types name, price and stock, taps the image, taps **Save** | 2 | name, price, stock |

**9 taps in the app, 11 required fields.**

Sources, so the count can be re-taken rather than believed:

- Auth is two states, `AuthUiState.EnterPhone` and `AuthUiState.EnterOtp`
  (`feature/auth/AuthScreen.kt:126-127`); the country picker is a default, not a
  tap (`Countries.default`).
- The passkey sheet renders only when `state is AuthUiState.PasskeyInvite`
  (`AuthScreen.kt:142`), so its tap is conditional and is listed separately.
- Step 1's requirements are `canContinueAccount` — full name in `3..80`, a birth
  year in `1900..currentUtcYear()`, and `emailValid`, which treats a **blank**
  email as valid, so email is optional (`ShopSetupViewModel.kt:79-84`).
- Step 2's are `canFinishStore` — name in `2..60`, a slug matching
  `^[a-z0-9]+(?:-[a-z0-9]+)*$` **and** confirmed available, a non-blank category,
  a two-letter country, and a city of at least two characters
  (`ShopSetupViewModel.kt:85-91`). Country arrives from the phone's dial prefix,
  so it is preselected rather than filled.
- The product's are `canSave` — name of at least two characters, a parseable
  price, and a stock of zero or more (`ProductEditViewModel.kt:72-77`).
  Description, discount and **image** are all optional, which matters: the
  criterion says "a published product with an image", and the image is a choice
  the seller makes rather than a gate.

## Before and after

**Unchanged.** The six files that decide this path —
`ShopSetupScreen.kt`, `ShopSetupViewModel.kt`, `ProductEditScreen.kt`,
`ProductEditViewModel.kt`, `AuthScreen.kt`, `AuthPhoneForm.kt`,
`AuthOtpForm.kt` — carry **zero structural changes** against the pre-redesign
tree: no field, button, step or validation was added or removed. Their only edits
are design-system values (spacing and radius tokens) and the one wiring fix below.

So the "after" number is the same 9 taps and 11 required fields, and **G1's
criterion is not met**. Recording it as met would be the whole failure mode the
criterion exists to prevent.

## What the measurement found worth fixing

**One tap was being spent on a validation the app already had.** Step 1's button
was enabled on `!state.saving` alone, while step 2's consulted `canFinishStore` —
so the two steps of one screen disagreed about when a form is ready. Worse, the
step-1 predicate was already written and **had no reader anywhere in the app**:
`canContinueAccount` (`ShopSetupViewModel.kt:81`) was dead code. A seller who
mistyped their birth year tapped Next, waited for the round trip, and was told
what the client already knew.

The button now reads `state.canContinueAccount && !state.saving`. That removes the
failed tap and the error round-trip on every invalid account step, and makes the
two steps consistent. It removes no required field, so the criterion's constraint
is respected.

The existing screenshot fixture `setupAccountInvalidEmail` already renders the
invalid-email state; it now shows the disabled button, which is the behaviour this
fix introduces and what makes it reviewable.

## What is still on the table

These are the remaining ways to lower the number, largest first. None is applied
here, because each changes onboarding flow rather than wiring, and none has been
through the owner's eyes.

1. **End onboarding at the first product, not at اليوم.** After step 2 the seller
   lands on اليوم and then has to find المتجر (1 tap) and ➕ (1 tap) before they
   can add anything. Landing instead on the product editor would remove two taps
   from the path the criterion measures, and would not touch G2: that criterion is
   about what the اليوم surface shows when a seller is on it, not about always
   arriving there.
2. **Defer the passkey invite** until after first value. It is a security
   convenience, and it currently interrupts the one moment the criterion cares
   about. Worth 1 tap.
3. **The slug costs a round trip to confirm availability.** It is already
   automatic and does not gate a tap, but it is the slowest field on the path; a
   generated default the seller can accept would remove the typing rather than a
   tap.
4. **The store step asks for four things before the shop exists.** Category and
   city could default from the country and be changeable later, which would remove
   two required fields without removing anything a contract or a legal obligation
   requires.

## Re-taking this measurement

```powershell
cd apps/seller-android
# the flow's structural surface, against the tree the redesign started from
git diff -U0 -- '*ShopSetup*' '*ProductEdit*' '*Auth*' |
  Select-String 'OutlinedTextField|Button\(|step ==|canContinue|canFinish|canSave'
```

An empty result means the path is unchanged, which is exactly what it returned
while this document was written.
