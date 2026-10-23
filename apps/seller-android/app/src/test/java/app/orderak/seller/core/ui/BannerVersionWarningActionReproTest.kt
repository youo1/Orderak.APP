package app.orderak.seller.core.ui

import android.app.Application
import androidx.compose.ui.test.junit4.createComposeRule
import androidx.compose.ui.test.onAllNodesWithText
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
class BannerVersionWarningActionReproTest {
    @get:Rule
    val rule = createComposeRule()

    @Test
    fun versionWarningShowsTheUpdateActionTheDesignDraws() {
        rule.setContent {
            Banner(
                state = BannerState.VersionWarning,
                title = "Version title",
                message = "Version message",
                actionLabel = "ZzUpdateAction",
                onAction = {},
            )
        }
        rule.waitForIdle()
        val nodes = rule.onAllNodesWithText("ZzUpdateAction").fetchSemanticsNodes()
        assertTrue(
            "The approved design draws an Update action on the non-dismissible version warning",
            nodes.isNotEmpty(),
        )
    }
}
