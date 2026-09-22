package app.orderak.seller.core.text

import java.text.NumberFormat
import java.util.Locale

/**
 * A count, written the way the locale writes numbers.
 *
 * WHY THIS EXISTS
 *   `Money.kt` has read its digits from the locale since the order list shipped
 *   an Arabic-Indic date beside a Latin-digit amount. Counts never got the same
 *   treatment, so المتجر rendered a price through `formatAmountLabel` — "٤٥٠
 *   ج.م." — and the stock beside it through `Text("${p.stock}")`, which is
 *   Kotlin string interpolation and has no locale at all: "12". Two numeral
 *   systems, one row, on the primary surface of the app.
 *
 *   The same split was in `UsageMeter` ("4 / 20"), in the اليوم counters, in the
 *   order line quantities and in the basket stepper. It was not a decision
 *   anywhere: `NumberFormat` produces Arabic-Indic digits for `ar` because that
 *   is what CLDR says Egypt writes, and interpolation produces Latin ones
 *   because that is what `Int.toString()` does. Nobody chose either.
 *
 * WHICH FORM, AND WHY
 *   Locale-native — Arabic-Indic under `ar` — because that is what everything
 *   else in the app already does and the alternative is far larger than it
 *   looks. Going the other way means overriding CLDR for money
 *   (`NumberFormat.getCurrencyInstance`), for dates
 *   (`DateFormat.getDateTimeInstance`) and for every `%d` in `strings.xml`,
 *   i.e. forcing `-u-nu-latn` across the app — which re-creates, deliberately,
 *   the mixed row that `verify-money-locale.mjs` was written to prevent.
 *
 *   Egyptian sellers do read both, and Egyptian apps do often keep Latin digits
 *   for quantities. That convention is a mixed one: Latin quantities beside
 *   Arabic-Indic prices. It is the state this file removes, so adopting it
 *   would mean formalising the mix rather than picking a form.
 *
 * WHAT IS DELIBERATELY NOT A COUNT
 *   This formats quantities. A figure that is not one is outside the rule
 *   rather than an exception to it, and keeps whatever its own screen already
 *   does: the contents of an editable field stay plain Latin digits so that
 *   what the seller typed is what the parser reads back — `majorUnitsText`
 *   says the same thing about the price editor — and the dial code and the OTP
 *   boxes echo a keypad. `order_details_title` is still `%d`, so an order
 *   number follows the locale the way every other `%d` does; it is an
 *   identifier rather than a quantity, and nothing here moves it either way.
 *
 *   What the rule does forbid is one string carrying both forms, which was not
 *   hypothetical: `setup_step_indicator` read "خطوة %1$d من ٢" — the step
 *   through String.format and the total written out by hand.
 *
 * WHY THE LOCALE IS REQUIRED AND NOT DEFAULTED
 *   `formatAmount` and `formatMoney` default to `Locale.getDefault()`, which is
 *   right for a library and wrong for a screen — the app switches language
 *   in-process through AppCompatDelegate, so the ambient default can lag the
 *   composition by a whole screen. `verify-money-locale.mjs` exists to catch
 *   the call sites that take that default. Here the parameter has no default,
 *   so the compiler catches them instead and there is no guard to keep current.
 *
 *   Pass the locale the screen is drawing with:
 *     val locale = LocalConfiguration.current.locales[0]
 */
fun formatCount(value: Int, locale: Locale): String =
    NumberFormat.getIntegerInstance(locale).format(value.toLong())

/**
 * Left-to-right mark. Invisible, and strong enough to stop the bidi algorithm
 * reading the separator below as Arabic.
 */
private const val LTR_MARK = '\u200E'

/**
 * "٤ / ٢٠" — a count against a limit, in that order, in any paragraph direction.
 *
 * WHY THE MARKS
 *   `UsageMeter` already carried `textDirection = TextDirection.Ltr`, because
 *   left to the paragraph "14 / 20" reorders inside Arabic and renders as
 *   "20 / 14" — twenty of fourteen, the count and the limit swapped. That fix
 *   worked for Latin digits and stops working for Arabic-Indic ones, which is
 *   the trap in this change: Latin digits are bidi class EN and rule W7 turns
 *   them into strong L inside an LTR paragraph, so the spaced slash between
 *   them resolves to L and the run stays in logical order. Arabic-Indic digits
 *   are class AN. W7 does not apply to AN, so the slash resolves to R by N1 and
 *   the two numbers swap again — this time with the paragraph direction already
 *   forced, so the existing fix cannot catch it.
 *
 *   A left-to-right mark on each side of the separator is a strong L on both
 *   sides of the neutral run, which is what N1 needs to leave it alone. It
 *   holds in an RTL paragraph too, so this does not depend on the caller
 *   keeping `TextDirection.Ltr`.
 */
fun formatCountOfLimit(used: Int, limit: Int, locale: Locale): String =
    "${formatCount(used, locale)}$LTR_MARK / $LTR_MARK${formatCount(limit, locale)}"
