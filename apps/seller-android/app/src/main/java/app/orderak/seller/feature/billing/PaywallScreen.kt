package app.orderak.seller.feature.billing

import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.FilledTonalButton
import androidx.compose.material3.Surface
import androidx.compose.material3.TextButton
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.Alignment
import app.orderak.seller.core.ui.PLAN_USAGE_KEYS
import app.orderak.seller.core.ui.PlanUsageRow
import app.orderak.seller.core.ui.PlanUsageRowItem
import app.orderak.seller.core.ui.SemanticRole
import app.orderak.seller.core.ui.TopBar
import app.orderak.seller.core.ui.colors
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material.icons.outlined.Lock
import androidx.compose.material3.Button
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Text
import androidx.compose.material3.TopAppBar
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.platform.LocalConfiguration
import androidx.compose.ui.semantics.heading
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.unit.dp
import androidx.hilt.navigation.compose.hiltViewModel
import androidx.lifecycle.SavedStateHandle
import androidx.lifecycle.ViewModel
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.lifecycle.viewModelScope
import androidx.navigation.toRoute
import app.orderak.seller.R
import app.orderak.seller.core.text.formatCount
import app.orderak.seller.app.navigation.PaywallRoute
import app.orderak.seller.core.ui.Banner
import app.orderak.seller.core.ui.BannerState
import app.orderak.seller.data.billing.EntitlementManager
import app.orderak.seller.data.remote.BackendApi
import dagger.hilt.android.lifecycle.HiltViewModel
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.launch
import javax.inject.Inject
import app.orderak.seller.core.ui.theme.LocalOrderakSpacing

data class PaywallUiState(
    val limitKey: String,
    /** Null means the snapshot has no ceiling for this key, or none at all. */
    val limit: Int? = null,
    val used: Int? = null,
    /** What the next plan up gives for this key, as the catalogue words it. */
    val nextPlanValue: String? = null,
    val nextPlanName: String? = null,
    val purchaseOpen: Boolean = false,
)

@HiltViewModel
class PaywallViewModel @Inject constructor(
    private val api: BackendApi,
    private val entitlements: EntitlementManager,
    savedStateHandle: SavedStateHandle,
) : ViewModel() {
    private val limitKey: String = savedStateHandle.toRoute<PaywallRoute>().limitKey

    private val _state = MutableStateFlow(PaywallUiState(limitKey = limitKey))
    val state: StateFlow<PaywallUiState> = _state.asStateFlow()

    init {
        // The numbers come from the snapshot the app already holds rather than
        // from the refusal that sent us here. Same source as the usage meters, so
        // the paywall cannot disagree with the card the seller just looked at.
        val entitlement = entitlements.config.value?.entitlements?.get(limitKey)
        _state.value = PaywallUiState(
            limitKey = limitKey,
            limit = entitlement?.value?.toString()?.trim('"')?.toIntOrNull(),
            used = entitlement?.used,
            purchaseOpen = entitlements.isPurchaseOpen(),
        )
        loadNextPlanValue()
    }

    /**
     * What the next plan up offers for this exact limit.
     *
     * A paywall that says only "you have reached your limit" tells the seller
     * something they already discovered. The useful sentence is what changes if
     * they upgrade, and the only honest source for that is the catalogue.
     */
    private fun loadNextPlanValue() {
        viewModelScope.launch {
            val nextKey = entitlements.nextUpgradePlanKey() ?: return@launch
            val res = api.listPlans()
            if (!res.ok) return@launch
            val row = res.comparison.firstOrNull { it.entitlement_key == limitKey }
            _state.value = _state.value.copy(
                nextPlanValue = row?.values?.get(nextKey),
                nextPlanName = res.plans.firstOrNull { it.plan_key == nextKey }?.name,
            )
        }
    }
}

/**
 * S — the moment a seller hits a plan limit.
 *
 * It names the limit, what they have used, and what the next plan gives for that
 * same limit. It does not sell: while purchase is closed there is nothing to
 * buy, and the server would refuse anyway (I-5, BR-514). The exit is back to
 * where the seller came from, with their input intact — the caller pops rather
 * than resetting, so a half-written product is still there.
 */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun PaywallScreen(
    onBack: () -> Unit,
    onViewPlans: () -> Unit,
    viewModel: PaywallViewModel = hiltViewModel(),
) {
    val state by viewModel.state.collectAsStateWithLifecycle()
    PaywallContent(state = state, onBack = onBack, onViewPlans = onViewPlans)
}

/**
 * The limit-reached page, as a function of its state.
 *
 * A close at the top; centred, a commerce icon, "بلغت حد … في خطتك", the full meter with the
 * server's own numbers, and what the next plan gives for that same limit. While purchase is
 * closed a note says so. «عرض الخطط» is a tonal button and «رجوع» a text button, back to where
 * the seller came from with their input kept.
 *
 * Its contract declares `content` and nothing else, which is right: everything here comes from
 * the entitlement snapshot the caller already had in hand when it decided to show this page.
 */
@Composable
fun PaywallContent(
    state: PaywallUiState,
    onBack: () -> Unit,
    onViewPlans: () -> Unit,
) {
    val spacing = LocalOrderakSpacing.current
    val locale = LocalConfiguration.current.locales[0]
    val colors = SemanticRole.Commerce.colors()
    Scaffold(
        topBar = {
            TopBar(
                title = stringResource(R.string.paywall_title),
                onBack = onBack,
                backDescription = stringResource(R.string.sheet_close),
                closeIcon = true,
            )
        },
    ) { padding ->
        Column(
            Modifier.fillMaxSize().padding(padding).padding(spacing.space6).verticalScroll(rememberScrollState()),
            horizontalAlignment = Alignment.CenterHorizontally,
            verticalArrangement = Arrangement.spacedBy(spacing.space4),
        ) {
            Surface(shape = CircleShape, color = colors.container, modifier = Modifier.size(spacing.space16)) {
                Box(contentAlignment = Alignment.Center) {
                    Icon(Icons.Outlined.Lock, contentDescription = null, tint = colors.onContainer)
                }
            }
            Text(
                text = stringResource(limitNameResource(state.limitKey)),
                style = MaterialTheme.typography.titleLarge,
                textAlign = TextAlign.Center,
                modifier = Modifier.semantics { heading() },
            )

            // The specific number, not "you have reached a limit": a seller told which limit and
            // what it is can decide what to do.
            val limit = state.limit
            val used = state.used
            val usageLabel = PLAN_USAGE_KEYS.firstOrNull { it.first == state.limitKey }?.second
            when {
                limit != null && used != null && usageLabel != null ->
                    PlanUsageRowItem(PlanUsageRow(state.limitKey, usageLabel, used, limit))
                limit != null -> Text(
                    stringResource(R.string.paywall_limit_only, formatCount(limit, locale)),
                    style = MaterialTheme.typography.bodyLarge,
                )
                else -> Text(stringResource(R.string.paywall_limit_unknown), style = MaterialTheme.typography.bodyLarge)
            }

            val nextValue = state.nextPlanValue
            val nextName = state.nextPlanName
            if (nextValue != null && nextName != null) {
                Text(
                    text = stringResource(R.string.paywall_next_plan, nextName, nextValue),
                    style = MaterialTheme.typography.bodyLarge,
                    textAlign = TextAlign.Center,
                )
            }

            // No purchase control here in either state, and a sentence rather than a disabled
            // button when billing is closed: an upgrade path that ends at a control the server
            // refuses is worse than one that ends at an explanation.
            if (!state.purchaseOpen) {
                Banner(
                    state = BannerState.LockedByPlan,
                    title = stringResource(R.string.paywall_purchase_closed),
                    message = stringResource(R.string.paywall_purchase_closed_body),
                )
            }

            FilledTonalButton(
                onClick = onViewPlans,
                modifier = Modifier.fillMaxWidth().heightIn(min = spacing.minimumTouchTarget),
            ) { Text(stringResource(R.string.paywall_view_plans)) }
            TextButton(
                onClick = onBack,
                modifier = Modifier.fillMaxWidth().heightIn(min = spacing.minimumTouchTarget),
            ) { Text(stringResource(R.string.paywall_dismiss)) }
        }
    }
}

/**
 * The seller-facing name of a limit.
 *
 * Mapped rather than echoing the entitlement key: `max_orders_per_month` is a
 * database column, not a sentence, and an unmapped key falls back to a general
 * phrasing rather than showing an identifier to a seller.
 */
private fun limitNameResource(key: String): Int = when (key) {
    app.orderak.seller.data.billing.FeatureKeys.MAX_PRODUCTS -> R.string.paywall_limit_products
    app.orderak.seller.data.billing.FeatureKeys.MAX_CATEGORIES -> R.string.paywall_limit_categories
    app.orderak.seller.data.billing.FeatureKeys.MAX_ORDERS_PER_MONTH -> R.string.paywall_limit_orders
    app.orderak.seller.data.billing.FeatureKeys.MAX_CONCURRENT_DEVICES -> R.string.paywall_limit_devices
    app.orderak.seller.data.billing.FeatureKeys.MAX_AI_REQUESTS_PER_MONTH -> R.string.paywall_limit_ai
    else -> R.string.paywall_limit_generic
}
