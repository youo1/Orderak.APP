package app.orderak.seller.feature.orders

import androidx.compose.material3.Surface
import androidx.compose.runtime.Composable
import androidx.compose.ui.tooling.preview.Preview
import app.orderak.seller.core.ui.FeatureAvailability
import app.orderak.seller.core.ui.theme.OrderakTheme
import app.orderak.seller.data.db.OrderEntity
import app.orderak.seller.data.db.OrderItemEntity
import app.orderak.seller.data.db.OrderWithItems
import app.orderak.seller.data.db.PaymentEntity
import app.orderak.seller.data.db.ProductEntity
import app.orderak.seller.domain.OrderStatus
import app.orderak.seller.domain.PayMethod
import com.android.tools.screenshot.PreviewTest

/**
 * One order, and the form that makes one — the last two screens reached from
 * الطلبات.
 *
 * `payments` seeded `emptyList()`, so the page said "no payment recorded" about
 * an order whose payment may well be recorded, on the screen a seller opens
 * precisely to check whether a transfer landed. It is nullable now.
 *
 * The OCR gate is drawn in all three of its states here, which nothing had ever
 * done. `FeatureGate` took a resolver, the resolver needs an EntitlementManager
 * and therefore a Hilt graph, so a three-state gating rule had two states nobody
 * had looked at. A decision-taking overload fixes that, and NotBuilt is the one
 * to check: it must carry no upgrade affordance at all, because no plan change
 * opens it.
 *
 * All Arabic: `ar` is the primary direction, so the render is what a seller sees.
 */

private val ORDER = OrderWithItems(
    order = OrderEntity(
        id = 1,
        remoteId = 1,
        buyerPhone = "01000000001",
        buyerName = "منى عبد الله",
        status = OrderStatus.CONFIRMED.name,
        payMethod = PayMethod.COD.name,
        totalMinor = 45_000,
        currency = "EGP",
        note = "التسليم بعد ٥ المغرب",
        createdAt = 1_757_000_000_000L,
    ),
    items = listOf(
        OrderItemEntity(
            id = 1,
            orderId = 1,
            productId = 1,
            productName = "عباية كلوش أسود",
            qty = 1,
            priceMinor = 45_000,
        ),
    ),
)

private val PAYMENT = PaymentEntity(
    id = 1,
    orderId = 1,
    ref = "INSTA-88213",
    amountMinor = 45_000,
    currency = "EGP",
    verified = true,
    createdAt = 1_757_000_500_000L,
)

@Composable
private fun details(
    order: OrderWithItems?,
    payments: List<PaymentEntity>?,
    ocr: FeatureAvailability = FeatureAvailability.Available,
    proof: ProofUiState = ProofUiState.Idle,
    refusalCode: String? = null,
    dark: Boolean = false,
) {
    OrderakTheme(darkTheme = dark) {
        Surface {
            OrderDetailsContent(
                orderWithItems = order,
                payments = payments,
                countryIso = "EG",
                proof = proof,
                refusalCode = refusalCode,
                ocrAvailability = ocr,
                confirmCancel = false,
                confirmDiscard = false,
                actions = OrderDetailsActions(),
                onPickProof = {},
                onConfirmCancel = {},
                onConfirmDiscard = {},
                onOpenIntent = {},
                onBack = {},
                onOpenCustomer = {},
            )
        }
    }
}

// ---- loading -----------------------------------------------------------

@PreviewTest
@Preview(name = "Order details loading light", locale = "ar")
@Composable
fun orderDetailsLoadingLight() = details(order = null, payments = null)

@PreviewTest
@Preview(name = "Order details loading dark", locale = "ar")
@Composable
fun orderDetailsLoadingDark() = details(order = null, payments = null, dark = true)

// ---- content -----------------------------------------------------------

@PreviewTest
@Preview(name = "Order details content light", locale = "ar")
@Composable
fun orderDetailsContentLight() = details(order = ORDER, payments = listOf(PAYMENT))

@PreviewTest
@Preview(name = "Order details content dark", locale = "ar")
@Composable
fun orderDetailsContentDark() = details(order = ORDER, payments = listOf(PAYMENT), dark = true)

/** Read, and genuinely no payment yet — the sentence the seed used to fake. */
@PreviewTest
@Preview(name = "Order details no payment", locale = "ar")
@Composable
fun orderDetailsNoPayment() = details(order = ORDER, payments = emptyList())

/**
 * The gate's three states, which nothing had drawn.
 *
 * NotBuilt is the one that matters: it carries no upgrade affordance at all,
 * because a path no plan change can open must not look like a path.
 */
@PreviewTest
@Preview(name = "Order details ocr locked by plan", locale = "ar")
@Composable
fun orderDetailsOcrLockedByPlan() =
    details(order = ORDER, payments = emptyList(), ocr = FeatureAvailability.LockedByPlan)

@PreviewTest
@Preview(name = "Order details ocr not built", locale = "ar")
@Composable
fun orderDetailsOcrNotBuilt() =
    details(order = ORDER, payments = emptyList(), ocr = FeatureAvailability.NotBuilt)

@PreviewTest
@Preview(name = "Order details verifying proof", locale = "ar")
@Composable
fun orderDetailsVerifyingProof() =
    details(order = ORDER, payments = emptyList(), proof = ProofUiState.Running)

// ---- error: the server refused this order ------------------------------

@PreviewTest
@Preview(name = "Order details refused light", locale = "ar")
@Composable
fun orderDetailsRefusedLight() = details(
    order = ORDER.copy(order = ORDER.order.copy(remoteId = null)),
    payments = emptyList(),
    refusalCode = "stock_unavailable",
)

@PreviewTest
@Preview(name = "Order details refused dark", locale = "ar")
@Composable
fun orderDetailsRefusedDark() = details(
    order = ORDER.copy(order = ORDER.order.copy(remoteId = null)),
    payments = emptyList(),
    refusalCode = "stock_unavailable",
    dark = true,
)

// ================= new order =================

private fun product(id: Long, name: String, price: Long, stock: Int) = ProductEntity(
    id = id,
    name = name,
    priceMinor = price,
    currency = "EGP",
    stock = stock,
)

private val CATALOGUE = listOf(
    product(1, "عباية كلوش أسود", 45_000, 12),
    product(2, "طرحة شيفون", 8_500, 2),
)

@Composable
private fun newOrder(
    state: NewOrderUiState,
    products: List<ProductEntity>?,
    totalMinor: Long = 0,
    currency: String? = null,
    dark: Boolean = false,
) {
    OrderakTheme(darkTheme = dark) {
        Surface {
            NewOrderContent(
                state = state,
                products = products,
                totalMinor = totalMinor,
                selectedCurrency = currency,
                actions = NewOrderActions(),
                onBack = {},
                onCreated = {},
            )
        }
    }
}

@PreviewTest
@Preview(name = "New order loading light", locale = "ar")
@Composable
fun newOrderLoadingLight() = newOrder(NewOrderUiState(), products = null)

@PreviewTest
@Preview(name = "New order loading dark", locale = "ar")
@Composable
fun newOrderLoadingDark() = newOrder(NewOrderUiState(), products = null, dark = true)

/** An empty form over a real catalogue — how a seller meets this screen. */
@PreviewTest
@Preview(name = "New order content light", locale = "ar")
@Composable
fun newOrderContentLight() = newOrder(NewOrderUiState(), products = CATALOGUE)

@PreviewTest
@Preview(name = "New order content dark", locale = "ar")
@Composable
fun newOrderContentDark() = newOrder(NewOrderUiState(), products = CATALOGUE, dark = true)

/** Filled in, with a basket and a total. */
@PreviewTest
@Preview(name = "New order filled", locale = "ar")
@Composable
fun newOrderFilled() = newOrder(
    NewOrderUiState(
        phone = "01000000001",
        name = "منى عبد الله",
        qty = mapOf(1L to 1, 2L to 2),
        payMethods = listOf(PayMethod.COD, PayMethod.INSTAPAY),
        payMethod = PayMethod.INSTAPAY,
    ),
    products = CATALOGUE,
    totalMinor = 62_000,
    currency = "EGP",
)

/**
 * No catalogue at all.
 *
 * An order needs something to sell, so this is a dead end unless it says where
 * to go — the seller has to add a product first.
 */
@PreviewTest
@Preview(name = "New order empty catalogue", locale = "ar")
@Composable
fun newOrderEmptyCatalogue() = newOrder(NewOrderUiState(), products = emptyList())

@PreviewTest
@Preview(name = "New order saving", locale = "ar")
@Composable
fun newOrderSaving() = newOrder(
    NewOrderUiState(phone = "01000000001", qty = mapOf(1L to 1), saving = true),
    products = CATALOGUE,
    totalMinor = 45_000,
    currency = "EGP",
)

/** The stock moved under the seller between opening the form and saving it. */
@PreviewTest
@Preview(name = "New order stock error light", locale = "ar")
@Composable
fun newOrderStockErrorLight() = newOrder(
    NewOrderUiState(phone = "01000000001", qty = mapOf(2L to 5), stockError = true),
    products = CATALOGUE,
    totalMinor = 42_500,
    currency = "EGP",
)

@PreviewTest
@Preview(name = "New order stock error dark", locale = "ar")
@Composable
fun newOrderStockErrorDark() = newOrder(
    NewOrderUiState(phone = "01000000001", qty = mapOf(2L to 5), stockError = true),
    products = CATALOGUE,
    totalMinor = 42_500,
    currency = "EGP",
    dark = true,
)
