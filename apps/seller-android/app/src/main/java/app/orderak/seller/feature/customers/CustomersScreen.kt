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
     */
    val customers: StateFlow<List<CustomerSummary>?> =
        repo.customers.stateIn(viewModelScope, SharingStarted.WhileSubscribed(5_000), null)
}

/** S11 — phone-keyed customer list with LTV. */
@Composable
fun CustomersScreen(
    onOpen: (String) -> Unit,
    viewModel: CustomersViewModel = hiltViewModel()
) {
    val spacing = LocalOrderakSpacing.current
    val customers by viewModel.customers.collectAsStateWithLifecycle()
    var query by rememberSaveable { mutableStateOf("") }

    CustomersContent(
        state = CustomersUiState(customers = customers),
        query = query,
        onQueryChange = { query = it },
        onOpen = onOpen,
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
                    c.ordersCount,
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
