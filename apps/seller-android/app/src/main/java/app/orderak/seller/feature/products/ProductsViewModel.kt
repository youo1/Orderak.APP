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

    /**
     * The catalogue, or null while it is still being read.
     *
     * Seeded `emptyList()` before, which is the same defect the اليوم counters
     * had: "not read yet" and "you have none" became one value, so a seller with
     * forty products met the empty state on every cold start until Room emitted.
     * On this screen that is worse than a flicker, because the empty state is
     * the one that tells them to add their first product.
     */
    val products: StateFlow<List<ProductEntity>?> =
        repo.products.stateIn(viewModelScope, SharingStarted.WhileSubscribed(5_000), null)

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
        // Usage is unknown until the catalogue is read. Reporting 0 used would
        // tell a seller at their limit that they have room, and the meter is
        // what the add button and the paywall both key off.
        val used = products?.size ?: 0
        ProductQuotaUiState(
            used = used,
            limit = limit.takeUnless { it == Int.MAX_VALUE },
            canAdd = products != null && used < limit,
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

