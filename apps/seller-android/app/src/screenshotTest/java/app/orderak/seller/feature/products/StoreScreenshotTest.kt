package app.orderak.seller.feature.products

import androidx.compose.material3.Surface
import androidx.compose.runtime.Composable
import androidx.compose.ui.tooling.preview.Preview
import app.orderak.seller.core.ui.theme.OrderakTheme
import app.orderak.seller.data.db.ProductEntity
import com.android.tools.screenshot.PreviewTest

/**
 * المتجر, in every state its contract declares — rendered through the screen.
 *
 * WHY THIS REPLACES WHAT WAS HERE
 *   `ProductsStateScreenshotTest` called `FullScreenEmpty` and `FullScreenLoading`
 *   directly, with the store's strings passed in by hand. Those renders stay
 *   green no matter what `ProductsScreen` decides to show — they prove the
 *   component and the string, and nothing about the screen. That is the exact
 *   blind spot `render-coverage.mjs` was written to close, so leaving them as
 *   the store's evidence while adding a guard that says they are not evidence
 *   would be writing the rule and then not following it.
 *
 *   `StoreContent(state, ...)` is the screen, so these are the same states
 *   reached the way a seller reaches them.
 *
 * All Arabic: `ar` is the primary direction, so the render is what a seller sees.
 */

private fun product(
    id: Long,
    name: String,
    priceMinor: Long,
    stock: Int,
    code: String? = null,
) = ProductEntity(
    id = id,
    name = name,
    priceMinor = priceMinor,
    currency = "EGP",
    stock = stock,
    productCode = code,
)

private val CATALOGUE = listOf(
    product(1, "عباية كلوش أسود", 45_000, 12, "AB-01"),
    product(2, "طرحة شيفون", 8_500, 2, "TR-04"),
    product(3, "فستان سواريه", 120_000, 0, "FS-11"),
    product(4, "بلوزة قطن", 22_000, 34, "BL-07"),
)

private val QUOTA = ProductQuotaUiState(used = 4, limit = 20, canAdd = true)

@Composable
private fun store(
    state: StoreUiState,
    query: String = "",
    dark: Boolean = false,
) {
    OrderakTheme(darkTheme = dark) {
        Surface {
            StoreContent(
                state = state,
                query = query,
                onQueryChange = {},
                onAdd = {},
                onLimitReached = {},
                onEdit = {},
                onShare = {},
                onShowStuck = {},
            )
        }
    }
}

// ---- loading: products is null, not empty ------------------------------
// The distinction this whole file exists for. Seeded as emptyList(), a seller
// with a full catalogue met "add your first product" on every cold start.

@PreviewTest
@Preview(name = "Store loading light", locale = "ar")
@Composable
fun storeLoadingLight() = store(StoreUiState(products = null))

@PreviewTest
@Preview(name = "Store loading dark", locale = "ar")
@Composable
fun storeLoadingDark() = store(StoreUiState(products = null), dark = true)

// ---- content ----------------------------------------------------------

@PreviewTest
@Preview(name = "Store content light", locale = "ar")
@Composable
fun storeContentLight() = store(StoreUiState(products = CATALOGUE, quota = QUOTA))

@PreviewTest
@Preview(name = "Store content dark", locale = "ar")
@Composable
fun storeContentDark() = store(StoreUiState(products = CATALOGUE, quota = QUOTA), dark = true)

// ---- empty: a real catalogue count, and no search affordance -----------

@PreviewTest
@Preview(name = "Store empty light", locale = "ar")
@Composable
fun storeEmptyLight() = store(StoreUiState(products = emptyList(), quota = ProductQuotaUiState(used = 0)))

@PreviewTest
@Preview(name = "Store empty dark", locale = "ar")
@Composable
fun storeEmptyDark() =
    store(StoreUiState(products = emptyList(), quota = ProductQuotaUiState(used = 0)), dark = true)

// ---- error: the catalogue cannot refresh while products are stuck ------
// The store contract's error state is not a blank screen. Products saved here
// that never reached the account block the refresh entirely, so the surface
// still lists what Room holds and says the sync is stopped over the top of it.

@PreviewTest
@Preview(name = "Store error light", locale = "ar")
@Composable
fun storeErrorLight() = store(StoreUiState(products = CATALOGUE, quota = QUOTA, stuckCount = 2))

@PreviewTest
@Preview(name = "Store error dark", locale = "ar")
@Composable
fun storeErrorDark() =
    store(StoreUiState(products = CATALOGUE, quota = QUOTA, stuckCount = 2), dark = true)

// ---- a search matching nothing is not an empty catalogue ---------------

@PreviewTest
@Preview(name = "Store search empty", locale = "ar")
@Composable
fun storeSearchEmpty() = store(StoreUiState(products = CATALOGUE, quota = QUOTA), query = "جاكيت")

// ---- at the plan limit the FAB locks rather than disappearing ----------
// A control that vanishes reads as a bug; one that locks says a plan decides
// this. LockedByPlan, not NotBuilt — so it keeps its upgrade affordance.

@PreviewTest
@Preview(name = "Store at plan limit", locale = "ar")
@Composable
fun storeAtLimit() = store(
    StoreUiState(products = CATALOGUE, quota = ProductQuotaUiState(used = 20, limit = 20, canAdd = false)),
)
