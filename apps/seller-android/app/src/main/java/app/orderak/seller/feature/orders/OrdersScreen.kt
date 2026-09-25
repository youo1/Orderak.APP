package app.orderak.seller.feature.orders

import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.height
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.remember
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalConfiguration
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.unit.dp
import androidx.hilt.navigation.compose.hiltViewModel
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import app.orderak.seller.core.ui.theme.LocalOrderakSpacing
import app.orderak.seller.R
import app.orderak.seller.core.money.formatAmountLabel
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
    viewModel: OrdersViewModel = hiltViewModel(),
    /** Set when a اليوم counter opened this surface; applied once, then cleared. */
    initialFilter: OrdersFilter? = null,
    onInitialFilterApplied: () -> Unit = {},
) {
    val spacing = LocalOrderakSpacing.current
    // Keyed on the request so a second tap on the same counter re-applies it
    // after the seller has cleared the chip, and so re-entering from the nav bar
    // (where the request is null) never re-filters.
    LaunchedEffect(initialFilter) {
        if (initialFilter != null) {
            viewModel.setFilter(initialFilter)
            onInitialFilterApplied()
        }
    }
    val orders by viewModel.orders.collectAsStateWithLifecycle()
    val filter by viewModel.filter.collectAsStateWithLifecycle()
    val refusedPushes by viewModel.refusedPushes.collectAsStateWithLifecycle()
    val loadError by viewModel.loadError.collectAsStateWithLifecycle()

    OrdersContent(
        state = OrdersUiState(orders = orders, filter = filter, refusedPushes = refusedPushes, loadError = loadError),
        onOpen = onOpen,
        onNew = onNew,
        // The view model still keeps a status-shaped setter for the chips that
        // speak in statuses; the surface now speaks only OrdersFilter.
        onFilter = viewModel::setFilter,
    )
}

@Composable
fun OrderCard(o: OrderEntity, refused: Boolean = false, onClick: () -> Unit) {
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
                    formatAmountLabel(o.totalMinor, o.currency, locale),
                    style = MaterialTheme.typography.titleMedium,
                )
                Spacer(Modifier.height(4.dp))
                StatusChip(status)
                // An order the server has never seen sits in this list beside
                // ones it has, and nothing else on the row tells them apart.
                if (o.livesOnlyOnThisPhone) {
                    Spacer(Modifier.height(4.dp))
                    // Danger rather than warning when the server refused it:
                    // that one needs the seller and will not clear itself.
                    LocalOnlyOrderChip(refused = refused)
                }
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
