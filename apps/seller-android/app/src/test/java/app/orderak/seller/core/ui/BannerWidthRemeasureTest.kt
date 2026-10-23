package app.orderak.seller.core.ui

import android.app.Application
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.width
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.test.junit4.createComposeRule
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.unit.Density
import androidx.compose.ui.unit.dp
import androidx.test.ext.junit.runners.AndroidJUnit4
import org.junit.Assert.assertTrue
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.annotation.Config
import org.robolectric.annotation.GraphicsMode

/**
 * The Banner decides once whether its action sits beside the text or below it.
 * That decision must be taken again when the Banner gets narrower: a rotation,
 * a split screen or a resized window changes the width without changing the
 * text, and a message measured on a wide row can need far more lines on a
 * narrow one.
 */
@RunWith(AndroidJUnit4::class)
@GraphicsMode(GraphicsMode.Mode.NATIVE)
@Config(sdk = [35], qualifiers = "en-w411dp-h891dp-xxhdpi", application = Application::class)
class BannerWidthRemeasureTest {
    @get:Rule
    val rule = createComposeRule()

    @Test
    fun narrowingTheBannerAt200PercentMovesTheActionBelowTheMessage() {
        var width by mutableStateOf(400.dp)
        rule.setContent {
            val density = LocalDensity.current
            CompositionLocalProvider(LocalDensity provides Density(density.density, fontScale = 2f)) {
                Box(Modifier.width(width)) {
                    Banner(
                        state = BannerState.Warning,
                        title = "Limit",
                        message = "Orders this month",
                        actionLabel = "Plans",
                        onAction = {},
                    )
                }
            }
        }
        rule.waitForIdle()
        width = 200.dp
        rule.waitForIdle()

        val message = rule.onNodeWithText("Orders this month").fetchSemanticsNode().boundsInRoot
        val action = rule.onNodeWithText("Plans").fetchSemanticsNode().boundsInRoot
        assertTrue(
            "After narrowing, the 200% text needs more than three lines, so the action must sit " +
                "below the message; action=$action message=$message",
            action.top >= message.bottom,
        )
    }
}
