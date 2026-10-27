package app.orderak.seller.feature.main

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import app.orderak.seller.data.db.MonthSalesRow
import app.orderak.seller.data.db.OrderEntity
import app.orderak.seller.data.db.ProductEntity
import app.orderak.seller.data.remote.StoreIdentityResolver
import app.orderak.seller.data.catalog.CatalogRepository
import app.orderak.seller.data.orders.OrderRepository
import app.orderak.seller.data.session.SessionStore
import app.orderak.seller.data.billing.EntitlementRepository
import app.orderak.seller.data.billing.EntitlementRefreshResult
import dagger.hilt.android.lifecycle.HiltViewModel
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.MutableSharedFlow
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.SharedFlow
import kotlinx.coroutines.flow.SharingStarted
import kotlinx.coroutines.flow.catch
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.map
import kotlinx.coroutines.flow.stateIn
import kotlinx.coroutines.launch
import java.util.Calendar
import javax.inject.Inject

@HiltViewModel
class MainViewModel @Inject constructor(
    private val sessionStore: SessionStore,
    private val storeIdentityResolver: StoreIdentityResolver,
    private val catalogRepo: CatalogRepository,
    private val entitlementRepository: EntitlementRepository,
    orderRepo: OrderRepository,
) : ViewModel() {

    /**
     * Whether the store has any products (drives the dashboard empty/share
     * state). A COUNT(*) flow instead of collecting the whole product list via
     * a second ViewModel — avoids a standing full-list Room subscription and
     * the recomposition churn it caused on every catalog change.
     */
    /**
     * Nullable for the same reason the counters are: `false` seeded before the
     * count was read, so اليوم told a seller with a full catalogue that their
     * store was empty and invited them to add their first product. `null` is
     * "not read yet"; the first Room emission settles it.
     */
    val hasProducts: StateFlow<Boolean?> =
        catalogRepo.productCount.map { it > 0 }
            .stateIn(viewModelScope, SharingStarted.WhileSubscribed(5_000), null)

    /** Full product list, read once at share time (only when there's no catalog link). */
    suspend fun productsForShare(): List<ProductEntity> = catalogRepo.productsOnce()

    private fun startOfMonth(): Long = Calendar.getInstance().apply {
        set(Calendar.DAY_OF_MONTH, 1)
        set(Calendar.HOUR_OF_DAY, 0); set(Calendar.MINUTE, 0)
        set(Calendar.SECOND, 0); set(Calendar.MILLISECOND, 0)
    }.timeInMillis

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


    /**
     * The three اليوم counters, nullable so that "not read yet" is expressible.
     *
     * They seeded at `0` before, which made a shop whose orders had not loaded
     * yet look exactly like a shop with no orders — and `0` is a figure a seller
     * acts on. `null` is the loading state the screen contract has always
     * declared and the surface never had; the first Room emission replaces it,
     * which on a local COUNT(*) is immediate.
     */
    private val _summaryFailed = MutableStateFlow(false)

    /**
     * True when the device could not read the figures above: the local summary
     * failed, which is not the same as there being none. The surface says so and
     * offers a retry instead of drawing a count it does not have.
     */
    val summaryFailed: StateFlow<Boolean> = _summaryFailed

    /** A count that, if the database cannot answer, is unknown and says so once. */
    private fun Flow<Int>.counted(): StateFlow<Int?> =
        map<Int, Int?> { it }
            .catch { _summaryFailed.value = true; emit(null) }
            .stateIn(viewModelScope, SharingStarted.WhileSubscribed(5_000), null)

    val todayCount: StateFlow<Int?> = orderRepo.countToday(startOfToday()).counted()
    val newCount: StateFlow<Int?> = orderRepo.countNew().counted()
    val unpaidCount: StateFlow<Int?> = orderRepo.countUnpaid().counted()
    val toShipCount: StateFlow<Int?> = orderRepo.countToShip().counted()

    /** The two newest orders that are not finished; empty until there are some. */
    val latestOpenOrders: StateFlow<List<OrderEntity>> =
        orderRepo.latestOpen(LATEST_OPEN_ORDERS)
            .catch { _summaryFailed.value = true; emit(emptyList()) }
            .stateIn(viewModelScope, SharingStarted.WhileSubscribed(5_000), emptyList())

    /** This month's sales in one currency, or null when there is no order this month. */
    val monthSales: StateFlow<MonthSalesRow?> =
        orderRepo.salesSince(startOfMonth())
            .catch { _summaryFailed.value = true; emit(null) }
            .stateIn(viewModelScope, SharingStarted.WhileSubscribed(5_000), null)

    /** Read again after a failure. The flows above resubscribe when they are collected anew. */
    fun retrySummary() {
        _summaryFailed.value = false
    }

    val entitlementState = entitlementRepository.state
    private val _planRefreshEvents = MutableSharedFlow<EntitlementRefreshResult>(extraBufferCapacity = 1)
    val planRefreshEvents: SharedFlow<EntitlementRefreshResult> = _planRefreshEvents

    fun refreshPlanSettings() {
        viewModelScope.launch {
            _planRefreshEvents.emit(entitlementRepository.refresh(force = true))
        }
    }

}

/** How many open orders اليوم lists. */
internal const val LATEST_OPEN_ORDERS = 2
