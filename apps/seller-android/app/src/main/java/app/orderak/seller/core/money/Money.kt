package app.orderak.seller.core.money

import java.text.NumberFormat
import java.text.ParsePosition
import kotlin.math.roundToLong

/** Locale-aware EGP formatting from minor units (Plan §3.1). */
fun formatEgp(piasters: Long): String {
    val nf = NumberFormat.getNumberInstance()
    nf.minimumFractionDigits = 0
    nf.maximumFractionDigits = 2
    return nf.format(piasters / 100.0)
}

fun parseEgpToPiasters(text: String): Long? {
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
    // Fix(#3): round, don't floor — 4.35 must be 435 piasters, not 434
    return (v * 100).roundToLong()
}
