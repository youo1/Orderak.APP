package app.orderak.seller.feature.products

import androidx.compose.material3.Surface
import androidx.compose.runtime.Composable
import androidx.compose.ui.tooling.preview.Preview
import app.orderak.seller.core.ui.theme.OrderakTheme
import app.orderak.seller.data.db.CategoryEntity
import com.android.tools.screenshot.PreviewTest

/**
 * The product form, in every state its contract declares.
 *
 * `state.loaded` is why this screen has a loading state at all: it was computed
 * in three places in the view model and read in none, so opening an existing
 * product drew an empty form first — blank name, stock "1" — and swapped in the
 * real values when Room answered, overwriting anything the seller typed in
 * between.
 *
 * The two renders worth the most here are the write failures. A Class A write
 * does not queue, so `writeError` present means nothing was saved anywhere, and
 * `stockConflict` holds both numbers because the seller resolves it — nothing is
 * chosen for them and nothing is retried, since an automatic re-send would
 * overwrite the decrement a buyer's order had just made.
 *
 * All Arabic: `ar` is the primary direction, so the render is what a seller sees.
 */

private val CATEGORIES = listOf(
    CategoryEntity(id = 1, name = "عبايات", categoryCode = "c-000001"),
    CategoryEntity(id = 2, name = "طرح", categoryCode = "c-000002"),
)

private val PRODUCT = ProductEditUiState(
    id = 7,
    loaded = true,
    name = "عباية كلوش أسود",
    description = "قماش كريب، مقاسات من S لـ XL",
    priceText = "450",
    currency = "EGP",
    stockText = "12",
    categoryCode = "c-000001",
    available = true,
)

@Composable
private fun edit(
    state: ProductEditUiState,
    confirmDelete: Boolean = false,
    dark: Boolean = false,
) {
    OrderakTheme(darkTheme = dark) {
        Surface {
            ProductEditContent(
                state = state,
                categories = CATEGORIES,
                confirmDelete = confirmDelete,
                actions = ProductEditActions(),
                onPickImage = {},
                onConfirmDelete = {},
                onBack = {},
                onLimitReached = {},
            )
        }
    }
}

// ---- loading: the product has not been read yet ------------------------

@PreviewTest
@Preview(name = "Product edit loading light", locale = "ar")
@Composable
fun productEditLoadingLight() = edit(ProductEditUiState(id = 7, loaded = false))

@PreviewTest
@Preview(name = "Product edit loading dark", locale = "ar")
@Composable
fun productEditLoadingDark() = edit(ProductEditUiState(id = 7, loaded = false), dark = true)

// ---- content -----------------------------------------------------------

@PreviewTest
@Preview(name = "Product edit content light", locale = "ar")
@Composable
fun productEditContentLight() = edit(PRODUCT)

@PreviewTest
@Preview(name = "Product edit content dark", locale = "ar")
@Composable
fun productEditContentDark() = edit(PRODUCT, dark = true)

/** A new product: no id, so no delete, and the title says add rather than edit. */
@PreviewTest
@Preview(name = "Product edit new", locale = "ar")
@Composable
fun productEditNew() = edit(ProductEditUiState(id = 0, loaded = true))

/** Hidden from the catalogue. The seller owns this, so it is a switch, not a state. */
@PreviewTest
@Preview(name = "Product edit unavailable", locale = "ar")
@Composable
fun productEditUnavailable() = edit(PRODUCT.copy(available = false))

@PreviewTest
@Preview(name = "Product edit saving", locale = "ar")
@Composable
fun productEditSaving() = edit(PRODUCT.copy(saving = true))

@PreviewTest
@Preview(name = "Product edit confirm delete", locale = "ar")
@Composable
fun productEditConfirmDelete() = edit(PRODUCT, confirmDelete = true)

// ---- the write failed, and nothing was saved anywhere -------------------

/**
 * Offline.
 *
 * The one that has to be unmistakable: a Class A write does not queue, so
 * closing the editor here loses the edit. Saying "saved" would be a lie and
 * saying nothing is worse.
 */
@PreviewTest
@Preview(name = "Product edit offline", locale = "ar")
@Composable
fun productEditOffline() = edit(PRODUCT.copy(writeError = ProductWriteError.OFFLINE))

@PreviewTest
@Preview(name = "Product edit offline dark", locale = "ar")
@Composable
fun productEditOfflineDark() =
    edit(PRODUCT.copy(writeError = ProductWriteError.OFFLINE), dark = true)

/** A plan boundary rather than a fault — the editor keeps what was typed. */
@PreviewTest
@Preview(name = "Product edit plan limit", locale = "ar")
@Composable
fun productEditPlanLimit() = edit(PRODUCT.copy(writeError = ProductWriteError.PLAN_LIMIT))

/** The category was deleted while the editor was open. */
@PreviewTest
@Preview(name = "Product edit unknown category", locale = "ar")
@Composable
fun productEditUnknownCategory() =
    edit(PRODUCT.copy(writeError = ProductWriteError.UNKNOWN_CATEGORY))

// ---- the shop disagrees about stock -------------------------------------
// Both numbers, because the seller decides: take the shop's figure, or re-apply
// their own against the revision the server returned.

@PreviewTest
@Preview(name = "Product edit stock conflict", locale = "ar")
@Composable
fun productEditStockConflict() = edit(
    PRODUCT.copy(stockConflict = StockConflict(yours = 12, shop = 9, shopVersion = 41)),
)

@PreviewTest
@Preview(name = "Product edit stock conflict dark", locale = "ar")
@Composable
fun productEditStockConflictDark() = edit(
    PRODUCT.copy(stockConflict = StockConflict(yours = 12, shop = 9, shopVersion = 41)),
    dark = true,
)
