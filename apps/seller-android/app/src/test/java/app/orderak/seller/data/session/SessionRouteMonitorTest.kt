package app.orderak.seller.data.session

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class SessionRouteMonitorTest {
    @Test
    fun `signal remains until matching acknowledgement`() {
        val monitor = SessionRouteMonitor()
        monitor.reportRestricted("suspended")
        val signal = monitor.signal.value!!

        assertEquals(SessionRouteSignalType.ACCOUNT_RESTRICTED, signal.type)
        assertEquals("suspended", signal.accountStatus)

        monitor.acknowledge(signal.id + 1)
        assertTrue(monitor.signal.value === signal)

        monitor.acknowledge(signal.id)
        assertNull(monitor.signal.value)
    }

    @Test
    fun `newer stable response replaces older pending signal`() {
        val monitor = SessionRouteMonitor()
        monitor.reportCredentialRejected()
        val firstId = monitor.signal.value!!.id
        monitor.reportRestricted("banned")

        val latest = monitor.signal.value!!
        assertTrue(latest.id > firstId)
        assertEquals(SessionRouteSignalType.ACCOUNT_RESTRICTED, latest.type)
        assertEquals("banned", latest.accountStatus)
    }
}
