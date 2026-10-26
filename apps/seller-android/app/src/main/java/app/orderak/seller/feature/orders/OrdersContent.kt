package app.orderak.seller.feature.orders

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.Add
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.ModalBottomSheet
import androidx.compose.material3.rememberModalBottomSheetState
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.res.stringResource
import app.orderak.seller.R
import app.orderak.seller.core.ui.Banner
import app.orderak.seller.core.ui.BannerState
import app.orderak.seller.core.ui.EmptyState
import app.orderak.seller.core.ui.EmptyStateKind
import app.orderak.seller.core.ui.ErrorState
import app.orderak.seller.core.ui.ErrorStateKind
import app.orderak.seller.core.ui.Fab
import app.orderak.seller.core.ui.FilterChipRow
import app.orderak.seller.core.ui.PickerOption
import app.orderak.seller.core.ui.PickerSheet
import app.orderak.seller.core.ui.PickerSheetMode
import app.orderak.seller.core.ui.SectionHeader
import app.orderak.seller.core.ui.Skeleton
import app.orderak.seller.core.ui.SkeletonVariant
import app.orderak.seller.core.ui.TopBar
import app.orderak.seller.core.ui.theme.LocalOrderakSpacing
import app.orderak.seller.data.db.OrderEntity
import app.orderak.seller.domain.OrderStatus

/**
 * الطلبات, as a function of its state.
 *
 * Split out of `OrdersScreen` for the reason `StoreContent` was: the screen
 * reads flows off a Hilt view model, so no preview could construct it, so a
 * surface declaring four states had renders of none of them.
 *
 * The `initialFilter` handshake stays behind in `OrdersScreen`. It is a
 * navigation effect — a اليوم tile asking for a filter, once — and not
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
    /** How many lines each order has, by local id, so a row can say "3 items". */
    val itemCounts: Map<Long, Int> = emptyMap(),
)

/**
 * The list is the large title, a pinned row of filters, and the orders in two
 * sections: those that still need the seller, then those that are finished.
 *
 * The filters are the three questions a seller asks (unpaid, ready to ship, today)
 * and one chip, الحالة, that opens a sheet with the six exact statuses; when one
 * of them is chosen the chip says which. A banner appears only while a manual
 * order is still on this phone, or the server refused one.
 */
@OptIn(ExperimentalMaterial3Api::class)
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
    // `rememberSaveable`: a rotation must not close a sheet the seller opened.
    var statusSheet by rememberSaveable { mutableStateOf(false) }
    val noOrdersAtAll = list != null && list.isEmpty() && filter == OrdersFilter.All

    Box(modifier.fillMaxSize()) {
        Column(Modifier.fillMaxSize()) {
            TopBar(title = stringResource(R.string.nav_orders), large = true)
            when {
                state.loadError -> {
                    // The one case list==null cannot distinguish on its own: a Room read
                    // that actually threw, rather than one still in flight. The retry is
                    // the point: this state used to be a dead end.
                    ErrorState(
                        // The local read failed, not the service, so the title names what
                        // could not be read rather than the service's own cause.
                        kind = ErrorStateKind.ServiceUnavailable,
                        title = stringResource(R.string.error_state_orders_load_title),
                        message = stringResource(R.string.error_unknown),
                        onRetry = onRetry,
                    )
                }
                // Nothing at all to filter: the chips would only be noise. The shared empty
                // state carries an action, because "nothing here" without a next step is a
                // dead end and a seller on day one meets this screen before any other.
                noOrdersAtAll -> EmptyState(
                    kind = EmptyStateKind.Empty,
                    title = stringResource(R.string.orders_empty_title),
                    message = stringResource(R.string.orders_empty_body),
                    actionLabel = stringResource(R.string.orders_empty_action),
                    onAction = onNew,
                )
                else -> {
                    OrdersFilters(filter, onFilter, onMore = { statusSheet = true })
                    when {
                        // Still reading: rows under the real chips. An empty list stood in for
                        // "not read yet" before, and the empty state — whose action is "record
                        // an order" — greeted a seller who already had some.
                        list == null -> Skeleton(SkeletonVariant.ListRows, Modifier.padding(spacing.space4))
                        // Filtered to nothing is a different situation from having no orders:
                        // the fix is to clear the filter, not to sell something.
                        list.isEmpty() -> EmptyState(
                            kind = EmptyStateKind.FilteredToNothing,
                            title = stringResource(R.string.orders_filtered_title),
                            actionLabel = stringResource(R.string.orders_filtered_action),
                            onAction = { onFilter(OrdersFilter.All) },
                        )
                        else -> OrdersList(list, state, onOpen)
                    }
                }
            }
        }
        if (!noOrdersAtAll && !state.loadError) {
            Fab(
                label = stringResource(R.string.order_new_title),
                icon = Icons.Outlined.Add,
                onClick = onNew,
                modifier = Modifier.align(Alignment.BottomEnd).padding(spacing.space4),
            )
        }
    }

    if (statusSheet) {
        ModalBottomSheet(
            onDismissRequest = { statusSheet = false },
            sheetState = rememberModalBottomSheetState(skipPartiallyExpanded = true),
            containerColor = MaterialTheme.colorScheme.surface,
            // The kit's sheet draws its own top corners and handle.
            dragHandle = null,
            shape = RoundedCornerShape(spacing.space0),
        ) {
            val chosen = (filter as? OrdersFilter.Status)?.status
            PickerSheet(
                mode = PickerSheetMode.SingleChoice,
                title = stringResource(R.string.orders_status_sheet_title),
                options = OrderStatus.entries.map { PickerOption(it.name, statusLabel(it)) },
                selectedKey = chosen?.name,
                onSelect = { option ->
                    statusSheet = false
                    onFilter(OrdersFilter.Status(OrderStatus.valueOf(option.key)))
                },
                closeLabel = stringResource(R.string.sheet_close),
                onClose = { statusSheet = false },
            )
        }
    }
}

/** الكل · غير مدفوعة · جاهزة للشحن · اليوم, and the chip that opens the status sheet. */
@Composable
private fun OrdersFilters(filter: OrdersFilter, onFilter: (OrdersFilter) -> Unit, onMore: () -> Unit) {
    val spacing = LocalOrderakSpacing.current
    val choices = listOf(OrdersFilter.All, OrdersFilter.Unpaid, OrdersFilter.ToShip, OrdersFilter.Today)
    val status = (filter as? OrdersFilter.Status)?.status
    FilterChipRow(
        options = listOf(
            stringResource(R.string.orders_all),
            stringResource(R.string.today_counter_unpaid),
            stringResource(R.string.today_counter_to_ship),
            stringResource(R.string.nav_dashboard),
        ),
        selectedIndex = choices.indexOf(filter),
        onSelect = { onFilter(choices[it]) },
        moreLabel = if (status != null) statusLabel(status) else stringResource(R.string.orders_status_filter),
        onMore = onMore,
        moreSelected = status != null,
        modifier = Modifier.padding(horizontal = spacing.space4, vertical = spacing.space2),
    )
}

/** The two sections, and the banner that says when an order has not reached the server. */
@Composable
private fun OrdersList(list: List<OrderEntity>, state: OrdersUiState, onOpen: (Long) -> Unit) {
    val spacing = LocalOrderakSpacing.current
    // Split where the order already splits: `needsSellerFirst` sorts the list into
    // "still yours to move" and "finished or cancelled", and the row draws a rail and
    // a chip from the same predicate. The headings name the priority.
    val (waiting, rest) = list.partition { o ->
        runCatching { OrderStatus.valueOf(o.status) }.getOrDefault(OrderStatus.NEW).needsSeller
    }
    val refused = list.any { it.id in state.refusedPushes }
    val onlyHere = list.any { it.livesOnlyOnThisPhone }
    LazyColumn(
        contentPadding = PaddingValues(start = spacing.space4, end = spacing.space4, top = spacing.space2),
        verticalArrangement = Arrangement.spacedBy(spacing.space2),
        modifier = Modifier.fillMaxWidth(),
    ) {
        if (refused) {
            item(key = "sync-refused") {
                Banner(state = BannerState.Error, title = stringResource(R.string.orders_sync_refused))
            }
        } else if (onlyHere) {
            item(key = "sync-pending") {
                Banner(state = BannerState.Information, title = stringResource(R.string.orders_sync_pending))
            }
        }
        if (waiting.isNotEmpty()) {
            item(key = "group-waiting") {
                SectionHeader(title = stringResource(R.string.orders_group_waiting), count = waiting.size)
            }
            items(waiting, key = { it.id }) { o ->
                OrderCard(o, refused = o.id in state.refusedPushes, itemCount = state.itemCounts[o.id], onClick = { onOpen(o.id) })
            }
        }
        if (rest.isNotEmpty()) {
            item(key = "group-rest") {
                SectionHeader(title = stringResource(R.string.orders_group_rest), count = rest.size)
            }
            items(rest, key = { it.id }) { o ->
                OrderCard(o, refused = o.id in state.refusedPushes, itemCount = state.itemCounts[o.id], onClick = { onOpen(o.id) })
            }
        }
        item { Spacer(Modifier.height(spacing.fabClearance)) }
    }
}
