package app.orderak.seller.core.money

import java.util.Locale
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotEquals
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * Money formatting across locales.
 *
 * `MoneyTest` covers rounding, currency exponents and parsing, and nothing
 * covered the locale. That gap is how a screen came to show an Arabic-Indic date
 * beside a Latin-digit amount in the same row: the date formatter is keyed on
 * the composition locale, the money formatter read the ambient default, and
 * nothing compared the two.
 */
class MoneyLocaleTest {

    private val arabicEgypt = Locale.forLanguageTag("ar-EG")

    @Test
    fun `english formats with latin digits and a comma group separator`() {
        assertEquals("1,200", formatAmount(120_000, "EGP", Locale.US))
    }

    @Test
    fun `french groups with its own separator rather than a comma`() {
        val french = formatAmount(120_000, "EGP", Locale.FRANCE)
        assertTrue("French grouping should not use a plain comma: $french", !french.contains(","))
        assertTrue("French should still render the digits: $french", french.contains("200"))
    }

    /**
     * The case the mismatch was visible in. Arabic (Egypt) renders Arabic-Indic
     * digits, so an amount formatted for it must not come back in Latin ones.
     */
    @Test
    fun `arabic egypt renders arabic-indic digits`() {
        val arabic = formatAmount(45_000, "EGP", arabicEgypt)
        assertNotEquals("Arabic must not fall back to Latin digits", "450", arabic)
        assertTrue(
            "Expected Arabic-Indic digits, got: $arabic",
            arabic.any { it in '٠'..'٩' },
        )
    }

    /**
     * The whole reason the parameter exists: the same amount must be able to
     * render differently per locale, rather than following one ambient default
     * for the life of the process.
     */
    @Test
    fun `the same amount differs between locales`() {
        assertNotEquals(
            formatAmount(45_000, "EGP", Locale.US),
            formatAmount(45_000, "EGP", arabicEgypt),
        )
    }

    /** Omitting the locale must behave exactly as it did before the parameter. */
    @Test
    fun `the default argument matches the ambient locale`() {
        assertEquals(
            formatAmount(45_000, "EGP", Locale.getDefault()),
            formatAmount(45_000, "EGP"),
        )
    }

    /**
     * The currency's exponent still decides the decimals, whatever the locale.
     *
     * 45_055 minor units rather than 45_050: minimumFractionDigits is 0, so a
     * trailing zero is dropped on purpose and 450.50 would render as "450.5" —
     * which says nothing about whether the second decimal place survived.
     */
    @Test
    fun `the currency exponent survives the locale`() {
        for (locale in listOf(Locale.US, Locale.FRANCE, arabicEgypt)) {
            val formatted = formatAmount(45_055, "EGP", locale)
            val digits = formatted.count { it.isDigit() || it in '٠'..'٩' }
            assertEquals("EGP keeps two decimals; $locale produced $formatted", 5, digits)
        }
    }

    /** A whole amount shows no decimal part at all. */
    @Test
    fun `whole amounts drop the decimals`() {
        assertEquals("450", formatAmount(45_000, "EGP", Locale.US))
    }
}
