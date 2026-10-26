package app.orderak.seller.core.text

import android.app.Application
import androidx.test.ext.junit.runners.AndroidJUnit4
import java.util.Locale
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotEquals
import org.junit.Assert.assertTrue
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.annotation.Config

/** When something happened, in words for a week and as a date after that. */
@RunWith(AndroidJUnit4::class)
@Config(sdk = [35], application = Application::class)
class RelativeTimeTest {
    private val now = 1_790_000_000_000L
    private val minute = 60_000L
    private val hour = 60 * minute
    private val day = 24 * hour

    private val en = Locale.forLanguageTag("en")
    private val ar = Locale.forLanguageTag("ar")

    @Test
    fun underAMinuteIsNow() {
        assertEquals("now", formatAgo(now - 20_000, now, en))
    }

    @Test
    fun minutesHoursAndDaysAreSaidAsSuch() {
        assertEquals("5 minutes ago", formatAgo(now - 5 * minute, now, en))
        assertEquals("3 hours ago", formatAgo(now - 3 * hour, now, en))
        assertEquals("2 days ago", formatAgo(now - 2 * day, now, en))
    }

    @Test
    fun oneHourReadsAsOne() {
        assertEquals("1 hour ago", formatAgo(now - hour - minute, now, en))
    }

    @Test
    fun arabicUsesArabicIndicDigitsAndArabicWords() {
        val text = formatAgo(now - 5 * minute, now, ar)
        assertTrue("digits are Arabic-Indic: $text", text.contains("٥"))
        assertTrue("words are Arabic: $text", text.contains("قبل"))
    }

    @Test
    fun aWeekOrMoreIsADateWhichDoesNotChange() {
        val first = formatAgo(now - 8 * day, now, en)
        val later = formatAgo(now - 8 * day, now + 400 * day, en)
        assertEquals(first, later)
        assertNotEquals("8 days ago", first)
    }

    @Test
    fun aTimeInTheFutureIsNowNotNegative() {
        assertEquals("now", formatAgo(now + hour, now, en))
    }
}
