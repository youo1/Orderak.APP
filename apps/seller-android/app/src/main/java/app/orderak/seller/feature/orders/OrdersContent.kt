package app.orderak.seller.feature.orders

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.LazyRow
import androidx.compose.foundation.lazy.items
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Add
import androidx.compose.material3.FilterChip
import androidx.compose.material3.FloatingActionButton
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalConfiguration
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.heading
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.unit.dp
import app.orderak.seller.R
import app.orderak.seller.core.text.formatCount
import app.orderak.seller.core.ui.FullScreenEmpty
import app.orderak.seller.core.ui.FullScreenError
import app.orderak.seller.core.ui.FullScreenLoading
import app.orderak.seller.core.ui.theme.LocalOrderakSpacing
import app.orderak.seller.data.db.OrderEntity
import app.orderak.seller.domain.OrderStatus

/**
 * الطلبات, as a function of its state.
 *
 * Split out of `OrdersScreen` for the reason `StoreContent` was: the screen
 * reads three flows off a Hilt view model, so no preview could construct it,
 * so a surface declaring four states had renders of none of them.
 *
 * The `initialFilter` handshake stays behind in `OrdersScreen`. It is a
 * navigation effect — a اليوم counter asking for a filter, once — and not
 * something this surface can be in the middle of.
 */
data class OrdersUiState(
    /** null until Room answers. Not `emptyList()`, which is a different claim. */
    val orders: List<OrderEntity>? = null,
    val filter: OrdersFilter = OrdersFilter.All,
    /** Orders the server refused, so the list can separate them from the ones still on their way. */
    val refusedPushes: Set<Long> = emptySet(),
    /** True when the local Room read itself failed, not merely "not read yet". */
    val loadError: Boolean = false,
)

@Composable
fun OrdersContent(
    state: OrdersUiState,
    onOpen: (Long) -> Unit,
    onNew: () -> Unit,
    onFilter: (OrdersFilter) -> Unit,
    onRetry: () -> Unit,
    modifier: Modifier = Modifier,
) {
    val spacing = LocalOrderakSpacing.current
    val list = state.orders
    val filter = state.filter

    Box(modifier.fillMaxSize()) {
        if (state.loadError) {
            // The one case list==null cannot distinguish on its own: a Room read
            // that actually threw, rather than one still in flight. Falls back to
            // an empty list upstream so this does not fight the loading check
            // below for the same null.
            //
            // The retry is the point. This state used to be a dead end: the read
            // that failed could not be re-run, so the seller's only way out was
            // to kill the app. `FullScreenError` had accepted an `onRetry` all
            // along — nothing passed one.
            FullScreenError(
                message = stringResource(R.string.error_unknown),
                onRetry = onRetry,
            )
        } else if (list == null) {
            // The state this screen declared and never had. An empty list stood
            // in for "not read yet", so the empty state — whose action is
            // "record an order" — greeted a seller who already had some.
            FullScreenLoading()
        } else if (list.isEmpty() && filter == OrdersFilter.All) {
            // The shared empty state, and it carries an action. "Nothing here"
            // without a next step is a dead end, and a seller on day one meets
            // this screen before any other.
            FullScreenEmpty(
                message = stringResource(R.string.orders_empty),
                actionLabel = stringResource(R.string.order_new_title),
                onAction = onNew,
            )
        } else {
            Column {
                LazyRow(
                    contentPadding = PaddingValues(horizontal = spacing.space4, vertical = spacing.space2),
                    horizontalArrangement = Arrangement.spacedBy(spacing.space2),
                ) {
                    item {
                        FilterChip(
                            selected = filter == OrdersFilter.All,
                            onClick = { onFilter(OrdersFilter.All) },
                            label = { Text(stringResource(R.string.orders_all)) },
                        )
                    }
                    // The three اليوم counters, as chips. They are here so the
                    // filter a counter opens is one the seller can also see,
                    // clear and re-apply — arriving in a state with no visible
                    // control is how a filtered list reads as a broken one.
                    item {
                        FilterChip(
                            selected = filter == OrdersFilter.Today,
                            onClick = { onFilter(OrdersFilter.Today) },
                            label = { Text(stringResource(R.string.dash_today_orders)) },
                        )
                    }
                    item {
                        FilterChip(
                            selected = filter == OrdersFilter.Unpaid,
                            onClick = { onFilter(OrdersFilter.Unpaid) },
                            label = { Text(stringResource(R.string.dash_unpaid)) },
                        )
                    }
                    item {
                        FilterChip(
                            selected = filter == OrdersFilter.ToShip,
                            onClick = { onFilter(OrdersFilter.ToShip) },
                            label = { Text(stringResource(R.string.dash_to_ship)) },
                        )
                    }
                    items(OrderStatus.entries.filter { it != OrderStatus.CANCELLED }) { st ->
                        FilterChip(
                            selected = filter == OrdersFilter.Status(st),
                            onClick = { onFilter(OrdersFilter.Status(st)) },
                            label = { Text(statusLabel(st)) },
                        )
                    }
                }
                if (list.isEmpty()) {
                    // Filtered to nothing is a different situation from having no
                    // orders at all: the fix is to clear the filter, not to sell
                    // something.
                    FullScreenEmpty(
                        message = stringResource(R.string.orders_empty_filtered),
                        actionLabel = stringResource(R.string.orders_all),
                        onAction = { onFilter(OrdersFilter.All) },
                    )
                } else {
                    // Split where the order already splits.
                    //
                    // `needsSellerFirst` sorts the list into "still yours to move"
                    // and "finished or cancelled", and the row already draws a rail
                    // and a chip from the same predicate. Without the headings the
                    // sort would be invisible — a priority-ordered list with nothing
                    // naming the priority reads exactly like an arbitrary one, which
                    // is what this list was until now.
                    val (waiting, rest) = list.partition { o ->
                        runCatching { OrderStatus.valueOf(o.status) }
                            .getOrDefault(OrderStatus.NEW)
                            .needsSeller
                    }
                    LazyColumn(
                        contentPadding = PaddingValues(spacing.space4),
                        verticalArrangement = Arrangement.spacedBy(spacing.space2),
                    ) {
                        if (waiting.isNotEmpty()) {
                            item(key = "group-waiting") {
                                GroupHeading(stringResource(R.string.orders_group_waiting), waiting.size)
                            }
                            items(waiting, key = { it.id }) { o ->
                                OrderCard(o, refused = o.id in state.refusedPushes, onClick = { onOpen(o.id) })
                            }
                        }
                        if (rest.isNotEmpty()) {
                            item(key = "group-rest") {
                                GroupHeading(stringResource(R.string.orders_group_rest), rest.size)
                            }
                            items(rest, key = { it.id }) { o ->
                                OrderCard(o, refused = o.id in state.refusedPushes, onClick = { onOpen(o.id) })
                            }
                        }
                        item { Spacer(Modifier.height(spacing.fabClearance)) }
                    }
                }
            }
        }
        FloatingActionButton(
            onClick = onNew,
            modifier = Modifier.align(Alignment.BottomEnd).padding(spacing.space4),
        ) { Icon(Icons.Filled.Add, contentDescription = stringResource(R.string.order_new_title)) }
    }
}

/**
 * A group heading that also carries the count.
 *
 * The count is not decoration: it answers the question the list exists to answer,
 * in the place a seller reads before scrolling. `formatCount` gives it the locale's
 * digits — these lists printed Latin numerals under an Arabic heading before
 * `core/text/Counts.kt` existed.
 */
@Composable
private fun GroupHeading(label: String, count: Int) {
    val spacing = LocalOrderakSpacing.current
    val locale = LocalConfiguration.current.locales[0]
    Row(
        Modifier.fillMaxWidth().padding(top = spacing.space2),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Text(
            label,
            style = MaterialTheme.typography.titleMedium,
            modifier = Modifier.weight(1f).semantics { heading() },
        )
        Text(
            formatCount(count, locale),
            style = MaterialTheme.typography.labelLarge,
            color = MaterialTheme.colorScheme.onSurfaceVariant,
        )
    }
}
