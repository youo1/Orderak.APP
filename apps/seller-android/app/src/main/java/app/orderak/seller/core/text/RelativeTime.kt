package app.orderak.seller.core.text

import android.icu.text.DisplayContext
import android.icu.text.RelativeDateTimeFormatter
import android.icu.text.RelativeDateTimeFormatter.AbsoluteUnit
import android.icu.text.RelativeDateTimeFormatter.Direction
import android.icu.text.RelativeDateTimeFormatter.RelativeUnit
import android.icu.util.ULocale
import java.text.DateFormat
import java.util.Date
import java.util.Locale

private const val MINUTE_MS = 60_000L
private const val HOUR_MS = 60 * MINUTE_MS
private const val DAY_MS = 24 * HOUR_MS

/** An event within this long ago is "x ago"; an older one is a date, which does not change. */
private const val RELATIVE_FOR_DAYS = 7

/**
 * When something happened, the way a seller says it: "now", "5 minutes ago",
 * "3 hours ago", "2 days ago", and a date once it is more than a week old.
 *
 * The wording and the digits are the locale's own, from ICU, with the Arabic-Indic
 * digits asked for explicitly like every other figure here (see
 * [arabicIndicLocale]). The week limit is deliberate: "11 months ago" tells a
 * seller less than the date does, and a date does not change under a screenshot.
 */
fun formatAgo(then: Long, now: Long, locale: Locale): String {
    val diff = (now - then).coerceAtLeast(0L)
    if (diff >= RELATIVE_FOR_DAYS * DAY_MS) {
        return DateFormat.getDateInstance(DateFormat.SHORT, locale).format(Date(then))
    }
    val formatter = RelativeDateTimeFormatter.getInstance(
        ULocale.forLocale(arabicIndicLocale(locale)),
        null,
        RelativeDateTimeFormatter.Style.LONG,
        DisplayContext.CAPITALIZATION_NONE,
    )
    return when {
        diff < MINUTE_MS -> formatter.format(Direction.PLAIN, AbsoluteUnit.NOW)
        diff < HOUR_MS -> formatter.format((diff / MINUTE_MS).toDouble(), Direction.LAST, RelativeUnit.MINUTES)
        diff < DAY_MS -> formatter.format((diff / HOUR_MS).toDouble(), Direction.LAST, RelativeUnit.HOURS)
        else -> formatter.format((diff / DAY_MS).toDouble(), Direction.LAST, RelativeUnit.DAYS)
    }
}
