package app.orderak.seller.feature.products

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import app.orderak.seller.data.billing.EntitlementManager
import app.orderak.seller.data.db.ProductEntity
import app.orderak.seller.data.catalog.CatalogRepository
import app.orderak.seller.data.catalog.LegacyCatalogueReconciler
import app.orderak.seller.data.catalog.StuckLegacyProduct
import app.orderak.seller.data.remote.StoreIdentityResolver
import app.orderak.seller.data.session.SessionStore
import dagger.hilt.android.lifecycle.HiltViewModel
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.flow.SharingStarted
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.combine
import kotlinx.coroutines.flow.map
import kotlinx.coroutines.flow.stateIn
import kotlinx.coroutines.launch
import javax.inject.Inject

@HiltViewModel
class ProductsViewModel @Inject constructor(
    repo: CatalogRepository,
    private val sessionStore: SessionStore,
    private val entitlementManager: EntitlementManager,
    private val storeIdentityResolver: StoreIdentityResolver,
    private val legacyCatalogue: LegacyCatalogueReconciler,
) : ViewModel() {

    val products: StateFlow<List<ProductEntity>> =
        repo.products.stateIn(viewModelScope, SharingStarted.WhileSubscribed(5_000), emptyList())

    /**
     * Products that live on this phone and have not reached the server.
     *
     * WHY THIS IS ON SCREEN
     *   The catalogue refresh is gated on this list being empty
     *   (`SellerRefresher`: `if (reconciled) refreshCatalogue(...) else false`),
     *   because adopting the server's catalogue while a local-only product
     *   exists would delete it. That gate is correct, and until now it was
     *   invisible: a product the server refuses for a reason that will never
     *   change — a name it will not accept, say — holds the gate shut for ever,
     *   and the seller sees a catalogue that has quietly stopped updating with
     *   nothing anywhere to say why.
     *
     *   `LegacyCatalogueReconciler.discard` is the documented way out and had no
     *   caller in any screen. This is that caller.
     *
     * WHY IT RECOMPUTES OFF `products`
     *   The stuck set only changes when the catalogue does — a conversion
     *   rewrites the row, a discard removes it from the list. Deriving it here
     *   means the banner clears itself the moment the reconciliation succeeds,
     *   with no refresh of its own to get wrong.
     */
    val stuck: StateFlow<List<StuckLegacyProduct>> = repo.products
        .map { legacyCatalogue.pending() }
        .stateIn(viewModelScope, SharingStarted.WhileSubscribed(5_000), emptyList())

    /**
     * The seller has been shown a stuck product and chosen to let it go.
     *
     * This is a local deletion of something that exists nowhere else, so it is
     * only ever reached from a confirmation. See the reconciler: a device may
     * never make this transition on its own.
     */
    fun discardStuck(localId: Long) {
        viewModelScope.launch { legacyCatalogue.discard(localId) }
    }

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

