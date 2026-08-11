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
import app.orderak.seller.core.money.formatEgp
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
            // Empty state when no orders exist at all (unfiltered).
            Box(Modifier.fillMaxSize().padding(32.dp), contentAlignment = Alignment.Center) {
                Column(horizontalAlignment = Alignment.CenterHorizontally) {
                    Icon(
                        imageVector = Icons.Outlined.Inbox,
                        contentDescription = null,
                        modifier = Modifier.sizeIn(minWidth = 48.dp, minHeight = 48.dp),
                        tint = MaterialTheme.colorScheme.onSurfaceVariant,
                    )
                    Spacer(Modifier.height(16.dp))
                    Text(
                        stringResource(R.string.orders_empty),
                        style = MaterialTheme.typography.bodyLarge,
                        textAlign = TextAlign.Center,
                    )
                }
            }
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
                    Box(Modifier.fillMaxSize().padding(32.dp), contentAlignment = Alignment.Center) {
                        Text(
                            stringResource(R.string.orders_empty),
                            style = MaterialTheme.typography.bodyLarge,
                            textAlign = TextAlign.Center,
                        )
                    }
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
    Card(Modifier.fillMaxWidth().clickable(onClick = onClick).semantics(mergeDescendants = true) {}) {
        Row(Modifier.padding(12.dp), verticalAlignment = Alignment.CenterVertically) {
            Column(Modifier.weight(1f)) {
                Text(
                    o.buyerName ?: o.buyerPhone,
                    style = MaterialTheme.typography.titleMedium.copy(
                        textDirection = TextDirection.Content,
                    ),
                )
                Text(
                    dateText,
                    style = MaterialTheme.typography.labelSmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant
                )
            }
            Column(horizontalAlignment = Alignment.End) {
                Text(
                    stringResource(R.string.currency_egp, formatEgp(o.totalPiasters)),
                    style = MaterialTheme.typography.titleMedium,
                    color = MaterialTheme.colorScheme.primary
                )
                StatusChip(status)
            }
        }
    }
}

@Composable
fun StatusChip(status: OrderStatus) {
    val (bg, fg) = when (status) {
        OrderStatus.NEW -> MaterialTheme.colorScheme.tertiaryContainer to MaterialTheme.colorScheme.onTertiaryContainer
        OrderStatus.CONFIRMED -> MaterialTheme.colorScheme.secondaryContainer to MaterialTheme.colorScheme.onSecondaryContainer
        OrderStatus.PAID -> MaterialTheme.colorScheme.primaryContainer to MaterialTheme.colorScheme.onPrimaryContainer
        OrderStatus.SHIPPED -> MaterialTheme.colorScheme.surfaceVariant to MaterialTheme.colorScheme.onSurfaceVariant
        OrderStatus.DONE -> MaterialTheme.colorScheme.surfaceVariant to MaterialTheme.colorScheme.onSurfaceVariant
        OrderStatus.CANCELLED -> MaterialTheme.colorScheme.errorContainer to MaterialTheme.colorScheme.onErrorContainer
    }
    // minimumInteractiveComponentSize ensures ≥48dp touch target (M3 requirement).
    Surface(
        color = bg,
        shape = MaterialTheme.shapes.small,
        modifier = Modifier.minimumInteractiveComponentSize(),
    ) {
        Text(
            statusLabel(status), color = fg,
            style = MaterialTheme.typography.labelMedium,
            modifier = Modifier.padding(horizontal = 8.dp, vertical = 4.dp)
        )
    }
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
