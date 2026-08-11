package app.orderak.seller.feature.settings

import kotlinx.coroutines.test.runTest
import org.junit.Assert.assertEquals
import org.junit.Test

class LogoutSequenceTest {
    @Test
    fun `provider sign out precedes local cleanup`() = runTest {
        val events = mutableListOf<String>()

        runLogoutSequence(
            signOutProvider = { events += "provider" },
            clearBusinessData = { events += "database" },
            clearEntitlements = { events += "entitlements" },
            clearSession = { events += "session" },
        )

        assertEquals(
            listOf("provider", "database", "entitlements", "session"),
            events,
        )
    }
}
