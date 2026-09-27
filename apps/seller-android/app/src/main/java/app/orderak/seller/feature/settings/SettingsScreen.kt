package app.orderak.seller.feature.settings

import androidx.activity.compose.LocalActivity
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.ListItem
import androidx.compose.material3.ListItemDefaults
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Scaffold
import androidx.compose.material3.SnackbarHost
import androidx.compose.material3.SnackbarHostState
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.TopAppBar
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.res.stringResource
import androidx.hilt.navigation.compose.hiltViewModel
import androidx.lifecycle.ViewModel
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.lifecycle.viewModelScope
import app.orderak.seller.R
import android.content.Context
import app.orderak.seller.data.refresh.RefreshScheduler
import app.orderak.seller.data.remote.BackendApi
import app.orderak.seller.data.db.OrderakDatabase
import app.orderak.seller.data.session.SessionLogoutManager
import app.orderak.seller.data.session.SessionStore
import androidx.compose.runtime.rememberCoroutineScope
import dagger.hilt.android.qualifiers.ApplicationContext
import app.orderak.seller.data.billing.EntitlementManager
import app.orderak.seller.data.auth.AuthRepository
import app.orderak.seller.data.billing.EntitlementRepository
import app.orderak.seller.data.billing.BillingManager
import app.orderak.seller.data.billing.BillingState
import app.orderak.seller.data.billing.Feature
import app.orderak.seller.data.remote.BillingProductDto
import app.orderak.seller.feature.auth.LanguageSheet
import dagger.hilt.android.lifecycle.HiltViewModel
import kotlinx.coroutines.flow.SharingStarted
import kotlinx.coroutines.flow.combine
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.map
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.flow.stateIn
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.collectLatest

import kotlinx.coroutines.launch
import javax.inject.Inject
import app.orderak.seller.core.ui.theme.LocalOrderakSpacing

@HiltViewModel
class SettingsViewModel @Inject constructor(
    private val sessionStore: SessionStore,
    private val authRepository: AuthRepository,
    private val entitlementManager: EntitlementManager,
	private val entitlementRepository: EntitlementRepository,
	private val billingManager: BillingManager,
    private val backendApi: BackendApi,
    private val sessionLogoutManager: SessionLogoutManager,
    private val db: OrderakDatabase,
    @param:ApplicationContext private val appContext: Context,
) : ViewModel() {
    val shopName = sessionStore.shopName.stateIn(viewModelScope, SharingStarted.WhileSubscribed(5_000), null)
    val storeUrl = sessionStore.storeUrl.stateIn(viewModelScope, SharingStarted.WhileSubscribed(5_000), null)
    val instapay = sessionStore.instapay.stateIn(viewModelScope, SharingStarted.WhileSubscribed(5_000), null)
    val vfcash = sessionStore.vfcash.stateIn(viewModelScope, SharingStarted.WhileSubscribed(5_000), null)
    val slug = sessionStore.slug.stateIn(viewModelScope, SharingStarted.WhileSubscribed(5_000), null)
    // Full public catalog id (EG-store-A1B2C3), falling back to the legacy slug.
    val catalogId = sessionStore.publicIdentifier.combine(sessionStore.slug) { pub, slug ->
        pub?.ifBlank { null } ?: slug
    }.stateIn(viewModelScope, SharingStarted.WhileSubscribed(5_000), null)
	/**
	 * null until entitlements answer. NOT "Free".
	 *
	 * The seed was a factual claim about the seller's money, made before anything
	 * was known: every paying seller opening حسابي was told they were on the free
	 * plan until the config arrived, and the screen had no way to say "not yet".
	 * The contract has declared a loading state for this surface all along.
	 *
	 * The map carried `?: "Free"` as well, so the sentence above and the behaviour
	 * still disagreed. `EntitlementManager.config` is null until the snapshot
	 * answers — and null again when the snapshot is cleared — so a paying seller
	 * offline, or signed out, read "Current plan: Free" about their own money: the
	 * same claim, in the same place, one layer down. It also made the state the
	 * contract declares unreachable: the skeletons in `AccountContent` draw for
	 * null, and the fallback never produced one. An answered snapshot that carries
	 * no plan name is still "not known", which is what null means here.
	 */
	val planName: StateFlow<String?> = entitlementManager.config.map { it?.plan_name }
		.stateIn(viewModelScope, SharingStarted.WhileSubscribed(5_000), null)

	/**
	 * null until entitlements answer. NOT false.
	 *
	 * `false` hid the AI entry and then let it appear a beat later, which reads as
	 * a glitch rather than a decision. Withheld while unknown, shown or omitted
	 * once it is known.
	 */
	val aiAvailable: StateFlow<Boolean?> = entitlementManager.config.map { entitlementManager.isFeatureEnabled(Feature.AI_ASSISTANT) }
		.stateIn(viewModelScope, SharingStarted.WhileSubscribed(5_000), null)
	private val _billingPlans = MutableStateFlow<List<BillingPlanUi>>(emptyList())
	val billingPlans = _billingPlans.asStateFlow()

	/**
	 * Whether this account may buy anything right now.
	 *
	 * The one authoritative answer, from EntitlementManager, shared with every
	 * other surface that offers an upgrade (I-5). This screen used to draw a
	 * purchase button per plan on two conditions — an Activity exists, and the
	 * Play catalogue returned products — neither of which is a permission. It was
	 * safe only by accident: BILLING_ENABLED is false, so the catalogue comes back
	 * empty and no button drew. The accident ends the moment billing opens.
	 */
	val purchaseOpen = entitlementManager.config
		.map { entitlementManager.isPurchaseOpen() }
		.stateIn(viewModelScope, SharingStarted.WhileSubscribed(5_000), false)

	init {
		viewModelScope.launch {
			combine(billingManager.catalog, billingManager.state) { products, state -> products to state }
				.collectLatest { (products, state) ->
					_billingPlans.value = products.map { BillingPlanUi(it) }
					if (state == BillingState.Ready && products.isNotEmpty()) {
						billingManager.queryProductDetails(products.map { it.product_id }) { details ->
							_billingPlans.value = products.map { product ->
								val detail = details.firstOrNull { it.productId == product.product_id }
								val offer = detail?.subscriptionOfferDetails
									?.firstOrNull { it.basePlanId == product.base_plan_id }
								val localizedPrice = offer?.pricingPhases?.pricingPhaseList
									?.lastOrNull()?.formattedPrice
								BillingPlanUi(product, localizedPrice)
							}
						}
					}
				}
		}
	}

	fun purchase(activity: android.app.Activity, product: BillingProductDto) {
		// Checked here as well as at the button. The composition that drew the
		// button can be older than the snapshot that closed purchasing, and this is
		// the last point the app controls before Play takes over. The server stays
		// the commercial authority either way — this gate exists so a seller is not
		// walked into a checkout that will refuse them.
		if (!entitlementManager.isPurchaseOpen()) return
		billingManager.queryProductDetails(listOf(product.product_id)) { details ->
			details.firstOrNull { it.productId == product.product_id }?.let {
				billingManager.launchBillingFlow(activity, it, product.base_plan_id)
			}
		}
	}

    fun savePayout(instapay: String, vfcash: String, onDone: () -> Unit) {
        viewModelScope.launch {
            sessionStore.savePayout(instapay.trim(), vfcash.trim())
            // The slug is not written here. It is a store field, edited on the
            // store surface, which is the only place that can check the name
            // against the server before saving it (`StoreInfoScreen`). This call
            // used to write a slug that had never been checked, and a taken name
            // made the registration below fail — stopping the sync — while the
            // snackbar reported success.
            RefreshScheduler.refreshNow(appContext)   // يبعت التحديث للباك اند فورًا
            onDone()
        }
    }

    /**
     * Signing out from Settings, through the one sequence every account state
     * uses. Auth contract v8, guarantee 10.
     *
     * This used to assemble the sequence itself — which is how the class
     * documented as "the single protected logout sequence used by every account
     * state" acquired a second caller that was not it, and why a change to
     * logout had to be made in two places or silently be made in one.
     */
    fun logout(onDone: () -> Unit) {
        viewModelScope.launch {
            sessionLogoutManager.logout()
            onDone()
        }
    }

    fun requestAccountDeletion(onResult: (Boolean) -> Unit) {
        viewModelScope.launch {
            val phone = sessionStore.phone.first().orEmpty()
            val secret = sessionStore.getOrCreateSecret()
            val response = if (phone.isNotBlank()) backendApi.requestAccountDeletion(phone, secret) else null
            onResult(response?.ok == true)
        }
    }
}

data class BillingPlanUi(
	val product: BillingProductDto,
	val localizedPrice: String? = null,
)

/** S13 — settings hub with grouped ListItem sections using proper M3 hierarchy. */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun SettingsScreen(
    onLogout: () -> Unit,
    onOpenStoreInfo: () -> Unit = {},
    onOpenCategories: () -> Unit = {},
    onOpenSupport: () -> Unit = {},
    onOpenAnnouncements: () -> Unit = {},
    onOpenCatalogLanguages: () -> Unit = {},
    onOpenDevices: () -> Unit = {},
    onOpenDeletionStatus: () -> Unit = {},
    onOpenSubscription: () -> Unit = {},
    onOpenAiAssistant: () -> Unit = {},
    onOpenSellerProfile: () -> Unit = {},
    viewModel: SettingsViewModel = hiltViewModel(),
) {
    val storeUrlSaved by viewModel.storeUrl.collectAsStateWithLifecycle()
    val instapaySaved by viewModel.instapay.collectAsStateWithLifecycle()
    val vfcashSaved by viewModel.vfcash.collectAsStateWithLifecycle()
    val catalogIdSaved by viewModel.catalogId.collectAsStateWithLifecycle()
	val planName by viewModel.planName.collectAsStateWithLifecycle()
	val aiAvailable by viewModel.aiAvailable.collectAsStateWithLifecycle()
	val billingPlans by viewModel.billingPlans.collectAsStateWithLifecycle()
	val purchaseOpen by viewModel.purchaseOpen.collectAsStateWithLifecycle()
	val activity = LocalActivity.current

    var instapay by rememberSaveable(instapaySaved) { mutableStateOf(instapaySaved.orEmpty()) }
    var vfcash by rememberSaveable(vfcashSaved) { mutableStateOf(vfcashSaved.orEmpty()) }
    var showLanguage by rememberSaveable { mutableStateOf(value = false) }
    var confirmDeletion by rememberSaveable { mutableStateOf(false) }
    var confirmLogout by rememberSaveable { mutableStateOf(false) }
    var deletionResult by rememberSaveable { mutableStateOf<Boolean?>(null) }

    // Saving payout details used to call the screen's onBack, which dismissed
    // it. As a tab there is nothing to dismiss, so the save reported itself by
    // doing nothing at all. It says so now.
    val snackbarHostState = remember { SnackbarHostState() }
    val scope = rememberCoroutineScope()
    val payoutSaved = stringResource(R.string.settings_payout_saved)

    if (showLanguage) LanguageSheet { showLanguage = false }

    // One bar, not two.
    //
    // This surface used to draw its own `Scaffold` and `TopAppBar` inside the
    // shell's, which is two stacked bars with two titles — the shop's above the
    // word "Settings" — and two snackbar hosts. A surface hosted in the shell
    // draws no chrome of its own; the only thing the inner bar carried was the
    // language switch, and that is a row in the account-actions group now.
    Box(Modifier.fillMaxSize()) {
        AccountContent(
            state = AccountUiState(
                planName = planName,
                aiAvailable = aiAvailable,
                billingPlans = billingPlans,
                // An Activity is what a purchase needs, not what permits one.
                // Folded in here so the surface reads one boolean.
                purchaseOpen = purchaseOpen && activity != null,
                storeUrl = storeUrlSaved,
            ),
            instapay = instapay,
            onInstapayChange = { instapay = it },
            vfcash = vfcash,
            onVfcashChange = { vfcash = it },
            onSavePayout = {
                viewModel.savePayout(instapay, vfcash) {
                    scope.launch { snackbarHostState.showSnackbar(payoutSaved) }
                }
            },
            onPurchase = { plan -> activity?.let { viewModel.purchase(it, plan.product) } },
            onOpenStoreInfo = onOpenStoreInfo,
            onOpenCategories = onOpenCategories,
            onOpenCatalogLanguages = onOpenCatalogLanguages,
            onOpenSellerProfile = onOpenSellerProfile,
            onOpenSupport = onOpenSupport,
            onOpenAnnouncements = onOpenAnnouncements,
            onOpenAiAssistant = onOpenAiAssistant,
            onOpenDevices = onOpenDevices,
            onOpenSubscription = onOpenSubscription,
            onOpenDeletionStatus = onOpenDeletionStatus,
            onRequestDeletion = { confirmDeletion = true },
            onRequestLogout = { confirmLogout = true },
            onOpenAppLanguage = { showLanguage = true },
        )
        SnackbarHost(
            hostState = snackbarHostState,
            modifier = Modifier.align(Alignment.BottomCenter),
        )
    }

    if (confirmDeletion) {
        AlertDialog(
            onDismissRequest = { confirmDeletion = false },
            title = { Text(stringResource(R.string.settings_delete_account)) },
            text = { Text(stringResource(R.string.settings_delete_confirm)) },
            confirmButton = {
                TextButton(onClick = {
                    confirmDeletion = false
                    viewModel.requestAccountDeletion { deletionResult = it }
                }) { Text(stringResource(R.string.settings_delete_account), color = MaterialTheme.colorScheme.error) }
            },
            dismissButton = { TextButton(onClick = { confirmDeletion = false }) { Text(stringResource(R.string.common_cancel)) } },
        )
    }
    if (confirmLogout) {
        AlertDialog(
            onDismissRequest = { confirmLogout = false },
            title = { Text(stringResource(R.string.settings_logout)) },
            text = { Text(stringResource(R.string.settings_logout_confirm)) },
            confirmButton = {
                TextButton(onClick = { confirmLogout = false; viewModel.logout(onLogout) }) {
                    Text(stringResource(R.string.settings_logout), color = MaterialTheme.colorScheme.error)
                }
            },
            dismissButton = { TextButton(onClick = { confirmLogout = false }) { Text(stringResource(R.string.common_cancel)) } },
        )
    }
    deletionResult?.let { success ->
        AlertDialog(
            onDismissRequest = { deletionResult = null },
            text = { Text(stringResource(if (success) R.string.settings_delete_requested else R.string.settings_delete_failed)) },
            confirmButton = { TextButton(onClick = { deletionResult = null }) { Text(stringResource(R.string.common_ok)) } },
        )
    }
}

@Composable
internal fun SettingsSectionHeader(title: String) {
    val spacing = LocalOrderakSpacing.current
    Text(
        text = title,
        style = MaterialTheme.typography.labelLarge,
        color = MaterialTheme.colorScheme.primary,
        modifier = Modifier.padding(horizontal = spacing.space4, vertical = spacing.space1),
    )
    HorizontalDivider(
        modifier = Modifier.padding(horizontal = spacing.space4, vertical = spacing.space1),
        color = MaterialTheme.colorScheme.outlineVariant,
    )
}

@Composable
internal fun SettingsListItem(
    icon: ImageVector,
    label: String,
    onClick: () -> Unit,
    /**
     * A row whose action cannot be undone: the icon and the label carry the
     * error colour. The words still say what it does, so the colour reinforces
     * the meaning rather than being the only place it exists.
     */
    destructive: Boolean = false,
) {
    val tint = if (destructive) MaterialTheme.colorScheme.error else MaterialTheme.colorScheme.onSurfaceVariant
    ListItem(
        headlineContent = {
            Text(
                label,
                style = MaterialTheme.typography.bodyLarge,
                color = if (destructive) MaterialTheme.colorScheme.error else Color.Unspecified,
            )
        },
        leadingContent = {
            Icon(
                imageVector = icon,
                contentDescription = null,
                tint = tint,
            )
        },
        colors = ListItemDefaults.colors(
            containerColor = MaterialTheme.colorScheme.surface,
        ),
        // Every row is at least the 48dp floor the design system sets, whatever
        // its label's line height happens to be.
        modifier = Modifier
            .fillMaxWidth()
            .heightIn(min = LocalOrderakSpacing.current.minimumTouchTarget)
            .clickable(onClick = onClick),
    )
}
