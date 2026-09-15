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

    /**
     * Each of these reached the seller as "Failed to send code. Try again."
     * before 2026-09-13, which is wrong advice: retrying cannot fix app
     * verification, and the wording blames the phone number instead.
     */
    @Test
    fun `app verification failures are named rather than collapsed into generic`() {
        for (
        code in listOf(
            "ERROR_APP_NOT_VERIFIED",
            "ERROR_WEB_CONTEXT_CANCELED",
            "ERROR_WEB_CONTEXT_ALREADY_PRESENTED",
        )
        ) {
            assertEquals(
                "$code must map to APP_VERIFICATION_FAILED",
                AuthFailure.APP_VERIFICATION_FAILED,
                mapAuthErrorCode(code),
            )
        }
    }

    @Test
    fun `codes that already mapped still map the same way`() {
        assertEquals(AuthFailure.INVALID_PHONE, mapAuthErrorCode("ERROR_INVALID_PHONE_NUMBER"))
        assertEquals(AuthFailure.TOO_MANY_REQUESTS, mapAuthErrorCode("ERROR_TOO_MANY_REQUESTS"))
        assertEquals(AuthFailure.TOO_MANY_REQUESTS, mapAuthErrorCode("ERROR_QUOTA_EXCEEDED"))
        assertEquals(AuthFailure.APP_VERIFICATION_FAILED, mapAuthErrorCode("ERROR_APP_NOT_AUTHORIZED"))
        assertEquals(AuthFailure.APP_VERIFICATION_FAILED, mapAuthErrorCode("ERROR_CAPTCHA_CHECK_FAILED"))
        assertEquals(
            AuthFailure.APP_VERIFICATION_FAILED,
            mapAuthErrorCode("ERROR_MISSING_CLIENT_IDENTIFIER"),
        )
    }

    /**
     * The fallback must stay a fallback. An unrecognised code is not an app
     * verification problem, and claiming otherwise would send a seller to the
     * Play Store over, say, a backend outage.
     */
    @Test
    fun `an unrecognised code stays generic`() {
        assertEquals(AuthFailure.GENERIC, mapAuthErrorCode("ERROR_SOMETHING_NOBODY_HAS_SEEN"))
    }
}
