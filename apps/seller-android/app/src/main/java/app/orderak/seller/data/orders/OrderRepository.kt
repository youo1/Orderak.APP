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
    private val paymentDao: PaymentDao
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

    /** Legal transitions only (domain state machine). Returns false if not allowed. */
    suspend fun advance(id: Long, from: OrderStatus): Boolean {
        val next = from.next ?: return false
        orderDao.updateStatus(id, next.name)
        return true
    }

    /** Fix(#12): PAID only reachable from NEW/CONFIRMED — the state machine stays authoritative. */
    suspend fun markPaid(id: Long, current: OrderStatus): Boolean {
        if (current != OrderStatus.NEW && current != OrderStatus.CONFIRMED) return false
        orderDao.updateStatus(id, OrderStatus.PAID.name)
        return true
    }

    suspend fun cancel(id: Long, current: OrderStatus): Boolean {
        if (!current.canCancel) return false
        db.withTransaction {
            orderDao.itemsOf(id).forEach { db.productDao().restoreStock(it.productId, it.qty) }
            orderDao.updateStatus(id, OrderStatus.CANCELLED.name)
        }
        return true
    }

    suspend fun isDuplicateRef(ref: String): Boolean = paymentDao.countByRef(ref) > 0
    suspend fun recordPayment(payment: PaymentEntity) = paymentDao.insert(payment)
}
