package app.orderak.seller.feature.products

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import app.orderak.seller.data.billing.EntitlementManager
import app.orderak.seller.data.db.ProductEntity
import app.orderak.seller.data.catalog.CatalogRepository
import app.orderak.seller.data.remote.PendingBulkDeletion
import app.orderak.seller.data.remote.StoreIdentityResolver
import app.orderak.seller.data.remote.SyncRepository
import app.orderak.seller.data.session.SessionStore
import dagger.hilt.android.lifecycle.HiltViewModel
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.flow.SharingStarted
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.combine
import kotlinx.coroutines.flow.stateIn
import kotlinx.coroutines.launch
import javax.inject.Inject

@HiltViewModel
class ProductsViewModel @Inject constructor(
    repo: CatalogRepository,
    private val sessionStore: SessionStore,
    private val entitlementManager: EntitlementManager,
    private val storeIdentityResolver: StoreIdentityResolver,
    private val syncRepository: SyncRepository,
) : ViewModel() {

    /**
     * A deletion the server is holding until the seller confirms it.
     *
     * Surfaced here because this is the screen the deletion was made on. The
     * sync cannot answer the question itself — a client that set
     * `confirm_deletion` on its own authority would defeat a guard whose entire
     * purpose is to distinguish a seller clearing their shelves from a device
     * that has lost its database.
     *
     * Until it is answered the push is refused on every sync, so the products
     * the seller deleted stay live on their public storefront. That was the
     * previous behaviour with no way out of it at all.
     */
    val pendingBulkDeletion: StateFlow<PendingBulkDeletion?> =
        syncRepository.pendingBulkDeletion
            .stateIn(viewModelScope, SharingStarted.WhileSubscribed(5_000), null)

    fun confirmBulkDeletion() {
        viewModelScope.launch { runCatching { syncRepository.confirmBulkDeletion() } }
    }

    fun cancelBulkDeletion() = syncRepository.cancelBulkDeletion()
    val products: StateFlow<List<ProductEntity>> =
        repo.products.stateIn(viewModelScope, SharingStarted.WhileSubscribed(5_000), emptyList())

    val quota: StateFlow<ProductQuotaUiState> = combine(products, entitlementManager.config) { products, _ ->
        val limit = entitlementManager.getProductLimit()
        ProductQuotaUiState(
            used = products.size,
            limit = limit.takeUnless { it == Int.MAX_VALUE },
            canAdd = products.size < limit,
            upgradePlanKey = entitlementManager.nextUpgradePlanKey(),
        )
    }.stateIn(viewModelScope, SharingStarted.WhileSubscribed(5_000), ProductQuotaUiState())
    val shopName: StateFlow<String?> =
        sessionStore.shopName.stateIn(viewModelScope, SharingStarted.WhileSubscribed(5_000), null)
    val storeUrl: StateFlow<String?> =
        sessionStore.storeUrl.stateIn(viewModelScope, SharingStarted.WhileSubscribed(5_000), null)
    val slug: StateFlow<String?> =
        sessionStore.slug.stateIn(viewModelScope, SharingStarted.WhileSubscribed(5_000), null)
    // The public identifier used for the shared link (centralized in SessionStore).
    val catalogId: StateFlow<String?> =
        sessionStore.storeIdentifier.stateIn(viewModelScope, SharingStarted.WhileSubscribed(5_000), null)

    /** Suspend on purpose — see MainViewModel.resolveCatalogId (leak fix). */
    suspend fun resolveCatalogId(): String? = try {
        storeIdentityResolver.ensure()
    } catch (e: CancellationException) {
        throw e
    } catch (e: Exception) {
        null
    }
}

data class ProductQuotaUiState(
    val used: Int = 0,
    val limit: Int? = 20,
    val canAdd: Boolean = true,
    val upgradePlanKey: String? = "paid1",
)

