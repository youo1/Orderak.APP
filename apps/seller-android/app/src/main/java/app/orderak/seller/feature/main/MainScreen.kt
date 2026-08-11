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
import androidx.compose.material.icons.filled.Settings
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
    onOpenSettings: () -> Unit,
    onOpenAnnouncements: () -> Unit,
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

    var tab by rememberSaveable { mutableIntStateOf(0) }

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
                actions = {
                    IconButton(onClick = onOpenSettings) {
                        Icon(Icons.Filled.Settings, contentDescription = stringResource(R.string.cd_settings))
                    }
                }
            )
        },
        floatingActionButton = {
            if (tab == 0) {
                FloatingActionButton(onClick = onNewOrder) {
                    Icon(Icons.Filled.Add, contentDescription = stringResource(R.string.order_new_title))
                }
            }
        },
        bottomBar = {
            NavigationBar {
                NavigationBarItem(selected = tab == 0, onClick = { tab = 0 },
                    icon = { Icon(Icons.Filled.Home, contentDescription = stringResource(R.string.nav_dashboard)) },
                    label = { Text(stringResource(R.string.nav_dashboard)) })
                NavigationBarItem(selected = tab == 1, onClick = { tab = 1 },
                    icon = { Icon(Icons.AutoMirrored.Outlined.ReceiptLong, contentDescription = stringResource(R.string.nav_orders)) },
                    label = { Text(stringResource(R.string.nav_orders)) })
                NavigationBarItem(selected = tab == 2, onClick = { tab = 2 },
                    icon = { Icon(Icons.Outlined.Inventory2, contentDescription = stringResource(R.string.nav_products)) },
                    label = { Text(stringResource(R.string.nav_products)) })
                NavigationBarItem(selected = tab == 3, onClick = { tab = 3 },
                    icon = { Icon(Icons.Outlined.Group, contentDescription = stringResource(R.string.nav_customers)) },
                    label = { Text(stringResource(R.string.nav_customers)) })
            }
        }
    ) { padding ->
        Box(Modifier.fillMaxSize().padding(padding)) {
            when (tab) {
                0 -> DashboardTab(
                    viewModel = viewModel,
                    sellerPhone = sellerPhone,
                    storeUrl = storeUrl,
                    entitlementState = entitlementState,
                    syncStatus = syncStatus,
                    versionMode = versionMode,
                    versionPolicy = versionPolicy,
                    onRetrySync = { SyncScheduler.syncNow(appContext) },
                    onRefresh = viewModel::refreshPlanSettings,
                    onSeeOrders = { tab = 1 },
                    onOpenAnnouncements = onOpenAnnouncements,
                )

                1 -> OrdersScreen(onOpen = onOpenOrder, onNew = onNewOrder)
                2 -> ProductsScreen(
                    onAdd = onAddProduct,
                    onEdit = onEditProduct,
                    onUpgrade = onOpenSettings,
                    sellerPhone = sellerPhone,
                )
                else -> CustomersScreen(onOpen = onOpenCustomer)
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
            Surface(
                color = MaterialTheme.colorScheme.secondaryContainer,
                shape = MaterialTheme.shapes.medium,
            ) {
                Row(Modifier.fillMaxWidth().padding(12.dp), verticalAlignment = Alignment.CenterVertically) {
                    Icon(Icons.Outlined.CloudOff, contentDescription = null)
                    Text(stringResource(R.string.plan_using_offline_settings), Modifier.padding(start = 8.dp))
                }
            }
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
    Surface(
        color = MaterialTheme.colorScheme.tertiaryContainer,
        shape = MaterialTheme.shapes.medium,
    ) {
        Row(Modifier.fillMaxWidth().padding(12.dp), verticalAlignment = Alignment.CenterVertically) {
            Text(text, Modifier.weight(1f), style = MaterialTheme.typography.bodyMedium)
            if (dismissible) {
                IconButton(onClick = onDismiss) {
                    Icon(Icons.Filled.Close, contentDescription = stringResource(R.string.common_dismiss))
                }
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
                val ratio = if (limit == null || limit <= 0) 0f else (used.toFloat() / limit).coerceIn(0f, 1f)
                val extendedColors = LocalOrderakExtendedColors.current
                val color = when {
                    limit == null || ratio < 0.70f -> MaterialTheme.colorScheme.primary
                    ratio < 0.90f -> extendedColors.warning
                    else -> MaterialTheme.colorScheme.error
                }
                Column(verticalArrangement = Arrangement.spacedBy(4.dp)) {
                    Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween) {
                        Text(stringResource(label), style = MaterialTheme.typography.labelLarge)
                        Text(
                            if (limit == null) stringResource(R.string.usage_value_unlimited, used)
                            else stringResource(R.string.usage_value, used, limit),
                            style = MaterialTheme.typography.labelLarge,
                        )
                    }
                    if (limit != null) {
                        LinearProgressIndicator(
                            progress = { ratio },
                            modifier = Modifier.fillMaxWidth(),
                            color = color,
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