package app.orderak.seller.core.money

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotEquals
import org.junit.Assert.assertTrue
import org.junit.Test
import java.util.Locale

/**
 * The currency an amount is labelled with must be the currency it is in.
 *
 * Every screen in the app rendered money as one string resource, `currency_egp`,
 * reading "EGP %1$s". formatMoney has always read the exponent from the currency,
 * so a 15.000 KWD order printed its digits correctly and then called them pounds
 * — the one part of an amount that was not derived from the row.
 *
 * These assert on what the currency contributes rather than on an exact string:
 * the symbol and its placement come from ICU and shift between Android versions,
 * and pinning the whole rendering would make this a test of the platform's
 * locale data instead of a test of ours.
 */
class MoneyLabelTest {

    @Test
    fun `a Kuwaiti amount is not labelled in Egyptian pounds`() {
        val kwd = formatMoneyLabel(Money(15_000, "KWD"), Locale.US)
        val egp = formatMoneyLabel(Money(15_000, "EGP"), Locale.US)

        // The defect exactly: these two produced the same label.
        assertNotEquals(egp, kwd)
        assertTrue("KWD label should name KWD, got '$kwd'", kwd.contains("KWD"))
    }

    @Test
    fun `the exponent still comes from the currency`() {
        // 15000 minor units is 150 pounds and 15 dinars. The label must not
        // disturb what formatMoney already got right.
        assertTrue(formatMoneyLabel(Money(15_000, "EGP"), Locale.US).contains("150"))
        assertTrue(formatMoneyLabel(Money(15_000, "KWD"), Locale.US).contains("15"))
        assertEquals("15", formatMoney(Money(15_000, "KWD"), Locale.US))
    }

    @Test
    fun `a whole amount keeps no trailing zeros`() {
        // getCurrencyInstance would render "EGP 150.00"; every screen in the app
        // shows "150", and the label must not change that.
        assertTrue(formatMoneyLabel(Money(15_000, "EGP"), Locale.US).contains("150"))
        assertTrue(!formatMoneyLabel(Money(15_000, "EGP"), Locale.US).contains("150.00"))
    }

    @Test
    fun `every supported currency renders`() {
        // exponentOf throws on a currency java.util.Currency does not know, which
        // is deliberate — a default of 2 would render a plausible wrong number.
        // This is the assertion that the list and the platform agree.
        for (code in SUPPORTED_CURRENCIES) {
            val rendered = formatAmountLabel(1_000, code, Locale.US)
            assertTrue("$code rendered as '$rendered'", rendered.isNotBlank())
        }
    }

    @Test
    fun `the label follows the locale`() {
        // Arabic places the symbol after the number and uses Arabic-Indic digits.
        // Asserting only that the locale changes the output keeps this from
        // becoming a test of ICU's Arabic data.
        assertNotEquals(
            formatMoneyLabel(Money(15_000, "EGP"), Locale.US),
            formatMoneyLabel(Money(15_000, "EGP"), Locale.forLanguageTag("ar-EG")),
        )
    }
}
