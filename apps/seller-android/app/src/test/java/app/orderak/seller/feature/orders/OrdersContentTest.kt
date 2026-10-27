package app.orderak.seller.feature.orders

import android.app.Application
import androidx.compose.material3.MaterialTheme
import androidx.compose.ui.semantics.SemanticsProperties
import androidx.compose.ui.semantics.getOrNull
import androidx.compose.ui.test.assertCountEquals
import androidx.compose.ui.test.junit4.createComposeRule
import androidx.compose.ui.test.onAllNodesWithText
import androidx.compose.ui.test.onFirst
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.performClick
import androidx.test.core.app.ApplicationProvider
import androidx.test.ext.junit.runners.AndroidJUnit4
import app.orderak.seller.R
import app.orderak.seller.data.db.OrderEntity
import app.orderak.seller.domain.OrderStatus
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.annotation.Config
import org.robolectric.annotation.GraphicsMode

/** The orders list, in Arabic: its filters, its two sections and its honest states. */
@RunWith(AndroidJUnit4::class)
@GraphicsMode(GraphicsMode.Mode.NATIVE)
@Config(sdk = [35], qualifiers = "ar-w411dp-h891dp-xxhdpi", application = Application::class)
class OrdersContentTest {
    @get:Rule
    val rule = createComposeRule()

    private val application: Application get() = ApplicationProvider.getApplicationContext()
    private fun string(id: Int) = application.getString(id)

    private fun order(
        id: Long,
        name: String,
        status: OrderStatus,
        remoteId: Long? = 1000 + id,
    ) = OrderEntity(
        id = id, remoteId = remoteId, buyerName = name, buyerPhone = "+20100000000$id",
        status = status.name, payMethod = "CASH", totalMinor = 50_000, currency = "EGP",
        createdAt = 1_757_000_000_000,
    )

    private val mixed = listOf(
        order(1, "منى عبد الله", OrderStatus.NEW),
        order(2, "أحمد يسري", OrderStatus.PAID),
        order(3, "سارة الشناوي", OrderStatus.DONE),
    )

    private val filters = mutableListOf<OrdersFilter>()
    private var opened: Long? = null
    private var created = 0
    private var retries = 0

    private fun show(state: OrdersUiState) {
        rule.setContent {
            MaterialTheme {
                OrdersContent(
                    state = state,
                    onOpen = { opened = it },
                    onNew = { created++ },
                    onFilter = { filters += it },
                    onRetry = { retries++ },
                )
            }
        }
    }

    @Test
    fun theFiltersAreTheThreeQuestionsTheDayAndTheStatusChip() {
        show(OrdersUiState(orders = mixed))
        for (id in listOf(R.string.orders_all, R.string.today_counter_unpaid, R.string.today_counter_to_ship, R.string.nav_dashboard, R.string.orders_status_filter)) {
            assertTrue("${string(id)} is a chip", rule.onAllNodesWithText(string(id)).fetchSemanticsNodes().isNotEmpty())
        }
        rule.onNodeWithText(string(R.string.today_counter_unpaid)).performClick()
        rule.onNodeWithText(string(R.string.today_counter_to_ship)).performClick()
        rule.onNodeWithText(string(R.string.orders_all)).performClick()
        assertEquals(listOf(OrdersFilter.Unpaid, OrdersFilter.ToShip, OrdersFilter.All), filters)
    }

    @Test
    fun theStatusChipOpensASheetWithTheSixStatusesAndChoosingOneFilters() {
        show(OrdersUiState(orders = mixed))
        rule.onNodeWithText(string(R.string.orders_status_filter)).performClick()
        rule.waitForIdle()
        for (status in OrderStatus.entries) {
            val label = application.getString(
                when (status) {
                    OrderStatus.NEW -> R.string.status_new
                    OrderStatus.CONFIRMED -> R.string.status_confirmed
                    OrderStatus.PAID -> R.string.status_paid
                    OrderStatus.SHIPPED -> R.string.status_shipped
                    OrderStatus.DONE -> R.string.status_done
                    OrderStatus.CANCELLED -> R.string.status_cancelled
                },
            )
            assertTrue("$label is in the sheet", rule.onAllNodesWithText(label).fetchSemanticsNodes().isNotEmpty())
        }
        rule.onAllNodesWithText(string(R.string.status_shipped)).onFirst().performClick()
        rule.waitForIdle()
        assertEquals(listOf<OrdersFilter>(OrdersFilter.Status(OrderStatus.SHIPPED)), filters)
    }

    @Test
    fun aChosenStatusIsNamedOnTheChip() {
        show(OrdersUiState(orders = mixed, filter = OrdersFilter.Status(OrderStatus.PAID)))
        // The chip carries the chosen status in place of the word "status", and is drawn chosen.
        rule.onAllNodesWithText(string(R.string.orders_status_filter)).assertCountEquals(0)
        val chip = rule.onNodeWithText(string(R.string.status_paid)).fetchSemanticsNode()
        assertTrue(chip.config.getOrNull(SemanticsProperties.Selected) == true)
    }

    @Test
    fun theOrdersThatNeedTheSellerComeFirstWithTheirCount() {
        show(OrdersUiState(orders = mixed))
        val waiting = rule.onNodeWithText(string(R.string.orders_group_waiting), substring = true).fetchSemanticsNode().boundsInRoot
        val rest = rule.onNodeWithText(string(R.string.orders_group_rest), substring = true).fetchSemanticsNode().boundsInRoot
        assertTrue("waiting above finished: $waiting $rest", waiting.top < rest.top)
        // Two orders still need the seller; one is finished.
        assertTrue(rule.onAllNodesWithText("٢", substring = true).fetchSemanticsNodes().isNotEmpty())
    }

    @Test
    fun aRowSaysWhichOrderHowBigAndWhen() {
        show(OrdersUiState(orders = mixed, itemCounts = mapOf(1L to 3, 2L to 1)))
        // "#١٠٠١ · ٣ منتجات · <date>"
        assertTrue(rule.onAllNodesWithText("#١٠٠١", substring = true).fetchSemanticsNodes().isNotEmpty())
        assertTrue(rule.onAllNodesWithText("٣ منتجات", substring = true).fetchSemanticsNodes().isNotEmpty())
        assertTrue(rule.onAllNodesWithText("منتج واحد", substring = true).fetchSemanticsNodes().isNotEmpty())
    }

    @Test
    fun anOrderWhoseLinesAreNotReadYetSaysNothingAboutThem() {
        show(OrdersUiState(orders = mixed))
        rule.onAllNodesWithText("منتج", substring = true).assertCountEquals(0)
    }

    @Test
    fun aRowOpensItsOrder() {
        show(OrdersUiState(orders = mixed))
        rule.onNodeWithText("منى عبد الله", substring = true).performClick()
        assertEquals(1L, opened)
    }

    @Test
    fun noOrdersAtAllExplainsAndOffersAManualOrderWithNoFiltersOrFab() {
        show(OrdersUiState(orders = emptyList()))
        rule.onAllNodesWithText(string(R.string.orders_empty_title)).assertCountEquals(1)
        rule.onAllNodesWithText(string(R.string.orders_empty_body)).assertCountEquals(1)
        rule.onAllNodesWithText(string(R.string.orders_all)).assertCountEquals(0)
        rule.onAllNodesWithText(string(R.string.order_new_title)).assertCountEquals(0)
        rule.onNodeWithText(string(R.string.orders_empty_action)).performClick()
        assertEquals(1, created)
    }

    @Test
    fun aFilterWithNoMatchKeepsTheChipsAndOffersAllOrders() {
        show(OrdersUiState(orders = emptyList(), filter = OrdersFilter.Unpaid))
        rule.onAllNodesWithText(string(R.string.orders_filtered_title)).assertCountEquals(1)
        rule.onAllNodesWithText(string(R.string.today_counter_unpaid)).assertCountEquals(1)
        rule.onNodeWithText(string(R.string.orders_filtered_action)).performClick()
        assertEquals(listOf<OrdersFilter>(OrdersFilter.All), filters)
    }

    @Test
    fun whileReadingTheChipsAreThereAndTheEmptyStateIsNot() {
        show(OrdersUiState(orders = null))
        rule.onAllNodesWithText(string(R.string.orders_all)).assertCountEquals(1)
        rule.onAllNodesWithText(string(R.string.orders_empty_title)).assertCountEquals(0)
    }

    @Test
    fun aFailedReadOffersARetry() {
        show(OrdersUiState(orders = null, loadError = true))
        rule.onNodeWithText(string(R.string.common_retry)).performClick()
        assertEquals(1, retries)
    }

    @Test
    fun aManualOrderStillOnThePhoneGetsAnInformationBannerAndARefusedOneAnErrorBanner() {
        val local = order(9, "كريم فؤاد", OrderStatus.CONFIRMED, remoteId = null).copy(idempotencyKey = "k9")
        show(OrdersUiState(orders = mixed + local))
        rule.onAllNodesWithText(string(R.string.orders_sync_pending)).assertCountEquals(1)
        rule.onAllNodesWithText(string(R.string.orders_sync_refused)).assertCountEquals(0)
    }

    @Test
    fun aRefusedManualOrderSaysSoInsteadOfPending() {
        val local = order(9, "كريم فؤاد", OrderStatus.CONFIRMED, remoteId = null).copy(idempotencyKey = "k9")
        show(OrdersUiState(orders = mixed + local, refusedPushes = setOf(9L)))
        rule.onAllNodesWithText(string(R.string.orders_sync_refused)).assertCountEquals(1)
        rule.onAllNodesWithText(string(R.string.orders_sync_pending)).assertCountEquals(0)
    }

    @Test
    fun noUnsentOrderMeansNoBanner() {
        show(OrdersUiState(orders = mixed))
        rule.onAllNodesWithText(string(R.string.orders_sync_pending)).assertCountEquals(0)
        rule.onAllNodesWithText(string(R.string.orders_sync_refused)).assertCountEquals(0)
    }

    @Test
    fun theFabCreatesAnOrder() {
        show(OrdersUiState(orders = mixed))
        rule.onNodeWithText(string(R.string.order_new_title)).performClick()
        assertEquals(1, created)
    }
}
