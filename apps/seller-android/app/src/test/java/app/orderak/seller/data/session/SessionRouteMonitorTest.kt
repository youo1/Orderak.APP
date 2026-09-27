package app.orderak.seller.data.session

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class SessionRouteMonitorTest {
    private val oldSecret = "11111111-1111-4111-8111-111111111111"
    private val newSecret = "22222222-2222-4222-8222-222222222222"

    @Test
    fun `signal remains until matching acknowledgement`() {
        val monitor = SessionRouteMonitor()
        monitor.reportRestricted("suspended", credentialFingerprint(oldSecret))
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
        monitor.reportCredentialRejected(credentialFingerprint(oldSecret))
        val firstId = monitor.signal.value!!.id
        monitor.reportRestricted("banned", credentialFingerprint(oldSecret))

        val latest = monitor.signal.value!!
        assertTrue(latest.id > firstId)
        assertEquals(SessionRouteSignalType.ACCOUNT_RESTRICTED, latest.type)
        assertEquals("banned", latest.accountStatus)
    }

    @Test
    fun `a rejection of the credential held now still applies`() {
        val monitor = SessionRouteMonitor()
        monitor.reportCredentialRejected(credentialFingerprint(newSecret))

        assertTrue(monitor.signal.value!!.appliesTo(newSecret))
    }

    @Test
    fun `a rejection of a retired credential does not apply to the new one`() {
        val monitor = SessionRouteMonitor()
        monitor.reportCredentialRejected(credentialFingerprint(oldSecret))

        assertFalse(monitor.signal.value!!.appliesTo(newSecret))
    }

    @Test
    fun `a restriction of a retired credential does not apply to the new one`() {
        val monitor = SessionRouteMonitor()
        monitor.reportRestricted("suspended", credentialFingerprint(oldSecret))

        assertFalse(monitor.signal.value!!.appliesTo(newSecret))
    }

    @Test
    fun `no signal applies to a signed-out device`() {
        val monitor = SessionRouteMonitor()
        monitor.reportCredentialRejected(credentialFingerprint(oldSecret))
        val signal = monitor.signal.value!!

        assertFalse(signal.appliesTo(null))
        assertFalse(signal.appliesTo(""))
    }

    /**
     * The defect as it shipped, step by step.
     *
     * A rejected credential is detected, the resolver runs the logout sequence,
     * and the sequence's revocation call — which authenticates with the rejected
     * secret by design — is itself rejected. That raises a second signal the
     * resolver never acknowledges, because it acknowledges only the id it read.
     * The seller signs in again; the leftover signal was then read as a
     * rejection of the brand-new credential and signed them straight back out.
     */
    @Test
    fun `the logout revocation's own 401 cannot sign the next session out`() {
        val monitor = SessionRouteMonitor()

        // 1. A background request with the old credential is rejected.
        monitor.reportCredentialRejected(credentialFingerprint(oldSecret))
        val readByResolver = monitor.signal.value!!

        // 2. The logout sequence revokes with the same credential: 401 again.
        monitor.reportCredentialRejected(credentialFingerprint(oldSecret))

        // 3. The resolver acknowledges the id it read; the newer one survives.
        monitor.acknowledge(readByResolver.id)
        val leftover = monitor.signal.value
        assertNotEquals(null, leftover)

        // 4. The seller signs in and the server provisions a new secret. The
        //    leftover must not describe it.
        assertFalse(leftover!!.appliesTo(newSecret))
    }

    @Test
    fun `fingerprints are stable, distinct, and not the secret`() {
        assertEquals(credentialFingerprint(oldSecret), credentialFingerprint(oldSecret))
        assertNotEquals(credentialFingerprint(oldSecret), credentialFingerprint(newSecret))
        assertFalse(credentialFingerprint(oldSecret).contains(oldSecret))
    }
}
