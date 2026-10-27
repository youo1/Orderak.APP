package app.orderak.seller.feature.main

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Close
import androidx.compose.material.icons.outlined.Add
import androidx.compose.material3.Button
import androidx.compose.material3.Card
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Scaffold
import androidx.compose.material3.SnackbarHost
import androidx.compose.material3.SnackbarHostState
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
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
import androidx.activity.compose.BackHandler
import androidx.hilt.navigation.compose.hiltViewModel
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.navigation.NavGraph.Companion.findStartDestination
import androidx.navigation.NavHostController
import androidx.navigation.compose.NavHost
import androidx.navigation.compose.composable
import androidx.navigation.compose.currentBackStackEntryAsState
import androidx.navigation.compose.rememberNavController
import app.orderak.seller.R
import app.orderak.seller.app.navigation.SellerSurface
import app.orderak.seller.core.ui.theme.LocalOrderakSpacing
import app.orderak.seller.domain.OrderStatus
import app.orderak.seller.feature.orders.OrdersFilter
import app.orderak.seller.feature.today.TodayCounter
import app.orderak.seller.feature.today.TodayScreen
import app.orderak.seller.feature.today.TodayUiState
import app.orderak.seller.core.money.Money
import app.orderak.seller.core.ui.Banner
import app.orderak.seller.core.ui.BottomNav
import app.orderak.seller.core.ui.Fab
import app.orderak.seller.core.ui.NavItem
import app.orderak.seller.core.ui.TopBar
import app.orderak.seller.core.ui.BannerState
import app.orderak.seller.core.ui.PlanUsageRowItem
import app.orderak.seller.core.ui.planUsageRows
import app.orderak.seller.feature.settings.SettingsScreen
import app.orderak.seller.core.ads.LocalAdManager
import app.orderak.seller.feature.customers.CustomersScreen
import app.orderak.seller.feature.orders.OrdersScreen
import app.orderak.seller.feature.products.ProductsScreen
import app.orderak.seller.data.refresh.RefreshScheduler
import app.orderak.seller.data.remote.BackendConfig
import app.orderak.seller.data.remote.AppVersionPolicy
import app.orderak.seller.data.billing.EntitlementFreshness
import app.orderak.seller.data.billing.EntitlementRefreshResult
import app.orderak.seller.data.billing.EntitlementSyncState
import app.orderak.seller.core.share.shareStoreLink
import app.orderak.seller.feature.products.shareCatalogText
import app.orderak.seller.feature.operations.OperationsViewModel
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import androidx.compose.material3.pulltorefresh.PullToRefreshBox

/**
 * Main graph shell: S4 dashboard + S5 orders + S8 products + S11 customers.
 *
 * The five surfaces are destinations of their own inside the shell rather than a
 * `when` over an enum. The enum version lost every surface's `rememberSaveable`
 * state on each tab switch — the product search query, the customer query, the
 * list scroll position and any open dialog — because a composable that leaves the
 * composition has nowhere to keep it. A `NavHost` keeps a `SaveableStateHolder`
 * per destination, and the navigation below saves the state of the surface it
 * leaves, so returning to a tab returns to what the seller had on it.
 *
 * The surface is still saved by name: a navigation route IS a string, so the
 * reason the old state used `SellerSurface.Today.name` rather than an ordinal
 * survives the change.
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
    /**
     * A plan limit refused something, named by its entitlement key.
     *
     * Routes to the paywall, which is the one place that states the limit, the
     * usage and what the next plan gives for that same key together. Each screen
     * used to answer this itself and they did not agree.
     */
    onLimitReached: (String) -> Unit = {},
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
    val hasProducts by viewModel.hasProducts.collectAsStateWithLifecycle()
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
    val unpaidOrders by viewModel.unpaidCount.collectAsStateWithLifecycle()
    // The dot on حسابي says something there has not been read: an announcement.
    // A list that has not loaded is not "no unread", so it draws no dot.
    val operations: OperationsViewModel = hiltViewModel()
    val announcements by operations.announcements.collectAsStateWithLifecycle()
    LaunchedEffect(Unit) { operations.loadAnnouncements() }
    val hasUnreadAnnouncements = announcements?.any { !it.is_read } == true
    val uriHandler = LocalUriHandler.current
    val warning = versionMode == VersionUiMode.WARNING || versionMode == VersionUiMode.STALE_WARNING
    val versionWarningText = if (warning) {
        localizedVersionMessage(versionPolicy, blocking = false)
            ?: stringResource(if (versionMode == VersionUiMode.STALE_WARNING) R.string.app_version_stale_warning else R.string.app_version_warning)
    } else {
        null
    }

    if (versionMode in setOf(VersionUiMode.FORCE_UPDATE, VersionUiMode.BLOCKED, VersionUiMode.MAINTENANCE)) {
        VersionBlockingScreen(versionMode, versionPolicy ?: AppVersionPolicy(), viewModel::refreshPlanSettings)
        return
    }

    val surfaceNav = rememberNavController()
    val surfaceEntry by surfaceNav.currentBackStackEntryAsState()
    val surface = surfaceFor(surfaceEntry?.destination?.route)

    // Not saveable on purpose: a filter is a request made by one tap, and
    // restoring it after process death would filter a list the seller never asked
    // to filter.
    var requestedOrdersFilter by remember { mutableStateOf<OrdersFilter?>(null) }

    // System back inside the shell means "go home", not "leave the app".
    //
    // It used to mean leave: a surface is not a pushed destination, so the back
    // stack was one entry deep and the button that every Android seller presses
    // to go up closed the app from any surface but اليوم. On اليوم there is
    // nothing above it, so back still leaves — which is what the platform's own
    // convention asks for.
    BackHandler(enabled = shellOwnsBack(surface)) {
        surfaceNav.navigateToSurface(SellerSurface.Default)
    }

    val appContext = LocalContext.current.applicationContext
    LaunchedEffect(Unit) {
        RefreshScheduler.ensurePeriodic(appContext)
        RefreshScheduler.refreshNow(appContext)
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

    MainShellContent(
        shopName = shopName,
        surface = surface,
        onSurface = surfaceNav::navigateToSurface,
        onNewOrder = onNewOrder,
        // A count not read yet draws no badge: it is not a claim of zero.
        unpaidOrders = unpaidOrders ?: 0,
        hasUnreadAnnouncements = hasUnreadAnnouncements,
        canCreateOrder = hasProducts != false,
        versionWarning = versionWarningText,
        onUpdateVersion = versionPolicy?.store_url?.takeIf { it.isNotBlank() }?.let { url ->
            { runCatching { uriHandler.openUri(url) } }
        },
        snackbarHostState = snackbarHostState,
    ) {
        NavHost(navController = surfaceNav, startDestination = SellerSurface.Default.name) {
            composable(SellerSurface.Today.name) {
                DashboardTab(
                    viewModel = viewModel,
                    sellerPhone = sellerPhone,
                    storeUrl = storeUrl,
                    entitlementState = entitlementState,
                    syncStatus = syncStatus,
                    unreadAnnouncements = announcements?.count { !it.is_read } ?: 0,
                    onOpenOrder = onOpenOrder,
                    onAddProduct = onAddProduct,
                    onOpenSubscription = onOpenSubscription,
                    onRetrySync = { RefreshScheduler.refreshNow(appContext) },
                    onRefresh = { RefreshScheduler.refreshNow(appContext); viewModel.refreshPlanSettings() },
                    // Each counter carries the question it counts, so the list it
                    // opens is the list it is a count of. All three used to send
                    // the seller to the same unfiltered page.
                    onOpenCounter = { counter ->
                        requestedOrdersFilter = when (counter) {
                            TodayCounter.New -> OrdersFilter.Status(OrderStatus.NEW)
                            TodayCounter.Today -> OrdersFilter.Today
                            TodayCounter.Unpaid -> OrdersFilter.Unpaid
                            TodayCounter.ToShip -> OrdersFilter.ToShip
                        }
                        surfaceNav.navigateToSurface(SellerSurface.Orders)
                    },
                    onOpenAnnouncements = onOpenAnnouncements,
                )
            }

            composable(SellerSurface.Orders.name) {
                OrdersScreen(
                    onOpen = onOpenOrder,
                    onNew = onNewOrder,
                    // Consumed once on arrival, then cleared: re-entering the
                    // surface from the nav bar must not silently re-apply a
                    // filter the seller cleared.
                    initialFilter = requestedOrdersFilter,
                    onInitialFilterApplied = { requestedOrdersFilter = null },
                )
            }

            composable(SellerSurface.Store.name) {
                ProductsScreen(
                    onAdd = onAddProduct,
                    onEdit = onEditProduct,
                    onLimitReached = onLimitReached,
                    sellerPhone = sellerPhone,
                    onOpenStoreInfo = onOpenStoreInfo,
                    onOpenCategories = onOpenCategories,
                    onOpenLanguages = onOpenCatalogLanguages,
                )
            }

            composable(SellerSurface.Customers.name) {
                CustomersScreen(onOpen = onOpenCustomer)
            }

            // Hosted, not reimplemented: this is the same screen the old
            // settings route showed, now reached only as a surface.
            composable(SellerSurface.Account.name) {
                SettingsScreen(
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
                    unreadAnnouncements = announcements?.count { !it.is_read } ?: 0,
                )
            }
        }
    }
}

/**
 * The surface a route names, or اليوم for a route that names none.
 *
 * The fallback is not defensive padding: `currentBackStackEntryAsState()` is null
 * for the first frame of the inner `NavHost`, and the bar has to draw something
 * selected on that frame. Today is what the graph starts on, so the bar's first
 * frame agrees with the graph's own answer instead of showing nothing selected.
 */
private fun surfaceFor(route: String?): SellerSurface =
    SellerSurface.entries.firstOrNull { it.name == route } ?: SellerSurface.Default

/** Exposed for `MainShellNavigationTest`; the shell itself calls [surfaceFor]. */
internal fun sellerSurfaceForRoute(route: String?): SellerSurface = surfaceFor(route)

/**
 * Whether the shell, rather than the system, owns the back gesture.
 *
 * On any surface but the start one, back means "go home". On اليوم there is
 * nothing above it, so back leaves the app — the platform's own convention.
 * Extracted from the `BackHandler` so the rule is asserted rather than read.
 */
internal fun shellOwnsBack(surface: SellerSurface): Boolean = surface != SellerSurface.Default

/**
 * Move between surfaces the way a bottom bar is supposed to.
 *
 * `popUpTo(start) { saveState = true }` sends the surface being left to the
 * `SaveableStateHolder` with its state and its view model intact, and
 * `restoreState = true` hands them back on return. Without the pair, a tab switch
 * discards what the seller had typed and where the seller had scrolled.
 */
private fun NavHostController.navigateToSurface(target: SellerSurface) {
    navigate(target.name) {
        popUpTo(graph.findStartDestination().id) { saveState = true }
        launchSingleTop = true
        restoreState = true
    }
}

/** The surfaces that draw their own large title, so the shell does not draw its bar over it. */
private val SURFACES_WITH_OWN_BAR = setOf(SellerSurface.Today, SellerSurface.Orders, SellerSurface.Store, SellerSurface.Customers, SellerSurface.Account)

/**
 * The five-surface shell: what stays on screen whichever surface is showing.
 *
 * A top bar carrying the shop name, the version warning when governance asks for
 * one, a FAB that belongs to اليوم alone, and the bottom bar. The surface itself
 * is a slot, so this composable is the whole of what the `main-shell` contract
 * means by content, and the only part of MainScreen that does not need a Hilt
 * graph to draw.
 *
 * The bottom bar carries the unpaid count on الطلبات and a dot on حسابي when an
 * announcement is unread. The version warning is a banner above every surface
 * and cannot be dismissed: it stays until the seller updates.
 */
@Composable
fun MainShellContent(
    shopName: String?,
    surface: SellerSurface,
    onSurface: (SellerSurface) -> Unit,
    onNewOrder: () -> Unit,
    unpaidOrders: Int = 0,
    hasUnreadAnnouncements: Boolean = false,
    versionWarning: String? = null,
    onUpdateVersion: (() -> Unit)? = null,
    /** An order needs a product, so with none the FAB is not offered. */
    canCreateOrder: Boolean = true,
    snackbarHostState: SnackbarHostState = remember { SnackbarHostState() },
    content: @Composable () -> Unit,
) {
    val spacing = LocalOrderakSpacing.current
    Scaffold(
        snackbarHost = { SnackbarHost(snackbarHostState) },
        topBar = {
            // اليوم draws its own large title and its bell; the other surfaces keep the
            // shop's name here until each brings its own bar (R5 to R8). The app name
            // until the shop's own arrives: not a blank bar, and not a guess.
            if (surface !in SURFACES_WITH_OWN_BAR) {
                TopBar(title = shopName ?: stringResource(R.string.app_name))
            }
        },
        floatingActionButton = {
            // اليوم only: on every other surface the primary action is that
            // surface's own, and two would compete.
            if (surface == SellerSurface.Today && canCreateOrder) {
                Fab(
                    label = stringResource(R.string.order_new_title),
                    icon = Icons.Outlined.Add,
                    onClick = onNewOrder,
                )
            }
        },
        bottomBar = {
            BottomNav(
                items = SellerSurface.entries.map { item ->
                    NavItem(
                        label = stringResource(item.labelRes),
                        icon = item.icon,
                        selectedIcon = item.selectedIcon,
                        badge = if (item == SellerSurface.Orders) unpaidOrders else 0,
                        dot = item == SellerSurface.Account && hasUnreadAnnouncements,
                    )
                },
                selectedIndex = SellerSurface.entries.indexOf(surface),
                onSelect = { onSurface(SellerSurface.entries[it]) },
            )
        },
    ) { padding ->
        Column(Modifier.fillMaxSize().padding(padding)) {
            if (versionWarning != null) {
                Banner(
                    state = BannerState.Warning,
                    title = versionWarning,
                    modifier = Modifier.padding(horizontal = spacing.space4, vertical = spacing.space2),
                    actionLabel = onUpdateVersion?.let { stringResource(R.string.app_version_banner_action) },
                    onAction = onUpdateVersion,
                )
            }
            Box(Modifier.weight(1f).fillMaxWidth()) { content() }
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
    unreadAnnouncements: Int,
    onOpenOrder: (Long) -> Unit,
    onAddProduct: () -> Unit,
    onOpenSubscription: () -> Unit,
    onRetrySync: () -> Unit,
    onRefresh: () -> Unit,
    onOpenCounter: (TodayCounter) -> Unit,
    onOpenAnnouncements: () -> Unit,
) {
    val adManager = LocalAdManager.current
    val shopName by viewModel.shopName.collectAsStateWithLifecycle()
    val today by viewModel.todayCount.collectAsStateWithLifecycle()
    val newOrders by viewModel.newCount.collectAsStateWithLifecycle()
    val unpaid by viewModel.unpaidCount.collectAsStateWithLifecycle()
    val toShip by viewModel.toShipCount.collectAsStateWithLifecycle()
    val latestOrders by viewModel.latestOpenOrders.collectAsStateWithLifecycle()
    val monthSales by viewModel.monthSales.collectAsStateWithLifecycle()
    val summaryFailed by viewModel.summaryFailed.collectAsStateWithLifecycle()

    // Lightweight COUNT(*) instead of collecting the full product list here.
    val hasProducts by viewModel.hasProducts.collectAsStateWithLifecycle()
    val context = LocalContext.current
    // UI-scoped: cancelled when this composable leaves composition, so the
    // share sheet can never fire against a dead screen (leak fix).
    val scope = rememberCoroutineScope()

    PullToRefreshBox(
        // Tracks the whole refresh, not just the plan call. The spinner used to
        // follow `entitlementState.isRefreshing` while the gesture below only
        // refreshed entitlements — so pulling on a screen of order counters
        // refreshed everything except the counters.
        isRefreshing = entitlementState.isRefreshing || syncStatus == "running",
        onRefresh = onRefresh,
        modifier = Modifier.fillMaxSize(),
    ) {
        TodayScreen(
            state = TodayUiState(
                shopName = shopName,
                newCount = newOrders,
                todayCount = today,
                unpaidCount = unpaid,
                toShipCount = toShip,
                hasProducts = hasProducts,
                summaryFailed = summaryFailed,
                unreadAnnouncements = unreadAnnouncements,
                latestOrders = latestOrders,
                monthSales = monthSales?.let { Money(it.totalMinor, it.currency) },
                storeUrl = storeUrl,
                planError = entitlementState.error,
            ),
            onOpenCounter = onOpenCounter,
            onOpenOrder = onOpenOrder,
            onAddProduct = onAddProduct,
            onShareCatalog = {
                scope.launch {
                    val url = storeUrl
                    if (url.isNullOrBlank()) shareCatalogText(context, shopName, sellerPhone, viewModel.productsForShare())
                    else shareStoreLink(context, shopName, url)
                }
            },
            onOpenAnnouncements = onOpenAnnouncements,
            onRetry = {
                // One retry for both things that can be behind: the sync, and a summary
                // the device could not read.
                viewModel.retrySummary()
                onRetrySync()
            },
            modifier = Modifier.fillMaxSize(),
            planNotices = {
                Column(verticalArrangement = Arrangement.spacedBy(LocalOrderakSpacing.current.space2)) {
                    PlanStatusBanners(entitlementState)
                    if (syncStatus == "running" || syncStatus == "pending" || syncStatus == "failed") {
                        val failed = syncStatus == "failed"
                        Banner(
                            state = if (failed) BannerState.SyncFailed else BannerState.SyncInProgress,
                            title = stringResource(if (failed) R.string.sync_failed else R.string.sync_pending),
                            actionLabel = if (failed) stringResource(R.string.common_retry) else null,
                            onAction = if (failed) onRetrySync else null,
                        )
                    }
                }
            },
            planUsage = { entitlementState.config?.let { config -> PlanUsageCard(config, onOpenSubscription) } },
            footer = { adManager.Banner(Modifier.fillMaxWidth()) },
        )
    }
}

@Composable
private fun PlanStatusBanners(state: EntitlementSyncState) {
    val spacing = LocalOrderakSpacing.current
    val config = state.config
    var dismissedPending by rememberSaveable(config?.pending_revision_id) { mutableStateOf(false) }
    Column(verticalArrangement = Arrangement.spacedBy(spacing.space2)) {
        if (state.freshness == EntitlementFreshness.OFFLINE) {
            // Was a hand-rolled surface on secondaryContainer — the orange this
            // system reserves for nothing in particular. The shared banner makes
            // offline read the same here as on every other surface.
            Banner(
                state = BannerState.Information,
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

/**
 * The app held shut by governance.
 *
 * Three modes and one frame: an update the seller must take, a build the server
 * refuses, and a maintenance window. Only FORCE_UPDATE offers a button, and the
 * button is the way out: the other two are waits, and a button that cannot help
 * is worse than none. A wait looks again every [WAIT_RECHECK_MS], so it ends by
 * itself when the server lets the seller back in.
 */
@Composable
internal fun VersionBlockingScreen(mode: VersionUiMode, policy: AppVersionPolicy, onRetry: () -> Unit) {
    val spacing = LocalOrderakSpacing.current
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
    val isWait = mode != VersionUiMode.FORCE_UPDATE
    if (isWait) {
        LaunchedEffect(mode) {
            while (true) {
                delay(WAIT_RECHECK_MS)
                onRetry()
            }
        }
    }
    Surface(Modifier.fillMaxSize(), color = MaterialTheme.colorScheme.background) {
        Column(
            Modifier.fillMaxSize().padding(spacing.space8),
            verticalArrangement = Arrangement.Center,
            horizontalAlignment = Alignment.CenterHorizontally,
        ) {
            Text(title, style = MaterialTheme.typography.headlineMedium, textAlign = TextAlign.Center, modifier = Modifier.semantics { heading() })
            Spacer(Modifier.height(spacing.space3))
            Text(localizedVersionMessage(policy, blocking = true) ?: fallback, textAlign = TextAlign.Center, color = MaterialTheme.colorScheme.onSurfaceVariant)
            if (mode == VersionUiMode.FORCE_UPDATE && !policy.store_url.isNullOrBlank()) {
                Spacer(Modifier.height(spacing.space6))
                Button(
                    onClick = { runCatching { uriHandler.openUri(policy.store_url) } },
                    modifier = Modifier.heightIn(min = spacing.minimumTouchTarget),
                ) { Text(stringResource(R.string.app_version_update_action)) }
            }
        }
    }
}

/** How often a blocked or maintenance screen asks the server whether the seller may come back. */
internal const val WAIT_RECHECK_MS = 60_000L

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
        Banner(
            state = BannerState.Warning,
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

/** From this share of a limit used, the plan is worth the seller's attention on اليوم. */
private const val PLAN_ATTENTION_AT = 0.9f

/**
 * The plan, on اليوم, only when it needs the seller.
 *
 * Where limits are enforced, a buyer's order from the link is refused once the
 * monthly limit is reached, and the seller would not otherwise know. Below 90%
 * the plan is on its own screen, حسابي › الاشتراك, not here.
 */
@Composable
private fun PlanUsageCard(config: BackendConfig, onOpenSubscription: () -> Unit) {
    val spacing = LocalOrderakSpacing.current
    // Rows, order and unlimited handling all come from core/ui/PlanUsage.kt, so
    // this card and the subscription screen cannot drift apart again.
    val rows = planUsageRows(config).filter { it.limit != null && it.limit > 0 && it.used.toFloat() / it.limit >= PLAN_ATTENTION_AT }
    if (rows.isEmpty()) return

    Card(Modifier.fillMaxWidth()) {
        Column(Modifier.fillMaxWidth().padding(spacing.space4), verticalArrangement = Arrangement.spacedBy(spacing.space3)) {
            Text(stringResource(R.string.plan_usage_title), style = MaterialTheme.typography.titleMedium)
            rows.forEach { row -> PlanUsageRowItem(row) }
            TextButton(onClick = onOpenSubscription, modifier = Modifier.heightIn(min = spacing.minimumTouchTarget)) {
                Text(stringResource(R.string.today_plan_details))
            }
        }
    }
}
