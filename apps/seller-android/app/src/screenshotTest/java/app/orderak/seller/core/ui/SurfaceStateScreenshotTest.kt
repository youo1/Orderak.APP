package app.orderak.seller.core.ui

import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.Group
import androidx.compose.material.icons.outlined.Inbox
import androidx.compose.material3.Surface
import androidx.compose.runtime.Composable
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.tooling.preview.Preview
import app.orderak.seller.R
import app.orderak.seller.core.ui.theme.OrderakTheme
import com.android.tools.screenshot.PreviewTest

/**
 * The states every surface declares, drawn side by side so the ones that must
 * differ cannot quietly converge.
 *
 * WHY THIS FILE IS SHARED RATHER THAN PER-SURFACE
 *   Four surfaces hit the same three defects, and the fix was the same shape in
 *   each: an empty list stood in for "not read yet", so the empty state — whose
 *   copy tells a seller what to do — greeted one who already had the thing. The
 *   distinction is a property of the shared components, so it is asserted once
 *   on them rather than four times through four view models that cannot be
 *   constructed in a preview.
 *
 *   The per-surface layouts are covered by their own files (TodayScreenshotTest,
 *   ProductsStateScreenshotTest, OrderListScreenshotTest).
 *
 * All Arabic: `ar` is the primary direction, so the render is what a seller sees.
 */

// ---- loading is not empty ---------------------------------------------

@PreviewTest
@Preview(name = "State loading", locale = "ar")
@Composable
fun stateLoading() {
    OrderakTheme(darkTheme = false) { Surface { FullScreenLoading() } }
}

@PreviewTest
@Preview(name = "State loading dark", locale = "ar")
@Composable
fun stateLoadingDark() {
    OrderakTheme(darkTheme = true) { Surface { FullScreenLoading() } }
}

// ---- orders: empty vs filtered-to-none --------------------------------
// Different situations with different ways out: record an order, versus clear
// the filter. Same sentence for both would read as "your orders are gone".

@PreviewTest
@Preview(name = "Orders empty", locale = "ar")
@Composable
fun ordersEmptyState() {
    OrderakTheme(darkTheme = false) {
        Surface {
            FullScreenEmpty(
                message = stringResource(R.string.orders_empty),
                actionLabel = stringResource(R.string.order_new_title),
                onAction = {},
                icon = Icons.Outlined.Inbox,
            )
        }
    }
}

@PreviewTest
@Preview(name = "Orders filtered to none", locale = "ar")
@Composable
fun ordersFilteredEmptyState() {
    OrderakTheme(darkTheme = false) {
        Surface {
            FullScreenEmpty(
                message = stringResource(R.string.orders_empty_filtered),
                actionLabel = stringResource(R.string.orders_all),
                onAction = {},
            )
        }
    }
}

// ---- customers: empty carries NO action -------------------------------

/**
 * Deliberately actionless.
 *
 * A customer row is created by an order arriving, so there is nothing here for
 * a seller to press until one does. A button that cannot help is worse than no
 * button — which is why this render exists beside the two above, where the
 * action is the whole point.
 */
@PreviewTest
@Preview(name = "Customers empty", locale = "ar")
@Composable
fun customersEmptyState() {
    OrderakTheme(darkTheme = false) {
        Surface {
            FullScreenEmpty(
                message = stringResource(R.string.customers_empty),
                icon = Icons.Outlined.Group,
            )
        }
    }
}

@PreviewTest
@Preview(name = "Customers empty dark", locale = "ar")
@Composable
fun customersEmptyStateDark() {
    OrderakTheme(darkTheme = true) {
        Surface {
            FullScreenEmpty(
                message = stringResource(R.string.customers_empty),
                icon = Icons.Outlined.Group,
            )
        }
    }
}

// ---- error carries a way back -----------------------------------------

@PreviewTest
@Preview(name = "State error", locale = "ar")
@Composable
fun stateError() {
    OrderakTheme(darkTheme = false) {
        Surface {
            FullScreenError(
                message = stringResource(R.string.sync_failed),
                onRetry = {},
            )
        }
    }
}

@PreviewTest
@Preview(name = "State error dark", locale = "ar")
@Composable
fun stateErrorDark() {
    OrderakTheme(darkTheme = true) {
        Surface {
            FullScreenError(
                message = stringResource(R.string.sync_failed),
                onRetry = {},
            )
        }
    }
}
