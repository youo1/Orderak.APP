package app.orderak.seller.feature.orders

import android.app.Application
import androidx.compose.material3.MaterialTheme
import androidx.compose.ui.test.assertCountEquals
import androidx.compose.ui.test.assertIsEnabled
import androidx.compose.ui.test.assertIsNotEnabled
import androidx.compose.ui.test.junit4.createComposeRule
import androidx.compose.ui.test.onAllNodesWithText
import androidx.compose.ui.test.onNodeWithTag
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.performClick
import androidx.test.core.app.ApplicationProvider
import androidx.test.ext.junit.runners.AndroidJUnit4
import app.orderak.seller.R
import app.orderak.seller.core.ui.FeatureAvailability
import app.orderak.seller.data.db.OrderEntity
import app.orderak.seller.data.db.OrderItemEntity
import app.orderak.seller.data.db.OrderWithItems
import app.orderak.seller.domain.OrderStatus
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.annotation.Config
import org.robolectric.annotation.GraphicsMode

/**
 * One order, in Arabic: where it stands, who it is for, what is in it, how it is
 * paid, and the single next step.
 */
@RunWith(AndroidJUnit4::class)
@GraphicsMode(GraphicsMode.Mode.NATIVE)
@Config(sdk = [35], qualifiers = "ar-w411dp-h891dp-xxhdpi", application = Application::class)
class OrderDetailsContentTest {
    @get:Rule
    val rule = createComposeRule()

    private val application: Application get() = ApplicationProvider.getApplicationContext()
    private fun string(id: Int) = application.getString(id)

    private fun data(
        status: OrderStatus,
        remoteId: Long? = 1041,
        note: String? = null,
    ): OrderWithItems {
        val order = OrderEntity(
            id = 7, remoteId = remoteId, buyerName = "منى السيد", buyerPhone = "+201000000002",
            status = status.name, payMethod = "COD", totalMinor = 125_000, currency = "EGP", note = note,
            idempotencyKey = if (remoteId == null) "k7" else null, createdAt = 1_757_000_000_000,
        )
        return OrderWithItems(
            order,
            listOf(
                OrderItemEntity(orderId = 7, productId = 1, productName = "تيشيرت أطفال قطني", qty = 2, priceMinor = 25_000),
                OrderItemEntity(orderId = 7, productId = 2, productName = "حقيبة", qty = 1, priceMinor = 75_000),
            ),
        )
    }

    private var advanced = 0
    private var cancelled = 0
    private var manualPaid = 0
    private var customer: String? = null
    private var confirmingCancel = false

    private fun show(
        order: OrderWithItems?,
        answered: Boolean = true,
        payments: List<app.orderak.seller.data.db.PaymentEntity>? = emptyList(),
        confirmCancel: Boolean = false,
        refusalCode: String? = null,
    ) {
        rule.setContent {
            MaterialTheme {
                OrderDetailsContent(
                    orderWithItems = order,
                    answered = answered,
                    payments = payments,
                    countryIso = "EG",
                    proof = ProofUiState.Idle,
                    refusalCode = refusalCode,
                    ocrAvailability = FeatureAvailability.NotBuilt,
                    confirmCancel = confirmCancel,
                    confirmDiscard = false,
                    actions = OrderDetailsActions(
                        advance = { advanced++ },
                        markPaidManually = { manualPaid++ },
                        cancel = { done -> cancelled++; done() },
                    ),
                    onPickProof = {},
                    onConfirmCancel = { confirmingCancel = it },
                    onConfirmDiscard = {},
                    onOpenIntent = {},
                    onBack = {},
                    onOpenCustomer = { customer = it },
                )
            }
        }
    }

    @Test
    fun theTitleNamesTheOrderByItsNumber() {
        show(data(OrderStatus.NEW))
        assertTrue(rule.onAllNodesWithText("#١٠٤١", substring = true).fetchSemanticsNodes().isNotEmpty())
    }

    @Test
    fun theStepperShowsTheFiveStepsAndACancelledOrderReplacesIt() {
        show(data(OrderStatus.CONFIRMED))
        for (step in listOf(R.string.status_new, R.string.status_confirmed, R.string.status_paid, R.string.status_shipped, R.string.status_done)) {
            assertTrue(string(step), rule.onAllNodesWithText(string(step)).fetchSemanticsNodes().isNotEmpty())
        }
    }

    @Test
    fun aCancelledOrderHasNoStepperAndNoBar() {
        show(data(OrderStatus.CANCELLED))
        rule.onAllNodesWithText(string(R.string.status_shipped)).assertCountEquals(0)
        rule.onAllNodesWithText(string(R.string.order_cancel)).assertCountEquals(0)
    }

    @Test
    fun theCustomerRowOpensTheirPage() {
        show(data(OrderStatus.NEW))
        rule.onNodeWithText("منى السيد").performClick()
        assertEquals("+201000000002", customer)
    }

    @Test
    fun theProductsHaveLineTotalsAndTheTotalIsInArabicIndicDigits() {
        show(data(OrderStatus.NEW))
        rule.onAllNodesWithText("تيشيرت أطفال قطني").assertCountEquals(1)
        assertTrue(rule.onAllNodesWithText("٥٠٠", substring = true).fetchSemanticsNodes().isNotEmpty()) // 2 x 250
        assertTrue(rule.onAllNodesWithText("١٬٢٥٠", substring = true).fetchSemanticsNodes().isNotEmpty()) // total
    }

    private fun assertNextStep(status: OrderStatus, label: Int) {
        show(data(status))
        assertTrue("$status offers ${string(label)}", rule.onAllNodesWithText(string(label)).fetchSemanticsNodes().isNotEmpty())
    }

    @Test
    fun aNewOrderOffersToConfirm() = assertNextStep(OrderStatus.NEW, R.string.order_next_confirm)

    @Test
    fun aConfirmedOrderOffersToMarkPaid() = assertNextStep(OrderStatus.CONFIRMED, R.string.order_next_paid)

    @Test
    fun aPaidOrderOffersToShip() = assertNextStep(OrderStatus.PAID, R.string.order_next_shipped)

    @Test
    fun aShippedOrderOffersToComplete() = assertNextStep(OrderStatus.SHIPPED, R.string.order_next_done)

    @Test
    fun theNextStepAdvancesTheOrder() {
        show(data(OrderStatus.NEW))
        rule.onNodeWithText(string(R.string.order_next_confirm)).assertIsEnabled().performClick()
        assertEquals(1, advanced)
    }

    @Test
    fun aPaidOrderOffersShippingAndNoCancel() {
        show(data(OrderStatus.PAID))
        assertTrue(rule.onAllNodesWithText(string(R.string.order_next_shipped)).fetchSemanticsNodes().isNotEmpty())
        rule.onAllNodesWithText(string(R.string.order_cancel)).assertCountEquals(0)
    }

    @Test
    fun aFinishedOrderHasNoBar() {
        show(data(OrderStatus.DONE))
        rule.onAllNodesWithText(string(R.string.order_next_done)).assertCountEquals(0)
        rule.onAllNodesWithText(string(R.string.order_cancel)).assertCountEquals(0)
    }

    @Test
    fun cancellingIsInTheSecondarySlotWhileItIsAllowedAndAsksFirst() {
        show(data(OrderStatus.NEW))
        rule.onNodeWithText(string(R.string.order_cancel)).assertIsEnabled().performClick()
        assertTrue("asks first", confirmingCancel)
        assertEquals(0, cancelled)
    }

    @Test
    fun theCancelSheetStatesTheConsequenceAndTheVerbAndConfirmingCancels() {
        show(data(OrderStatus.NEW), confirmCancel = true)
        rule.waitForIdle()
        assertTrue(rule.onAllNodesWithText(string(R.string.order_cancel_sheet_body)).fetchSemanticsNodes().isNotEmpty())
        rule.onNodeWithTag("orderak.sheet.confirm").performClick()
        rule.waitForIdle()
        assertEquals(1, cancelled)
    }

    @Test
    fun anOrderNotYetOnTheAccountDisablesTheStepAndSaysWhy() {
        show(data(OrderStatus.NEW, remoteId = null))
        rule.onNodeWithText(string(R.string.order_next_confirm)).assertIsNotEnabled()
        rule.onAllNodesWithText(string(R.string.order_bar_unsent_reason)).assertCountEquals(1)
    }

    @Test
    fun theManualPaymentIsOfferedOnlyUntilPaid() {
        show(data(OrderStatus.CONFIRMED))
        rule.onNodeWithText(string(R.string.payment_manual)).performClick()
        assertEquals(1, manualPaid)
    }

    @Test
    fun afterPaymentThereIsNoManualPayment() {
        show(data(OrderStatus.PAID))
        rule.onAllNodesWithText(string(R.string.payment_manual)).assertCountEquals(0)
    }

    @Test
    fun theNoteIsShownWhenThereIsOne() {
        show(data(OrderStatus.NEW, note = "التسليم بعد الظهر"))
        rule.onAllNodesWithText("التسليم بعد الظهر").assertCountEquals(1)
    }

    @Test
    fun noNoteMeansNoNoteSection() {
        show(data(OrderStatus.NEW))
        rule.onAllNodesWithText(string(R.string.order_note_title)).assertCountEquals(0)
    }

    @Test
    fun anOrderThatDoesNotExistSaysSoWithAWayBack() {
        show(null, answered = true)
        rule.onAllNodesWithText(string(R.string.order_details_missing_body)).assertCountEquals(1)
    }
}
