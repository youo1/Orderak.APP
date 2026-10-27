package app.orderak.seller.feature.products

import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.ModalBottomSheet
import androidx.compose.material3.rememberModalBottomSheetState
import app.orderak.seller.core.ui.ConfirmSheet
import app.orderak.seller.core.ui.ConfirmSheetState
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import app.orderak.seller.core.share.shareStoreLink
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.size
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Lock
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.LocalConfiguration
import androidx.compose.ui.res.stringResource
import androidx.hilt.navigation.compose.hiltViewModel
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import app.orderak.seller.core.ui.theme.LocalOrderakSpacing
import app.orderak.seller.core.text.formatCount
import app.orderak.seller.R
import app.orderak.seller.data.billing.EntitlementManager
import app.orderak.seller.data.billing.FeatureKeys
import androidx.hilt.navigation.compose.hiltViewModel as hiltVm
import app.orderak.seller.data.catalog.StuckLegacyProduct
import kotlinx.coroutines.launch

/** S8 — products list + share + low-stock badges, with all states. */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun ProductsScreen(
    onAdd: () -> Unit,
    onEdit: (Long) -> Unit,
    onLimitReached: (String) -> Unit,
    sellerPhone: String?,
    onOpenStoreInfo: () -> Unit = {},
    onOpenCategories: () -> Unit = {},
    onOpenLanguages: () -> Unit = {},
    viewModel: ProductsViewModel = hiltViewModel(),
    entitlements: EntitlementManager = hiltVm<EntitlementHolderViewModel>().entitlements,
) {
    val spacing = LocalOrderakSpacing.current
    val products by viewModel.products.collectAsStateWithLifecycle()
    val loadError by viewModel.loadError.collectAsStateWithLifecycle()
    // Survives rotation but not the surface switch, which is right: a search is
    // how the seller is reading the list right now, not a setting.
    var query by rememberSaveable { mutableStateOf("") }
    val shopName by viewModel.shopName.collectAsStateWithLifecycle()
    val storeUrl by viewModel.storeUrl.collectAsStateWithLifecycle()
    val quota by viewModel.quota.collectAsStateWithLifecycle()
    var showLimitDialog by rememberSaveable { mutableStateOf(false) }
    val purchaseOpen = entitlements.isPurchaseOpen()

    // Products saved here that never reached the account. Until this is empty
    // the catalogue refresh does not run at all, so it cannot be a quiet state.
    val stuck by viewModel.stuck.collectAsStateWithLifecycle()
    var showStuckDialog by rememberSaveable { mutableStateOf(false) }
    // The row awaiting confirmation, not a boolean: the confirmation names the
    // product, and a flag would leave the dialog able to delete the wrong one
    // after the list underneath it changes.
    var confirmDiscard by remember { mutableStateOf<StuckLegacyProduct?>(null) }

    val context = LocalContext.current
    val locale = LocalConfiguration.current.locales[0]
    val scope = rememberCoroutineScope()

    if (showLimitDialog) {
        val upgradeName = planName(quota.upgradePlanKey)
        val limit = quota.limit ?: quota.used
        val message = when {
            quota.used > limit -> stringResource(
                R.string.products_limit_body_over,
                formatCount(limit, locale),
                formatCount(quota.used, locale),
            )
            quota.upgradePlanKey != null && purchaseOpen -> stringResource(
                R.string.products_limit_body,
                formatCount(limit, locale),
                upgradeName,
            )
            quota.upgradePlanKey != null -> stringResource(
                R.string.products_limit_body_purchase_closed,
                formatCount(limit, locale),
            )
            else -> stringResource(
                R.string.products_limit_body_max_plan,
                formatCount(limit, locale),
            )
        }
        // A higher plan existing is not the same as being able to buy it. Purchase is closed
        // platform-wide and the acquisition routes answer 403, so the label changes rather than
        // the destination: the plans page explains what the next plan gives either way, and only
        // offers to sell when selling is actually open (I-5).
        val canUpgrade = quota.upgradePlanKey != null
        ModalBottomSheet(
            onDismissRequest = { showLimitDialog = false },
            sheetState = rememberModalBottomSheetState(skipPartiallyExpanded = true),
            containerColor = MaterialTheme.colorScheme.surface,
            dragHandle = null,
            shape = RoundedCornerShape(spacing.space0),
        ) {
            ConfirmSheet(
                state = ConfirmSheetState.Regular,
                title = stringResource(R.string.products_limit_title),
                message = message,
                confirmLabel = stringResource(
                    when {
                        !canUpgrade -> R.string.common_ok
                        purchaseOpen -> R.string.upgrade_now
                        else -> R.string.paywall_view_plans
                    },
                ),
                cancelLabel = if (canUpgrade) stringResource(R.string.common_ok) else null,
                onConfirm = {
                    showLimitDialog = false
                    if (canUpgrade) onLimitReached(FeatureKeys.MAX_PRODUCTS)
                },
                onCancel = { showLimitDialog = false },
            )
        }
    }

    if (showStuckDialog) {
        ModalBottomSheet(
            onDismissRequest = { showStuckDialog = false },
            sheetState = rememberModalBottomSheetState(skipPartiallyExpanded = true),
            containerColor = MaterialTheme.colorScheme.surface,
            dragHandle = null,
            shape = RoundedCornerShape(spacing.space0),
        ) {
            Column(
                Modifier.fillMaxWidth().padding(spacing.space4),
                verticalArrangement = Arrangement.spacedBy(spacing.space3),
            ) {
                Text(
                    stringResource(R.string.products_stuck_dialog_title),
                    style = MaterialTheme.typography.titleLarge,
                )
                stuck.forEach { item ->
                    Row(
                        Modifier.fillMaxWidth(),
                        verticalAlignment = Alignment.CenterVertically,
                    ) {
                        Column(Modifier.weight(1f)) {
                            Text(item.name, style = MaterialTheme.typography.bodyLarge)
                            Text(
                                // TERMINAL is the reconciler's own word for "the server said
                                // something that will not change by asking again". Anything else,
                                // including no answer at all, is still on its way, and saying
                                // otherwise would push a seller to delete a product over a bad
                                // signal.
                                text = if (item.lastError == "TERMINAL") {
                                    stringResource(R.string.products_stuck_refused)
                                } else {
                                    stringResource(R.string.products_stuck_waiting)
                                },
                                style = MaterialTheme.typography.bodySmall,
                                color = MaterialTheme.colorScheme.onSurfaceVariant,
                            )
                        }
                        TextButton(
                            onClick = {
                                // The list closes as the confirmation opens: one conversation at a time.
                                showStuckDialog = false
                                confirmDiscard = item
                            },
                            modifier = Modifier.heightIn(min = spacing.minimumTouchTarget),
                        ) { Text(stringResource(R.string.products_stuck_discard)) }
                    }
                }
                TextButton(
                    onClick = { showStuckDialog = false },
                    modifier = Modifier.fillMaxWidth().heightIn(min = spacing.minimumTouchTarget),
                ) { Text(stringResource(R.string.common_cancel)) }
            }
        }
    }

    // The row awaiting confirmation, not a boolean: the confirmation names the product, and a
    // flag would leave the sheet able to delete the wrong one after the list changes.
    confirmDiscard?.let { target ->
        ModalBottomSheet(
            onDismissRequest = { confirmDiscard = null },
            sheetState = rememberModalBottomSheetState(skipPartiallyExpanded = true),
            containerColor = MaterialTheme.colorScheme.surface,
            dragHandle = null,
            shape = RoundedCornerShape(spacing.space0),
        ) {
            ConfirmSheet(
                state = ConfirmSheetState.Destructive,
                title = stringResource(R.string.products_stuck_discard_title, target.name),
                message = stringResource(R.string.products_stuck_discard_confirm),
                confirmLabel = stringResource(R.string.products_stuck_discard),
                cancelLabel = stringResource(R.string.common_cancel),
                onConfirm = {
                    viewModel.discardStuck(target.localId)
                    confirmDiscard = null
                },
                onCancel = { confirmDiscard = null },
            )
        }
    }

    StoreContent(
        state = StoreUiState(
            products = products,
            quota = quota,
            stuckCount = stuck.size,
            loadError = loadError,
        ),
        query = query,
        onQueryChange = { query = it },
        onAdd = onAdd,
        onLimitReached = { showLimitDialog = true },
        onEdit = onEdit,
        onRetry = viewModel::retry,
        onShare = {
            scope.launch {
                val url = storeUrl
                // Shares the whole catalogue, never the filtered view — a search
                // is how the seller is looking at their products, not a
                // statement about what the shop sells.
                if (url.isNullOrBlank()) shareCatalogText(context, shopName, sellerPhone, products.orEmpty())
                else shareStoreLink(context, shopName, url)
            }
        },
        onShowStuck = { showStuckDialog = true },
        onOpenStoreInfo = onOpenStoreInfo,
        onOpenCategories = onOpenCategories,
        onOpenLanguages = onOpenLanguages,
    )
}

@Composable
private fun planName(planKey: String?): String = when (planKey) {
    "paid1" -> stringResource(R.string.plan_paid1)
    "paid2" -> stringResource(R.string.plan_paid2)
    "paid3" -> stringResource(R.string.plan_paid3)
    else -> stringResource(R.string.plan_free)
}

/**
 * Hands the screen the shared [EntitlementManager].
 *
 * A thin holder rather than a constructor parameter so existing call sites keep
 * working while the screen learns to ask whether purchase is open at all.
 */
@dagger.hilt.android.lifecycle.HiltViewModel
class EntitlementHolderViewModel @javax.inject.Inject constructor(
    val entitlements: EntitlementManager,
) : androidx.lifecycle.ViewModel()
