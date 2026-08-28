package app.orderak.seller.feature.main

import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.outlined.ReceiptLong
import androidx.compose.material.icons.filled.Add
import androidx.compose.material.icons.filled.Home
import androidx.compose.material.icons.filled.Close
import androidx.compose.material.icons.outlined.CloudOff
import androidx.compose.material.icons.outlined.Group
import androidx.compose.material.icons.outlined.Inventory2
import androidx.compose.material.icons.outlined.Share
import androidx.compose.material3.Button
import androidx.compose.material3.Card
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.FloatingActionButton
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.LinearProgressIndicator
import androidx.compose.material3.NavigationBar
import androidx.compose.material3.NavigationBarItem
import androidx.compose.material3.NavigationBarItemDefaults
import androidx.compose.material3.Scaffold
import androidx.compose.material3.SnackbarHost
import androidx.compose.material3.SnackbarHostState
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.TopAppBar
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.LocalUriHandler
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.heading
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.hilt.navigation.compose.hiltViewModel
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import app.orderak.seller.R
import app.orderak.seller.app.navigation.SellerSurface
import app.orderak.seller.core.ui.NoticeBanner
import app.orderak.seller.core.ui.SemanticRole
import app.orderak.seller.core.ui.UsageMeter
import app.orderak.seller.feature.settings.SettingsScreen
import app.orderak.seller.core.ads.LocalAdManager
import app.orderak.seller.core.ui.SyncStatusBanner
import app.orderak.seller.feature.customers.CustomersScreen
import app.orderak.seller.feature.orders.OrdersScreen
import app.orderak.seller.feature.products.ProductsScreen
import app.orderak.seller.data.remote.SyncScheduler
import app.orderak.seller.data.remote.BackendConfig
import app.orderak.seller.data.remote.AppVersionPolicy
import app.orderak.seller.data.billing.EntitlementFreshness
import app.orderak.seller.data.billing.EntitlementRefreshResult
import app.orderak.seller.data.billing.EntitlementSyncState
import app.orderak.seller.feature.products.shareStoreLink
import app.orderak.seller.feature.products.shareCatalogText
import app.orderak.seller.feature.operations.AnnouncementsDashboardIndicator
import app.orderak.seller.core.ui.theme.LocalOrderakExtendedColors
import kotlinx.coroutines.launch
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.intOrNull
import androidx.compose.material3.pulltorefresh.PullToRefreshBox

/**
 * Main graph shell: S4 dashboard + S5 orders + S8 products + S11 customers.
 * TODO(polish): nested NavHost with saveState/restoreState per tab (Plan §3.4).
 */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun MainScreen(
    onNewOrder: () -> Unit,
    onOpenOrder: (Long) -> Unit,
    onAddProduct: () -> Unit,
    onEditProduct: (Long) -> Unit,
    onOpenCustomer: (String) -> Unit,
    onOpenAnnouncements: () -> Unit,
    // The account surface is where settings live now, so the shell owns the
    // destinations the deleted SettingsRoute used to reach.
    onLogout: () -> Unit = {},
    onOpenStoreInfo: () -> Unit = {},
    onOpenCategories: () -> Unit = {},
    onOpenSupport: () -> Unit = {},
    onOpenCatalogLanguages: () -> Unit = {},
    onOpenDevices: () -> Unit = {},
    onOpenDeletionStatus: () -> Unit = {},
    onOpenSubscription: () -> Unit = {},
    onOpenAiAssistant: () -> Unit = {},
    onOpenSellerProfile: () -> Unit = {},
    viewModel: MainViewModel = hiltViewModel()
) {
    val shopName by viewModel.shopName.collectAsStateWithLifecycle()
    val storeUrl by viewModel.storeUrl.collectAsStateWithLifecycle()
    val sellerPhone by viewModel.sellerPhone.collectAsStateWithLifecycle()
    val entitlementState by viewModel.entitlementState.collectAsStateWithLifecycle()
    val syncStatus by viewModel.syncStatus.collectAsStateWithLifecycle()
    val snackbarHostState = remember { SnackbarHostState() }
    val updatedMessage = stringResource(R.string.plan_settings_updated)
    val refreshFailedMessage = stringResource(R.string.plan_settings_refresh_failed)
    val versionPolicy = entitlementState.config?.governance?.version
    val configAge = entitlementState.lastUpdatedEpochMs?.let { System.currentTimeMillis() - it }
    val versionMode = versionUiMode(versionPolicy, configAge)

    if (versionMode in setOf(VersionUiMode.FORCE_UPDATE, VersionUiMode.BLOCKED, VersionUiMode.MAINTENANCE)) {
        VersionBlockingScreen(versionMode, versionPolicy ?: AppVersionPolicy(), viewModel::refreshPlanSettings)
        return
    }

    // Saved by name rather than index: an ordinal survives process death only
    // until the surface list changes, and then restores the wrong screen.
    var surfaceName by rememberSaveable { mutableStateOf(SellerSurface.Default.name) }
    val surface = SellerSurface.valueOf(surfaceName)

    val appContext = LocalContext.current.applicationContext
    LaunchedEffect(Unit) {
        SyncScheduler.ensurePeriodic(appContext)
        SyncScheduler.syncNow(appContext)
    }
    LaunchedEffect(viewModel, updatedMessage, refreshFailedMessage) {
        viewModel.planRefreshEvents.collect { result ->
            when (result) {
                EntitlementRefreshResult.UPDATED,
                EntitlementRefreshResult.NOT_MODIFIED -> snackbarHostState.showSnackbar(updatedMessage)
                EntitlementRefreshResult.FAILED -> snackbarHostState.showSnackbar(refreshFailedMessage)
                else -> Unit
            }
        }
    }

    Scaffold(
        snackbarHost = { SnackbarHost(snackbarHostState) },
        topBar = {
            TopAppBar(
                title = { Text(shopName ?: stringResource(R.string.app_name), modifier = Modifier.semantics { heading() }) },
            )
        },
        floatingActionButton = {
            if (surface == SellerSurface.Today) {
                FloatingActionButton(onClick = onNewOrder) {
                    Icon(Icons.Filled.Add, contentDescription = stringResource(R.string.order_new_title))
                }
            }
        },
        bottomBar = {
            NavigationBar {
                SellerSurface.entries.forEach { item ->
                    val label = stringResource(item.labelRes)
                    NavigationBarItem(
                        selected = surface == item,
                        onClick = { surfaceName = item.name },
                        icon = { Icon(item.icon, contentDescription = label) },
                        label = { Text(label) },
                        colors = NavigationBarItemDefaults.colors(
                            selectedIconColor = MaterialTheme.colorScheme.onPrimaryContainer,
                            selectedTextColor = MaterialTheme.colorScheme.onSurface,
                            indicatorColor = MaterialTheme.colorScheme.primaryContainer,
                            unselectedIconColor = MaterialTheme.colorScheme.onSurfaceVariant,
                            unselectedTextColor = MaterialTheme.colorScheme.onSurfaceVariant,
                        ),
                    )
                }
            }
        }
    ) { padding ->
        Box(Modifier.fillMaxSize().padding(padding)) {
            when (surface) {
                SellerSurface.Today -> DashboardTab(
                    viewModel = viewModel,
                    sellerPhone = sellerPhone,
                    storeUrl = storeUrl,
                    entitlementState = entitlementState,
                    syncStatus = syncStatus,
                    versionMode = versionMode,
                    versionPolicy = versionPolicy,
                    onRetrySync = { SyncScheduler.syncNow(appContext) },
                    onRefresh = viewModel::refreshPlanSettings,
                    onSeeOrders = { surfaceName = SellerSurface.Orders.name },
                    onOpenAnnouncements = onOpenAnnouncements,
                )

                SellerSurface.Orders -> OrdersScreen(onOpen = onOpenOrder, onNew = onNewOrder)
                SellerSurface.Store -> ProductsScreen(
                    onAdd = onAddProduct,
                    onEdit = onEditProduct,
                    onUpgrade = onOpenSubscription,
                    sellerPhone = sellerPhone,
                )
                SellerSurface.Customers -> CustomersScreen(onOpen = onOpenCustomer)
                // Hosted, not reimplemented: this is the same screen the old
                // settings route showed, now reached only as a surface.
                SellerSurface.Account -> SettingsScreen(
                    onLogout = onLogout,
                    onOpenStoreInfo = onOpenStoreInfo,
                    onOpenCategories = onOpenCategories,
                    onOpenSupport = onOpenSupport,
                    onOpenAnnouncements = onOpenAnnouncements,
                    onOpenCatalogLanguages = onOpenCatalogLanguages,
                    onOpenDevices = onOpenDevices,
                    onOpenDeletionStatus = onOpenDeletionStatus,
                    onOpenSubscription = onOpenSubscription,
                    onOpenAiAssistant = onOpenAiAssistant,
                    onOpenSellerProfile = onOpenSellerProfile,
                )
            }
        }
    }
}

/** S4 — the daily habit: today / unpaid / to-ship + share (Plan S4). */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
private fun DashboardTab(
    viewModel: MainViewModel,
    sellerPhone: String?,
    storeUrl: String?,
    entitlementState: EntitlementSyncState,
    syncStatus: String?,
    versionMode: VersionUiMode,
    versionPolicy: AppVersionPolicy?,
    onRetrySync: () -> Unit,
    onRefresh: () -> Unit,
    onSeeOrders: () -> Unit,
    onOpenAnnouncements: () -> Unit,
) {
    val adManager = LocalAdManager.current
    val shopName by viewModel.shopName.collectAsStateWithLifecycle()
    val today by viewModel.todayCount.collectAsStateWithLifecycle()
    val unpaid by viewModel.unpaidCount.collectAsStateWithLifecycle()
    val toShip by viewModel.toShipCount.collectAsStateWithLifecycle()

    // Lightweight COUNT(*) instead of collecting the full product list here.
    val hasProducts by viewModel.hasProducts.collectAsStateWithLifecycle()
    val context = LocalContext.current
    // UI-scoped: cancelled when this composable leaves composition, so the
    // share sheet can never fire against a dead screen (leak fix).
    val scope = rememberCoroutineScope()

    PullToRefreshBox(
        isRefreshing = entitlementState.isRefreshing,
        onRefresh = onRefresh,
        modifier = Modifier.fillMaxSize(),
    ) {
        LazyColumn(
            modifier = Modifier.fillMaxSize(),
            contentPadding = PaddingValues(16.dp),
            verticalArrangement = Arrangement.spacedBy(16.dp),
        ) {
            item {
                Text(stringResource(R.string.dash_greeting, shopName.orEmpty()),
                    style = MaterialTheme.typography.titleLarge)
            }
            item { PlanStatusBanners(entitlementState, versionMode, versionPolicy) }
            item { AnnouncementsDashboardIndicator(onOpenAnnouncements) }
            if (syncStatus == "running" || syncStatus == "pending" || syncStatus == "failed") {
                item { SyncStatusBanner(syncStatus, onRetrySync) }
            }
            item {
                Row(horizontalArrangement = Arrangement.spacedBy(8.dp), modifier = Modifier.fillMaxWidth()) {
                    StatCard(stringResource(R.string.dash_today_orders), today, Modifier.weight(1f), onSeeOrders)
                    StatCard(stringResource(R.string.dash_unpaid), unpaid, Modifier.weight(1f), onSeeOrders)
                    StatCard(stringResource(R.string.dash_to_ship), toShip, Modifier.weight(1f), onSeeOrders)
                }
            }
            entitlementState.config?.let { config -> item { PlanUsageCard(config) } }
            item {
                Card(Modifier.fillMaxWidth()) {
                    Column(Modifier.fillMaxWidth().padding(24.dp), horizontalAlignment = Alignment.CenterHorizontally) {
                        if (!hasProducts) {
                            Text(stringResource(R.string.dash_empty_title), style = MaterialTheme.typography.titleMedium)
                            Spacer(Modifier.height(8.dp))
                            Text(stringResource(R.string.dash_empty_body_v2),
                                style = MaterialTheme.typography.bodyMedium, textAlign = TextAlign.Center,
                                color = MaterialTheme.colorScheme.onSurfaceVariant)
                        } else {
                            Button(onClick = {
                                scope.launch {
                                    val url = storeUrl
                                    if (url.isNullOrBlank()) shareCatalogText(context, shopName, sellerPhone, viewModel.productsForShare())
                                    else shareStoreLink(context, shopName, url)
                                }
                            }) {
                                Icon(Icons.Outlined.Share, contentDescription = null)
                                Text(stringResource(R.string.dash_share_catalog), Modifier.padding(start = 8.dp))
                            }
                        }
                    }
                }
            }
            item { adManager.Banner(Modifier.fillMaxWidth()) }
        }
    }
}

@Composable
private fun PlanStatusBanners(state: EntitlementSyncState, versionMode: VersionUiMode, versionPolicy: AppVersionPolicy?) {
    val config = state.config
    var dismissedPending by rememberSaveable(config?.pending_revision_id) { mutableStateOf(false) }
    Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
        if (versionMode == VersionUiMode.WARNING || versionMode == VersionUiMode.STALE_WARNING) {
            PlanNotice(
                text = localizedVersionMessage(versionPolicy, blocking = false)
                    ?: stringResource(if (versionMode == VersionUiMode.STALE_WARNING) R.string.app_version_stale_warning else R.string.app_version_warning),
                dismissible = false,
            )
        }
        if (state.freshness == EntitlementFreshness.OFFLINE) {
            // Was a hand-rolled surface on secondaryContainer — the orange this
            // system reserves for nothing in particular. The shared banner makes
            // offline read the same here as on every other surface.
            NoticeBanner(
                role = SemanticRole.Info,
                title = stringResource(R.string.plan_using_offline_settings),
                message = stringResource(R.string.plan_using_offline_settings_body),
            )
        }
        if (config?.subscription_status == "grace") {
            PlanNotice(text = stringResource(R.string.plan_billing_grace), dismissible = false)
        } else if (config?.pending_revision_id != null && !dismissedPending) {
            PlanNotice(
                text = stringResource(
                    R.string.plan_change_pending,
                    config.pending_effective_at?.take(10).orEmpty(),
                ),
                dismissible = true,
                onDismiss = { dismissedPending = true },
            )
        }
    }
}

@Composable
private fun VersionBlockingScreen(mode: VersionUiMode, policy: AppVersionPolicy, onRetry: () -> Unit) {
    val uriHandler = LocalUriHandler.current
    val title = when (mode) {
        VersionUiMode.MAINTENANCE -> stringResource(R.string.app_version_maintenance_title)
        VersionUiMode.BLOCKED -> stringResource(R.string.app_version_blocked_title)
        else -> stringResource(R.string.app_version_update_title)
    }
    val fallback = when (mode) {
        VersionUiMode.MAINTENANCE -> stringResource(R.string.app_version_maintenance_body)
        VersionUiMode.BLOCKED -> stringResource(R.string.app_version_blocked_body)
        else -> stringResource(R.string.app_version_update_body)
    }
    Surface(Modifier.fillMaxSize(), color = MaterialTheme.colorScheme.background) {
        Column(
            Modifier.fillMaxSize().padding(32.dp),
            verticalArrangement = Arrangement.Center,
            horizontalAlignment = Alignment.CenterHorizontally,
        ) {
            Text(title, style = MaterialTheme.typography.headlineMedium, textAlign = TextAlign.Center)
            Spacer(Modifier.height(12.dp))
            Text(localizedVersionMessage(policy, blocking = true) ?: fallback, textAlign = TextAlign.Center, color = MaterialTheme.colorScheme.onSurfaceVariant)
            Spacer(Modifier.height(24.dp))
            if (mode == VersionUiMode.FORCE_UPDATE && !policy.store_url.isNullOrBlank()) {
                Button(onClick = { runCatching { uriHandler.openUri(policy.store_url) } }) { Text(stringResource(R.string.app_version_update_action)) }
                Spacer(Modifier.height(8.dp))
            }
            TextButton(onClick = onRetry) { Text(stringResource(R.string.common_retry)) }
        }
    }
}

@Composable
private fun localizedVersionMessage(policy: AppVersionPolicy?, blocking: Boolean): String? {
    if (policy == null) return null
    val language = androidx.compose.ui.text.intl.Locale.current.language
    val messages = if (blocking) policy.blocking_message else policy.warning_message
    return messages[language] ?: messages["en"] ?: messages["ar"]
}

@Composable
private fun PlanNotice(text: String, dismissible: Boolean, onDismiss: () -> Unit = {}) {
    // Drew on `tertiaryContainer` with no icon at all, so it carried its meaning
    // in hue alone and in a hue the semantic layer does not assign. A version
    // that needs attention, or settings that have gone stale, is a warning — and
    // the shared banner brings the glyph that survives greyscale.
    Row(verticalAlignment = Alignment.CenterVertically) {
        NoticeBanner(
            role = SemanticRole.Warning,
            title = stringResource(R.string.plan_notice_title),
            message = text,
            modifier = Modifier.weight(1f),
        )
        if (dismissible) {
            IconButton(onClick = onDismiss) {
                Icon(Icons.Filled.Close, contentDescription = stringResource(R.string.common_dismiss))
            }
        }
    }
}

@Composable
private fun PlanUsageCard(config: BackendConfig) {
    val definitions = listOf(
        "max_products" to R.string.usage_products,
        "max_orders_per_month" to R.string.usage_orders_month,
        "max_ai_requests_per_month" to R.string.usage_ai_requests,
        "max_categories" to R.string.usage_categories,
        "max_concurrent_devices" to R.string.usage_devices,
    )
    val rows = definitions.mapNotNull { (key, label) ->
        val entitlement = config.entitlements[key] ?: return@mapNotNull null
        val used = entitlement.used ?: return@mapNotNull null
        val limit = if (entitlement.mode == "unlimited") null
        else (entitlement.value as? JsonPrimitive)?.intOrNull
        Triple(label, used, limit)
    }
    if (rows.isEmpty()) return

    Card(Modifier.fillMaxWidth()) {
        Column(Modifier.fillMaxWidth().padding(16.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
            Text(stringResource(R.string.plan_usage_title), style = MaterialTheme.typography.titleMedium)
            rows.forEach { (label, used, limit) ->
                // This card used to draw its own bar and pick its own thresholds,
                // so the dashboard and the products screen disagreed about how
                // close to a limit counts as close. UsageMeter owns that now, and
                // carries the icon that keeps the warning readable without colour.
                if (limit != null) {
                    UsageMeter(label = stringResource(label), used = used, limit = limit)
                } else {
                    Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween) {
                        Text(stringResource(label), style = MaterialTheme.typography.bodyMedium)
                        Text(
                            stringResource(R.string.usage_value_unlimited, used),
                            style = MaterialTheme.typography.labelMedium,
                        )
                    }
                }
            }
        }
    }
}

@Composable
private fun StatCard(label: String, value: Int, modifier: Modifier = Modifier, onClick: () -> Unit) {
    Card(modifier.clickable(onClick = onClick)) {
        Column(Modifier.padding(12.dp).fillMaxWidth(), horizontalAlignment = Alignment.CenterHorizontally) {
            Text("$value", style = MaterialTheme.typography.headlineMedium,
                color = if (value > 0) MaterialTheme.colorScheme.primary
                        else MaterialTheme.colorScheme.onSurface)
            Text(label, style = MaterialTheme.typography.labelMedium, textAlign = TextAlign.Center)
        }
    }
}