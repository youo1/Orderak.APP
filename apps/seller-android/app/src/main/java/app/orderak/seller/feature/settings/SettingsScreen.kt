package app.orderak.seller.feature.settings

import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material.icons.outlined.Category
import androidx.compose.material.icons.outlined.Delete
import androidx.compose.material.icons.outlined.Devices
import androidx.compose.material.icons.outlined.Language
import androidx.compose.material.icons.outlined.Logout
import androidx.compose.material.icons.outlined.Person
import androidx.compose.material.icons.outlined.SmartToy
import androidx.compose.material.icons.outlined.Store
import androidx.compose.material.icons.outlined.SupportAgent
import androidx.compose.material.icons.outlined.Campaign
import androidx.compose.material.icons.outlined.Translate
import androidx.compose.material.icons.outlined.Star
import androidx.compose.material.icons.outlined.Subscriptions
import androidx.compose.material3.Button
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.ListItem
import androidx.compose.material3.ListItemDefaults
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.TopAppBar
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.heading
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.unit.dp
import androidx.hilt.navigation.compose.hiltViewModel
import androidx.lifecycle.ViewModel
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.lifecycle.viewModelScope
import app.orderak.seller.R
import android.content.Context
import app.orderak.seller.data.remote.SyncScheduler
import app.orderak.seller.data.remote.BackendApi
import app.orderak.seller.data.db.OrderakDatabase
import app.orderak.seller.data.session.SessionStore
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
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
import kotlinx.coroutines.flow.map
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.flow.stateIn
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.collectLatest

import kotlinx.coroutines.launch
import javax.inject.Inject
import java.util.Locale

@HiltViewModel
class SettingsViewModel @Inject constructor(
    private val sessionStore: SessionStore,
    private val authRepository: AuthRepository,
    private val entitlementManager: EntitlementManager,
	private val entitlementRepository: EntitlementRepository,
	private val billingManager: BillingManager,
    private val backendApi: BackendApi,
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
	val planName = entitlementManager.config.map { it?.plan_name ?: "Free" }
		.stateIn(viewModelScope, SharingStarted.WhileSubscribed(5_000), "Free")
	val aiAvailable = entitlementManager.config.map { entitlementManager.isFeatureEnabled(Feature.AI_ASSISTANT) }
		.stateIn(viewModelScope, SharingStarted.WhileSubscribed(5_000), false)
	private val _billingPlans = MutableStateFlow<List<BillingPlanUi>>(emptyList())
	val billingPlans = _billingPlans.asStateFlow()

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
		billingManager.queryProductDetails(listOf(product.product_id)) { details ->
			details.firstOrNull { it.productId == product.product_id }?.let {
				billingManager.launchBillingFlow(activity, it, product.base_plan_id)
			}
		}
	}

    fun savePayout(instapay: String, vfcash: String, slug: String, onDone: () -> Unit) {
        viewModelScope.launch {
            sessionStore.savePayout(instapay.trim(), vfcash.trim())
            if (slug.isNotBlank()) sessionStore.saveSlug(slug.trim())
            SyncScheduler.syncNow(appContext)   // يبعت التحديث للباك اند فورًا
            onDone()
        }
    }

        /** Debug-only subscription plan switching — guarded by BuildConfig. */
    /** Fix(#8): logout wipes business data too — next seller starts clean. */
    fun logout(onDone: () -> Unit) {
        viewModelScope.launch {
            runLogoutSequence(
                signOutProvider = authRepository::signOut,
                clearBusinessData = { withContext(Dispatchers.IO) { db.clearAllTables() } },
                clearEntitlements = entitlementRepository::clear,
                clearSession = sessionStore::clear, // keeps the device secret (see SessionStore)
            )
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
    onBack: () -> Unit,
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
    val slugSaved by viewModel.slug.collectAsStateWithLifecycle()
    val catalogIdSaved by viewModel.catalogId.collectAsStateWithLifecycle()
	val planName by viewModel.planName.collectAsStateWithLifecycle()
	val aiAvailable by viewModel.aiAvailable.collectAsStateWithLifecycle()
	val billingPlans by viewModel.billingPlans.collectAsStateWithLifecycle()
	val activity = LocalContext.current as? android.app.Activity

    var instapay by rememberSaveable(instapaySaved) { mutableStateOf(instapaySaved.orEmpty()) }
    var vfcash by rememberSaveable(vfcashSaved) { mutableStateOf(vfcashSaved.orEmpty()) }
    var slug by rememberSaveable(slugSaved) { mutableStateOf(slugSaved.orEmpty()) }
    var showLanguage by rememberSaveable { mutableStateOf(value = false) }
    var confirmDeletion by rememberSaveable { mutableStateOf(false) }
    var confirmLogout by rememberSaveable { mutableStateOf(false) }
    var deletionResult by rememberSaveable { mutableStateOf<Boolean?>(null) }

    if (showLanguage) LanguageSheet { showLanguage = false }

    Scaffold(
        topBar = {
            TopAppBar(
                title = { Text(stringResource(R.string.settings_title), modifier = Modifier.semantics { heading() }) },
                navigationIcon = {
                    IconButton(onClick = onBack) {
                        Icon(Icons.AutoMirrored.Filled.ArrowBack, contentDescription = stringResource(R.string.common_back))
                    }
                },
                actions = {
                    IconButton(onClick = { showLanguage = true }) {
                        Icon(Icons.Outlined.Language, contentDescription = stringResource(R.string.cd_language))
                    }
                }
            )
        }
    ) { padding ->
        Column(
            Modifier.fillMaxSize().padding(padding).verticalScroll(rememberScrollState()),
        ) {
            // ── Plan section ──
            Text(
                stringResource(R.string.settings_current_plan, planName),
                style = MaterialTheme.typography.titleMedium,
                modifier = Modifier.padding(horizontal = 16.dp, vertical = 12.dp),
            )
            if (activity != null && billingPlans.isNotEmpty()) {
                billingPlans.forEach { plan ->
                    OutlinedButton(
                        onClick = { viewModel.purchase(activity, plan.product) },
                        modifier = Modifier.fillMaxWidth().padding(horizontal = 16.dp),
                    ) {
                        Text(
                            plan.localizedPrice?.let {
                                stringResource(
                                    R.string.settings_choose_plan_priced,
                                    plan.product.name,
                                    plan.product.base_plan_id,
                                    it,
                                )
                            } ?: stringResource(
                                R.string.settings_choose_plan,
                                plan.product.name,
                                plan.product.base_plan_id,
                            )
                        )
                    }
                    Spacer(Modifier.height(8.dp))
                }
            }
            Spacer(Modifier.height(8.dp))

            // ── Store section ──
            SettingsSectionHeader(stringResource(R.string.store_info_title))
            SettingsListItem(
                icon = Icons.Outlined.Store,
                label = stringResource(R.string.store_info_title),
                onClick = onOpenStoreInfo,
            )
            SettingsListItem(
                icon = Icons.Outlined.Category,
                label = stringResource(R.string.categories_title),
                onClick = onOpenCategories,
            )
            SettingsListItem(
                icon = Icons.Outlined.Translate,
                label = stringResource(R.string.catalog_languages_title),
                onClick = onOpenCatalogLanguages,
            )
            SettingsListItem(
                icon = Icons.Outlined.Person,
                label = stringResource(R.string.seller_profile_title),
                onClick = onOpenSellerProfile,
            )
            Spacer(Modifier.height(8.dp))

            // ── Tools section ──
            SettingsSectionHeader(stringResource(R.string.support_title))
            SettingsListItem(
                icon = Icons.Outlined.SupportAgent,
                label = stringResource(R.string.support_title),
                onClick = onOpenSupport,
            )
            SettingsListItem(
                icon = Icons.Outlined.Campaign,
                label = stringResource(R.string.announcements_title),
                onClick = onOpenAnnouncements,
            )
            if (aiAvailable) {
                SettingsListItem(
                    icon = Icons.Outlined.SmartToy,
                    label = stringResource(R.string.ai_assistant_title),
                    onClick = onOpenAiAssistant,
                )
            }
            Spacer(Modifier.height(8.dp))

            // ── Account section ──
            SettingsSectionHeader(stringResource(R.string.devices_title))
            SettingsListItem(
                icon = Icons.Outlined.Devices,
                label = stringResource(R.string.devices_title),
                onClick = onOpenDevices,
            )
            SettingsListItem(
                icon = Icons.Outlined.Subscriptions,
                label = stringResource(R.string.subscription_title),
                onClick = onOpenSubscription,
            )
            SettingsListItem(
                icon = Icons.Outlined.Delete,
                label = stringResource(R.string.deletion_status_title),
                onClick = onOpenDeletionStatus,
            )
            Spacer(Modifier.height(8.dp))

            // ── Payout section ──
            SettingsSectionHeader(stringResource(R.string.settings_payout_title))
            Text(
                stringResource(R.string.settings_link_title),
                style = MaterialTheme.typography.titleMedium,
                modifier = Modifier.padding(horizontal = 16.dp, vertical = 4.dp),
            )
            OutlinedTextField(
                value = slug,
                onValueChange = { v -> slug = v.lowercase(Locale.ROOT).filter { (it.isLetterOrDigit() || it == '-') }.take(30) },
                label = { Text(stringResource(R.string.settings_slug_label)) },
                singleLine = true,
                modifier = Modifier.fillMaxWidth().padding(horizontal = 16.dp),
            )
            storeUrlSaved?.takeIf { it.isNotBlank() }?.let { saved ->
                Text(
                    text = saved,
                    style = MaterialTheme.typography.bodySmall,
                    color = MaterialTheme.colorScheme.primary,
                    modifier = Modifier.padding(horizontal = 16.dp),
                )
            } ?: run {
                Text(
                    text = stringResource(R.string.settings_link_pending),
                    style = MaterialTheme.typography.bodySmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                    modifier = Modifier.padding(horizontal = 16.dp),
                )
            }
            Spacer(Modifier.height(8.dp))
            OutlinedTextField(
                value = instapay, onValueChange = { instapay = it.take(60) },
                label = { Text(stringResource(R.string.settings_instapay)) },
                singleLine = true,
                modifier = Modifier.fillMaxWidth().padding(horizontal = 16.dp),
            )
            OutlinedTextField(
                value = vfcash, onValueChange = { vfcash = it.filter(Char::isDigit).take(11) },
                label = { Text(stringResource(R.string.settings_vfcash)) },
                singleLine = true,
                modifier = Modifier.fillMaxWidth().padding(horizontal = 16.dp),
            )
            Button(
                onClick = { viewModel.savePayout(instapay, vfcash, slug, onBack) },
                modifier = Modifier.fillMaxWidth().padding(horizontal = 16.dp, vertical = 8.dp),
            ) {
                Text(stringResource(R.string.settings_save))
            }
            Spacer(Modifier.height(16.dp))

            // ── Danger zone ──
            Text(
                stringResource(R.string.settings_delete_account),
                style = MaterialTheme.typography.bodyMedium,
                color = MaterialTheme.colorScheme.error,
                modifier = Modifier
                    .fillMaxWidth()
                    .clickable(enabled = true) { confirmDeletion = true }
                    .padding(horizontal = 16.dp, vertical = 12.dp),
            )
            Text(
                stringResource(R.string.settings_logout),
                style = MaterialTheme.typography.bodyMedium,
                color = MaterialTheme.colorScheme.error,
                modifier = Modifier
                    .fillMaxWidth()
                    .clickable(enabled = true) { confirmLogout = true }
                    .padding(horizontal = 16.dp, vertical = 12.dp),
            )
            Spacer(Modifier.height(24.dp))
        }
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
private fun SettingsSectionHeader(title: String) {
    Text(
        text = title,
        style = MaterialTheme.typography.labelLarge,
        color = MaterialTheme.colorScheme.primary,
        modifier = Modifier.padding(horizontal = 16.dp, vertical = 4.dp),
    )
    HorizontalDivider(
        modifier = Modifier.padding(horizontal = 16.dp, vertical = 2.dp),
        color = MaterialTheme.colorScheme.outlineVariant,
    )
}

@Composable
private fun SettingsListItem(
    icon: ImageVector,
    label: String,
    onClick: () -> Unit,
) {
    ListItem(
        headlineContent = { Text(label, style = MaterialTheme.typography.bodyLarge) },
        leadingContent = {
            Icon(
                imageVector = icon,
                contentDescription = null,
                tint = MaterialTheme.colorScheme.onSurfaceVariant,
            )
        },
        colors = ListItemDefaults.colors(
            containerColor = MaterialTheme.colorScheme.surface,
        ),
        modifier = Modifier.fillMaxWidth().clickable(onClick = onClick),
    )
}
