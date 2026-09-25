package app.orderak.seller.feature.products

import android.net.Uri
import androidx.lifecycle.SavedStateHandle
import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import androidx.navigation.toRoute
import android.content.Context
import app.orderak.seller.core.images.ImageStore
import app.orderak.seller.data.catalog.ProductCacheWriter
import app.orderak.seller.data.catalog.ProductDraft
import app.orderak.seller.data.catalog.ProductWriteDecision
import app.orderak.seller.data.catalog.ProductWriteRepository
import app.orderak.seller.data.refresh.RefreshScheduler
import dagger.hilt.android.qualifiers.ApplicationContext
import app.orderak.seller.core.money.DEFAULT_CURRENCY
import app.orderak.seller.core.money.Money
import app.orderak.seller.core.money.majorUnitsText
import app.orderak.seller.core.money.parseMoney
import app.orderak.seller.data.billing.EntitlementManager
import app.orderak.seller.data.db.CategoryEntity
import app.orderak.seller.data.db.OrderakDatabase
import app.orderak.seller.data.db.ProductEntity
import app.orderak.seller.data.catalog.CatalogRepository
import app.orderak.seller.data.session.SessionStore
import app.orderak.seller.app.navigation.ProductEditRoute
import dagger.hilt.android.lifecycle.HiltViewModel
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.launch
import javax.inject.Inject

data class ProductEditUiState(
    val id: Long = 0,
    val createdAt: Long = System.currentTimeMillis(),  // Fix(#6): preserved across edits
    val name: String = "",
    val description: String = "",
    val priceText: String = "",
    /** The product's currency. Price display and parsing both read it, so a
     *  three-decimal currency is not silently treated as a two-decimal one. */
    val currency: String = DEFAULT_CURRENCY,
    val stockText: String = "1",
    val discountType: String? = null,
    val discountValueText: String = "",
    val imagePath: String? = null,
    val imageUrl: String? = null, // uploaded R2 URL; kept in step with imagePath
    val available: Boolean = true,
    val categoryCode: String? = null,
    val saving: Boolean = false,
    val loaded: Boolean = false,
    val quotaExceeded: Boolean = false,
    /**
     * The server refused the write, or it never arrived.
     *
     * Present means nothing was saved — not here and not on the server. A Class
     * A write does not queue, so an editor that cleared this and closed would be
     * telling the seller their edit landed when it did not.
     */
    val writeError: ProductWriteError? = null,
    /**
     * A stock edit the shop disagrees with, holding both numbers.
     *
     * The seller resolves it: take the shop's figure, or re-apply their own
     * against the revision the server returned. Nothing is chosen for them and
     * nothing is retried automatically — an automatic re-send would overwrite
     * the decrement a buyer's order had just made.
     */
    val stockConflict: StockConflict? = null,
) {
    val canSave: Boolean
        get() = (name.trim().length >= 2) &&
                (parseMoney(priceText, currency) != null) &&
                ((stockText.toIntOrNull() ?: -1) >= 0) &&
                (discountValueText.isEmpty() || (discountValueText.toLongOrNull() ?: -1L) >= 0)
}

/** Why a product write did not happen, in terms a screen can render. */
enum class ProductWriteError { OFFLINE, PLAN_LIMIT, UNKNOWN_CATEGORY, REFUSED }

/** The seller's stock figure and the shop's, when they disagree. */
data class StockConflict(val yours: Int, val shop: Int, val shopVersion: Long)

@HiltViewModel
class ProductEditViewModel @Inject constructor(
    private val repo: CatalogRepository,
    private val writes: ProductWriteRepository,
    private val cache: ProductCacheWriter,
    private val imageStore: ImageStore,
    private val sessionStore: SessionStore,
    private val entitlementManager: EntitlementManager,
    private val db: OrderakDatabase,
    @param:ApplicationContext private val appContext: Context,
    savedStateHandle: SavedStateHandle
) : ViewModel() {

    private val routeId: Long = savedStateHandle.toRoute<ProductEditRoute>().id
    private val _state = MutableStateFlow(ProductEditUiState())
    val state: StateFlow<ProductEditUiState> = _state.asStateFlow()

    private val _categories = MutableStateFlow<List<CategoryEntity>>(emptyList())
    val categories: StateFlow<List<CategoryEntity>> = _categories.asStateFlow()

    init {
        viewModelScope.launch {
            _categories.value = db.categoryDao().allOnce()
            if (routeId > 0) {
                repo.byId(routeId)?.let { p ->
                    _state.value = ProductEditUiState(
                        id = p.id, createdAt = p.createdAt, name = p.name,
                        description = p.description.orEmpty(),
                        currency = p.currency,
                        priceText = majorUnitsText(Money(p.priceMinor, p.currency)),
                        stockText = p.stock.toString(),
                        discountType = p.discountType,
                        discountValueText = p.discountValue?.toString().orEmpty(),
                        imagePath = p.imagePath, imageUrl = p.imageUrl, available = p.available,
                        categoryCode = p.categoryCode, loaded = true
                    )
                } ?: run { _state.value = _state.value.copy(loaded = true) }
            } else _state.value = _state.value.copy(loaded = true)
        }
    }

    fun onCategory(code: String?) { _state.value = _state.value.copy(categoryCode = code) }

    fun onName(v: String) { _state.value = _state.value.copy(name = v.take(60)) }
    fun onDescription(v: String) { _state.value = _state.value.copy(description = v.take(500)) }
    fun onPrice(v: String) { _state.value = _state.value.copy(priceText = v.take(10)) }
    fun onStock(v: String) { _state.value = _state.value.copy(stockText = v.filter(Char::isDigit).take(5)) }
    fun onDiscountType(v: String?) { _state.value = _state.value.copy(discountType = v) }
    fun onDiscountValue(v: String) { _state.value = _state.value.copy(discountValueText = v.take(10)) }
    fun onAvailable(v: Boolean) { _state.value = _state.value.copy(available = v) }

    fun onImagePicked(uri: Uri?) {
        uri ?: return
        viewModelScope.launch {
            val old = _state.value.imagePath
            imageStore.persist(uri, "product")?.let {
                // New local image → clear the cached remote URL so sync re-uploads it.
                _state.value = _state.value.copy(imagePath = it, imageUrl = null)
                if (old != null && old != it) imageStore.delete(old) // no orphans
            }
        }
    }

    /**
     * Save the product to the server, and only then to this device.
     *
     * CLASS A, AT THE PLACE IT IS VISIBLE
     *   If this does not reach the server it does not happen: no local row, no
     *   queued mutation, and an error on screen. That is worse than the old
     *   behaviour in exactly one way — a seller with no signal cannot add a
     *   product — and better in every way that cost anyone anything. The old path
     *   wrote locally and let a mirror push reconcile later, which is how a
     *   second device's edit could overwrite this one, and how a catalogue got
     *   deleted by a device that had simply forgotten it.
     *
     * WHY METADATA AND STOCK ARE TWO CALLS
     *   Stock is server-owned: it moves through a buyer's order or an explicit
     *   compare-and-set, never through a metadata write that happens to carry a
     *   number. So a new product is created and then stocked, and an edit that
     *   changed the figure adjusts it separately.
     *
     *   That means a partial outcome is possible — the name saved, the stock
     *   refused because an order moved it first. It is reported rather than
     *   hidden: the metadata genuinely is saved, and the conflict goes in front
     *   of the seller with both numbers.
     */
    fun save(onDone: () -> Unit) {
        val s = _state.value
        val price = parseMoney(s.priceText, s.currency)?.amountMinor ?: return
        _state.value = s.copy(saving = true, writeError = null, stockConflict = null, quotaExceeded = false)
        viewModelScope.launch {
            val existing = s.id.takeIf { it > 0 }?.let { repo.byId(it) }

            val draft = ProductDraft(
                name = s.name.trim(),
                description = s.description.trim().ifBlank { null },
                priceMinor = price,
                currency = s.currency,
                available = s.available,
                imageUrl = s.imageUrl ?: existing?.imageUrl,
                categoryCode = s.categoryCode,
                // From the seller's own edit state, not `existing` — no screen
                // currently renders a control bound to onDiscountType()/
                // onDiscountValue(), so this is not observably different
                // today, but reading the stale pre-edit value here was a
                // second bug stacked on top of the missing UI: the day a
                // discount editor is added to this screen, saving would have
                // kept silently discarding it.
                discountType = s.discountType,
                discountValue = s.discountValueText.toLongOrNull(),
            )

            val code = existing?.productCode
            val written = if (code.isNullOrBlank()) writes.create(draft) else writes.update(code, draft)
            val product = (written as? ProductWriteDecision.Store)?.product
            if (product == null) {
                val error = written.toError()
                _state.value = _state.value.copy(
                    saving = false,
                    writeError = error,
                    quotaExceeded = error == ProductWriteError.PLAN_LIMIT,
                )
                return@launch
            }

            val wanted = s.stockText.toIntOrNull() ?: 0
            if (wanted != product.stock) {
                when (val stocked = writes.adjustStock(product.product_code, wanted, product.stock_version)) {
                    is ProductWriteDecision.Store -> Unit
                    is ProductWriteDecision.StaleStock -> {
                        // The metadata did save. Reporting a plain failure here
                        // would be a second wrong answer on top of the conflict.
                        _state.value = _state.value.copy(
                            saving = false,
                            stockConflict = StockConflict(wanted, stocked.serverStock, stocked.serverStockVersion),
                        )
                        return@launch
                    }
                    else -> {
                        _state.value = _state.value.copy(saving = false, writeError = stocked.toError())
                        return@launch
                    }
                }
            }

            RefreshScheduler.refreshNow(appContext)
            onDone()
        }
    }

    /** Take the shop's figure, abandoning the number that lost. */
    fun acceptShopStock() {
        val conflict = _state.value.stockConflict ?: return
        _state.value = _state.value.copy(stockText = conflict.shop.toString(), stockConflict = null)
    }

    /**
     * Send the seller's figure again, against the revision the server reported.
     *
     * Only ever from an explicit tap. Doing this automatically on a 409 is
     * last-write-wins wearing a different name: it would silently overwrite the
     * decrement a buyer's order had just made, which is the one outcome the
     * compare-and-set exists to prevent.
     */
    fun reapplyMyStock(onDone: () -> Unit) {
        val conflict = _state.value.stockConflict ?: return
        val localId = _state.value.id.takeIf { it > 0 } ?: return
        _state.value = _state.value.copy(saving = true, stockConflict = null)
        viewModelScope.launch {
            val code = repo.byId(localId)?.productCode
            if (code.isNullOrBlank()) {
                _state.value = _state.value.copy(saving = false, writeError = ProductWriteError.REFUSED)
                return@launch
            }
            when (val res = writes.adjustStock(code, conflict.yours, conflict.shopVersion)) {
                is ProductWriteDecision.Store -> {
                    RefreshScheduler.refreshNow(appContext)
                    onDone()
                }
                is ProductWriteDecision.StaleStock -> {
                    _state.value = _state.value.copy(
                        saving = false,
                        stockConflict = StockConflict(conflict.yours, res.serverStock, res.serverStockVersion),
                    )
                }
                else -> _state.value = _state.value.copy(saving = false, writeError = res.toError())
            }
        }
    }

    fun dismissWriteError() {
        _state.value = _state.value.copy(writeError = null, quotaExceeded = false)
    }

    fun delete(onDone: () -> Unit) {
        val s = _state.value
        if (s.id <= 0) return
        _state.value = s.copy(saving = true, writeError = null)
        viewModelScope.launch {
            val code = repo.byId(s.id)?.productCode
            if (code.isNullOrBlank()) {
                // Never reached the server, so there is nothing there to delete
                // and the local row is the only copy. Removing it is the seller's
                // instruction and costs nothing that exists anywhere else.
                imageStore.delete(s.imagePath)
                cache.removeNeverSynced(s.id)
                onDone()
                return@launch
            }
            when (val res = writes.delete(code)) {
                is ProductWriteDecision.Deleted -> {
                    imageStore.delete(s.imagePath)
                    RefreshScheduler.refreshNow(appContext)
                    onDone()
                }
                else -> _state.value = _state.value.copy(saving = false, writeError = res.toError())
            }
        }
    }

    private fun ProductWriteDecision.toError(): ProductWriteError = when (this) {
        is ProductWriteDecision.Unreachable -> ProductWriteError.OFFLINE
        is ProductWriteDecision.Refused -> when (code) {
            "plan_limit_reached", "PLAN_LIMIT_REACHED" -> ProductWriteError.PLAN_LIMIT
            "unknown_category_code" -> ProductWriteError.UNKNOWN_CATEGORY
            else -> ProductWriteError.REFUSED
        }
        else -> ProductWriteError.REFUSED
    }
}
