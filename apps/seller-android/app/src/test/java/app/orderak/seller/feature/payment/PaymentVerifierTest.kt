package app.orderak.seller.feature.payment

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
            expectedTotalPiasters = 25000,
        ) { false }
        assertTrue(r.amountMatched)
        assertEquals("123456789012", r.ref)
        assertTrue(r.verified)
    }

    @Test
    fun `matches arabic digits with thousands separator`() {
        // ١٬٠٠٠ = 1,000 EGP — the ٬ (U+066C) must not break matching
        val r = PaymentVerifier.evaluate(
            "تم تحويل ١٬٠٠٠ جنيه — عملية ٩٨٧٦٥٤٣٢١٠",
            expectedTotalPiasters = 100000,
        ) { false }
        assertTrue(r.amountMatched)
        assertEquals("9876543210", r.ref)
    }

    @Test
    fun `wrong amount flags`() {
        val r = PaymentVerifier.evaluate("تحويل 200 جنيه عملية 123456789", 25000) { false }
        assertFalse(r.amountMatched)
        assertFalse(r.verified)
    }

    @Test
    fun `duplicate ref flags`() {
        val r = PaymentVerifier.evaluate("250 جنيه عملية 123456789", 25000) { true }
        assertTrue(r.duplicateRef)
        assertFalse(r.verified)
    }

    @Test
    fun `no ref found flags`() {
        val r = PaymentVerifier.evaluate("تم تحويل 250 جنيه", 25000) { false }
        assertNull(r.ref)
        assertFalse(r.verified)
    }
}
