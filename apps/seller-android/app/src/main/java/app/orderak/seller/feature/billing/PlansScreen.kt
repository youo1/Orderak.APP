package app.orderak.seller.feature.billing

import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.platform.LocalConfiguration
import app.orderak.seller.core.text.formatNumber
import app.orderak.seller.core.ui.EmptyState
import app.orderak.seller.core.ui.EmptyStateKind
import app.orderak.seller.core.ui.KeyValueRow
import app.orderak.seller.core.ui.SectionHeader
import app.orderak.seller.core.ui.SegmentedChoice
import app.orderak.seller.core.ui.TopBar
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
import androidx.compose.ui.unit.dp
import androidx.hilt.navigation.compose.hiltViewModel
import androidx.lifecycle.ViewModel
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.lifecycle.viewModelScope
import app.orderak.seller.R
import app.orderak.seller.core.ui.Banner
import app.orderak.seller.core.ui.BannerState
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
import app.orderak.seller.core.ui.theme.LocalOrderakSpacing
import app.orderak.seller.core.ui.ErrorState
import app.orderak.seller.core.ui.errorStateText
import app.orderak.seller.core.ui.Skeleton
import app.orderak.seller.core.ui.SkeletonVariant

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
    PlansContent(state = state, onBack = onBack, onRetry = viewModel::load)
}

/**
 * The plan comparison, as a function of its state.
 *
 * A top bar with back, the purchase-closed notice, a choice with one tab per plan (the current
 * one marked «خطتك»), and for the chosen plan its limits as rows, each with its difference from the
 * current plan, then the features it includes. No buy control while purchase is closed.
 */
@Composable
fun PlansContent(
    state: PlansUiState,
    onBack: () -> Unit,
    onRetry: () -> Unit,
) {
    val spacing = LocalOrderakSpacing.current
    Scaffold(
        topBar = {
            TopBar(
                title = stringResource(R.string.plans_title),
                onBack = onBack,
                backDescription = stringResource(R.string.common_back),
            )
        },
    ) { padding ->
        when {
            state.loading -> Skeleton(
                variant = SkeletonVariant.DetailBlock,
                modifier = Modifier.padding(padding).padding(spacing.space4),
            )
            state.error != null -> {
                val text = errorStateText(state.error)
                ErrorState(
                    kind = text.kind,
                    title = text.title?.let { stringResource(it) },
                    message = stringResource(text.message),
                    modifier = Modifier.padding(padding),
                    onRetry = onRetry,
                )
            }
            state.plans.isEmpty() -> EmptyState(
                kind = EmptyStateKind.Empty,
                title = stringResource(R.string.plans_unavailable),
                modifier = Modifier.padding(padding),
            )
            else -> PlanComparison(state, padding)
        }
    }
}

@Composable
private fun PlanComparison(state: PlansUiState, padding: PaddingValues) {
    val spacing = LocalOrderakSpacing.current
    // The tab opens on the seller's own plan: that is the one they compare the others against.
    var selected by rememberSaveable(state.currentPlanKey) {
        mutableStateOf(state.plans.indexOfFirst { it.plan_key == state.currentPlanKey }.coerceAtLeast(0))
    }
    val plan = state.plans[selected.coerceIn(0, state.plans.lastIndex)]
    val dash = "—"
    val limits = state.comparison.filter { it.value_type != "boolean" }
    val features = state.comparison.filter {
        it.value_type == "boolean" && it.values[plan.plan_key].equals("true", ignoreCase = true)
    }
    LazyColumn(
        Modifier.fillMaxSize().padding(padding),
        contentPadding = PaddingValues(spacing.space4),
        verticalArrangement = Arrangement.spacedBy(spacing.space2),
    ) {
        if (!state.purchaseOpen) {
            item {
                // Said once, at the top, in the role the semantic layer keeps for anything
                // monetary, rather than as a disabled button beside every plan.
                Banner(
                    state = BannerState.LockedByPlan,
                    title = stringResource(R.string.plans_purchase_closed),
                    message = stringResource(R.string.plans_purchase_closed_body),
                )
            }
        }
        item {
            SegmentedChoice(
                options = state.plans.map {
                    if (it.plan_key == state.currentPlanKey) stringResource(R.string.plans_current_plan_marked, it.name) else it.name
                },
                selectedIndex = selected,
                onSelect = { selected = it },
            )
        }
        item { SectionHeader(title = stringResource(R.string.plans_limits_title)) }
        items(limits, key = { it.entitlement_key }) { row ->
            val value = row.values[plan.plan_key]
            val current = state.currentPlanKey?.let { row.values[it] }
            val diff = limitDifference(value, current)
            KeyValueRow(
                label = row.name,
                // An em dash is the catalogue's own "not included"; a blank would read as missing.
                value = (value ?: dash) + (diff?.let { "  ($it)" } ?: ""),
            )
        }
        item { SectionHeader(title = stringResource(R.string.plans_features_title)) }
        if (features.isEmpty()) {
            item {
                Text(
                    dash,
                    style = MaterialTheme.typography.bodyMedium,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                )
            }
        }
        items(features, key = { "f-" + it.entitlement_key }) { row ->
            Text(row.name, style = MaterialTheme.typography.bodyMedium)
        }
        item {
            Text(
                stringResource(R.string.plans_price_note),
                style = MaterialTheme.typography.bodySmall,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
                modifier = Modifier.padding(top = spacing.space4),
            )
        }
    }
}

/** "+٢٠٠" or "−١٠" against the seller's own plan, or null when either side is not a number. */
@Composable
private fun limitDifference(chosen: String?, current: String?): String? {
    val a = chosen?.toLongOrNull() ?: return null
    val b = current?.toLongOrNull() ?: return null
    val d = a - b
    if (d == 0L) return null
    val locale = LocalConfiguration.current.locales[0]
    val digits = formatNumber(kotlin.math.abs(d), locale)
    return (if (d > 0) "+" else "−") + digits
}

