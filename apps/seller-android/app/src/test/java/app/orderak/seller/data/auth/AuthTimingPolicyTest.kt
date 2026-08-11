package app.orderak.seller.data.auth

import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

class AuthTimingPolicyTest {
    @Test
    fun `current Firebase timing profile remains explicit and bounded`() {
        assertEquals(60L, AuthTimingPolicy.SMS_RETRIEVAL_TIMEOUT_SECONDS)
        assertEquals(90_000L, AuthTimingPolicy.SEND_OPERATION_TIMEOUT_MS)
        assertEquals(10 * 60 * 1_000L, AuthTimingPolicy.OTP_SESSION_TTL_MS)
        assertTrue(
            AuthTimingPolicy.SEND_OPERATION_TIMEOUT_MS >=
                AuthTimingPolicy.SMS_RETRIEVAL_TIMEOUT_SECONDS * 1_000,
        )
    }
}
