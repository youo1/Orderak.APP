package app.orderak.seller.feature.customers

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.defaultMinSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.ui.Alignment
import androidx.compose.ui.res.pluralStringResource
import androidx.compose.ui.text.style.TextDirection
import app.orderak.seller.core.money.formatAmountLabel
import app.orderak.seller.core.text.formatCount
import app.orderak.seller.core.ui.Avatar
import app.orderak.seller.core.ui.TopBar
import app.orderak.seller.core.ui.isolated
import java.util.Locale
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.padding
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalConfiguration
import androidx.compose.ui.res.stringResource
import app.orderak.seller.R
import app.orderak.seller.core.text.SearchText
import app.orderak.seller.core.ui.SearchField
import app.orderak.seller.core.ui.theme.LocalOrderakSpacing
import app.orderak.seller.data.db.CustomerSummary
import app.orderak.seller.core.ui.ErrorState
import app.orderak.seller.core.ui.ErrorStateKind
import app.orderak.seller.core.ui.EmptyState
import app.orderak.seller.core.ui.EmptyStateKind
import app.orderak.seller.core.ui.Skeleton
import app.orderak.seller.core.ui.SkeletonVariant

/**
 * العملاء, as a function of its state.
 *
 * Split out of `CustomersScreen` for the reason `StoreContent` and
 * `OrdersContent` were: the screen read a Hilt view model, so no preview could
 * construct it, so a surface declaring four states had renders of none of them.
 */
data class CustomersUiState(
    /**
     * null until Room answers.
     *
     * Aggregated from orders on the device, so this is the slowest of the three
     * lists to arrive — and the one whose empty state says "you have no
     * customers", which is a claim, not a placeholder.
     */
    val customers: List<CustomerSummary>? = null,
    /** True when the local Room read itself failed, not merely "not read yet". */
    val loadError: Boolean = false,
)

@Composable
fun CustomersContent(
    state: CustomersUiState,
    query: String,
    onQueryChange: (String) -> Unit,
    onOpen: (String) -> Unit,
    onRetry: () -> Unit,
    modifier: Modifier = Modifier,
) {
    val spacing = LocalOrderakSpacing.current
    val locale = LocalConfiguration.current.locales[0]
    val list = state.customers
    Column(modifier.fillMaxSize()) {
        TopBar(title = stringResource(R.string.nav_customers), large = true)
        when {
            // The one case `list == null` cannot distinguish on its own: a Room read that
            // actually threw, rather than one still in flight. It carries an action because
            // the read can be run again.
            state.loadError -> ErrorState(
                kind = ErrorStateKind.ServiceUnavailable,
                title = stringResource(R.string.error_state_customers_load_title),
                message = stringResource(R.string.error_unknown),
                onRetry = onRetry,
            )
            list == null -> Skeleton(SkeletonVariant.ListRows, Modifier.padding(spacing.space4))
            // A customer record is created by an order arriving, so there is nothing here for
            // a seller to press until one does: no action, and no search over nothing.
            list.isEmpty() -> EmptyState(
                kind = EmptyStateKind.Empty,
                title = stringResource(R.string.customers_empty_title),
                message = stringResource(R.string.customers_empty_body),
            )
            else -> {
                // Filtered here rather than in a query: the list is in memory, so this works
                // with the network off. The phone as well as the name, since the phone IS the
                // customer's identity, and Arabic-Indic digits fold to Latin.
                val visible = list.filter { SearchText.matches(query, it.name, it.phone) }
                SearchField(
                    query = query,
                    onQueryChange = onQueryChange,
                    placeholder = stringResource(R.string.customers_search_hint),
                    modifier = Modifier.padding(horizontal = spacing.space4, vertical = spacing.space2),
                )
                // A search with no match is not an empty customer list, and one sentence for
                // both would read as "your customers are gone".
                if (visible.isEmpty()) {
                    EmptyState(
                        kind = EmptyStateKind.FilteredToNothing,
                        title = stringResource(R.string.customers_search_empty, query),
                        actionLabel = stringResource(R.string.search_clear_action),
                        onAction = { onQueryChange("") },
                    )
                } else {
                    LazyColumn(
                        contentPadding = PaddingValues(spacing.space4),
                        verticalArrangement = Arrangement.spacedBy(spacing.space2),
                    ) {
                        items(visible, key = { it.customerKey }) { c -> CustomerRow(c, locale, onOpen) }
                    }
                }
            }
        }
    }
}

/**
 * One customer: initials, the name (or the number when there is no name), "number · n orders",
 * and what they have spent at the end. With orders in more than one currency there is no total
 * that would be right, so the row says the currencies differ instead of adding unlike things.
 */
@Composable
private fun CustomerRow(customer: CustomerSummary, locale: Locale, onOpen: (String) -> Unit) {
    val spacing = LocalOrderakSpacing.current
    val orders = pluralStringResource(
        R.plurals.customer_orders_count,
        customer.ordersCount,
        formatCount(customer.ordersCount, locale),
    )
    Surface(
        onClick = { onOpen(customer.customerKey) },
        modifier = Modifier.fillMaxWidth(),
        shape = MaterialTheme.shapes.large,
        color = MaterialTheme.colorScheme.surfaceContainerLowest,
    ) {
        Row(
            modifier = Modifier
                .defaultMinSize(minHeight = spacing.minimumTouchTarget)
                .padding(spacing.space3),
            horizontalArrangement = Arrangement.spacedBy(spacing.space3),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Avatar(name = customer.name ?: customer.phone)
            Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(spacing.space1)) {
                if (customer.name != null) {
                    Text(
                        customer.name,
                        style = MaterialTheme.typography.titleSmall.copy(textDirection = TextDirection.Content),
                    )
                    Text(
                        stringResource(R.string.customers_row_detail, isolated(customer.phone), orders),
                        style = MaterialTheme.typography.bodySmall,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                    )
                } else {
                    Text(isolated(customer.phone), style = MaterialTheme.typography.titleSmall)
                    Text(
                        orders,
                        style = MaterialTheme.typography.bodySmall,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                    )
                }
            }
            when {
                customer.currencyCount > 1 -> Text(
                    stringResource(R.string.customers_mixed_currencies),
                    style = MaterialTheme.typography.bodySmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                )
                customer.currency != null -> Text(
                    formatAmountLabel(customer.totalMinor, customer.currency, locale),
                    style = MaterialTheme.typography.titleMedium,
                )
            }
        }
    }
}
