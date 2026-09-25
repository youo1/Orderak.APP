package app.orderak.seller.feature.products

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
@Composable
fun ProductsScreen(
    onAdd: () -> Unit,
    onEdit: (Long) -> Unit,
    onLimitReached: (String) -> Unit,
    sellerPhone: String?,
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
        AlertDialog(
            onDismissRequest = { showLimitDialog = false },
            icon = { Icon(Icons.Filled.Lock, contentDescription = null) },
            title = { Text(stringResource(R.string.products_limit_title)) },
            text = {
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
                Text(message)
            },
            confirmButton = {
                // A higher plan existing is not the same as being able to buy it.
                // Purchase is closed platform-wide and the acquisition routes
                // answer 403, so the label changes rather than the destination:
                // the paywall explains what the next plan gives either way, and
                // only offers to sell when selling is actually open. Sending a
                // seller to a purchase control the server refuses is the dead end
                // this avoids (I-5).
                if (quota.upgradePlanKey != null) {
                    TextButton(onClick = {
                        showLimitDialog = false
                        onLimitReached(FeatureKeys.MAX_PRODUCTS)
                    }) {
                        Text(
                            stringResource(
                                if (purchaseOpen) R.string.upgrade_now else R.string.paywall_view_plans,
                            ),
                        )
                    }
                }
            },
            dismissButton = {
                TextButton(onClick = { showLimitDialog = false }) {
                    Text(stringResource(R.string.common_ok))
                }
            },
        )
    }

    if (showStuckDialog) {
        AlertDialog(
            onDismissRequest = { showStuckDialog = false },
            title = { Text(stringResource(R.string.products_stuck_dialog_title)) },
            text = {
                Column(verticalArrangement = Arrangement.spacedBy(spacing.space3)) {
                    stuck.forEach { item ->
                        Row(
                            Modifier.fillMaxWidth(),
                            verticalAlignment = Alignment.CenterVertically,
                        ) {
                            Column(Modifier.weight(1f)) {
                                Text(item.name, style = MaterialTheme.typography.bodyLarge)
                                Text(
                                    // TERMINAL is the reconciler's own word for
                                    // "the server said something that will not
                                    // change by asking again". Anything else —
                                    // including no answer at all — is still on
                                    // its way, and saying otherwise would push a
                                    // seller to delete a product over a bad
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
                            TextButton(onClick = { confirmDiscard = item }) {
                                Text(stringResource(R.string.products_stuck_discard))
                            }
                        }
                    }
                }
            },
            confirmButton = {
                TextButton(onClick = { showStuckDialog = false }) {
                    Text(stringResource(R.string.common_cancel))
                }
            },
        )
    }

    confirmDiscard?.let { target ->
        AlertDialog(
            onDismissRequest = { confirmDiscard = null },
            title = { Text(stringResource(R.string.products_stuck_discard_title, target.name)) },
            text = { Text(stringResource(R.string.products_stuck_discard_confirm)) },
            confirmButton = {
                TextButton(onClick = {
                    viewModel.discardStuck(target.localId)
                    confirmDiscard = null
                    // Closing the list too: it is about to be one row shorter,
                    // and a dialog that stays open over a changing list invites
                    // the second tap to land on something else.
                    showStuckDialog = false
                }) {
                    Text(stringResource(R.string.products_stuck_discard))
                }
            },
            dismissButton = {
                TextButton(onClick = { confirmDiscard = null }) {
                    Text(stringResource(R.string.common_cancel))
                }
            },
        )
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
