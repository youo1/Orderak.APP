package app.orderak.seller.feature.customers

import android.app.Application
import androidx.compose.material3.MaterialTheme
import androidx.compose.ui.test.assertCountEquals
import androidx.compose.ui.test.junit4.createComposeRule
import androidx.compose.ui.test.onAllNodesWithText
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.performClick
import androidx.test.core.app.ApplicationProvider
import androidx.test.ext.junit.runners.AndroidJUnit4
import app.orderak.seller.R
import app.orderak.seller.data.db.CustomerEntity
import app.orderak.seller.data.db.OrderEntity
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.annotation.Config
import org.robolectric.annotation.GraphicsMode

/** العميل, in Arabic: how to reach them, what the seller knows, and what they have bought. */
@RunWith(AndroidJUnit4::class)
@GraphicsMode(GraphicsMode.Mode.NATIVE)
@Config(sdk = [35], qualifiers = "ar-w411dp-h891dp-xxhdpi", application = Application::class)
class CustomerDetailsContentTest {
    @get:Rule
    val rule = createComposeRule()

    private val application: Application get() = ApplicationProvider.getApplicationContext()
    private fun string(id: Int) = application.getString(id)

    private val customer = CustomerEntity(
        customerKey = "k1", phone = "+201001234567", name = "منى السيد",
        altContact = "mona@example.com", note = "تفضّل التوصيل مساءً",
    )
    private fun order(id: Long, currency: String = "EGP") = OrderEntity(
        id = id, remoteId = 1000 + id, buyerName = "منى السيد", buyerPhone = "+201001234567",
        status = "NEW", payMethod = "COD", totalMinor = 50_000, currency = currency, createdAt = 1_757_000_000_000,
    )

    private var saved: Triple<String, String, String>? = null
    private var contacted = 0
    private var opened: Long? = null

    private fun show(
        orders: List<OrderEntity>? = listOf(order(1), order(2)),
        editable: Boolean = true,
        c: CustomerEntity? = customer,
    ) {
        rule.setContent {
            MaterialTheme {
                CustomerDetailsContent(
                    customer = c,
                    orders = orders,
                    customerKey = "k1",
                    editable = editable,
                    onSave = { n, a, note -> saved = Triple(n, a, note) },
                    onContact = { contacted++ },
                    onBack = {},
                    onOpenOrder = { opened = it },
                )
            }
        }
    }

    @Test
    fun theHeaderNamesTheCustomerAndOffersToReachThem() {
        show()
        assertTrue(rule.onAllNodesWithText("منى السيد").fetchSemanticsNodes().isNotEmpty())
        rule.onNodeWithText(string(R.string.customer_contact)).performClick()
        assertEquals(1, contacted)
    }

    @Test
    fun theFiguresAreOrdersTotalAndLast() {
        show()
        assertTrue(rule.onAllNodesWithText(string(R.string.customer_figure_orders)).fetchSemanticsNodes().isNotEmpty())
        assertTrue(rule.onAllNodesWithText("١٬٠٠٠", substring = true).fetchSemanticsNodes().isNotEmpty()) // 2 x 500
        assertTrue(rule.onAllNodesWithText(string(R.string.customer_figure_last)).fetchSemanticsNodes().isNotEmpty())
    }

    @Test
    fun ordersInTwoCurrenciesHaveNoTotal() {
        show(orders = listOf(order(1), order(2, currency = "SAR")))
        assertTrue(rule.onAllNodesWithText(string(R.string.customers_mixed_currencies)).fetchSemanticsNodes().isNotEmpty())
    }

    @Test
    fun theAboutCardShowsTheNoteAndEditOpensTheSheetThatSaves() {
        show()
        assertTrue(rule.onAllNodesWithText("تفضّل التوصيل مساءً").fetchSemanticsNodes().isNotEmpty())
        rule.onNodeWithText(string(R.string.customer_edit)).performClick()
        rule.waitForIdle()
        assertTrue(rule.onAllNodesWithText(string(R.string.customer_edit_title)).fetchSemanticsNodes().isNotEmpty())
        rule.onNodeWithText(string(R.string.customer_save)).performClick()
        rule.waitForIdle()
        assertEquals(Triple("منى السيد", "mona@example.com", "تفضّل التوصيل مساءً"), saved)
    }

    @Test
    fun whereThePlanDoesNotOpenEditingTheCardIsReadOnlyAndANoticeSaysSo() {
        show(editable = false)
        rule.onAllNodesWithText(string(R.string.customer_edit)).assertCountEquals(0)
        assertTrue(rule.onAllNodesWithText(string(R.string.customer_edit_locked)).fetchSemanticsNodes().isNotEmpty())
        assertTrue(rule.onAllNodesWithText("تفضّل التوصيل مساءً").fetchSemanticsNodes().isNotEmpty())
    }

    @Test
    fun theirOrdersAreRowsThatOpenTheOrder() {
        show()
        rule.onAllNodesWithText("منى السيد", substring = true)
        assertTrue(rule.onAllNodesWithText("#١٠٠١", substring = true).fetchSemanticsNodes().isNotEmpty())
        rule.onAllNodesWithText("#١٠٠١", substring = true)[0].performClick()
        assertEquals(1L, opened)
    }

    @Test
    fun ordersNotReadYetAreNotReportedAsNone() {
        show(orders = null)
        rule.onAllNodesWithText(string(R.string.orders_empty)).assertCountEquals(0)
    }

    @Test
    fun anUnresolvedNumberIsSaidToBeKeptAsTyped() {
        show(c = customer.copy(phoneStatus = "ambiguous"))
        assertTrue(rule.onAllNodesWithText(string(R.string.customer_phone_unresolved)).fetchSemanticsNodes().isNotEmpty())
    }
}
