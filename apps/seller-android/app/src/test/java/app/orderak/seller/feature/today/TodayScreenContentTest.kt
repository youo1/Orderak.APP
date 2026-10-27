package app.orderak.seller.feature.today

import android.app.Application
import androidx.compose.material3.MaterialTheme
import androidx.compose.ui.test.assertCountEquals
import androidx.compose.ui.test.junit4.createComposeRule
import androidx.compose.ui.test.onAllNodesWithText
import androidx.compose.ui.test.onNodeWithContentDescription
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.performClick
import androidx.test.core.app.ApplicationProvider
import androidx.test.ext.junit.runners.AndroidJUnit4
import app.orderak.seller.R
import app.orderak.seller.core.money.Money
import app.orderak.seller.data.db.OrderEntity
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.annotation.Config
import org.robolectric.annotation.GraphicsMode

/**
 * What اليوم shows and does, in Arabic: the three tiles in the order an order
 * moves through the shop, the orders that need the seller, and the honest states.
 */
@RunWith(AndroidJUnit4::class)
@GraphicsMode(GraphicsMode.Mode.NATIVE)
@Config(sdk = [35], qualifiers = "ar-w411dp-h891dp-xxhdpi", application = Application::class)
class TodayScreenContentTest {
    @get:Rule
    val rule = createComposeRule()

    private val application: Application get() = ApplicationProvider.getApplicationContext()
    private fun string(id: Int) = application.getString(id)

    private val loaded = TodayUiState(
        shopName = "حلواني الأمل",
        newCount = 4, unpaidCount = 3, toShipCount = 2, todayCount = 7,
        hasProducts = true,
        latestOrders = listOf(
            OrderEntity(id = 2, buyerPhone = "+201000000002", buyerName = "منى السيد", status = "NEW", payMethod = "CASH", totalMinor = 125000, currency = "EGP"),
            OrderEntity(id = 1, buyerPhone = "+201000000001", buyerName = "أحمد علي", status = "PAID", payMethod = "CASH", totalMinor = 48000, currency = "EGP"),
        ),
        monthSales = Money(1_845_000, "EGP"),
        storeUrl = "https://orderak.app/EG-halawany-K7M2Q9XA",
    )

    private val opened = mutableListOf<TodayCounter>()
    private var openedOrder: Long? = null
    private var shared = 0
    private var added = 0
    private var announcements = 0
    private var retries = 0

    private fun show(state: TodayUiState) {
        rule.setContent {
            MaterialTheme {
                TodayScreen(
                    state = state,
                    onOpenCounter = { opened += it },
                    onOpenOrder = { openedOrder = it },
                    onShareCatalog = { shared++ },
                    onAddProduct = { added++ },
                    onOpenAnnouncements = { announcements++ },
                    onRetry = { retries++ },
                )
            }
        }
    }

    @Test
    fun theThreeTilesRunInTheOrderAnOrderMovesThroughTheShop() {
        show(loaded)
        val xs = listOf(R.string.today_counter_new, R.string.today_counter_unpaid, R.string.today_counter_to_ship)
            .map { rule.onNodeWithContentDescription(string(it), substring = true).fetchSemanticsNode().boundsInRoot.center.x }
        // Arabic reads right to left: the first tile is the rightmost.
        assertTrue("new, then unpaid, then ready to ship, right to left: $xs", xs[0] > xs[1] && xs[1] > xs[2])
    }

    @Test
    fun eachTileOpensItsOwnList() {
        show(loaded)
        rule.onNodeWithContentDescription(string(R.string.today_counter_new), substring = true).performClick()
        rule.onNodeWithContentDescription(string(R.string.today_counter_unpaid), substring = true).performClick()
        rule.onNodeWithContentDescription(string(R.string.today_counter_to_ship), substring = true).performClick()
        assertEquals(listOf(TodayCounter.New, TodayCounter.Unpaid, TodayCounter.ToShip), opened)
    }

    @Test
    fun theTilesSpeakTheirCountsInArabicIndicDigits() {
        show(loaded)
        rule.onNodeWithContentDescription("${string(R.string.today_counter_new)} ٤").performClick()
        assertEquals(listOf(TodayCounter.New), opened)
    }

    @Test
    fun countsStillBeingReadAreNeverDrawnAsZero() {
        show(TodayUiState(shopName = "حلواني الأمل", hasProducts = true))
        rule.onAllNodesWithText("٠", useUnmergedTree = true).assertCountEquals(0)
        rule.onAllNodesWithText("0", useUnmergedTree = true).assertCountEquals(0)
        rule.onAllNodesWithText(string(R.string.dash_nothing_needs_you)).assertCountEquals(0)
    }

    @Test
    fun aFailedReadIsADashWithABannerAndARetry() {
        show(TodayUiState(shopName = "حلواني الأمل", hasProducts = true, summaryFailed = true, storeUrl = "https://orderak.app/EG-x-ABCDEFGH"))
        rule.onAllNodesWithText(string(R.string.today_error_title)).assertCountEquals(1)
        rule.onNodeWithText(string(R.string.common_retry)).performClick()
        assertEquals(1, retries)
        // The link is a stored value, not one of the figures that failed.
        rule.onAllNodesWithText("orderak.app/EG-x-ABCDEFGH", substring = true).assertCountEquals(1)
    }

    @Test
    fun nothingWaitingIsSaidInAWordNotThreeZeros() {
        show(loaded.copy(newCount = 0, unpaidCount = 0, toShipCount = 0, latestOrders = emptyList()))
        rule.onAllNodesWithText(string(R.string.dash_nothing_needs_you)).assertCountEquals(1)
    }

    @Test
    fun somethingWaitingDoesNotSayNothingIsWaiting() {
        show(loaded)
        rule.onAllNodesWithText(string(R.string.dash_nothing_needs_you)).assertCountEquals(0)
    }

    @Test
    fun theOrdersThatNeedTheSellerAreRowsThatOpenTheOrder() {
        show(loaded)
        rule.onAllNodesWithText(string(R.string.today_section_latest)).assertCountEquals(1)
        rule.onNodeWithText("منى السيد", substring = true).performClick()
        assertEquals(2L, openedOrder)
        rule.onNodeWithText(string(R.string.today_view_all)).performClick()
        assertEquals(TodayCounter.Today, opened.last())
    }

    @Test
    fun noOpenOrdersDrawsNoSection() {
        show(loaded.copy(latestOrders = emptyList()))
        rule.onAllNodesWithText(string(R.string.today_section_latest)).assertCountEquals(0)
    }

    @Test
    fun theBellOpensTheAnnouncementsAndMarksUnreadOnes() {
        show(loaded.copy(unreadAnnouncements = 2))
        rule.onNodeWithContentDescription(string(R.string.announcements_title)).performClick()
        assertEquals(1, announcements)
    }

    @Test
    fun theMonthsSalesAreInArabicIndicDigitsAndAbsentWithoutAnOrder() {
        show(loaded)
        assertTrue(rule.onAllNodesWithText("١٨٬٤٥٠", substring = true).fetchSemanticsNodes().isNotEmpty())
    }

    @Test
    fun withoutASaleThisMonthThereIsNoSalesLine() {
        show(loaded.copy(monthSales = null))
        rule.onAllNodesWithText(string(R.string.today_sales_month)).assertCountEquals(0)
    }

    @Test
    fun theLinkIsShownWithoutItsSchemeAndShared() {
        show(loaded)
        rule.onAllNodesWithText("orderak.app/EG-halawany-K7M2Q9XA", substring = true).assertCountEquals(1)
        rule.onNodeWithText(string(R.string.today_link_share)).performClick()
        assertEquals(1, shared)
    }

    @Test
    fun withNoProductsTheSurfaceIsOneInvitationAndTheChecklist() {
        show(TodayUiState(shopName = "حلواني الأمل", newCount = 0, unpaidCount = 0, toShipCount = 0, todayCount = 0, hasProducts = false))
        rule.onAllNodesWithText(string(R.string.today_empty_title)).assertCountEquals(1)
        rule.onAllNodesWithText(string(R.string.struct_setup_created)).assertCountEquals(1)
        rule.onAllNodesWithText(string(R.string.today_section_waiting)).assertCountEquals(0)
        rule.onAllNodesWithText(string(R.string.today_link_title)).assertCountEquals(0)
        rule.onNodeWithText(string(R.string.today_empty_action)).performClick()
        assertEquals(1, added)
    }

    @Test
    fun beforeTheCatalogueIsReadTheSurfaceGuessesNothing() {
        show(loaded.copy(hasProducts = null))
        rule.onAllNodesWithText(string(R.string.today_empty_title)).assertCountEquals(0)
        rule.onAllNodesWithText(string(R.string.today_link_title)).assertCountEquals(0)
    }
}
