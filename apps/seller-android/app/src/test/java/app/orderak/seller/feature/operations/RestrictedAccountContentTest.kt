package app.orderak.seller.feature.operations

import android.app.Application
import androidx.compose.material3.MaterialTheme
import androidx.compose.ui.semantics.SemanticsProperties
import androidx.compose.ui.semantics.getOrNull
import androidx.compose.ui.test.assertCountEquals
import androidx.compose.ui.test.junit4.createComposeRule
import androidx.compose.ui.test.onAllNodesWithText
import androidx.compose.ui.test.onFirst
import androidx.compose.ui.test.onNodeWithTag
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.performClick
import androidx.test.core.app.ApplicationProvider
import androidx.test.ext.junit.runners.AndroidJUnit4
import app.orderak.seller.R
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.annotation.Config
import org.robolectric.annotation.GraphicsMode

/**
 * The restricted-account page tells the seller which of two things happened and
 * offers only what can help with that one.
 */
@RunWith(AndroidJUnit4::class)
@GraphicsMode(GraphicsMode.Mode.NATIVE)
@Config(sdk = [35], qualifiers = "ar-w411dp-h891dp-xxhdpi", application = Application::class)
class RestrictedAccountContentTest {
    @get:Rule
    val rule = createComposeRule()

    private val application: Application get() = ApplicationProvider.getApplicationContext()
    private fun string(id: Int) = application.getString(id)

    private var checks = 0
    private var contacts = 0
    private var deletions = 0
    private var logouts = 0

    private fun show(status: String) {
        rule.setContent {
            MaterialTheme {
                RestrictedAccountContent(
                    status = status,
                    onCheckAgain = { checks++ },
                    onContactSupport = { contacts++ },
                    onRequestDeletion = { deletions++ },
                    onLogout = { logouts++ },
                )
            }
        }
    }

    private fun assertShown(id: Int, count: Int = 1) =
        rule.onAllNodesWithText(string(id)).assertCountEquals(count)

    @Test
    fun aSuspensionOffersSupportAStatusCheckAndSignOutOnly() {
        show("suspended")
        assertShown(R.string.restricted_suspended_title)
        assertShown(R.string.restricted_contact)
        assertShown(R.string.restricted_check_status)
        assertShown(R.string.settings_logout)
        assertShown(R.string.restricted_request_review, 0)
        assertShown(R.string.restricted_delete_data, 0)
        assertShown(R.string.restricted_banned_title, 0)
    }

    @Test
    fun aBanOffersAReviewDeletionAndSignOutButNoStatusCheck() {
        show("banned")
        assertShown(R.string.restricted_banned_title)
        assertShown(R.string.restricted_request_review)
        assertShown(R.string.restricted_delete_data)
        assertShown(R.string.settings_logout)
        // Checking will not change a ban, so there is nothing to check.
        assertShown(R.string.restricted_check_status, 0)
        assertShown(R.string.restricted_contact, 0)
        assertShown(R.string.restricted_suspended_title, 0)
    }

    @Test
    fun aStatusTheServerNeverSentIsReadAsASuspension() {
        show("something_new")
        assertShown(R.string.restricted_suspended_title)
        assertShown(R.string.restricted_check_status)
    }

    @Test
    fun theButtonsDoWhatTheySay() {
        show("suspended")
        rule.onNodeWithText(string(R.string.restricted_contact)).performClick()
        rule.onNodeWithText(string(R.string.restricted_check_status)).performClick()
        assertEquals(1, contacts)
        assertEquals(1, checks)
    }

    @Test
    fun aBannedSellerCanAskForAReviewAndForDeletion() {
        show("banned")
        rule.onNodeWithText(string(R.string.restricted_request_review)).performClick()
        rule.onNodeWithText(string(R.string.restricted_delete_data)).performClick()
        assertEquals(1, contacts)
        assertEquals(1, deletions)
        assertEquals(0, checks)
    }

    @Test
    fun theTitleIsAHeading() {
        show("suspended")
        val node = rule.onNodeWithText(string(R.string.restricted_suspended_title)).fetchSemanticsNode()
        assertTrue(node.config.getOrNull(SemanticsProperties.Heading) != null)
    }

    @Test
    fun signingOutAsksFirstAndStatesTheConsequence() {
        show("suspended")
        rule.onAllNodesWithText(string(R.string.settings_logout)).onFirst().performClick()
        rule.waitForIdle()
        assertEquals("nothing is signed out before the seller says yes", 0, logouts)
        assertTrue(
            "the consequence is stated",
            rule.onAllNodesWithText(string(R.string.settings_logout_confirm)).fetchSemanticsNodes().isNotEmpty(),
        )
        rule.onNodeWithTag("orderak.sheet.confirm").performClick()
        rule.waitForIdle()
        assertEquals(1, logouts)
    }

    @Test
    fun cancellingTheSignOutQuestionSignsNobodyOut() {
        show("banned")
        rule.onAllNodesWithText(string(R.string.settings_logout)).onFirst().performClick()
        rule.waitForIdle()
        rule.onNodeWithTag("orderak.sheet.cancel").performClick()
        rule.waitForIdle()
        assertEquals(0, logouts)
        rule.onAllNodesWithText(string(R.string.settings_logout_confirm)).assertCountEquals(0)
    }
}
