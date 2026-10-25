package app.orderak.seller.core.ui

import android.app.Application
import androidx.compose.ui.semantics.SemanticsActions
import androidx.compose.ui.semantics.getOrNull
import androidx.compose.ui.test.assertCountEquals
import androidx.compose.ui.test.assertIsEnabled
import androidx.compose.ui.test.assertIsNotEnabled
import androidx.compose.ui.test.junit4.createComposeRule
import androidx.compose.ui.test.onAllNodesWithText
import androidx.compose.ui.test.onNodeWithText
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
 * What the sheets and the Snackbar promise beyond their size:
 *
 * - a destructive confirmation names the destructive verb, a regular one does not;
 * - while a confirmation is in progress both of its buttons are disabled;
 * - the Snackbar's action is a 48dp target, beside the message at normal text
 *   and below it, with the message at full width, at a large font scale.
 */
@RunWith(AndroidJUnit4::class)
@GraphicsMode(GraphicsMode.Mode.NATIVE)
@Config(sdk = [35], qualifiers = "en-w411dp-h891dp-xxhdpi", application = Application::class)
class SheetKitBehaviourAcceptanceTest {
    @get:Rule
    val rule = createComposeRule()

    private val application: Application get() = ApplicationProvider.getApplicationContext()

    @Test
    fun aDestructiveConfirmationUsesTheDestructiveVerb() {
        rule.showSheetPreview("confirmSheetDestructive", 1f)
        rule.onNodeWithText(application.getString(R.string.common_delete)).assertIsEnabled()
        rule.tagged("orderak.sheet.cancel").assertIsEnabled()
        rule.tagged("orderak.sheet.confirm").assertIsEnabled()
    }

    @Test
    fun aRegularConfirmationDoesNotUseTheDestructiveVerb() {
        rule.showSheetPreview("confirmSheetRegular", 1f)
        rule.tagged("orderak.sheet.confirm").assertIsEnabled()
        rule.onAllNodesWithText(application.getString(R.string.common_delete)).assertCountEquals(0)
    }

    @Test
    fun anInProgressConfirmationDisablesBothButtons() {
        rule.showSheetPreview("confirmSheetInProgress", 1f)
        rule.tagged("orderak.sheet.confirm").assertIsNotEnabled()
        rule.tagged("orderak.sheet.cancel").assertIsNotEnabled()
    }

    @Test
    fun theSnackbarActionIsA48dpTargetBesideTheMessageAtNormalText() {
        rule.showSheetPreview("snackbarUndo", 1f)
        val density = application.resources.displayMetrics.density
        val snackbar = rule.tagged("orderak.snackbar").fetchSemanticsNode().boundsInRoot
        val message = rule.tagged("orderak.snackbar.message").fetchSemanticsNode().boundsInRoot
        val action = rule.tagged("orderak.snackbar.action").fetchSemanticsNode()
        val target = action.touchBoundsInRoot
        assertTrue("action target ${target.width / density}x${target.height / density}dp", target.width >= 48f * density - 0.5f && target.height >= 48f * density - 0.5f)
        assertTrue("beside the message: action=$target message=$message", target.top < message.bottom && message.top < target.bottom)
        assertTrue("the message leaves room for the action: $message in $snackbar", message.width < snackbar.width * 0.8f)
    }

    @Test
    fun theSnackbarActionMovesBelowTheMessageAtLargeText() {
        rule.showSheetPreview("snackbarUndo", 2f)
        val density = application.resources.displayMetrics.density
        val snackbar = rule.tagged("orderak.snackbar").fetchSemanticsNode().boundsInRoot
        val message = rule.tagged("orderak.snackbar.message").fetchSemanticsNode().boundsInRoot
        val target = rule.tagged("orderak.snackbar.action").fetchSemanticsNode().touchBoundsInRoot
        assertTrue("action target ${target.width / density}x${target.height / density}dp", target.width >= 48f * density - 0.5f && target.height >= 48f * density - 0.5f)
        assertTrue("below the message: action=$target message=$message", target.top >= message.bottom - 1f)
        assertTrue("the message takes the full width: $message in $snackbar", message.width >= snackbar.width * 0.6f)
    }

    @Test
    fun aSnackbarWithoutAnActionDrawsNone() {
        rule.showSheetPreview("snackbarNoAction", 1f)
        rule.tagged("orderak.snackbar.message").fetchSemanticsNode()
        assertEquals(0, rule.onAllNodesWithTagCount("orderak.snackbar.action"))
    }

    private fun androidx.compose.ui.test.junit4.ComposeContentTestRule.onAllNodesWithTagCount(tag: String): Int =
        onAllNodes(androidx.compose.ui.test.hasTestTag(tag), useUnmergedTree = true)
            .fetchSemanticsNodes().size

    @Test
    fun theSnackbarActionCanBeClicked() {
        rule.showSheetPreview("snackbarFailureWithRetry", 1f)
        val action = rule.tagged("orderak.snackbar.action").fetchSemanticsNode()
        assertTrue("the action must be clickable", action.config.getOrNull(SemanticsActions.OnClick) != null)
    }

    @Test
    fun aLongListReachesTheBoundAndScrollsWithItsActionsInReach() {
        rule.showSheetPreview("pickerSheetSingleChoice", 2f)
        val available = rule.tagged("orderak.preview.available").fetchSemanticsNode().boundsInRoot
        val sheet = rule.tagged("orderak.sheet").fetchSemanticsNode().boundsInRoot
        val actions = rule.tagged("orderak.sheet.actions").fetchSemanticsNode().boundsInRoot
        assertTrue(
            "twelve rows at 200% must fill the sheet to its bound: sheet=$sheet available=$available",
            sheet.height >= available.height * 0.9f - 2f,
        )
        val content = rule.tagged("orderak.sheet.content").fetchSemanticsNode()
        assertTrue("the body must scroll", content.config.getOrNull(SemanticsActions.ScrollBy) != null)
        assertTrue("the actions stay on screen: $actions in $available", actions.bottom <= available.bottom + 1f)
    }
}
