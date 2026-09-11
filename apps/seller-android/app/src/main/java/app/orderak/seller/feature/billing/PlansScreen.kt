package app.orderak.seller.feature.billing

import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.rememberScrollState
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material.icons.outlined.Info
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Text
import androidx.compose.material3.TopAppBar
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.heading
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.hilt.navigation.compose.hiltViewModel
import androidx.lifecycle.ViewModel
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.lifecycle.viewModelScope
import app.orderak.seller.R
import app.orderak.seller.core.ui.FullScreenError
import app.orderak.seller.core.ui.FullScreenLoading
import app.orderak.seller.core.ui.backendErrorResource
import app.orderak.seller.data.billing.EntitlementManager
import app.orderak.seller.data.remote.BackendApi
import app.orderak.seller.data.remote.PlanComparisonRowDto
import app.orderak.seller.data.remote.PlanSummaryDto
import dagger.hilt.android.lifecycle.HiltViewModel
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.launch
import javax.inject.Inject

data class PlansUiState(
    val loading: Boolean = true,
    val error: String? = null,
    val plans: List<PlanSummaryDto> = emptyList(),
    val comparison: List<PlanComparisonRowDto> = emptyList(),
    val currentPlanKey: String? = null,
    val purchaseOpen: Boolean = false,
)

@HiltViewModel
class PlansViewModel @Inject constructor(
    private val api: BackendApi,
    private val entitlements: EntitlementManager,
) : ViewModel() {
    private val _state = MutableStateFlow(PlansUiState())
    val state: StateFlow<PlansUiState> = _state.asStateFlow()

    init { load() }

    fun load() {
        viewModelScope.launch {
            _state.value = _state.value.copy(loading = true, error = null)
            val res = api.listPlans()
            _state.value = PlansUiState(
                loading = false,
                error = if (res.ok) null else (res.error ?: "unknown"),
                plans = res.plans,
                comparison = res.comparison,
                currentPlanKey = entitlements.config.value?.plan_id,
                // The client gate is UX protection; the server remains the
                // commercial authority (I-5). Both, never one.
                purchaseOpen = entitlements.isPurchaseOpen(),
            )
        }
    }
}

/**
 * S — the four-plan comparison.
 *
 * Every row is a feature the app has built: the server filters on
 * `implementation_status` before sending (BR-506), so this screen cannot
 * advertise something that does not exist even if the catalogue drifts.
 *
 * There are no prices and no purchase controls here. Play owns what a seller
 * pays, in their own currency; a number rendered here would be a second answer
 * that disagrees the moment Google applies a regional price. And while purchase
 * is closed this is a comparison, not a shop — a screen that offers to sell
 * something the server will refuse is worse than one that explains the position
 * (I-5, BR-514).
 */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun PlansScreen(
    onBack: () -> Unit,
    viewModel: PlansViewModel = hiltViewModel(),
) {
    val state by viewModel.state.collectAsStateWithLifecycle()

    Scaffold(
        topBar = {
            TopAppBar(
                title = { Text(stringResource(R.string.plans_title), modifier = Modifier.semantics { heading() }) },
                navigationIcon = {
                    IconButton(onClick = onBack) {
                        Icon(Icons.AutoMirrored.Filled.ArrowBack, contentDescription = stringResource(R.string.common_back))
                    }
                },
            )
        },
    ) { padding ->
        when {
            state.loading -> FullScreenLoading()
            state.error != null -> FullScreenError(
                message = stringResource(backendErrorResource(state.error)),
                onRetry = viewModel::load,
            )
            state.plans.isEmpty() -> Column(
                Modifier.fillMaxSize().padding(padding).padding(32.dp),
                verticalArrangement = Arrangement.Center,
                horizontalAlignment = Alignment.CenterHorizontally,
            ) {
                Text(stringResource(R.string.plans_unavailable), style = MaterialTheme.typography.bodyLarge)
            }
            else -> PlanComparison(state, padding)
        }
    }
}

@Composable
private fun PlanComparison(state: PlansUiState, padding: PaddingValues) {
    val columnScroll = rememberScrollState()
    LazyColumn(
        Modifier.fillMaxSize(),
        contentPadding = PaddingValues(
            start = 16.dp, end = 16.dp, bottom = 16.dp,
            top = padding.calculateTopPadding() + 8.dp,
        ),
        verticalArrangement = Arrangement.spacedBy(8.dp),
    ) {
        item {
            // Said once, at the top, rather than as a disabled button beside
            // every plan. While billing is closed there is nothing to buy, and
            // the honest thing is to say so rather than imply it.
            if (!state.purchaseOpen) {
                Row(
                    verticalAlignment = Alignment.CenterVertically,
                    horizontalArrangement = Arrangement.spacedBy(8.dp),
                    modifier = Modifier.fillMaxWidth(),
                ) {
                    Icon(
                        Icons.Outlined.Info,
                        contentDescription = null,
                        tint = MaterialTheme.colorScheme.onSurfaceVariant,
                    )
                    Text(
                        stringResource(R.string.plans_purchase_closed),
                        style = MaterialTheme.typography.bodyMedium,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                    )
                }
            }
        }

        item {
            Row(Modifier.horizontalScroll(columnScroll)) {
                Text(
                    stringResource(R.string.plans_feature_column),
                    style = MaterialTheme.typography.labelLarge,
                    modifier = Modifier.width(160.dp).padding(vertical = 8.dp),
                )
                state.plans.forEach { plan ->
                    Text(
                        text = plan.name,
                        style = MaterialTheme.typography.labelLarge,
                        fontWeight = if (plan.plan_key == state.currentPlanKey) FontWeight.Bold else FontWeight.Normal,
                        modifier = Modifier.width(110.dp).padding(vertical = 8.dp),
                    )
                }
            }
            HorizontalDivider()
        }

        items(state.comparison, key = { it.entitlement_key }) { row ->
            Row(Modifier.horizontalScroll(columnScroll)) {
                Text(
                    row.name,
                    style = MaterialTheme.typography.bodyMedium,
                    modifier = Modifier.width(160.dp).padding(vertical = 8.dp),
                )
                state.plans.forEach { plan ->
                    Text(
                        // An em dash is the catalogue's own "not included". A
                        // blank cell would read as missing data.
                        text = row.values[plan.plan_key] ?: "—",
                        style = MaterialTheme.typography.bodyMedium,
                        modifier = Modifier.width(110.dp).padding(vertical = 8.dp),
                    )
                }
            }
        }

        item {
            Text(
                stringResource(R.string.plans_price_note),
                style = MaterialTheme.typography.bodySmall,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
                modifier = Modifier.padding(top = 16.dp),
            )
        }
    }
}
