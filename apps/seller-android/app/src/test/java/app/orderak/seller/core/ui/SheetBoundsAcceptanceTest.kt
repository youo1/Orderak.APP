package app.orderak.seller.core.ui

import android.app.Application
import androidx.compose.ui.semantics.SemanticsActions
import androidx.compose.ui.semantics.getOrNull
import androidx.compose.ui.test.junit4.createComposeRule
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.ParameterizedRobolectricTestRunner
import org.robolectric.annotation.Config
import org.robolectric.annotation.GraphicsMode

/**
 * The sheet rules, checked on the kit's own approved previews at 100% and 200%:
 *
 * - a sheet is never taller than 90% of the height available to it;
 * - its actions stay pinned at its bottom edge, inside the available area;
 * - when the content is taller than the bound, it scrolls inside the sheet.
 *
 * The preview host tags the area a screen would give the sheet
 * (`orderak.preview.available`); the kit tags the sheet and its parts.
 */
@RunWith(ParameterizedRobolectricTestRunner::class)
@GraphicsMode(GraphicsMode.Mode.NATIVE)
@Config(sdk = [35], qualifiers = "en-w411dp-h891dp-xxhdpi", application = Application::class)
class SheetBoundsAcceptanceTest(
    private val preview: String,
    private val fontScale: Float,
) {
    @get:Rule
    val rule = createComposeRule()

    @Test
    fun theSheetStaysWithinNinetyPercentAndItsActionsStayPinned() {
        rule.showSheetPreview(preview, fontScale)
        val available = rule.tagged("orderak.preview.available").fetchSemanticsNode().boundsInRoot
        val sheet = rule.tagged("orderak.sheet").fetchSemanticsNode().boundsInRoot
        val actions = rule.tagged("orderak.sheet.actions").fetchSemanticsNode().boundsInRoot

        assertTrue(
            "$preview @$fontScale: the sheet ($sheet) is taller than 90% of $available",
            sheet.height <= available.height * 0.9f + 1f,
        )
        assertTrue("$preview @$fontScale: the sheet leaves the available area: $sheet", sheet.bottom <= available.bottom + 1f)
        assertEquals(
            "$preview @$fontScale: the actions must sit on the sheet's bottom edge",
            sheet.bottom,
            actions.bottom,
            1f,
        )
        assertTrue(
            "$preview @$fontScale: the actions ($actions) must be inside the sheet ($sheet)",
            actions.top >= sheet.top && actions.bottom <= sheet.bottom + 1f,
        )
    }

    @Test
    fun contentTallerThanTheBoundScrollsInsideTheSheet() {
        rule.showSheetPreview(preview, fontScale)
        val available = rule.tagged("orderak.preview.available").fetchSemanticsNode().boundsInRoot
        val sheet = rule.tagged("orderak.sheet").fetchSemanticsNode().boundsInRoot
        val atTheBound = sheet.height >= available.height * 0.9f - 2f
        if (atTheBound) {
            val content = rule.tagged("orderak.sheet.content").fetchSemanticsNode()
            assertTrue(
                "$preview @$fontScale: the sheet is at its bound, so its content must scroll",
                content.config.getOrNull(SemanticsActions.ScrollBy) != null,
            )
        }
    }

    companion object {
        private val previews = listOf(
            "bottomSheetActions",
            "pickerSheetSingleChoice",
            "pickerSheetSearchableWithManualEntry",
            "confirmSheetDestructive",
            "confirmSheetRegular",
            "confirmSheetInProgress",
        )

        @JvmStatic
        @ParameterizedRobolectricTestRunner.Parameters(name = "{0} @{1}")
        fun cases(): List<Array<Any>> =
            previews.flatMap { name -> listOf(1f, 2f).map { scale -> arrayOf<Any>(name, scale) } }
    }
}
