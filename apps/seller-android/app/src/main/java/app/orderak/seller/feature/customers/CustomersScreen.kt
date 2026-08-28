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
import app.orderak.seller.core.ui.FullScreenEmpty
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
    // No action offered: a customer record is created by an order arriving, so
    // there is nothing a seller can press here. An empty state with a button
    // that does not help is worse than one without.
    if (customers.isEmpty()) {
        FullScreenEmpty(message = stringResource(R.string.customers_empty))
        return
    }
    val locale = LocalConfiguration.current.locales[0]
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
