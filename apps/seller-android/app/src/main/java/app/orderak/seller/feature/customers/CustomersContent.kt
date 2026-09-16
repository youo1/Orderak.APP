package app.orderak.seller.feature.customers

import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.padding
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalConfiguration
import androidx.compose.ui.res.stringResource
import app.orderak.seller.R
import app.orderak.seller.core.text.SearchText
import app.orderak.seller.core.ui.FullScreenEmpty
import app.orderak.seller.core.ui.FullScreenLoading
import app.orderak.seller.core.ui.SearchField
import app.orderak.seller.core.ui.theme.LocalOrderakSpacing
import app.orderak.seller.data.db.CustomerSummary

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
)

@Composable
fun CustomersContent(
    state: CustomersUiState,
    query: String,
    onQueryChange: (String) -> Unit,
    onOpen: (String) -> Unit,
    modifier: Modifier = Modifier,
) {
    val spacing = LocalOrderakSpacing.current
    val list = state.customers

    // No action offered on the empty state: a customer record is created by an
    // order arriving, so there is nothing here for a seller to press until one
    // does. A button that does not help is worse than no button. Rows
    // themselves are pressable — they open the editor.
    //
    // Checked before the search box is drawn, so a seller with no customers is
    // not handed something to search through nothing with.
    if (list == null) {
        FullScreenLoading(modifier)
        return
    }
    if (list.isEmpty()) {
        FullScreenEmpty(message = stringResource(R.string.customers_empty), modifier = modifier)
        return
    }

    // Filtered here rather than in a query: the list is already in memory, so
    // this works with the network off, which is the state a seller at a stall is
    // most often in. Phone as well as name — the phone IS the customer's
    // identity, and Arabic-Indic digits fold to Latin so ٠١٠ finds 010.
    val visible = list.filter { SearchText.matches(query, it.name, it.phone) }
    val locale = LocalConfiguration.current.locales[0]

    Column(modifier.fillMaxSize()) {
        SearchField(
            query = query,
            onQueryChange = onQueryChange,
            placeholder = stringResource(R.string.customers_search_hint),
            modifier = Modifier.padding(horizontal = spacing.space4, vertical = spacing.space2),
        )

        // A search that matches nothing is not an empty customer list, and
        // saying so with the same sentence would read as "your customers are
        // gone". It names the query and offers the way back.
        if (visible.isEmpty()) {
            FullScreenEmpty(
                message = stringResource(R.string.customers_search_empty, query),
                actionLabel = stringResource(R.string.search_clear_action),
                onAction = { onQueryChange("") },
            )
            return@Column
        }

        CustomerList(visible, locale, onOpen)
    }
}
