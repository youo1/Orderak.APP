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
import app.orderak.seller.domain.availablePayMethods
import app.orderak.seller.domain.resolvePayMethod
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
    /**
     * Only the methods the server will accept for this store — see
     * [availablePayMethods]. Never `PayMethod.entries`: that offered FAWRY,
     * which the backend accepts for nobody, and pre-selected VF_CASH, which it
     * accepts only for a store that has configured a Vodafone Cash number.
     */
    val payMethods: List<PayMethod> = listOf(PayMethod.COD),
    val payMethod: PayMethod = PayMethod.COD,
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
            // The payout details are what the server derives the accepted
            // payment methods from, so the chip list is derived from the same
            // two values rather than from the enum.
            val available = availablePayMethods(
                vfcash = sessionStore.vfcash.first(),
                instapay = sessionStore.instapay.first(),
            )
            _state.value = _state.value.copy(
                countryIso = sessionStore.countryIso.first() ?: "EG",
                payMethods = available,
                payMethod = resolvePayMethod(available, _state.value.payMethod),
            )
        }
    }

    /**
     * Digits only, capped at what the selected country's numbers actually run to.
     *
     * The cap was a flat 11 — Egypt's national length — while the country picker
     * offers every ISO country and the server accepts 8 to 15 digits. A Saudi or
     * Emirati buyer's number was not too long for the backend, only for this
     * field.
     */
    fun onPhone(v: String) {
        val max = Countries.nationalDigitsMax(Countries.byIso(_state.value.countryIso))
        _state.value = _state.value.copy(phone = v.filter(Char::isDigit).take(max))
    }
    fun onName(v: String) { _state.value = _state.value.copy(name = v.take(40)) }
    fun onNote(v: String) { _state.value = _state.value.copy(note = v.take(200)) }
    /** Ignores a method this store cannot use, so the UI cannot outrun the rule. */
    fun onPayMethod(m: PayMethod) {
        if (m !in _state.value.payMethods) return
        _state.value = _state.value.copy(payMethod = m)
    }

    fun changeQty(product: ProductEntity, delta: Int) {
        val current = _state.value.qty[product.id] ?: 0
        val next = (current + delta).coerceIn(0, product.stock)
        _state.value = _state.value.copy(qty = _state.value.qty + (product.id to next), stockError = false)
    }

    fun totalMinor(): Long =
        products.value.sumOf { p -> (( _state.value.qty[p.id] ?: 0) * p.priceMinor) }

    /**
     * The currency of the selected lines, or null when they do not agree.
     *
     * [totalMinor] adds minor units, which is only money within one currency.
     * The screen rendered that sum with a hardcoded EGP, so a mixed selection —
     * and a wholly non-EGP one — showed a total that was wrong in both the digits
     * and the name. Null here means the screen has no total to show, which is the
     * honest answer rather than a plausible one.
     */
    fun selectedCurrency(): String? =
        products.value
            .filter { (_state.value.qty[it.id] ?: 0) > 0 }
            .map { it.currency }
            .distinct()
            .singleOrNull()

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
            val lines = selected.map { (p, q, _) -> NewOrderLine(p.id, p.name, q, p.priceMinor, p.currency) }
            val id = orderRepo.create(
                buyerPhone = s.phone, buyerName = s.name.ifBlank { null },
                payMethod = s.payMethod, note = s.note.ifBlank { null }, lines = lines
            )
            onDone(id)
        }
    }
}
