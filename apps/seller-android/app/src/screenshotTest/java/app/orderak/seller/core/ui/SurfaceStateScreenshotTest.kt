package app.orderak.seller.core.ui

import androidx.compose.material3.Surface
import androidx.compose.runtime.Composable
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.tooling.preview.Preview
import app.orderak.seller.R
import app.orderak.seller.core.ui.theme.OrderakTheme
import com.android.tools.screenshot.PreviewTest

/**
 * The shared state components that no screen render reaches yet.
 *
 * WHY THIS FILE IS NOW TWO RENDERS AND NOT EIGHT
 *   It was written when no surface could be rendered at all, so it stood in for
 *   the screens: FullScreenEmpty with the orders copy, FullScreenLoading with
 *   the store's, and so on. Six of those eight are now superseded, because
 *   StoreContent, OrdersContent and CustomersContent render those same states
 *   through the screen — which proves that the screen chooses them, the thing a
 *   component render can never show.
 *
 *   Keeping both would be keeping the weaker evidence for its own sake, and it
 *   would inflate the render count with renders that prove nothing new.
 *
 *   [FullScreenError] is the exception, and it is here because it has two real
 *   callers — `PlansScreen` and `OperationsScreens` — and neither is a
 *   composable a preview can construct yet. When one of them is split the way
 *   the three surfaces were, this file goes away.
 *
 * All Arabic: `ar` is the primary direction, so the render is what a seller sees.
 */

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
