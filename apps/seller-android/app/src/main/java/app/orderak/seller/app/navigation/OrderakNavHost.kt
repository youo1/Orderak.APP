package app.orderak.seller.app.navigation

import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.padding
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.Button
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import androidx.compose.ui.res.stringResource
import androidx.hilt.navigation.compose.hiltViewModel
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.navigation.NavHostController
import androidx.navigation.compose.currentBackStackEntryAsState
import androidx.navigation.compose.NavHost
import androidx.navigation.compose.composable
import androidx.navigation.compose.rememberNavController
import app.orderak.seller.feature.auth.AuthScreen
import app.orderak.seller.feature.customers.CustomerDetailsScreen
import app.orderak.seller.feature.main.MainScreen
import app.orderak.seller.feature.orders.NewOrderScreen
import app.orderak.seller.feature.orders.OrderDetailsScreen
import app.orderak.seller.feature.products.ProductEditScreen
import app.orderak.seller.feature.settings.SettingsScreen
import app.orderak.seller.feature.settings.StoreInfoScreen
import app.orderak.seller.feature.settings.CategoriesScreen
import app.orderak.seller.feature.settings.SellerProfileScreen
import app.orderak.seller.feature.shopsetup.ShopSetupScreen
import app.orderak.seller.feature.splash.SplashViewModel
import app.orderak.seller.feature.splash.EntryDecision
import app.orderak.seller.feature.splash.EntryUiState
import app.orderak.seller.feature.splash.SessionRoutingViewModel
import app.orderak.seller.R
import app.orderak.seller.feature.operations.AiAssistantScreen
import app.orderak.seller.feature.operations.AnnouncementsScreen
import app.orderak.seller.feature.operations.CatalogLanguagesScreen
import app.orderak.seller.feature.operations.DeletionStatusScreen
import app.orderak.seller.feature.operations.DevicesScreen
import app.orderak.seller.feature.operations.RestrictedAccountScreen
import app.orderak.seller.feature.operations.SubscriptionScreen
import app.orderak.seller.feature.operations.SupportScreen
import app.orderak.seller.feature.operations.SupportTicketScreen

@Composable
fun OrderakNavHost() {
    val navController = rememberNavController()
    val sessionRoutingViewModel: SessionRoutingViewModel = hiltViewModel()
    val sessionSignal by sessionRoutingViewModel.signal.collectAsStateWithLifecycle()
    val currentBackStackEntry by navController.currentBackStackEntryAsState()

    LaunchedEffect(sessionSignal?.id, currentBackStackEntry?.destination) {
        sessionSignal?.let { signal ->
            val destination = currentBackStackEntry?.destination
            val authenticationOrOnboarding = isAuthenticationOrOnboardingRoute(destination?.route)
            if (authenticationOrOnboarding) {
                // Credential errors from an older background seller request do
                // not apply to the phone currently being verified.
                sessionRoutingViewModel.acknowledge(signal.id)
            } else {
                navController.navigateAsRoot(SplashRoute)
            }
        }
    }

    NavHost(navController = navController, startDestination = SplashRoute) {

        composable<SplashRoute> {
            val vm: SplashViewModel = hiltViewModel()
            val state by vm.uiState.collectAsStateWithLifecycle()
            val decision = (state as? EntryUiState.Resolved)?.decision
            LaunchedEffect(decision) {
                val route: Any? = when (decision) {
                    EntryDecision.Auth -> AuthRoute
                    is EntryDecision.ShopSetup -> ShopSetupRoute
                    is EntryDecision.Main -> MainRoute
                    is EntryDecision.Restricted -> RestrictedAccountRoute
                    is EntryDecision.Error, null -> null
                }
                route?.let(navController::navigateAsRoot)
            }
            androidx.compose.material3.Surface(
                modifier = Modifier.fillMaxSize(),
                color = androidx.compose.material3.MaterialTheme.colorScheme.background
            ) {
                if (decision is EntryDecision.Error) {
                    Column(
                        modifier = Modifier.fillMaxSize().padding(24.dp),
                        horizontalAlignment = Alignment.CenterHorizontally,
                        verticalArrangement = androidx.compose.foundation.layout.Arrangement.Center,
                    ) {
                        Text(stringResource(R.string.operations_error))
                        Button(onClick = vm::retry, modifier = Modifier.padding(top = 16.dp)) {
                            Text(stringResource(R.string.common_retry))
                        }
                    }
                } else {
                    Box(Modifier.fillMaxSize(), contentAlignment = Alignment.Center) { CircularProgressIndicator() }
                }
            }
        }

        composable<AuthRoute> {
            AuthScreen(
                // Phone completion has already persisted the onboarding token
                // and pre-registration state. Enter setup directly so a stale
                // splash snapshot cannot bounce a new seller back to Welcome.
                onNewSeller = { navController.navigateAsRoot(ShopSetupRoute) },
                onExistingSeller = { navController.navigateAsRoot(SplashRoute) }
            )
        }

        composable<ShopSetupRoute> {
            ShopSetupScreen(
                onDone = { navController.navigateAsRoot(SplashRoute) },
                onExit = { navController.navigateAsRoot(AuthRoute) },
                onReauthenticate = { navController.navigateAsRoot(AuthRoute) },
            )
        }

        composable<MainRoute> {
            MainScreen(
                onNewOrder = { navController.navigate(NewOrderRoute) },
                onOpenOrder = { id: Long -> navController.navigate(OrderDetailsRoute(id)) },
                onAddProduct = { navController.navigate(ProductEditRoute()) },
                onEditProduct = { id: Long -> navController.navigate(ProductEditRoute(id)) },
                onOpenCustomer = { phone: String -> navController.navigate(CustomerRoute(phone)) },
                onOpenSettings = { navController.navigate(SettingsRoute) },
                onOpenAnnouncements = { navController.navigate(AnnouncementsRoute) },
            )
        }

        composable<ProductEditRoute> { ProductEditScreen(onBack = { navController.popBackStack() }) }

        composable<NewOrderRoute> {
            NewOrderScreen(
                onBack = { navController.popBackStack() },
                onCreated = { id ->
                    navController.navigate(OrderDetailsRoute(id)) { popUpTo(NewOrderRoute) { inclusive = true } }
                }
            )
        }

        composable<OrderDetailsRoute> { OrderDetailsScreen(onBack = { navController.popBackStack() }) }

        composable<CustomerRoute> {
            CustomerDetailsScreen(
                onBack = { navController.popBackStack() },
                onOpenOrder = { id: Long -> navController.navigate(OrderDetailsRoute(id)) }
            )
        }

        composable<SettingsRoute> {
            SettingsScreen(
                onBack = { navController.popBackStack() },
                onLogout = { navController.navigateAsRoot(SplashRoute) },
                onOpenStoreInfo = { navController.navigate(StoreInfoRoute) },
                onOpenCategories = { navController.navigate(CategoriesRoute) },
                onOpenSupport = { navController.navigate(SupportRoute) },
                onOpenAnnouncements = { navController.navigate(AnnouncementsRoute) },
                onOpenCatalogLanguages = { navController.navigate(CatalogLanguagesRoute) },
                onOpenDevices = { navController.navigate(DevicesRoute) },
                onOpenDeletionStatus = { navController.navigate(DeletionStatusRoute) },
                onOpenSubscription = { navController.navigate(SubscriptionRoute) },
                onOpenAiAssistant = { navController.navigate(AiAssistantRoute) },
                onOpenSellerProfile = { navController.navigate(SellerProfileRoute) },
            )
        }

        composable<StoreInfoRoute> { StoreInfoScreen(onBack = { navController.popBackStack() }) }

        composable<CategoriesRoute> { CategoriesScreen(onBack = { navController.popBackStack() }) }

        composable<SellerProfileRoute> {
            SellerProfileScreen(
                onBack = { navController.popBackStack() },
                onReauthenticate = { navController.navigateAsRoot(AuthRoute) },
            )
        }

        composable<SupportRoute> { SupportScreen(onBack = { navController.popBackStack() }, onTicket = { navController.navigate(SupportTicketRoute(it)) }) }
        composable<SupportTicketRoute> { SupportTicketScreen(onBack = { navController.popBackStack() }) }
        composable<AnnouncementsRoute> { AnnouncementsScreen(onBack = { navController.popBackStack() }) }
        composable<CatalogLanguagesRoute> { CatalogLanguagesScreen(onBack = { navController.popBackStack() }) }
        composable<DevicesRoute> {
            DevicesScreen(
                onBack = { navController.popBackStack() },
                onReauthenticate = { navController.navigateAsRoot(AuthRoute) },
            )
        }
        composable<DeletionStatusRoute> { DeletionStatusScreen(onBack = { navController.popBackStack() }) }
        composable<SubscriptionRoute> { SubscriptionScreen(onBack = { navController.popBackStack() }) }
        composable<AiAssistantRoute> { AiAssistantScreen(onBack = { navController.popBackStack() }) }
        composable<RestrictedAccountRoute> {
            RestrictedAccountScreen(
                onCheckAgain = { navController.navigateAsRoot(SplashRoute) },
                onLogout = { navController.navigateAsRoot(SplashRoute) },
            )
        }
    }
}

internal fun isAuthenticationOrOnboardingRoute(route: String?): Boolean {
    val routeName = route?.substringBefore('?') ?: return false
    return routeName == AuthRoute::class.qualifiedName ||
        routeName == ShopSetupRoute::class.qualifiedName
}

private fun NavHostController.navigateAsRoot(route: Any) {
    navigate(route) {
        popUpTo(0) { inclusive = true } // ✅ Safely clears the entire backstack
        launchSingleTop = true
    }
}
