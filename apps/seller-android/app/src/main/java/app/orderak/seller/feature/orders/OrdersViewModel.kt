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

    /**
     * What the seller is looking at. [OrdersFilter.All] is the default.
     *
     * Was `OrderStatus?`, where null meant all. It now carries the named
     * questions the اليوم counters ask as well — see [OrdersFilter] for why a
     * type rather than a widened argument.
     */
    val filter = MutableStateFlow<OrdersFilter>(OrdersFilter.All)

    /**
     * The visible orders, or null while Room is still answering.
     *
     * Seeded `emptyList()` before, which is the same defect the اليوم counters
     * and the product catalogue had: a seller with orders met the "no orders
     * yet, record one" screen on every cold start. On this screen that is worse
     * than a flicker, because the empty state's action is to create an order —
     * and a seller who takes it has now recorded a duplicate of one they already
     * had.
     */
    val orders: StateFlow<List<OrderEntity>?> =
        combine(repo.orders, filter) { list, f ->
            // One evaluation of `now` for the whole list, so a list crossing
            // midnight mid-filter cannot include an order by one row and exclude
            // it by the next.
            val now = System.currentTimeMillis()
            list.filter { f.matches(it, now) }
        }.stateIn(viewModelScope, SharingStarted.WhileSubscribed(5_000), null)

    /**
     * Local ids of orders the server refused, so the list can mark them apart
     * from the ones still on their way. See OrderRepository.refusedPushes.
     */
    val refusedPushes: StateFlow<Set<Long>> =
        repo.refusedPushes
            .map { it.keys }
            .stateIn(viewModelScope, SharingStarted.WhileSubscribed(5_000), emptySet())

    fun setFilter(filter: OrdersFilter) { this.filter.value = filter }

    /** The status chips still speak in statuses; null clears to [OrdersFilter.All]. */
    fun setStatusFilter(status: OrderStatus?) {
        filter.value = if (status == null) OrdersFilter.All else OrdersFilter.Status(status)
    }
}
