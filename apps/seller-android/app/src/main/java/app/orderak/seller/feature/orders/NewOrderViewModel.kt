package app.orderak.seller.feature.orders

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import app.orderak.seller.core.phone.Countries
import app.orderak.seller.data.db.ProductEntity
import app.orderak.seller.data.catalog.CatalogRepository
import app.orderak.seller.data.orders.NewOrderLine
import app.orderak.seller.data.orders.OrderRepository
import app.orderak.seller.data.session.SessionStore
import app.orderak.seller.domain.PayMethod
import dagger.hilt.android.lifecycle.HiltViewModel
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.SharingStarted
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.flow.stateIn
import kotlinx.coroutines.launch
import javax.inject.Inject

data class NewOrderUiState(
    val phone: String = "",
    val name: String = "",
    val note: String = "",
    val payMethod: PayMethod = PayMethod.VF_CASH,
    val qty: Map<Long, Int> = emptyMap(),   // productId -> qty
    val saving: Boolean = false,
    val stockError: Boolean = false,
    val countryIso: String = "EG",
) {
    val phoneValid: Boolean get() = Countries.isValid(Countries.byIso(countryIso), phone)
    val hasItems: Boolean get() = qty.any { it.value > 0 }
    val canSave: Boolean get() = phoneValid && hasItems
}

@HiltViewModel
class NewOrderViewModel @Inject constructor(
    catalogRepo: CatalogRepository,
    private val orderRepo: OrderRepository,
    private val sessionStore: SessionStore,
) : ViewModel() {

    val products: StateFlow<List<ProductEntity>> =
        catalogRepo.products.stateIn(viewModelScope, SharingStarted.WhileSubscribed(5_000), emptyList())

    private val _state = MutableStateFlow(NewOrderUiState())
    val state: StateFlow<NewOrderUiState> = _state.asStateFlow()

    init {
        viewModelScope.launch {
            _state.value = _state.value.copy(countryIso = sessionStore.countryIso.first() ?: "EG")
        }
    }

    fun onPhone(v: String) { _state.value = _state.value.copy(phone = v.filter(Char::isDigit).take(11)) }
    fun onName(v: String) { _state.value = _state.value.copy(name = v.take(40)) }
    fun onNote(v: String) { _state.value = _state.value.copy(note = v.take(200)) }
    fun onPayMethod(m: PayMethod) { _state.value = _state.value.copy(payMethod = m) }

    fun changeQty(product: ProductEntity, delta: Int) {
        val current = _state.value.qty[product.id] ?: 0
        val next = (current + delta).coerceIn(0, product.stock)
        _state.value = _state.value.copy(qty = _state.value.qty + (product.id to next), stockError = false)
    }

    fun totalPiasters(): Long =
        products.value.sumOf { p -> (( _state.value.qty[p.id] ?: 0) * p.pricePiasters) }

    fun save(onDone: (Long) -> Unit) {
        val s = _state.value
        if (!s.canSave || s.saving) return
        _state.value = s.copy(saving = true)
        viewModelScope.launch {
            val selected = products.value.mapNotNull { p ->
                val q = s.qty[p.id] ?: 0
                if (q <= 0) null else Triple(p, q, q > p.stock)
            }
            if (selected.any { it.third }) {
                _state.value = s.copy(saving = false, stockError = true)
                return@launch
            }
            val lines = selected.map { (p, q, _) -> NewOrderLine(p.id, p.name, q, p.pricePiasters) }
            val id = orderRepo.create(
                buyerPhone = s.phone, buyerName = s.name.ifBlank { null },
                payMethod = s.payMethod, note = s.note.ifBlank { null }, lines = lines
            )
            onDone(id)
        }
    }
}
