package app.orderak.seller.feature.main

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import app.orderak.seller.data.db.ProductEntity
import app.orderak.seller.data.remote.BackendApi
import app.orderak.seller.data.remote.StoreIdentityResolver
import app.orderak.seller.data.catalog.CatalogRepository
import app.orderak.seller.data.orders.OrderRepository
import app.orderak.seller.data.session.SessionStore
import app.orderak.seller.data.billing.EntitlementRepository
import app.orderak.seller.data.billing.EntitlementRefreshResult
import dagger.hilt.android.lifecycle.HiltViewModel
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.MutableSharedFlow
import kotlinx.coroutines.flow.SharedFlow
import kotlinx.coroutines.flow.SharingStarted
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.flow.map
import kotlinx.coroutines.flow.stateIn
import kotlinx.coroutines.launch
import java.util.Calendar
import javax.inject.Inject

@HiltViewModel
class MainViewModel @Inject constructor(
    private val sessionStore: SessionStore,
    private val backendApi: BackendApi,
    private val storeIdentityResolver: StoreIdentityResolver,
    private val catalogRepo: CatalogRepository,
    private val entitlementRepository: EntitlementRepository,
    orderRepo: OrderRepository
) : ViewModel() {

    /**
     * Whether the store has any products (drives the dashboard empty/share
     * state). A COUNT(*) flow instead of collecting the whole product list via
     * a second ViewModel — avoids a standing full-list Room subscription and
     * the recomposition churn it caused on every catalog change.
     */
    val hasProducts: StateFlow<Boolean> =
        catalogRepo.productCount.map { it > 0 }
            .stateIn(viewModelScope, SharingStarted.WhileSubscribed(5_000), false)

    /** Full product list, read once at share time (only when there's no catalog link). */
    suspend fun productsForShare(): List<ProductEntity> = catalogRepo.productsOnce()

    private fun startOfToday(): Long = Calendar.getInstance().apply {
        set(Calendar.HOUR_OF_DAY, 0); set(Calendar.MINUTE, 0)
        set(Calendar.SECOND, 0); set(Calendar.MILLISECOND, 0)
    }.timeInMillis

    val shopName: StateFlow<String?> =
        sessionStore.shopName.stateIn(viewModelScope, SharingStarted.WhileSubscribed(5_000), null)
    val sellerPhone: StateFlow<String?> =
        sessionStore.phone.stateIn(viewModelScope, SharingStarted.WhileSubscribed(5_000), null)
    val storeUrl: StateFlow<String?> =
        sessionStore.storeUrl.stateIn(viewModelScope, SharingStarted.WhileSubscribed(5_000), null)
    val slug: StateFlow<String?> =
        sessionStore.slug.stateIn(viewModelScope, SharingStarted.WhileSubscribed(5_000), null)
    // The catalog link id (centralized in SessionStore: public_identifier ?: slug).
    val catalogId: StateFlow<String?> =
        sessionStore.storeIdentifier.stateIn(viewModelScope, SharingStarted.WhileSubscribed(5_000), null)
    val syncStatus: StateFlow<String?> =
        sessionStore.syncStatus.stateIn(viewModelScope, SharingStarted.WhileSubscribed(5_000), null)

    /**
     * Suspend (not callback) on purpose: callers launch this from their own
     * UI scope (rememberCoroutineScope), so the work is cancelled when the
     * composable leaves composition and no Activity-capturing lambda is ever
     * retained by viewModelScope (leak fix from review).
     */
    suspend fun resolveCatalogId(): String? = try {
        storeIdentityResolver.ensure()
    } catch (e: CancellationException) {
        throw e
    } catch (e: Exception) {
        null
    }


    val todayCount: StateFlow<Int> =
        orderRepo.countToday(startOfToday()).stateIn(viewModelScope, SharingStarted.WhileSubscribed(5_000), 0)
    val unpaidCount: StateFlow<Int> =
        orderRepo.countUnpaid().stateIn(viewModelScope, SharingStarted.WhileSubscribed(5_000), 0)
    val toShipCount: StateFlow<Int> =
        orderRepo.countToShip().stateIn(viewModelScope, SharingStarted.WhileSubscribed(5_000), 0)

    val entitlementState = entitlementRepository.state
    private val _planRefreshEvents = MutableSharedFlow<EntitlementRefreshResult>(extraBufferCapacity = 1)
    val planRefreshEvents: SharedFlow<EntitlementRefreshResult> = _planRefreshEvents

    fun refreshPlanSettings() {
        viewModelScope.launch {
            _planRefreshEvents.emit(entitlementRepository.refresh(force = true))
        }
    }

    private val _aiTestState = MutableStateFlow(AiTestState())
    val aiTestState: StateFlow<AiTestState> = _aiTestState.asStateFlow()

    fun testAiChat(message: String) {
        val trimmedMessage = message.trim()
        if (trimmedMessage.isEmpty() || _aiTestState.value.loading) return

        _aiTestState.value = AiTestState(loading = true)

        viewModelScope.launch {
            val phone = sessionStore.phone.first()
            if (phone.isNullOrBlank()) {
                _aiTestState.value = AiTestState(error = "auth")
                return@launch
            }
            val secret = sessionStore.getOrCreateSecret()
            val response = backendApi.chat(phone, secret, trimmedMessage)
            _aiTestState.value = if (response.error != null) {
                AiTestState(error = response.error)
            } else {
                AiTestState(reply = response.reply.orEmpty())
            }
        }
    }
}

data class AiTestState(
    val loading: Boolean = false,
    val reply: String? = null,
    val error: String? = null,
)
