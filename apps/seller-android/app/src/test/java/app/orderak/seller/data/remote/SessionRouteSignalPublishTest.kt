package app.orderak.seller.data.remote

import app.orderak.seller.core.network.ApiRoutes
import app.orderak.seller.data.session.SessionRouteMonitor
import app.orderak.seller.data.session.SessionRouteSignalType
import app.orderak.seller.data.session.appliesTo
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * What a credentialed response publishes, and — the part that shipped wrong —
 * which credential the published verdict is about.
 */
class SessionRouteSignalPublishTest {
    private val phone = "+201000000000"
    private val sentSecret = "11111111-1111-4111-8111-111111111111"
    private val laterSecret = "22222222-2222-4222-8222-222222222222"
    private val authProblem = """{"code":"auth","status":401}"""
    private val restrictedProblem = """{"code":"account_restricted","status":403,"resource_status":"suspended"}"""

    private fun publish(
        monitor: SessionRouteMonitor,
        code: Int,
        raw: String,
        path: String = ApiRoutes.v1("orders"),
        secret: String? = sentSecret,
        sentPhone: String? = phone,
    ) = publishSessionRouteSignal(monitor, code, path, sentPhone, secret, raw)

    @Test
    fun `a 401 is about the secret the request carried`() {
        val monitor = SessionRouteMonitor()
        publish(monitor, 401, authProblem)

        val signal = monitor.signal.value!!
        assertEquals(SessionRouteSignalType.CREDENTIAL_REJECTED, signal.type)
        assertTrue(signal.appliesTo(sentSecret))
        assertFalse(signal.appliesTo(laterSecret))
    }

    @Test
    fun `the logout revocation's 401 is about the retired secret only`() {
        val monitor = SessionRouteMonitor()
        publish(monitor, 401, authProblem, path = ApiRoutes.v1("auth/logout"))

        // After logout the device holds no secret, then a freshly minted one.
        assertFalse(monitor.signal.value!!.appliesTo(null))
        assertFalse(monitor.signal.value!!.appliesTo(laterSecret))
    }

    @Test
    fun `a 403 restriction carries its status and credential`() {
        val monitor = SessionRouteMonitor()
        publish(monitor, 403, restrictedProblem)

        val signal = monitor.signal.value!!
        assertEquals(SessionRouteSignalType.ACCOUNT_RESTRICTED, signal.type)
        assertEquals("suspended", signal.accountStatus)
        assertTrue(signal.appliesTo(sentSecret))
    }

    @Test
    fun `requests without seller credentials publish nothing`() {
        val monitor = SessionRouteMonitor()
        publish(monitor, 401, authProblem, secret = null)
        publish(monitor, 401, authProblem, secret = "")
        publish(monitor, 401, authProblem, sentPhone = null)

        assertNull(monitor.signal.value)
    }

    @Test
    fun `the account status probe never publishes`() {
        val monitor = SessionRouteMonitor()
        publish(monitor, 401, authProblem, path = ApiRoutes.v1("account/status"))

        assertNull(monitor.signal.value)
    }

    @Test
    fun `other errors and mismatched status codes publish nothing`() {
        val monitor = SessionRouteMonitor()
        publish(monitor, 403, authProblem)
        publish(monitor, 401, restrictedProblem)
        publish(monitor, 401, """{"code":"recent_auth_required"}""")
        publish(monitor, 500, authProblem)
        publish(monitor, 401, "<html>gateway</html>")

        assertNull(monitor.signal.value)
    }
}
