package app.orderak.seller.core.ui

import android.app.Application
import androidx.compose.material3.Text
import androidx.compose.ui.test.hasClickAction
import androidx.compose.ui.test.junit4.createComposeRule
import androidx.compose.ui.test.onAllNodesWithText
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.performClick
import androidx.compose.ui.test.assertCountEquals
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
 * The gate's three states, as a seller meets them. Labels are read by resource
 * key, so the copy can change without these tests pinning it.
 */
@RunWith(AndroidJUnit4::class)
@GraphicsMode(GraphicsMode.Mode.NATIVE)
@Config(sdk = [35], qualifiers = "en-w411dp-h891dp-xxhdpi", application = Application::class)
class GateNoticeStatesTest {
    @get:Rule
    val rule = createComposeRule()

    private fun text(id: Int): String = ApplicationProvider.getApplicationContext<Application>().getString(id)

    @Test
    fun lockedWhilePurchaseIsOpenOffersThePlans() {
        var opened = false
        rule.setContent {
            GateNotice(availability = FeatureAvailability.LockedByPlan, onViewPlans = { opened = true })
        }
        rule.onNodeWithText(text(R.string.gate_locked_by_plan_title)).assertExists()
        rule.onNodeWithText(text(R.string.gate_upgrade_action)).performClick()
        assertTrue("The plans button must open the plans", opened)
    }

    @Test
    fun lockedWhilePurchaseIsClosedOffersNothingToPress() {
        rule.setContent { GateNotice(availability = FeatureAvailability.LockedByPlan) }
        rule.onNodeWithText(text(R.string.gate_locked_by_plan_title)).assertExists()
        rule.onAllNodes(hasClickAction()).assertCountEquals(0)
    }

    @Test
    fun notBuiltHasNoChipAndNoButtonEvenWhenAnUpgradeIsPassed() {
        rule.setContent {
            GateNotice(availability = FeatureAvailability.NotBuilt, onViewPlans = {})
        }
        rule.onNodeWithText(text(R.string.gate_not_built_title)).assertExists()
        rule.onAllNodes(hasClickAction()).assertCountEquals(0)
        rule.onAllNodesWithText(text(R.string.gate_upgrade_action)).assertCountEquals(0)
    }

    @Test
    fun availableDrawsTheFeatureItselfWithNoNotice() {
        rule.setContent {
            FeatureGate(availability = FeatureAvailability.Available, onUpgrade = {}) {
                Text("The feature")
            }
        }
        rule.onNodeWithText("The feature").assertExists()
        rule.onAllNodesWithText(text(R.string.gate_locked_by_plan_title)).assertCountEquals(0)
        rule.onAllNodesWithText(text(R.string.gate_not_built_title)).assertCountEquals(0)
    }

    @Test
    fun featureGateDrawsTheLockedNoticeInsteadOfTheFeature() {
        rule.setContent {
            FeatureGate(availability = FeatureAvailability.LockedByPlan) { Text("The feature") }
        }
        rule.onAllNodesWithText("The feature").assertCountEquals(0)
        rule.onNodeWithText(text(R.string.gate_locked_by_plan_title)).assertExists()
    }
}

/** D-15: the shared strings this task moves to Modern Standard Arabic. */
@RunWith(AndroidJUnit4::class)
@Config(sdk = [35], qualifiers = "ar", application = Application::class)
class FeedbackStandardArabicTest {
    private fun text(id: Int): String = ApplicationProvider.getApplicationContext<Application>().getString(id)

    @Test
    fun theLockedTitleAndTheRetryAreStandardArabic() {
        assertEquals("متاح في خطة أعلى", text(R.string.gate_locked_by_plan_title))
        assertEquals("إعادة المحاولة", text(R.string.common_retry))
    }
}

@RunWith(AndroidJUnit4::class)
@GraphicsMode(GraphicsMode.Mode.NATIVE)
@Config(sdk = [35], qualifiers = "en-w411dp-h891dp-xxhdpi", application = Application::class)
class EmptyAndErrorStateTest {
    @get:Rule
    val rule = createComposeRule()

    private fun text(id: Int): String = ApplicationProvider.getApplicationContext<Application>().getString(id)

    @Test
    fun anEmptyStateWithAnActionOffersExactlyThatAction() {
        var tapped = false
        rule.setContent {
            EmptyState(
                kind = EmptyStateKind.Empty,
                title = "Nothing yet",
                message = "Why and what next",
                actionLabel = "Do it",
                onAction = { tapped = true },
            )
        }
        rule.onNodeWithText("Why and what next").assertExists()
        rule.onNodeWithText("Do it").performClick()
        assertTrue(tapped)
    }

    @Test
    fun anEmptyStateWithoutAnActionHasNothingToPress() {
        rule.setContent { EmptyState(kind = EmptyStateKind.FilteredToNothing, title = "No match") }
        rule.onNodeWithText("No match").assertExists()
        rule.onAllNodes(hasClickAction()).assertCountEquals(0)
    }

    @Test
    fun anErrorStateNamesTheCauseByDefaultAndRetries() {
        var retried = false
        rule.setContent {
            ErrorState(kind = ErrorStateKind.NoConnection, message = "Check and retry", onRetry = { retried = true })
        }
        rule.onNodeWithText(text(R.string.error_state_no_connection_title)).assertExists()
        rule.onNodeWithText("Check and retry").assertExists()
        rule.onNodeWithText(text(R.string.common_retry)).performClick()
        assertTrue(retried)
    }

    @Test
    fun aServiceFailureHasItsOwnDefaultCause() {
        rule.setContent { ErrorState(kind = ErrorStateKind.ServiceUnavailable, message = "Later") }
        rule.onNodeWithText(text(R.string.error_state_service_unavailable_title)).assertExists()
        rule.onAllNodes(hasClickAction()).assertCountEquals(0)
    }
}
