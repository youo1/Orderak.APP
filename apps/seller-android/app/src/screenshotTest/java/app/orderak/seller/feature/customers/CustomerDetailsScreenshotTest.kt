package app.orderak.seller.feature.customers

import androidx.compose.material3.Surface
import androidx.compose.runtime.Composable
import androidx.compose.ui.tooling.preview.Preview
import app.orderak.seller.core.ui.theme.OrderakTheme
import app.orderak.seller.data.db.CustomerEntity
import app.orderak.seller.data.db.OrderEntity
import app.orderak.seller.domain.OrderStatus
import com.android.tools.screenshot.PreviewTest

/**
 * One customer, in every state the contract declares.
 *
 * The defect here was a sentence the screen could never truthfully say. `orders`
 * seeded `emptyList()`, so the page told the seller "no orders yet" about a
 * customer whose row exists BECAUSE an order arrived — every time, until Room
 * answered.
 *
 * All Arabic: `ar` is the primary direction, so the render is what a seller sees.
 */

private val CUSTOMER = CustomerEntity(
    customerKey = "EG-01000000001",
    phone = "01000000001",
    phoneE164 = "+201000000001",
    name = "منى عبد الله",
    altContact = "mona@example.com",
    note = "بتفضل الاستلام من الفرع",
)

private fun order(id: Long, status: OrderStatus, total: Long) = OrderEntity(
    id = id,
    remoteId = id,
    buyerPhone = "01000000001",
    buyerName = "منى عبد الله",
    status = status.name,
    payMethod = "CASH",
    totalMinor = total,
    currency = "EGP",
    createdAt = 1_757_000_000_000L + id * 86_400_000L,
)

private val ORDERS = listOf(
    order(1, OrderStatus.DONE, 45_000),
    order(2, OrderStatus.PAID, 87_500),
    order(3, OrderStatus.NEW, 32_000),
)

@Composable
private fun customer(
    customer: CustomerEntity?,
    orders: List<OrderEntity>?,
    editable: Boolean = true,
    dark: Boolean = false,
) {
    OrderakTheme(darkTheme = dark) {
        Surface {
            CustomerDetailsContent(
                customer = customer,
                orders = orders,
                customerKey = "EG-01000000001",
                editable = editable,
                name = customer?.name.orEmpty(),
                altContact = customer?.altContact.orEmpty(),
                note = customer?.note.orEmpty(),
                onName = {},
                onAltContact = {},
                onNote = {},
                onSave = { _, _, _ -> },
                onContact = {},
                onBack = {},
                onOpenOrder = {},
            )
        }
    }
}

// ---- loading: the row and its orders have not arrived ------------------
// The title falls back to the customer key, which is the only thing known at
// this point, rather than to a blank bar.

@PreviewTest
@Preview(name = "Customer loading light", locale = "ar")
@Composable
fun customerLoadingLight() = customer(customer = null, orders = null)

@PreviewTest
@Preview(name = "Customer loading dark", locale = "ar")
@Composable
fun customerLoadingDark() = customer(customer = null, orders = null, dark = true)

// ---- content ----------------------------------------------------------

@PreviewTest
@Preview(name = "Customer content light", locale = "ar")
@Composable
fun customerContentLight() = customer(customer = CUSTOMER, orders = ORDERS)

@PreviewTest
@Preview(name = "Customer content dark", locale = "ar")
@Composable
fun customerContentDark() = customer(customer = CUSTOMER, orders = ORDERS, dark = true)

/**
 * A customer with no name yet.
 *
 * The phone IS the identity, so the row still has to read — this is the
 * ordinary case for a customer created by a first order.
 */
@PreviewTest
@Preview(name = "Customer unnamed", locale = "ar")
@Composable
fun customerUnnamed() = customer(
    customer = CUSTOMER.copy(name = null, altContact = null, note = null),
    orders = ORDERS.take(1),
)

/**
 * Editing locked by plan.
 *
 * LockedByPlan, not NotBuilt: the fields are there and a plan decides whether
 * they can be changed, so they read rather than disappear.
 */
@PreviewTest
@Preview(name = "Customer read only", locale = "ar")
@Composable
fun customerReadOnly() = customer(customer = CUSTOMER, orders = ORDERS, editable = false)

// ---- error: the row is here and its orders came back empty -------------
// Read, and genuinely none — which the seed used to fake on every open. Kept
// separate from loading above precisely so the two cannot converge again.

@PreviewTest
@Preview(name = "Customer no orders light", locale = "ar")
@Composable
fun customerNoOrdersLight() = customer(customer = CUSTOMER, orders = emptyList())

@PreviewTest
@Preview(name = "Customer no orders dark", locale = "ar")
@Composable
fun customerNoOrdersDark() = customer(customer = CUSTOMER, orders = emptyList(), dark = true)
