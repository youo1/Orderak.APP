package app.orderak.seller.feature.auth

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

/** Contract v10: the sixth digit verifies by itself; a shorter code never does. */
class OtpAutoVerifyTest {
    @Test
    fun `six digits complete the code`() {
        assertTrue(AuthViewModel.completesCode("123456"))
    }

    @Test
    fun `fewer digits do not`() {
        assertFalse(AuthViewModel.completesCode(""))
        assertFalse(AuthViewModel.completesCode("12345"))
    }

    @Test
    fun `the code length is still six`() {
        assertEquals(6, AuthViewModel.OTP_LENGTH)
    }

    @Test
    fun `the explicit Verify action still needs a whole code and no verification in flight`() {
        assertTrue(canVerifyOtp("123456", isVerifying = false))
        assertFalse(canVerifyOtp("123456", isVerifying = true))
        assertFalse(canVerifyOtp("12345", isVerifying = false))
    }
}
