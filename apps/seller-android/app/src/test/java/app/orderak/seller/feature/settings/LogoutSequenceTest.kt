package app.orderak.seller.feature.settings

import kotlinx.coroutines.test.runTest
import org.junit.Assert.assertEquals
import org.junit.Test

class LogoutSequenceTest {
    @Test
    fun `a failing revocation does not stop the local teardown`() = runTest {
        // A seller signing out with no network must still be signed out on the
        // handset in front of them. The revocation is best effort by design, and
        // this is the assertion that keeps it from quietly becoming a gate.
        val events = mutableListOf<String>()

        runLogoutSequence(
            revokeCredential = { throw java.io.IOException("offline") },
            signOutProvider = { events += "provider" },
            clearBusinessData = { events += "database" },
            clearStoredImages = { events += "images" },
            clearEntitlements = { events += "entitlements" },
            clearSession = { events += "session" },
            clearDeviceSecret = { events += "secret" },
        )

        assertEquals(listOf("provider", "database", "images", "entitlements", "session", "secret"), events)
    }

    @Test
    fun `provider sign out precedes local cleanup`() = runTest {
        val events = mutableListOf<String>()

        runLogoutSequence(
            revokeCredential = { events += "revoke" },
            signOutProvider = { events += "provider" },
            clearBusinessData = { events += "database" },
            clearStoredImages = { events += "images" },
            clearEntitlements = { events += "entitlements" },
            clearSession = { events += "session" },
            clearDeviceSecret = { events += "secret" },
        )

        // Auth contract v8, guarantee 10. Both ends are load-bearing: the
        // revocation authenticates with the credential the middle of this
        // sequence destroys, and the stored secret is what it authenticates
        // with — so one must run first and the other last. Firebase sign-out
        // still precedes the database and session, which is the v7 ordering.
        assertEquals(
            listOf("revoke", "provider", "database", "images", "entitlements", "session", "secret"),
            events,
        )
    }
}
