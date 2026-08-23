package app.orderak.seller.data.orders

import androidx.room.withTransaction
import app.orderak.seller.data.db.CustomerEntity
import app.orderak.seller.data.db.OrderDao
import app.orderak.seller.data.db.OrderEntity
import app.orderak.seller.data.db.OrderItemEntity
import app.orderak.seller.data.db.OrderWithItems
import app.orderak.seller.data.db.OrderakDatabase
import app.orderak.seller.data.db.PaymentDao
import app.orderak.seller.data.db.PaymentEntity
import app.orderak.seller.data.remote.BackendApi
import app.orderak.seller.data.session.SessionStore
import kotlinx.coroutines.flow.first
import app.orderak.seller.domain.OrderStatus
import app.orderak.seller.domain.PayMethod
import kotlinx.coroutines.flow.Flow
import javax.inject.Inject
import javax.inject.Singleton

data class NewOrderLine(val productId: Long, val name: String, val qty: Int, val priceMinor: Long)

@Singleton
class OrderRepository @Inject constructor(
    private val db: OrderakDatabase,
    private val orderDao: OrderDao,
    private val paymentDao: PaymentDao,
    private val api: BackendApi,
    private val sessionStore: SessionStore,
) {
    val orders: Flow<List<OrderEntity>> = orderDao.all()
    fun order(id: Long): Flow<OrderWithItems?> = orderDao.withItems(id)
    fun ordersOf(phone: String): Flow<List<OrderEntity>> = orderDao.byPhone(phone)
    fun customer(phone: String) = db.customerDao().byPhone(phone)
    val customers = db.customerDao().summaries()
    fun payments(orderId: Long): Flow<List<PaymentEntity>> = paymentDao.byOrder(orderId)

    fun countToday(startOfDay: Long) = orderDao.countSince(startOfDay)
    fun countUnpaid() = orderDao.countUnpaid()
    fun countToShip() = orderDao.countToShip()

    /** Atomic order creation: customer upsert + order + items + stock decrement (Plan Stage 3). */
    suspend fun create(
        buyerPhone: String, buyerName: String?, payMethod: PayMethod,
        note: String?, lines: List<NewOrderLine>
    ): Long = db.withTransaction {
        db.customerDao().insertIgnore(CustomerEntity(phone = buyerPhone, name = buyerName))
        if (!buyerName.isNullOrBlank()) db.customerDao().fillName(buyerPhone, buyerName)
        val total = lines.sumOf { it.qty * it.priceMinor }
        val orderId = orderDao.insert(
            OrderEntity(
                buyerPhone = buyerPhone, buyerName = buyerName,
                status = OrderStatus.NEW.name, payMethod = payMethod.name,
                totalMinor = total, note = note
            )
        )
        orderDao.insertItems(lines.map {
            OrderItemEntity(orderId = orderId, productId = it.productId,
                productName = it.name, qty = it.qty, priceMinor = it.priceMinor)
        })
        lines.forEach { db.productDao().decrementStock(it.productId, it.qty) }
        orderId
    }

    /**
     * Push a status change to the backend, then mirror what it accepted.
     *
     * These three used to write to Room and stop, which meant the server held
     * every order at NEW: a reinstall replayed a pipeline the seller had already
     * worked, and two devices could each hold a different truth about one order.
     * Cancelling was worse — placing an order takes stock through a trigger, and
     * the local-only restore leaked it on the server every time.
     *
     * The server owns the transition table and its answer is written here
     * verbatim, so a client whose enum disagrees loses. Nothing is written when
     * the call fails: a false return leaves the row as the server still has it,
     * which is the honest state until the next sync.
     *
     * Orders created locally by the seller have no remoteId and are still
     * local-only; they are moved in Room alone until they have been pushed.
     */
    private suspend fun applyStatus(id: Long, target: OrderStatus): Boolean {
        val order = orderDao.byId(id) ?: return false
        val remoteNo = order.remoteId
        if (remoteNo == null) {
            orderDao.updateStatus(id, target.name)
            if (target == OrderStatus.CANCELLED) {
                db.withTransaction {
                    orderDao.itemsOf(id).forEach { db.productDao().restoreStock(it.productId, it.qty) }
                }
            }
            return true
        }
        val phone = sessionStore.phone.first() ?: return false
        val secret = sessionStore.getOrCreateSecret()
        val response = api.setOrderStatus(phone, secret, remoteNo, target.name)
        if (!response.ok) return false
        // Mirror the server, not the request: on a repeat it answers with the
        // status the order already held, and that is what should be shown.
        orderDao.updateStatus(id, response.status)
        // Stock is returned by the server's trigger. Room mirrors it only when
        // the server says this call is what changed it, so a retry cannot credit
        // the same units twice.
        if (response.status == OrderStatus.CANCELLED.name && response.changed) {
            db.withTransaction {
                orderDao.itemsOf(id).forEach { db.productDao().restoreStock(it.productId, it.qty) }
            }
        }
        return true
    }

    /** Legal transitions only (domain state machine). Returns false if not allowed. */
    suspend fun advance(id: Long, from: OrderStatus): Boolean {
        val next = from.next ?: return false
        return applyStatus(id, next)
    }

    /** Fix(#12): PAID only reachable from NEW/CONFIRMED — the state machine stays authoritative. */
    suspend fun markPaid(id: Long, current: OrderStatus): Boolean {
        if (current != OrderStatus.NEW && current != OrderStatus.CONFIRMED) return false
        return applyStatus(id, OrderStatus.PAID)
    }

    suspend fun cancel(id: Long, current: OrderStatus): Boolean {
        if (!current.canCancel) return false
        return applyStatus(id, OrderStatus.CANCELLED)
    }

    suspend fun isDuplicateRef(ref: String): Boolean = paymentDao.countByRef(ref) > 0
    suspend fun recordPayment(payment: PaymentEntity) = paymentDao.insert(payment)
}
