package app.orderak.seller.feature.customers

import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
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
import app.orderak.seller.core.ui.PriorityListRow
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
        items(customers, key = { it.customerKey }) { c ->
            // The shared row, with no priority rail: a customer is never
            // "waiting on the seller" the way an order is, so claiming a rail
            // here would put a signal on a list that has nothing to triage.
            PriorityListRow(
                title = c.name ?: c.phone,
                subtitle = pluralStringResource(
                    R.plurals.customer_orders_count,
                    c.ordersCount,
                    formatCount(c.ordersCount, locale),
                ),
                modifier = Modifier.clickable { onOpen(c.customerKey) },
                trailing = {
                    Text(
                        // A lifetime total exists only within one currency. With
                        // more than one there is no such number, and an em dash
                        // says so rather than a sum of unlike minor units
                        // labelled with whichever currency the screen assumed.
                        if (c.currencyCount > 1 || c.currency == null) "—"
                        else formatAmountLabel(c.totalMinor, c.currency, locale),
                        style = MaterialTheme.typography.titleMedium,
                    )
                },
            )
        }
    }
}
