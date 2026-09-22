package app.orderak.seller.feature.customers

import androidx.compose.material3.Surface
import androidx.compose.runtime.Composable
import androidx.compose.ui.tooling.preview.Preview
import app.orderak.seller.core.ui.theme.OrderakTheme
import app.orderak.seller.data.db.CustomerSummary
import com.android.tools.screenshot.PreviewTest

/**
 * العملاء, in every state its contract declares — rendered through the screen.
 *
 * The empty render is the one worth looking at: it carries NO action, on
 * purpose. A customer row is created by an order arriving, so there is nothing
 * for a seller to press until one does, and a button that cannot help is worse
 * than no button. Beside the orders empty state — which is all action — it is
 * the clearest statement of the rule.
 *
 * All Arabic: `ar` is the primary direction, so the render is what a seller sees.
 */

private fun customer(
    key: String,
    name: String?,
    phone: String,
    orders: Int,
    totalMinor: Long,
    currency: String? = "EGP",
    currencyCount: Int = 1,
) = CustomerSummary(
    customerKey = key,
    phone = phone,
    name = name,
    ordersCount = orders,
    totalMinor = totalMinor,
    currencyCount = currencyCount,
    currency = currency,
)

private val CUSTOMERS = listOf(
    customer("c1", "منى عبد الله", "01000000001", 7, 312_000),
    customer("c2", "أحمد يسري", "01000000002", 2, 95_500),
    // No name yet: the phone IS the identity, so the row still has to read.
    customer("c3", null, "01000000003", 1, 45_000),
    // Orders in more than one currency, so the total is a sum of unlike things
    // and must not be shown as one.
    customer("c4", "هدى مصطفى", "01000000004", 5, 210_000, currency = null, currencyCount = 2),
)

@Composable
private fun customers(
    state: CustomersUiState,
    query: String = "",
    dark: Boolean = false,
) {
    OrderakTheme(darkTheme = dark) {
        Surface {
            CustomersContent(state = state, query = query, onQueryChange = {}, onOpen = {})
        }
    }
}

// ---- loading: aggregated from orders, so the slowest list to arrive ----

@PreviewTest
@Preview(name = "Customers loading light", locale = "ar")
@Composable
fun customersLoadingLight() = customers(CustomersUiState(customers = null))

@PreviewTest
@Preview(name = "Customers loading dark", locale = "ar")
@Composable
fun customersLoadingDark() = customers(CustomersUiState(customers = null), dark = true)

// ---- content ----------------------------------------------------------

@PreviewTest
@Preview(name = "Customers content light", locale = "ar")
@Composable
fun customersContentLight() = customers(CustomersUiState(customers = CUSTOMERS))

@PreviewTest
@Preview(name = "Customers content dark", locale = "ar")
@Composable
fun customersContentDark() = customers(CustomersUiState(customers = CUSTOMERS), dark = true)

// ---- empty: no action, and no search box over nothing ------------------

@PreviewTest
@Preview(name = "Customers empty light", locale = "ar")
@Composable
fun customersEmptyLight() = customers(CustomersUiState(customers = emptyList()))

@PreviewTest
@Preview(name = "Customers empty dark", locale = "ar")
@Composable
fun customersEmptyDark() = customers(CustomersUiState(customers = emptyList()), dark = true)

// ---- error: a customer whose orders are in unlike currencies -----------
// The surface's failure mode is a total it cannot honestly add up, not a lost
// connection: the list is aggregated from orders already on the device. The row
// keeps the count and withholds the sum rather than printing a wrong one.

@PreviewTest
@Preview(name = "Customers error light", locale = "ar")
@Composable
fun customersErrorLight() = customers(
    CustomersUiState(customers = CUSTOMERS.filter { it.currencyCount > 1 }),
)

@PreviewTest
@Preview(name = "Customers error dark", locale = "ar")
@Composable
fun customersErrorDark() = customers(
    CustomersUiState(customers = CUSTOMERS.filter { it.currencyCount > 1 }),
    dark = true,
)

// ---- a search matching nothing is not an empty customer list -----------

@PreviewTest
@Preview(name = "Customers search empty", locale = "ar")
@Composable
fun customersSearchEmpty() = customers(CustomersUiState(customers = CUSTOMERS), query = "سلمى")
