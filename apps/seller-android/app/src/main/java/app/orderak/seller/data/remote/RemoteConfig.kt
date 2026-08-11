package app.orderak.seller.data.remote
import app.orderak.seller.data.billing.EntitlementManager
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.flow.SharingStarted
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.map
import kotlinx.coroutines.flow.stateIn
import javax.inject.Inject
import javax.inject.Singleton

/**
 * Handles remote feature flags and configuration.
 * In production, this would wrap Firebase Remote Config.
 * Fix(#4): Use application-scoped coroutine scope with Dispatchers.Main
 * instead of creating a standalone scope that never gets cancelled.
 */
@Singleton
class RemoteConfig @Inject constructor(
    entitlementManager: EntitlementManager
) {
    // Use the main dispatcher + SupervisorJob scoped to the application process.
    // This scope lives as long as the process and does not leak.
    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.Main)

    val adsEnabled: StateFlow<Boolean> = entitlementManager.config
        .map { it?.governance?.features?.get("first_party_ads")?.enabled ?: it?.ads_enabled ?: true }
        .stateIn(scope, SharingStarted.Eagerly, true)

    val adNetwork: StateFlow<String> = entitlementManager.config
        .map { "ADMOB" }
        .stateIn(scope, SharingStarted.Eagerly, "ADMOB")
}

