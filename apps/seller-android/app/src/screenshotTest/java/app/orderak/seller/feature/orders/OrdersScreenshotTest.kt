package app.orderak.seller.feature.orders

import androidx.compose.material3.Surface
import androidx.compose.runtime.Composable
import androidx.compose.ui.tooling.preview.Preview
import app.orderak.seller.core.ui.theme.OrderakTheme
import app.orderak.seller.data.db.OrderEntity
import app.orderak.seller.domain.OrderStatus
import com.android.tools.screenshot.PreviewTest

/**
 * الطلبات, in every state its contract declares — rendered through the screen.
 *
 * `OrderListScreenshotTest` next door renders real `OrderCard`s in a hand-built
 * Column. That proves the card, which is worth proving, and it is classified as
 * a component in render-coverage.mjs for exactly that reason: it has no chips,
 * no filter, no empty state, and stays green whatever `OrdersScreen` does. This
 * file renders `OrdersContent(state, ...)`, which is the screen.
 *
 * All Arabic: `ar` is the primary direction, so the render is what a seller sees.
 */

private fun order(
    id: Long,
    name: String,
    status: OrderStatus,
    total: Long,
    remoteId: Long? = id,
    createdAt: Long = 1_757_000_000_000,
) = OrderEntity(
    id = id,
    remoteId = remoteId,
    buyerName = name,
    buyerPhone = "0100000000$id",
    status = status.name,
    payMethod = "CASH",
    totalMinor = total,
    currency = "EGP",
    createdAt = createdAt,
)

private val ORDERS = listOf(
    order(1, "منى عبد الله", OrderStatus.NEW, 45_000),
    order(2, "أحمد يسري", OrderStatus.PAID, 87_500),
    // Typed in by the seller: same status family as the rows around it, so the
    // marker is the only thing separating them.
    order(3, "كريم فؤاد", OrderStatus.CONFIRMED, 120_000, remoteId = null),
    order(4, "هدى مصطفى", OrderStatus.SHIPPED, 64_000),
)

@Composable
private fun orders(
    state: OrdersUiState,
    dark: Boolean = false,
) {
    OrderakTheme(darkTheme = dark) {
        Surface {
            OrdersContent(state = state, onOpen = {}, onNew = {}, onFilter = {})
        }
    }
}

// ---- loading: orders is null, not empty -------------------------------

@PreviewTest
@Preview(name = "Orders loading light", locale = "ar")
@Composable
fun ordersLoadingLight() = orders(OrdersUiState(orders = null))

@PreviewTest
@Preview(name = "Orders loading dark", locale = "ar")
@Composable
fun ordersLoadingDark() = orders(OrdersUiState(orders = null), dark = true)

// ---- content ----------------------------------------------------------

@PreviewTest
@Preview(name = "Orders content light", locale = "ar")
@Composable
fun ordersContentLight() = orders(OrdersUiState(orders = ORDERS))

@PreviewTest
@Preview(name = "Orders content dark", locale = "ar")
@Composable
fun ordersContentDark() = orders(OrdersUiState(orders = ORDERS), dark = true)

// ---- empty: no orders at all, and the chips are not drawn --------------
// Deliberately without the filter row: handing a seller on day one four chips
// to filter nothing with is how an empty screen reads as a broken one.

@PreviewTest
@Preview(name = "Orders empty light", locale = "ar")
@Composable
fun ordersEmptyLight() = orders(OrdersUiState(orders = emptyList()))

@PreviewTest
@Preview(name = "Orders empty dark", locale = "ar")
@Composable
fun ordersEmptyDark() = orders(OrdersUiState(orders = emptyList()), dark = true)

// ---- error: the server refused one of them ----------------------------
// Not a blank screen. The orders are on the device either way, so the surface
// keeps listing them and marks the one that did not reach the account — losing
// the list to report a sync failure would be the worse trade.

@PreviewTest
@Preview(name = "Orders error light", locale = "ar")
@Composable
fun ordersErrorLight() = orders(OrdersUiState(orders = ORDERS, refusedPushes = setOf(3L)))

@PreviewTest
@Preview(name = "Orders error dark", locale = "ar")
@Composable
fun ordersErrorDark() = orders(OrdersUiState(orders = ORDERS, refusedPushes = setOf(3L)), dark = true)

// ---- filtered to none is not empty ------------------------------------
// The chips stay, because the way out is to clear one.

@PreviewTest
@Preview(name = "Orders filtered to none", locale = "ar")
@Composable
fun ordersFilteredToNone() =
    orders(OrdersUiState(orders = emptyList(), filter = OrdersFilter.Unpaid))

// ---- a counter's filter, applied and visible --------------------------
// A اليوم counter opens this surface already filtered. The chip shows which
// one, so the seller can see it, clear it and re-apply it.

@PreviewTest
@Preview(name = "Orders filtered unpaid", locale = "ar")
@Composable
fun ordersFilteredUnpaid() = orders(
    OrdersUiState(
        orders = ORDERS.filter { it.status == OrderStatus.NEW.name || it.status == OrderStatus.CONFIRMED.name },
        filter = OrdersFilter.Unpaid,
    ),
)
