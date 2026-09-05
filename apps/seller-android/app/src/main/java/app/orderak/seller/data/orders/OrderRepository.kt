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
import app.orderak.seller.data.remote.CreateOrderReq
import app.orderak.seller.data.remote.NewOrderLineDto
import app.orderak.seller.data.session.SessionStore
import kotlinx.coroutines.flow.first
import app.orderak.seller.domain.OrderStatus
import app.orderak.seller.domain.PayMethod
import kotlinx.coroutines.flow.Flow
import java.util.UUID
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

    /**
     * Record an order the seller took outside the storefront.
     *
     * Written locally first, then posted. Local first because the seller is
     * standing in front of a customer and the order must not depend on a signal;
     * posted immediately after because until the server has it, the order is not
     * on the account, does not reach a second device, does not survive a
     * reinstall and is not counted against the plan.
     *
     * A failed post is not an error the seller has to act on. The row keeps its
     * idempotency key, [SyncRepository] retries it on the next sync, and the
     * screens say plainly that it is not on the account yet — see
     * LocalOnlyOrder.kt. The key is what makes that retry safe: the server
     * returns the order already written rather than creating a second one.
     */
    suspend fun create(
        buyerPhone: String, buyerName: String?, payMethod: PayMethod,
        note: String?, lines: List<NewOrderLine>
    ): Long {
        val orderId = db.withTransaction {
            db.customerDao().insertIgnore(CustomerEntity(phone = buyerPhone, name = buyerName))
            if (!buyerName.isNullOrBlank()) db.customerDao().fillName(buyerPhone, buyerName)
            val total = lines.sumOf { it.qty * it.priceMinor }
            val id = orderDao.insert(
                OrderEntity(
                    buyerPhone = buyerPhone, buyerName = buyerName,
                    status = OrderStatus.NEW.name, payMethod = payMethod.name,
                    totalMinor = total, note = note,
                    idempotencyKey = UUID.randomUUID().toString(),
                )
            )
            orderDao.insertItems(lines.map {
                OrderItemEntity(orderId = id, productId = it.productId,
                    productName = it.name, qty = it.qty, priceMinor = it.priceMinor)
            })
            lines.forEach { db.productDao().decrementStock(it.productId, it.qty) }
            id
        }
        runCatching { pushOrder(orderId) }
        return orderId
    }

    /**
     * Post one locally created order and record what the server assigned.
     *
     * Returns true when the order is on the account afterwards, including the
     * case where it already was — a replay answers with the existing order, and
     * that is a success, not a conflict.
     *
     * Stock is deliberately not adjusted here. The local decrement happened when
     * the order was recorded, and the server's trigger takes its own units when
     * it accepts the order; touching stock again would double-count. The
     * authoritative figure arrives on the next catalogue sync.
     */
    suspend fun pushOrder(orderId: Long): Boolean {
        val order = orderDao.byId(orderId) ?: return false
        if (order.remoteId != null) return true
        val key = order.idempotencyKey ?: return false
        val phone = sessionStore.phone.first() ?: return false
        val secret = sessionStore.getOrCreateSecret()
        val items = orderDao.itemsOf(orderId).mapNotNull { item ->
            // The server addresses products by their immutable public code. A
            // line whose product has never synced has none, so the order cannot
            // be expressed yet; it stays pending and the next sync, which pushes
            // the catalogue first, gives it one.
            db.productDao().byId(item.productId)?.productCode?.let { code ->
                NewOrderLineDto(product_code = code, qty = item.qty)
            }
        }
        if (items.size != orderDao.itemsOf(orderId).size) return false
        val response = api.createOrder(
            phone, secret,
            CreateOrderReq(
                idempotency_key = key,
                buyer_phone = order.buyerPhone,
                buyer_name = order.buyerName,
                items = items,
                pay_method = order.payMethod,
                note = order.note,
            ),
        )
        if (!response.ok) return false
        orderDao.acceptRemoteId(orderId, response.order_no)
        return true
    }

    /** Post everything this device recorded and the server has not acknowledged. */
    suspend fun pushPendingOrders(): Boolean {
        var allSucceeded = true
        for (order in orderDao.pendingUpload()) {
            if (!runCatching { pushOrder(order.id) }.getOrDefault(false)) allSucceeded = false
        }
        return allSucceeded
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
     * An order the server has not acknowledged cannot be moved at all. It used
     * to be moved in Room alone, which meant the seller worked a pipeline that
     * existed on one phone: the server held the order at NEW, a reinstall
     * replayed work already done, and a local-only cancellation restored stock
     * here while the server kept it consumed. Refusing is the honest answer, and
     * the screens disable the controls rather than offering an action that
     * cannot be taken (BR-305a).
     *
     * This is not a lasting restriction. The order is posted the moment it is
     * recorded, and retried on every sync until it lands.
     */
    private suspend fun applyStatus(id: Long, target: OrderStatus): Boolean {
        val order = orderDao.byId(id) ?: return false
        // One attempt to get it onto the account first: an order recorded
        // seconds ago while the signal was out should not block the seller from
        // working it the moment the signal returns.
        val remoteNo = order.remoteId
            ?: (if (runCatching { pushOrder(id) }.getOrDefault(false)) orderDao.byId(id)?.remoteId else null)
            ?: return false
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
