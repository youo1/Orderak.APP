package app.orderak.seller.data.auth

import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

class FirebaseAuthErrorMappingTest {

    @Test
    fun `expired Firebase OTP session is not reported as an invalid code`() {
        val mapped = mapOtpCredentialErrorCode("ERROR_SESSION_EXPIRED")

        assertTrue(mapped is AuthFailureException)
        assertEquals(AuthFailure.OTP_EXPIRED, (mapped as AuthFailureException).failure)
    }

    @Test
    fun `invalid Firebase OTP remains an invalid code`() {
        assertTrue(
            mapOtpCredentialErrorCode("ERROR_INVALID_VERIFICATION_CODE") is InvalidOtpException
        )
    }
}
