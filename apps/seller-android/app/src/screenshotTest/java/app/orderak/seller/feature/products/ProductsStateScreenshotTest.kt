package app.orderak.seller.feature.products

import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.Inbox
import androidx.compose.material3.Surface
import androidx.compose.runtime.Composable
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.tooling.preview.Preview
import app.orderak.seller.R
import app.orderak.seller.core.ui.FullScreenEmpty
import app.orderak.seller.core.ui.FullScreenLoading
import app.orderak.seller.core.ui.theme.OrderakTheme
import com.android.tools.screenshot.PreviewTest

/**
 * The store surface's loading and empty states, which must not look alike.
 *
 * WHAT SHIPPED
 *   `ProductsScreen` branched on `products.isEmpty() && quota.limit == null`, so
 *   the real empty state was reachable only on an UNLIMITED plan. Free is 20, so
 *   for almost every seller an empty catalogue fell through to the branch below,
 *   where an empty catalogue and an empty SEARCH are the same test — and a
 *   seller on their first session was shown
 *
 *       «مفيش منتج مطابق لـ «»»      no product matches ""
 *
 *   with a "clear search" button, for a search they had never typed.
 *
 *   The catalogue also seeded as an empty list, so the same screen greeted a
 *   seller with forty products on every cold start until Room answered.
 *
 * These three renders are the distinction, drawn side by side so a future change
 * that collapses any two of them fails here.
 */
@PreviewTest
@Preview(name = "Products loading", locale = "ar")
@Composable
fun productsLoading() {
    OrderakTheme(darkTheme = false) { Surface { FullScreenLoading() } }
}

/** No products at all. The seller is told how to get their first one. */
@PreviewTest
@Preview(name = "Products empty catalogue", locale = "ar")
@Composable
fun productsEmptyCatalogue() {
    OrderakTheme(darkTheme = false) {
        Surface {
            FullScreenEmpty(
                message = stringResource(R.string.products_empty),
                icon = Icons.Outlined.Inbox,
            )
        }
    }
}

/**
 * Products exist; this query matched none of them. The way out is to clear the
 * search — which is why this one carries an action and the empty catalogue does
 * not. Naming the query is what stops it reading as "your products are gone".
 */
@PreviewTest
@Preview(name = "Products search empty", locale = "ar")
@Composable
fun productsSearchEmpty() {
    OrderakTheme(darkTheme = false) {
        Surface {
            FullScreenEmpty(
                message = stringResource(R.string.products_search_empty, "شوكولاتة"),
                actionLabel = stringResource(R.string.search_clear_action),
                onAction = {},
            )
        }
    }
}

@PreviewTest
@Preview(name = "Products empty catalogue dark", locale = "ar")
@Composable
fun productsEmptyCatalogueDark() {
    OrderakTheme(darkTheme = true) {
        Surface {
            FullScreenEmpty(
                message = stringResource(R.string.products_empty),
                icon = Icons.Outlined.Inbox,
            )
        }
    }
}
