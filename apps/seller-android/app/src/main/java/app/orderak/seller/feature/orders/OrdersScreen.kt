package app.orderak.seller.feature.orders

import androidx.compose.foundation.clickable
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
import androidx.compose.foundation.layout.sizeIn
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.LazyRow
import androidx.compose.foundation.lazy.items
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Add
import androidx.compose.material.icons.outlined.Inbox
import androidx.compose.material3.Card
import androidx.compose.material3.FilterChip
import androidx.compose.material3.FloatingActionButton
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.minimumInteractiveComponentSize
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.remember
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalConfiguration
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextDirection
import androidx.compose.ui.unit.dp
import androidx.hilt.navigation.compose.hiltViewModel
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import app.orderak.seller.R
import app.orderak.seller.core.money.DEFAULT_CURRENCY
import app.orderak.seller.core.money.formatAmount
import app.orderak.seller.core.ui.FullScreenEmpty
import app.orderak.seller.core.ui.PriorityListRow
import app.orderak.seller.core.ui.SemanticChip
import app.orderak.seller.core.ui.SemanticRole
import app.orderak.seller.data.db.OrderEntity
import app.orderak.seller.domain.OrderStatus
import java.text.DateFormat
import java.util.Date

/** S5 — pipeline list with status filter chips. */
@Composable
fun OrdersScreen(
    onOpen: (Long) -> Unit,
    onNew: () -> Unit,
    viewModel: OrdersViewModel = hiltViewModel()
) {
    val orders by viewModel.orders.collectAsStateWithLifecycle()
    val filter by viewModel.filter.collectAsStateWithLifecycle()

    Box(Modifier.fillMaxSize()) {
        if (orders.isEmpty() && filter == null) {
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
                    contentPadding = PaddingValues(horizontal = 16.dp, vertical = 8.dp),
                    horizontalArrangement = Arrangement.spacedBy(8.dp)
                ) {
                    item {
                        FilterChip(selected = filter == null, onClick = { viewModel.setFilter(null) },
                            label = { Text(stringResource(R.string.orders_all)) })
                    }
                    items(OrderStatus.entries.filter { it != OrderStatus.CANCELLED }) { st ->
                        FilterChip(selected = filter == st, onClick = { viewModel.setFilter(st) },
                            label = { Text(statusLabel(st)) })
                    }
                }
                if (orders.isEmpty()) {
                    // Filtered to nothing is a different situation from having no
                    // orders at all: the fix is to clear the filter, not to sell
                    // something.
                    FullScreenEmpty(
                        message = stringResource(R.string.orders_empty_filtered),
                        actionLabel = stringResource(R.string.orders_all),
                        onAction = { viewModel.setFilter(null) },
                    )
                } else {
                    LazyColumn(
                        contentPadding = PaddingValues(16.dp),
                        verticalArrangement = Arrangement.spacedBy(8.dp)
                    ) {
                        items(orders, key = { it.id }) { o -> OrderCard(o, onClick = { onOpen(o.id) }) }
                        item { Spacer(Modifier.height(80.dp)) }
                    }
                }
            }
        }
        FloatingActionButton(
            onClick = onNew,
            modifier = Modifier.align(Alignment.BottomEnd).padding(16.dp)
        ) { Icon(Icons.Filled.Add, contentDescription = stringResource(R.string.order_new_title)) }
    }
}

@Composable
fun OrderCard(o: OrderEntity, onClick: () -> Unit) {
    // Key the formatter by the current app locale. A global formatter would
    // keep displaying the previous language after an in-app locale switch.
    val locale = LocalConfiguration.current.locales[0]
    val dateFormatter = remember(locale) {
        DateFormat.getDateTimeInstance(DateFormat.SHORT, DateFormat.SHORT, locale)
    }
    val dateText = remember(o.createdAt, dateFormatter) {
        dateFormatter.format(Date(o.createdAt))
    }
    val status = remember(o.status) {
        runCatching { OrderStatus.valueOf(o.status) }.getOrDefault(OrderStatus.NEW)
    }
    // The list's job is "which of these still need me?", not "what stage is
    // each one at". The rail answers that by shape, so the sort survives
    // greyscale, colour blindness and a phone in the sun; the chip repeats it.
    PriorityListRow(
        title = o.buyerName ?: o.buyerPhone,
        subtitle = dateText,
        needsAction = status.needsSeller,
        modifier = Modifier.clickable(onClick = onClick).semantics(mergeDescendants = true) {},
        trailing = {
            Column(horizontalAlignment = Alignment.End) {
                Text(
                    // Same locale the date above uses. Reading the ambient default
                    // here would let money keep Latin digits on a screen whose
                    // dates have already switched to Arabic-Indic.
                    stringResource(R.string.currency_egp, formatAmount(o.totalMinor, o.currency, locale)),
                    style = MaterialTheme.typography.titleMedium,
                )
                Spacer(Modifier.height(4.dp))
                StatusChip(status)
            }
        },
    )
}

/** True while the order is still the seller's problem. */
private val OrderStatus.needsSeller: Boolean
    get() = this != OrderStatus.DONE && this != OrderStatus.CANCELLED

/**
 * One semantic role per meaning, not one hue per status.
 *
 * The mapping this replaces gave six statuses five different colours, and put
 * PAID on `primaryContainer` — the brand. A pipeline reads as a sequence, so the
 * sequence shares a role and only the exceptional outcome and the milestone
 * stand apart.
 */
private val OrderStatus.role: SemanticRole
    get() = when (this) {
        OrderStatus.NEW, OrderStatus.CONFIRMED, OrderStatus.SHIPPED -> SemanticRole.Info
        OrderStatus.PAID -> SemanticRole.Success
        OrderStatus.DONE -> SemanticRole.Neutral
        OrderStatus.CANCELLED -> SemanticRole.Danger
    }

@Composable
fun StatusChip(status: OrderStatus) {
    SemanticChip(role = status.role, label = statusLabel(status))
}

@Composable
fun statusLabel(status: OrderStatus): String = stringResource(
    when (status) {
        OrderStatus.NEW -> R.string.status_new
        OrderStatus.CONFIRMED -> R.string.status_confirmed
        OrderStatus.PAID -> R.string.status_paid
        OrderStatus.SHIPPED -> R.string.status_shipped
        OrderStatus.DONE -> R.string.status_done
        OrderStatus.CANCELLED -> R.string.status_cancelled
    }
)
