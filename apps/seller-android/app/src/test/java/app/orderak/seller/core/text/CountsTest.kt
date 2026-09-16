package app.orderak.seller.core.text

import app.orderak.seller.core.money.formatAmount
import java.text.Bidi
import java.util.Locale
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotEquals
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * Counts, and the row they share with an amount.
 *
 * The defect these cover is not that either number was wrong. Both were right;
 * they were written in different numeral systems in the same product card,
 * because the price went through `NumberFormat` and the stock went through
 * Kotlin string interpolation.
 */
class CountsTest {

    private val arabicEgypt = Locale.forLanguageTag("ar-EG")

    /** What `@Preview(locale = "ar")` and AppCompatDelegate actually hand a screen. */
    private val arabic = Locale.forLanguageTag("ar")

    private fun isArabicIndic(text: String) = text.any { it in '٠'..'٩' }

    @Test
    fun `english counts are latin digits`() {
        assertEquals("12", formatCount(12, Locale.US))
    }

    @Test
    fun `english counts group at a thousand`() {
        assertEquals("1,200", formatCount(1_200, Locale.US))
    }

    @Test
    fun `arabic counts are arabic-indic digits`() {
        val stock = formatCount(12, arabicEgypt)
        assertNotEquals("Arabic must not fall back to Latin digits", "12", stock)
        assertTrue("Expected Arabic-Indic digits, got: $stock", isArabicIndic(stock))
    }

    /** `ar` without a region is what a Compose preview and an in-process switch give. */
    @Test
    fun `the language alone is enough to pick the digits`() {
        assertTrue(isArabicIndic(formatCount(12, arabic)))
    }

    /**
     * The defect, stated as a test.
     *
     * A product card draws the price with `formatAmountLabel` and the stock with
     * `formatCount`. If those two disagree about the digits, the row mixes
     * numeral systems — which is exactly what it did, and what no test noticed,
     * because the two formatters had no test in common.
     */
    @Test
    fun `a count and an amount on the same row use the same digits`() {
        for (locale in listOf(Locale.US, Locale.FRANCE, arabic, arabicEgypt)) {
            val price = formatAmount(45_000, "EGP", locale)
            val stock = formatCount(12, locale)
            assertEquals(
                "Price '$price' and stock '$stock' disagree about digits in $locale",
                isArabicIndic(price),
                isArabicIndic(stock),
            )
        }
    }

    @Test
    fun `zero is a count like any other`() {
        assertEquals("0", formatCount(0, Locale.US))
        assertTrue(isArabicIndic(formatCount(0, arabicEgypt)))
    }

    // ---- used / limit ---------------------------------------------------

    @Test
    fun `the pair keeps the count before the limit`() {
        assertTrue(formatCountOfLimit(4, 20, Locale.US).startsWith("4"))
        assertTrue(formatCountOfLimit(4, 20, Locale.US).endsWith("20"))
    }

    @Test
    fun `the pair is arabic-indic under arabic`() {
        val pair = formatCountOfLimit(4, 20, arabicEgypt)
        assertTrue("Expected Arabic-Indic digits, got: $pair", isArabicIndic(pair))
        assertFalse("No Latin digits should survive: $pair", pair.any { it in '0'..'9' })
    }

    /**
     * The marks are the whole reason this is a function rather than a template.
     *
     * Arabic-Indic digits are bidi class AN, so the spaced slash between two of
     * them resolves to R and the paragraph renders "٢٠ / ٤" — twenty of four,
     * the two figures swapped. A left-to-right mark on each side of the
     * separator is the strong L that stops it. Dropping them leaves a string
     * that still reads correctly in every test that inspects it and renders
     * backwards on the screen, so the test has to name the characters.
     */
    @Test
    fun `the separator is fenced against bidi reordering`() {
        val pair = formatCountOfLimit(4, 20, arabicEgypt)
        assertTrue("Expected a left-to-right mark before the separator: $pair", "\u200E /" in pair)
        assertTrue("Expected a left-to-right mark after the separator: $pair", "/ \u200E" in pair)
        assertEquals("Exactly two marks, one per side", 2, pair.count { it == '\u200E' })
    }

    /** The marks are invisible, so stripping them must leave the readable string. */
    @Test
    fun `the marks carry no width of their own`() {
        assertEquals("4 / 20", formatCountOfLimit(4, 20, Locale.US).replace("\u200E", ""))
    }

    // ---- the reordering itself ------------------------------------------

    /**
     * What the bidi algorithm will actually put on the screen, left to right.
     *
     * Asserting on the string alone cannot see this defect: the characters are
     * in the right order in memory either way, and the swap happens in the
     * renderer. `java.text.Bidi` is the algorithm the renderer runs, so it is
     * an oracle a unit test can hold — a screenshot is the other one, and it
     * only covers the screens somebody remembered to render.
     */
    private fun visualOrder(text: String, paragraph: Int): String {
        val bidi = Bidi(text, paragraph)
        val levels = ByteArray(text.length) { bidi.getLevelAt(it).toByte() }
        val glyphs = Array<Any>(text.length) { text[it].toString() }
        Bidi.reorderVisually(levels, 0, glyphs, 0, text.length)
        return glyphs.joinToString("") { it as String }
    }

    private fun stripped(text: String) = text.replace("\u200E", "")

    @Test
    fun `the pair renders in logical order inside an arabic paragraph`() {
        val pair = formatCountOfLimit(4, 20, arabicEgypt)
        for (paragraph in listOf(Bidi.DIRECTION_LEFT_TO_RIGHT, Bidi.DIRECTION_RIGHT_TO_LEFT)) {
            assertEquals(
                "Reordered in paragraph direction $paragraph",
                stripped(pair),
                stripped(visualOrder(pair, paragraph)),
            )
        }
    }

    /**
     * The negative half, which is the only reason to trust the positive one.
     *
     * Without the marks the same figures render as "٢٠ / ٤" — twenty of four.
     * If this ever stops being true the marks have stopped being load-bearing
     * and `formatCountOfLimit` can be simplified; until then, deleting them
     * puts a wrong number in front of a seller without changing a single
     * assertion anywhere else in the app.
     */
    @Test
    fun `without the marks the two figures swap`() {
        val naive = "${formatCount(4, arabicEgypt)} / ${formatCount(20, arabicEgypt)}"
        assertNotEquals(
            "The marks in formatCountOfLimit are load-bearing; this is what happens without them",
            naive,
            visualOrder(naive, Bidi.DIRECTION_LEFT_TO_RIGHT),
        )
    }

    /** Latin digits never had the problem: W7 makes them strong inside an LTR run. */
    @Test
    fun `latin digits keep their order without any marks`() {
        assertEquals("4 / 20", visualOrder("4 / 20", Bidi.DIRECTION_LEFT_TO_RIGHT))
    }
}
