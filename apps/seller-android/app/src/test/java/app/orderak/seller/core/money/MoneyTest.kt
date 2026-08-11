package app.orderak.seller.core.money

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

class MoneyTest {

    @Test
    fun `parsing rounds instead of flooring`() {
        assertEquals(435L, parseEgpToPiasters("4.35"))   // was 434 before Fix(#3)
        assertEquals(29L, parseEgpToPiasters("0.29"))    // was 28
        assertEquals(25000L, parseEgpToPiasters("250"))
        assertEquals(19999L, parseEgpToPiasters("199.99"))
        assertEquals(435L, parseEgpToPiasters("4,35"))   // comma decimal input
    }

    @Test
    fun `invalid inputs return null`() {
        assertNull(parseEgpToPiasters("-1"))
        assertNull(parseEgpToPiasters("abc"))
        assertNull(parseEgpToPiasters(""))
    }
}
