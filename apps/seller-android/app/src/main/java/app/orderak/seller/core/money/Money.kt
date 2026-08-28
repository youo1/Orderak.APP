package app.orderak.seller.core.money

import java.text.NumberFormat
import java.util.Locale
import java.text.ParsePosition
import java.util.Currency as JavaCurrency
import kotlin.math.roundToLong

/**
 * Money as an amount plus a currency — never a bare number.
 *
 * Implements ADR-009, and mirrors `services/backend/src/platform/money/money.ts`.
 * The two cannot share code across Kotlin and TypeScript, so the shared artefact
 * is the API contract and these two files are kept deliberately parallel.
 *
 * What this replaces: `formatEgp(piasters)` and `parseEgpToPiasters(text)`,
 * which divided and multiplied by a literal 100. That is correct in Egypt and
 * wrong by a factor of ten in Kuwait, Bahrain and Oman, whose minor unit is a
 * thousandth:
 *
 *   15000 minor units  =  150.00 EGP
 *   15000 minor units  =   15.000 KWD
 *
 * `Countries.kt` already offers all three of those markets at sign-in.
 *
 * WHY THERE IS NO EXPONENT TABLE
 *   `java.util.Currency.getDefaultFractionDigits()` carries ISO 4217 exponents
 *   and has been available since API 1. A hand-written table would be a second
 *   source of truth that can only drift, and it would drift silently: a wrong
 *   exponent renders a plausible number rather than throwing.
 */

/** Currencies the app can render. Enabling one for sale is a server decision. */
val SUPPORTED_CURRENCIES = listOf("EGP", "SAR", "AED", "QAR", "KWD", "BHD", "OMR")

/**
 * An amount in the currency's smallest unit, plus the currency.
 *
 * `amountMinor` alone is meaningless: the same 15000 is 150 pounds or 15 dinars
 * depending on the field beside it.
 */
data class Money(val amountMinor: Long, val currency: String) {
    init {
        require(currency.length == 3) { "Currency must be an ISO 4217 alpha-3 code, got '$currency'" }
    }
}

/**
 * Minor units per major unit, read from ISO 4217 rather than declared.
 *
 * Throws on an unknown currency instead of defaulting to 2, because a default
 * turns "this currency was never added" into "every amount in it is wrong by a
 * factor of ten" — the exact failure this file exists to prevent.
 */
fun exponentOf(currency: String): Int =
    JavaCurrency.getInstance(currency).defaultFractionDigits

/**
 * Format for display, without the currency symbol.
 *
 * The screens wrap this in `R.string.currency_*`, so the symbol comes from the
 * string resources. The number of decimal places still comes from the currency.
 *
 * [locale] decides the digit shape and the grouping separator, and defaults to
 * the ambient one so existing callers are unchanged. A Compose caller should
 * pass the composition locale instead: the app switches language in-process via
 * AppCompatDelegate, and reading the ambient default there risks money keeping
 * Latin digits on a screen whose dates have already turned Arabic-Indic.
 */
fun formatMoney(money: Money, locale: Locale = Locale.getDefault()): String {
    val exponent = exponentOf(money.currency)
    val nf = NumberFormat.getNumberInstance(locale)
    nf.minimumFractionDigits = 0
    nf.maximumFractionDigits = exponent
    return nf.format(money.amountMinor / pow10(exponent))
}

/** Convenience for the common case of formatting a raw amount in a known currency. */
fun formatAmount(
    amountMinor: Long,
    currency: String,
    locale: Locale = Locale.getDefault(),
): String = formatMoney(Money(amountMinor, currency), locale)

/**
 * Parse a user-entered major-unit amount into minor units.
 *
 * The locale handling below is unchanged from `parseEgpToPiasters` and is
 * deliberately fussy — it was written against real input from Arabic, French and
 * numeric keyboards. Only the scaling factor is different: it comes from the
 * currency instead of a literal 100.
 */
fun parseMoney(text: String, currency: String): Money? {
    val trimmed = text.trim()
    if (trimmed.isEmpty()) return null

    // Numeric keyboards often emit a comma decimal even when the active locale
    // is English. Treat a one/two-digit suffix as decimals; keep "1,000" as a
    // locale-formatted grouping case.
    val commaSuffix = trimmed.substringAfterLast(',', missingDelimiterValue = "")
    val keyboardDecimal = if (
        ',' in trimmed && '.' !in trimmed && commaSuffix.length in 1..2 && commaSuffix.all(Char::isDigit)
    ) {
        trimmed.replace(',', '.').toDoubleOrNull()
    } else {
        null
    }

    // Parse with the active app locale first so Arabic/French digits and decimal
    // separators work. Require the entire input to be consumed.
    val position = ParsePosition(0)
    val localized = NumberFormat.getNumberInstance().parse(trimmed, position)
        ?.takeIf { position.index == trimmed.length }
        ?.toDouble()

    // Also accept a canonical dot decimal, which is common on numeric keyboards.
    val v = keyboardDecimal ?: localized ?: trimmed.toDoubleOrNull() ?: return null
    if (v < 0 || v.isNaN() || v.isInfinite()) return null
    // Round, don't floor — 4.35 must be 435 minor units, not 434. The server's
    // parseMoney() carries the same fix; this one found it first.
    return Money((v * pow10(exponentOf(currency))).roundToLong(), currency)
}

/**
 * Add amounts, refusing to mix currencies rather than producing a wrong total.
 */
operator fun Money.plus(other: Money): Money {
    require(currency == other.currency) { "Cannot add $currency to ${other.currency}" }
    return Money(amountMinor + other.amountMinor, currency)
}

/** Multiply by a whole quantity, as in a line item. */
operator fun Money.times(quantity: Int): Money = Money(amountMinor * quantity, currency)

/**
 * `Math.pow` on an Int exponent, kept exact.
 *
 * `10.0.pow(3)` is fine for the exponents ISO 4217 actually uses (0, 2 and 3),
 * but a table makes the intent obvious and removes any floating-point question
 * from a money path.
 */
private fun pow10(exponent: Int): Double = when (exponent) {
    0 -> 1.0
    2 -> 100.0
    3 -> 1000.0
    else -> throw IllegalArgumentException("Unsupported ISO 4217 exponent $exponent")
}

/** The app's default until a second market opens; see ADR-009. */
const val DEFAULT_CURRENCY = "EGP"
