package app.orderak.seller.feature.customers

import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.sizeIn
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.Inbox
import androidx.compose.material3.Card
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.res.pluralStringResource
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.style.TextDirection
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.hilt.navigation.compose.hiltViewModel
import androidx.lifecycle.ViewModel
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.lifecycle.viewModelScope
import app.orderak.seller.R
import app.orderak.seller.core.money.DEFAULT_CURRENCY
import app.orderak.seller.core.money.formatAmount
import app.orderak.seller.core.text.SearchText
import app.orderak.seller.core.ui.FullScreenEmpty
import app.orderak.seller.core.ui.SearchField
import app.orderak.seller.core.ui.PriorityListRow
import androidx.compose.ui.platform.LocalConfiguration
import app.orderak.seller.data.db.CustomerSummary
import app.orderak.seller.data.orders.OrderRepository
import dagger.hilt.android.lifecycle.HiltViewModel
import kotlinx.coroutines.flow.SharingStarted
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.stateIn
import javax.inject.Inject

@HiltViewModel
class CustomersViewModel @Inject constructor(repo: OrderRepository) : ViewModel() {
    val customers: StateFlow<List<CustomerSummary>> =
        repo.customers.stateIn(viewModelScope, SharingStarted.WhileSubscribed(5_000), emptyList())
}

/** S11 — phone-keyed customer list with LTV. */
@Composable
fun CustomersScreen(
    onOpen: (String) -> Unit,
    viewModel: CustomersViewModel = hiltViewModel()
) {
    val customers by viewModel.customers.collectAsStateWithLifecycle()
    var query by rememberSaveable { mutableStateOf("") }

    // No action offered: a customer record is created by an order arriving, so
    // there is nothing a seller can press here. An empty state with a button
    // that does not help is worse than one without.
    //
    // Checked before the search box is drawn, so a seller with no customers is
    // not handed something to search through nothing with.
    if (customers.isEmpty()) {
        FullScreenEmpty(message = stringResource(R.string.customers_empty))
        return
    }

    // Filtered here rather than in a query: the list is already in memory, so
    // this works with the network off, which is the state a seller at a stall is
    // most often in. Phone as well as name — the phone IS the customer's
    // identity, and Arabic-Indic digits fold to Latin so ٠١٠ finds 010.
    val visible = customers.filter { SearchText.matches(query, it.name, it.phone) }
    val locale = LocalConfiguration.current.locales[0]

    Column(Modifier.fillMaxSize()) {
        SearchField(
            query = query,
            onQueryChange = { query = it },
            placeholder = stringResource(R.string.customers_search_hint),
            modifier = Modifier.padding(horizontal = 16.dp, vertical = 8.dp),
        )

        // A search that matches nothing is not an empty customer list, and
        // saying so with the same sentence would read as "your customers are
        // gone". It names the query and offers the way back.
        if (visible.isEmpty()) {
            FullScreenEmpty(
                message = stringResource(R.string.customers_search_empty, query),
                actionLabel = stringResource(R.string.search_clear_action),
                onAction = { query = "" },
            )
            return@Column
        }

        CustomerList(visible, locale, onOpen)
    }
}

@Composable
private fun CustomerList(
    customers: List<CustomerSummary>,
    locale: java.util.Locale,
    onOpen: (String) -> Unit,
) {
    LazyColumn(contentPadding = PaddingValues(16.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
        items(customers, key = { it.phone }) { c ->
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
                modifier = Modifier.clickable { onOpen(c.phone) },
                trailing = {
                    Text(
                        stringResource(
                            R.string.currency_egp,
                            formatAmount(c.totalMinor, DEFAULT_CURRENCY, locale),
                        ),
                        style = MaterialTheme.typography.titleMedium,
                    )
                },
            )
        }
    }
}
