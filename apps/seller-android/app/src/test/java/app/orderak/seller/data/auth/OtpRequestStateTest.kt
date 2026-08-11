package app.orderak.seller.data.auth

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class OtpRequestStateTest {

    @Test
    fun `changing phone invalidates resend and verification id`() {
        val state = OtpRequestState(sessionTtlMs = 1_000)
        val first = state.begin("+201001112222", nowMs = 0)
        assertTrue(state.acceptVerificationId(first.generation, "first-id", nowMs = 1))

        val changed = state.begin("+201009998888", nowMs = 2)

        assertFalse(changed.mayReuseResendToken)
        assertNull(state.verificationId("+201001112222", nowMs = 3))
        assertNull(state.verificationId("+201009998888", nowMs = 3))
    }

    @Test
    fun `late callback cannot overwrite current request`() {
        val state = OtpRequestState(sessionTtlMs = 1_000)
        val old = state.begin("+201001112222", nowMs = 0)
        val current = state.begin("+201001112222", nowMs = 1)

        assertFalse(state.acceptVerificationId(old.generation, "old-id", nowMs = 2))
        assertTrue(state.acceptVerificationId(current.generation, "current-id", nowMs = 2))
        assertEquals("current-id", state.verificationId("+201001112222", nowMs = 3))
    }

    @Test
    fun `expired session cannot verify or reuse resend token`() {
        val state = OtpRequestState(sessionTtlMs = 100)
        val first = state.begin("+201001112222", nowMs = 0)
        assertTrue(state.acceptVerificationId(first.generation, "id", nowMs = 1))
        assertNull(state.verificationId("+201001112222", nowMs = 101))

        val retry = state.begin("+201001112222", nowMs = 101)
        assertFalse(retry.mayReuseResendToken)
    }
}
