package app.orderak.seller.feature.orders

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import app.orderak.seller.data.db.OrderEntity
import app.orderak.seller.data.orders.OrderRepository
import app.orderak.seller.domain.OrderStatus
import dagger.hilt.android.lifecycle.HiltViewModel
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.SharingStarted
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.combine
import kotlinx.coroutines.flow.map
import kotlinx.coroutines.flow.stateIn
import javax.inject.Inject

@HiltViewModel
class OrdersViewModel @Inject constructor(
    repo: OrderRepository
) : ViewModel() {

    /** null = all */
    val filter = MutableStateFlow<OrderStatus?>(null)

    val orders: StateFlow<List<OrderEntity>> =
        combine(repo.orders, filter) { list, f ->
            if (f == null) list else list.filter { it.status == f.name }
        }.stateIn(viewModelScope, SharingStarted.WhileSubscribed(5_000), emptyList())

    /**
     * Local ids of orders the server refused, so the list can mark them apart
     * from the ones still on their way. See OrderRepository.refusedPushes.
     */
    val refusedPushes: StateFlow<Set<Long>> =
        repo.refusedPushes
            .map { it.keys }
            .stateIn(viewModelScope, SharingStarted.WhileSubscribed(5_000), emptySet())

    fun setFilter(status: OrderStatus?) { filter.value = status }
}
