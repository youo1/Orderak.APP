package app.orderak.seller.feature.customers

import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.defaultMinSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.res.pluralStringResource
import androidx.hilt.navigation.compose.hiltViewModel
import androidx.lifecycle.ViewModel
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.lifecycle.viewModelScope
import app.orderak.seller.core.ui.theme.LocalOrderakSpacing
import app.orderak.seller.R
import app.orderak.seller.core.money.formatAmountLabel
import app.orderak.seller.core.read.RestartableRead
import app.orderak.seller.core.text.formatCount
import app.orderak.seller.data.db.CustomerSummary
import app.orderak.seller.data.orders.OrderRepository
import dagger.hilt.android.lifecycle.HiltViewModel
import kotlinx.coroutines.flow.SharingStarted
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.stateIn
import javax.inject.Inject

@HiltViewModel
class CustomersViewModel @Inject constructor(repo: OrderRepository) : ViewModel() {

    /**
     * The customer list, or null while it is still being derived.
     *
     * Seeded `emptyList()` before, which made "not read yet" and "you have no
     * customers" the same value — and this list is AGGREGATED from orders on the
     * device, so it is the slowest of the three to arrive.
     *
     * A thrown read used to be terminal: `catch` ended the upstream, so the list
     * stayed empty and no sync could replace it. See [RestartableRead].
     */
    private val read = RestartableRead { repo.customers }

    /** True while the local read is failing, so the surface can offer a retry. */
    val loadError: StateFlow<Boolean> = read.failed

    val customers: StateFlow<List<CustomerSummary>?> =
        read.values.stateIn(viewModelScope, SharingStarted.WhileSubscribed(5_000), null)

    /** Run the local read again after it threw. */
    fun retry() = read.retry()
}

/** S11 — phone-keyed customer list with LTV. */
@Composable
fun CustomersScreen(
    onOpen: (String) -> Unit,
    viewModel: CustomersViewModel = hiltViewModel()
) {
    val spacing = LocalOrderakSpacing.current
    val customers by viewModel.customers.collectAsStateWithLifecycle()
    val loadError by viewModel.loadError.collectAsStateWithLifecycle()
    var query by rememberSaveable { mutableStateOf("") }

    CustomersContent(
        state = CustomersUiState(customers = customers, loadError = loadError),
        query = query,
        onQueryChange = { query = it },
        onOpen = onOpen,
        onRetry = viewModel::retry,
    )
}

@Composable
internal fun CustomerList(
    customers: List<CustomerSummary>,
    locale: java.util.Locale,
    onOpen: (String) -> Unit,
) {
    val spacing = LocalOrderakSpacing.current
    LazyColumn(contentPadding = PaddingValues(spacing.space4), verticalArrangement = Arrangement.spacedBy(spacing.space2)) {
        items(customers, key = { it.customerKey }) { c -> CustomerRow(c, locale, onOpen) }
    }
}

/**
 * One customer, with no priority rail.
 *
 * This file used to say, directly above a `PriorityListRow` call, that the list
 * drew "the shared row, with no priority rail: a customer is never 'waiting on
 * the seller' the way an order is, so claiming a rail here would put a signal on
 * a list that has nothing to triage." `PriorityListRow` draws its rail either
 * way — filled when `needsAction` is set and hollow when it is not — so every
 * customer carried a 4dp bar whose only possible reading on this list was "not
 * waiting on you", on every row, in a list where no row ever is. The claim was
 * written down and the render contradicted it.
 *
 * So this is that row without the bar, and nothing else about it is new. The
 * shared row's own container and corner (`surfaceContainerLowest`, and
 * `shapes.large` — the list-row end of the shape scale), the 48dp floor the
 * design system requires of every target and a rail-free row still owes, the
 * same two text roles, and the same trailing slot for the lifetime total. The
 * count, the name-or-phone rule and the em dash for a total that cannot be added
 * up are the ones this file already had; the rail is the only thing that left.
 */
@Composable
private fun CustomerRow(
    customer: CustomerSummary,
    locale: java.util.Locale,
    onOpen: (String) -> Unit,
) {
    val spacing = LocalOrderakSpacing.current
    Surface(
        modifier = Modifier.fillMaxWidth().clickable { onOpen(customer.customerKey) },
        shape = MaterialTheme.shapes.large,
        color = MaterialTheme.colorScheme.surfaceContainerLowest,
    ) {
        Row(
            modifier = Modifier
                .defaultMinSize(minHeight = spacing.minimumTouchTarget)
                .padding(horizontal = spacing.space3 + spacing.space1, vertical = spacing.space3),
            horizontalArrangement = Arrangement.spacedBy(spacing.space2 + spacing.space1),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Column(
                modifier = Modifier.weight(1f),
                verticalArrangement = Arrangement.spacedBy(spacing.space1),
            ) {
                Text(
                    text = customer.name ?: customer.phone,
                    style = MaterialTheme.typography.titleSmall,
                )
                Text(
                    text = pluralStringResource(
                        R.plurals.customer_orders_count,
                        customer.ordersCount,
                        formatCount(customer.ordersCount, locale),
                    ),
                    style = MaterialTheme.typography.bodySmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                )
            }
            Text(
                // A lifetime total exists only within one currency. With
                // more than one there is no such number, and an em dash
                // says so rather than a sum of unlike minor units
                // labelled with whichever currency the screen assumed.
                text = if (customer.currencyCount > 1 || customer.currency == null) "—"
                else formatAmountLabel(customer.totalMinor, customer.currency, locale),
                style = MaterialTheme.typography.titleMedium,
            )
        }
    }
}
