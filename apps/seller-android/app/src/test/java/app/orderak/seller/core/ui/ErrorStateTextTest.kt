package app.orderak.seller.core.ui

import app.orderak.seller.R
import org.junit.Assert.assertEquals
import org.junit.Test

/**
 * The cause an error screen names must be the real one. Only a lost connection
 * and a failing service have a kind of their own; a lapsed sign-in or a plan
 * limit is neither, and calling it "the service is not available" would send
 * the seller to wait for a service that is fine.
 */
class ErrorStateTextTest {

    @Test
    fun aLostConnectionIsNoConnectionWithItsOwnTitle() {
        assertEquals(
            ErrorStateText(ErrorStateKind.NoConnection, null, R.string.error_network),
            errorStateText("network"),
        )
    }

    @Test
    fun aFailingServiceIsServiceUnavailableWithItsOwnTitle() {
        for (code in listOf("http_503", "server", "ai_temporarily_unavailable")) {
            assertEquals(
                code,
                ErrorStateText(ErrorStateKind.ServiceUnavailable, null, R.string.error_state_try_again_later),
                errorStateText(code),
            )
        }
    }

    @Test
    fun anythingElseSaysTheOperationFailedAndGivesThatCodesRemedy() {
        // A switched-off feature is here too: "try again in a moment" would promise a recovery.
        for (code in listOf("recent_auth_required", "plan_limit_reached", "invalid_email", "feature_disabled", null)) {
            val text = errorStateText(code)
            assertEquals(code.toString(), R.string.error_state_request_failed_title, text.title)
            assertEquals(code.toString(), backendErrorResource(code), text.message)
        }
    }
}
