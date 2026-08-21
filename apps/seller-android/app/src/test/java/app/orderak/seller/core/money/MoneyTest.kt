package app.orderak.seller.core.money

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertThrows
import org.junit.Assert.assertTrue
import org.junit.Test

class MoneyTest {

    @Test
    fun `parsing rounds instead of flooring`() {
        assertEquals(435L, parseMoney("4.35", "EGP")?.amountMinor)   // was 434 before Fix(#3)
        assertEquals(29L, parseMoney("0.29", "EGP")?.amountMinor)    // was 28
        assertEquals(25000L, parseMoney("250", "EGP")?.amountMinor)
        assertEquals(19999L, parseMoney("199.99", "EGP")?.amountMinor)
        assertEquals(435L, parseMoney("4,35", "EGP")?.amountMinor)   // comma decimal input
    }

    @Test
    fun `invalid inputs return null`() {
        assertNull(parseMoney("-1", "EGP"))
        assertNull(parseMoney("abc", "EGP"))
        assertNull(parseMoney("", "EGP"))
    }

    // The reason ADR-009 exists. A hardcoded /100 is not off by a rounding error
    // in these markets, it is off by a factor of ten — and Countries.kt already
    // offers all three at sign-in.
    @Test
    fun `exponent comes from the currency, not a constant`() {
        assertEquals(2, exponentOf("EGP"))
        assertEquals(2, exponentOf("SAR"))
        assertEquals(2, exponentOf("AED"))
        assertEquals(3, exponentOf("KWD"))
        assertEquals(3, exponentOf("BHD"))
        assertEquals(3, exponentOf("OMR"))
    }

    @Test
    fun `the same minor amount is a different major amount per currency`() {
        assertTrue(formatMoney(Money(15000, "EGP")).contains("150"))
        assertTrue(formatMoney(Money(15000, "KWD")).contains("15"))
        assertEquals(15000L, parseMoney("150", "EGP")?.amountMinor)
        assertEquals(150000L, parseMoney("150", "KWD")?.amountMinor)
    }

    @Test
    fun `parsing scales by the currency exponent`() {
        assertEquals(4356L, parseMoney("4.3555", "KWD")?.amountMinor)
        assertEquals(436L, parseMoney("4.3555", "EGP")?.amountMinor)
    }

    @Test
    fun `arithmetic refuses to mix currencies`() {
        assertEquals(350L, (Money(100, "EGP") + Money(250, "EGP")).amountMinor)
        assertThrows(IllegalArgumentException::class.java) {
            Money(100, "EGP") + Money(100, "KWD")
        }
    }

    @Test
    fun `a line item keeps its currency when multiplied`() {
        val line = Money(1500, "KWD") * 3
        assertEquals(4500L, line.amountMinor)
        assertEquals("KWD", line.currency)
    }

    @Test
    fun `a malformed currency code is rejected at construction`() {
        assertThrows(IllegalArgumentException::class.java) { Money(1, "EG") }
    }
}
