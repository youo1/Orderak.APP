package app.orderak.seller.feature.payment

import app.orderak.seller.core.money.Money
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class PaymentVerifierTest {

    @Test
    fun `matches latin amount and extracts ref`() {
        val r = PaymentVerifier.evaluate(
            "تم تحويل مبلغ 250.00 جنيه بنجاح رقم العملية 123456789012",
            Money(25_000, "EGP"),
        ) { false }
        assertTrue(r.amountMatched)
        assertEquals("123456789012", r.ref)
        assertTrue(r.verified)
    }

    @Test
    fun `matches arabic digits with thousands separator`() {
        // ١٬٠٠٠ = 1,000 EGP — the ٬ (U+066C) must not break matching
        val r = PaymentVerifier.evaluate(
            "تم تحويل ١٬٠٠٠ جنيه رقم العملية ٩٨٧٦٥٤٣٢١٠",
            Money(100_000, "EGP"),
        ) { false }
        assertTrue(r.amountMatched)
        assertEquals("9876543210", r.ref)
    }

    @Test
    fun `wrong amount flags`() {
        val r = PaymentVerifier.evaluate("250.00 EGP ref 123456789", Money(30_000, "EGP")) { false }
        assertFalse(r.amountMatched)
        assertFalse(r.verified)
    }

    @Test
    fun `duplicate ref flags`() {
        val r = PaymentVerifier.evaluate("250.00 ref 123456789", Money(25_000, "EGP")) { true }
        assertTrue(r.amountMatched)
        assertTrue(r.duplicateRef)
        assertFalse(r.verified)
    }

    @Test
    fun `no ref found flags`() {
        val r = PaymentVerifier.evaluate("250.00 EGP", Money(25_000, "EGP")) { false }
        assertTrue(r.amountMatched)
        assertNull(r.ref)
        assertFalse(r.verified)
    }

    // ---- the exponent -----------------------------------------------------
    //
    // evaluate() used to take a Long named expectedTotalPiasters and divide it by
    // a literal 100. Kuwait, Bahrain and Oman have three decimal places and are
    // all in SUPPORTED_CURRENCIES, so every comparison in them was out by a
    // factor of ten — in both directions, which is the dangerous part: the right
    // receipt was rejected AND a receipt for a tenth of the amount was accepted.

    @Test
    fun `a three-decimal currency matches the amount actually written`() {
        // 15.750 KWD = 15750 fils. Under the old code this compared 15.750
        // against 157.50 and refused a correct receipt.
        val r = PaymentVerifier.evaluate("Transfer 15.750 KWD ref 123456789", Money(15_750, "KWD")) { false }
        assertTrue(r.amountMatched)
    }

    @Test
    fun `a three-decimal currency does not match the ten-times figure`() {
        // The mirror of the test above, and the one that costs money: a receipt
        // reading 1.575 KWD must not satisfy an order for 15.750.
        val r = PaymentVerifier.evaluate("Transfer 1.575 KWD ref 123456789", Money(15_750, "KWD")) { false }
        assertFalse(r.amountMatched)
    }

    @Test
    fun `a whole three-decimal amount matches when the receipt omits the decimals`() {
        val r = PaymentVerifier.evaluate("Transfer 12 KWD ref 123456789", Money(12_000, "KWD")) { false }
        assertTrue(r.amountMatched)
    }

    @Test
    fun `two decimals in a three-decimal currency are read as written, not padded left`() {
        // 15.75 KWD is 15750 fils, not 1575. Getting this wrong is how a
        // shortened receipt silently becomes a tenth of the price.
        val r = PaymentVerifier.evaluate("Transfer 15.75 KWD ref 123456789", Money(15_750, "KWD")) { false }
        assertTrue(r.amountMatched)
    }

    @Test
    fun `more decimals than the currency has is not an amount in it`() {
        // 250.001 is not an EGP amount. Rounding it to 250.00 would invent a
        // number nobody wrote, on the one code path deciding whether a receipt
        // matches an order.
        val r = PaymentVerifier.evaluate("250.001 EGP ref 123456789", Money(25_000, "EGP")) { false }
        assertFalse(r.amountMatched)
    }

    @Test
    fun `the same digits mean different amounts in different currencies`() {
        // The single clearest statement of the bug: one receipt, two currencies,
        // and the exponent is the only thing that decides.
        val text = "Transfer 1.500 ref 123456789"
        assertTrue(PaymentVerifier.evaluate(text, Money(1_500, "KWD")) { false }.amountMatched)
        assertFalse(PaymentVerifier.evaluate(text, Money(1_500, "EGP")) { false }.amountMatched)
    }

    @Test
    fun `a digit run too long to be an amount does not match or crash`() {
        // OCR of a reference number is a long digit run. Overflowing Long while
        // parsing it must be a non-match, not an exception on the seller's phone.
        val r = PaymentVerifier.evaluate("99999999999999999999 ref 123456789", Money(25_000, "EGP")) { false }
        assertFalse(r.amountMatched)
    }
}
