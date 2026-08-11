package app.orderak.seller.feature.auth

import app.orderak.seller.core.phone.Countries
import app.orderak.seller.core.phone.Country
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * Highest-value Stage-1 tests: the auth state machine rules (Plan Stage 6 priorities).
 * Tests updated to use the Countries utility instead of deprecated EG_PHONE regex.
 */
class AuthViewModelTest {

    @Test
    fun `phone validation accepts valid EG numbers only`() {
        val egypt = Countries.byIso("EG")
        assertTrue(Countries.isValid(egypt, "01012345678"))
        assertTrue(Countries.isValid(egypt, "01112345678"))
        assertTrue(Countries.isValid(egypt, "01212345678"))
        assertTrue(Countries.isValid(egypt, "01512345678"))
        // Invalid lengths should fail
        assertFalse(Countries.isValid(egypt, "0101234567"))  // too short
        assertFalse(Countries.isValid(egypt, "010123456789"))// too long
        assertFalse(Countries.isValid(egypt, ""))  // empty
    }

    @Test
    fun `otp constants sane`() {
        assertEquals(6, AuthViewModel.OTP_LENGTH)
        assertTrue(AuthViewModel.RESEND_SECONDS >= 30)
    }

    @Test
    fun `six digits enable manual verification without auto submission`() {
        assertFalse(canVerifyOtp("12345", isVerifying = false))
        assertTrue(canVerifyOtp("123456", isVerifying = false))
        assertFalse(canVerifyOtp("123456", isVerifying = true))
    }

    @Test
    fun `otp input normalizes localized decimal digits for Firebase`() {
        assertEquals("123456", normalizeOtpDigits("١٢٣٤٥٦", AuthViewModel.OTP_LENGTH))
        assertEquals("123456", normalizeOtpDigits("۱۲۳۴۵۶", AuthViewModel.OTP_LENGTH))
        assertEquals("123456", normalizeOtpDigits(" 1-٢ 3٤5٦7", AuthViewModel.OTP_LENGTH))
    }
}
