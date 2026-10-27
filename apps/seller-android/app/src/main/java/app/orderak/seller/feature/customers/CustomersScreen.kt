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
