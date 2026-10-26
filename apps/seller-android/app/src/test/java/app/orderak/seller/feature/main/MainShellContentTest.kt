package app.orderak.seller.feature.main

import android.app.Application
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.semantics.SemanticsProperties
import androidx.compose.ui.semantics.getOrNull
import androidx.compose.ui.test.assertCountEquals
import androidx.compose.ui.test.junit4.createComposeRule
import androidx.compose.ui.test.onAllNodesWithText
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.performClick
import androidx.test.ext.junit.runners.AndroidJUnit4
import app.orderak.seller.R
import app.orderak.seller.app.navigation.SellerSurface
import app.orderak.seller.data.remote.AppVersionPolicy
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.annotation.Config
import org.robolectric.annotation.GraphicsMode

/**
 * The shell and the version modes, in Arabic: what the bottom bar says, what the
 * version warning does, and which governance screens have a button.
 */
@RunWith(AndroidJUnit4::class)
@GraphicsMode(GraphicsMode.Mode.NATIVE)
@Config(sdk = [35], qualifiers = "ar-w411dp-h891dp-xxhdpi", application = Application::class)
class MainShellContentTest {
    @get:Rule
    val rule = createComposeRule()

    private val application: Application get() = androidx.test.core.app.ApplicationProvider.getApplicationContext()

    private fun string(id: Int, vararg args: Any) = application.getString(id, *args)

    private fun shell(
        surface: SellerSurface = SellerSurface.Today,
        unpaidOrders: Int = 0,
        hasUnreadAnnouncements: Boolean = false,
        versionWarning: String? = null,
        onUpdateVersion: (() -> Unit)? = null,
        onSurface: (SellerSurface) -> Unit = {},
    ) {
        rule.setContent {
            MaterialTheme {
                MainShellContent(
                    shopName = "بوتيك منى",
                    surface = surface,
                    onSurface = onSurface,
                    onNewOrder = {},
                    unpaidOrders = unpaidOrders,
                    hasUnreadAnnouncements = hasUnreadAnnouncements,
                    versionWarning = versionWarning,
                    onUpdateVersion = onUpdateVersion,
                ) {
                    Box(Modifier.fillMaxSize()) { Text("المحتوى") }
                }
            }
        }
    }

    @Test
    fun theBarShowsAllFiveLabelsAndSwitchesSurface() {
        var chosen: SellerSurface? = null
        shell(onSurface = { chosen = it })
        for (surface in SellerSurface.entries) {
            assertTrue(
                "the label of $surface is on screen",
                rule.onAllNodesWithText(string(surface.labelRes)).fetchSemanticsNodes().isNotEmpty(),
            )
        }
        rule.onAllNodesWithText(string(R.string.nav_orders))[0].performClick()
        assertEquals(SellerSurface.Orders, chosen)
    }

    @Test
    fun theUnpaidCountIsInArabicDigitsAndNothingIsDrawnForZero() {
        shell(unpaidOrders = 3)
        assertTrue(rule.onAllNodesWithText("٣", useUnmergedTree = true).fetchSemanticsNodes().isNotEmpty())
    }

    @Test
    fun noUnpaidOrdersDrawsNoBadge() {
        shell(unpaidOrders = 0)
        rule.onAllNodesWithText("٠", useUnmergedTree = true).assertCountEquals(0)
        rule.onAllNodesWithText("0", useUnmergedTree = true).assertCountEquals(0)
    }

    @Test
    fun theFabBelongsToTodayAlone() {
        shell(surface = SellerSurface.Today)
        rule.onAllNodesWithText(string(R.string.order_new_title)).assertCountEquals(1)
    }

    @Test
    fun noOtherSurfaceHasTheFab() {
        shell(surface = SellerSurface.Store)
        rule.onAllNodesWithText(string(R.string.order_new_title)).assertCountEquals(0)
    }

    @Test
    fun aVersionWarningIsABannerAboveTheSurfaceWithAnUpdateActionAndNoDismiss() {
        var updates = 0
        shell(versionWarning = string(R.string.app_version_warning), onUpdateVersion = { updates++ })
        rule.onAllNodesWithText(string(R.string.app_version_warning)).assertCountEquals(1)
        rule.onNodeWithText(string(R.string.app_version_banner_action)).performClick()
        assertEquals(1, updates)
        // The warning stays until the seller updates: there is nothing to dismiss it with.
        rule.onAllNodesWithText(string(R.string.common_dismiss)).assertCountEquals(0)
        val banner = rule.onNodeWithText(string(R.string.app_version_warning)).fetchSemanticsNode().boundsInRoot
        val content = rule.onNodeWithText("المحتوى").fetchSemanticsNode().boundsInRoot
        assertTrue("the banner sits above the surface: $banner $content", banner.bottom <= content.top + 1f)
    }

    @Test
    fun noWarningDrawsNoBanner() {
        shell(versionWarning = null)
        rule.onAllNodesWithText(string(R.string.app_version_warning)).assertCountEquals(0)
    }

    @Test
    fun forceUpdateOffersTheStoreButtonAndAWaitOffersNone() {
        val policy = AppVersionPolicy(status = "force_update", store_url = "https://play.google.com/store/apps/details?id=app.orderak.seller")
        var mode by mutableStateOf(VersionUiMode.FORCE_UPDATE)
        rule.setContent { MaterialTheme { VersionBlockingScreen(mode, policy, onRetry = {}) } }
        rule.onAllNodesWithText(string(R.string.app_version_update_action)).assertCountEquals(1)
        mode = VersionUiMode.BLOCKED
        rule.waitForIdle()
        rule.onAllNodesWithText(string(R.string.app_version_update_action)).assertCountEquals(0)
        mode = VersionUiMode.MAINTENANCE
        rule.waitForIdle()
        rule.onAllNodesWithText(string(R.string.app_version_update_action)).assertCountEquals(0)
        rule.onAllNodesWithText(string(R.string.common_retry)).assertCountEquals(0)
    }

    @Test
    fun aWaitLooksAgainOnItsOwnEveryMinute() {
        var retries = 0
        rule.mainClock.autoAdvance = false
        rule.setContent {
            MaterialTheme { VersionBlockingScreen(VersionUiMode.MAINTENANCE, AppVersionPolicy(), onRetry = { retries++ }) }
        }
        // The clock moves in frames, so the checks keep a margin on either side of the minute.
        rule.mainClock.advanceTimeBy(WAIT_RECHECK_MS - 2_000)
        assertEquals(0, retries)
        rule.mainClock.advanceTimeBy(4_000)
        assertEquals(1, retries)
        rule.mainClock.advanceTimeBy(WAIT_RECHECK_MS)
        assertEquals(2, retries)
    }

    @Test
    fun aForcedUpdateDoesNotPollTheServer() {
        var retries = 0
        rule.mainClock.autoAdvance = false
        rule.setContent {
            MaterialTheme {
                VersionBlockingScreen(
                    VersionUiMode.FORCE_UPDATE,
                    AppVersionPolicy(status = "force_update", store_url = "https://example.test"),
                    onRetry = { retries++ },
                )
            }
        }
        rule.mainClock.advanceTimeBy(WAIT_RECHECK_MS * 3)
        assertEquals(0, retries)
    }

    @Test
    fun theTitleOfABlockingScreenIsAHeading() {
        rule.setContent {
            MaterialTheme { VersionBlockingScreen(VersionUiMode.BLOCKED, AppVersionPolicy(), onRetry = {}) }
        }
        val node = rule.onNodeWithText(string(R.string.app_version_blocked_title)).fetchSemanticsNode()
        assertTrue(node.config.getOrNull(SemanticsProperties.Heading) != null)
    }
}
