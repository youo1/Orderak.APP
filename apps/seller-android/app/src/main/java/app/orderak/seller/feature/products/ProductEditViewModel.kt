package app.orderak.seller.feature.products

import android.net.Uri
import androidx.lifecycle.SavedStateHandle
import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import androidx.navigation.toRoute
import android.content.Context
import app.orderak.seller.core.images.ImageStore
import app.orderak.seller.data.remote.SyncScheduler
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
) {
    val canSave: Boolean
        get() = (name.trim().length >= 2) &&
                (parseMoney(priceText, currency) != null) &&
                ((stockText.toIntOrNull() ?: -1) >= 0) &&
                (discountValueText.isEmpty() || (discountValueText.toDoubleOrNull() ?: -1.0) >= 0)
}

@HiltViewModel
class ProductEditViewModel @Inject constructor(
    private val repo: CatalogRepository,
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
                        discountValueText = p.discountValue?.let { if (it % 1.0 == 0.0) it.toLong().toString() else it.toString() }.orEmpty(),
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

    fun save(onDone: () -> Unit) {
        val s = _state.value
        val price = parseMoney(s.priceText, s.currency)?.amountMinor ?: return
        _state.value = s.copy(saving = true)
        viewModelScope.launch {
            if (s.id == 0L && db.productDao().allOnce().size >= entitlementManager.getProductLimit()) {
                _state.value = s.copy(saving = false, quotaExceeded = true)
                return@launch
            }
            val existing = s.id.takeIf { it > 0 }?.let { repo.byId(it) }
            val newStock = s.stockText.toIntOrNull() ?: 0
            val localCategory = _categories.value.firstOrNull { it.categoryCode == s.categoryCode }
            repo.save(
                ProductEntity(
                    id = s.id, name = s.name.trim(),
                    description = s.description.trim().ifBlank { null },
                    priceMinor = price,
                    currency = s.currency,
                    stock = newStock,
                    // Hidden until backend and public catalog share one discount contract.
                    discountType = existing?.discountType,
                    discountValue = existing?.discountValue,
                    imagePath = s.imagePath, imageUrl = s.imageUrl, available = s.available,
                    productCode = existing?.productCode,
                    remoteUuid = existing?.remoteUuid,
                    syncedStockVersion = existing?.syncedStockVersion,
                    stockDirty = existing?.stockDirty == true || existing == null || existing.stock != newStock,
                    categoryId = localCategory?.id,
                    categoryCode = s.categoryCode,
                    createdAt = s.createdAt  // Fix(#6)
                )
            )
            SyncScheduler.syncNow(appContext)   // يرفع التعديل للكتالوج فورًا
            onDone()
        }
    }

    fun delete(onDone: () -> Unit) {
        val s = _state.value
        if (s.id <= 0) return
        viewModelScope.launch {
            imageStore.delete(s.imagePath) // no orphans
            repo.delete(s.id)
            SyncScheduler.syncNow(appContext)
            onDone()
        }
    }
}
