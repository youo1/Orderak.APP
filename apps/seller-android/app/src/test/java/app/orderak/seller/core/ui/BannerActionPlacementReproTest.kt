package app.orderak.seller.core.ui

import android.app.Application
import androidx.compose.ui.test.junit4.createComposeRule
import androidx.compose.ui.test.onNodeWithText
import androidx.test.ext.junit.runners.AndroidJUnit4
import org.junit.Assert.assertTrue
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.annotation.Config
import org.robolectric.annotation.GraphicsMode

@RunWith(AndroidJUnit4::class)
@GraphicsMode(GraphicsMode.Mode.NATIVE)
@Config(sdk = [35], qualifiers = "en-w411dp-h891dp-xxhdpi", application = Application::class)
class BannerActionPlacementReproTest {
    @get:Rule
    val rule = createComposeRule()

    @Test
    fun atDefaultScaleTheActionSitsBesideTheMessageNotBelowIt() {
        rule.setContent {
            Banner(
                state = BannerState.Warning,
                title = "T",
                message = "Msg",
                actionLabel = "Act",
                onAction = {},
            )
        }
        rule.waitForIdle()
        val message = rule.onNodeWithText("Msg").fetchSemanticsNode().boundsInRoot
        val action = rule.onNodeWithText("Act").fetchSemanticsNode().boundsInRoot
        assertTrue(
            "At 100% the approved design places the action on the message row; action=$action message=$message",
            action.top < message.bottom,
        )
    }
}
