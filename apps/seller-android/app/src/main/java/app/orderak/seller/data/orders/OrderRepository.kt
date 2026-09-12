package app.orderak.seller.data.orders

import androidx.room.withTransaction
import app.orderak.seller.core.phone.CustomerPhone
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
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import java.util.UUID
import javax.inject.Inject
import javax.inject.Singleton

/**
 * A line, with the currency its price is in.
 *
 * The currency used to be absent, so OrderEntity took its "EGP" default and the
 * order recorded a currency nobody had chosen. A store in Kuwait wrote KWD
 * prices into orders stamped EGP, which is wrong by a factor of ten as well as
 * wrong by name.
 */
data class NewOrderLine(
    val productId: Long,
    val name: String,
    val qty: Int,
    val priceMinor: Long,
    val currency: String,
)

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
    fun customer(key: String) = db.customerDao().byKey(key)
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
     * A post that FAILED is not an error the seller has to act on. The row keeps
     * its idempotency key, [SyncRepository] retries it on the next sync, and the
     * screens say plainly that it is not on the account yet — see
     * LocalOnlyOrder.kt. The key is what makes that retry safe: the server
     * returns the order already written rather than creating a second one.
     *
     * A post the server REFUSED is different, and used to be treated the same.
     * A refusal answers identically however many times it is sent, so retrying
     * is not patience, it is a loop — and the seller was shown "it will send on
     * the next sync" about an order that never would. [pushOrder] separates the
     * two now, the refusal is surfaced with the server's reason, and
     * [discardLocalOnlyOrder] is the way out.
     */
    suspend fun create(
        buyerPhone: String, buyerName: String?, payMethod: PayMethod,
        note: String?, lines: List<NewOrderLine>
    ): Long {
        // The customer's identity, decided the same way the server decides it.
        // The seller's own country is the only country context a buyer phone
        // has; without it a bare national number is ambiguous and keys to
        // itself rather than being guessed at (I-6).
        val region = sessionStore.countryIso.first()
        val normalized = CustomerPhone.normalize(buyerPhone, region)

        // One order, one currency. Summing minor units across currencies produces
        // a number that is not money, and totalMinor is a single column with a
        // single currency beside it — there is nowhere to record a mixed order
        // even if one were meaningful. The caller filters to a single currency
        // before it gets here; this is the invariant stated where it is relied on.
        val currency = lines.map { it.currency }.distinct().singleOrNull()
            ?: error("An order must be in exactly one currency, got ${lines.map { it.currency }.distinct()}")

        val orderId = db.withTransaction {
            db.customerDao().insertIgnore(
                CustomerEntity(
                    customerKey = normalized.key,
                    phone = buyerPhone,
                    phoneE164 = normalized.e164,
                    phoneStatus = normalized.status.name.lowercase(),
                    name = buyerName,
                )
            )
            if (!buyerName.isNullOrBlank()) db.customerDao().fillName(normalized.key, buyerName)
            val total = lines.sumOf { it.qty * it.priceMinor }
            val id = orderDao.insert(
                OrderEntity(
                    buyerPhone = buyerPhone, buyerName = buyerName,
                    status = OrderStatus.NEW.name, payMethod = payMethod.name,
                    totalMinor = total, currency = currency, note = note,
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
     * Orders the server refused outright, by local id, with the reason.
     *
     * Held in memory rather than on the row: `remoteId` already answers "is this
     * on the account", and a persisted second field meaning "and here is why
     * not" would be a schema change plus a value to keep in step with it. What
     * is lost by not persisting is the reason text across a process restart —
     * after which the order is pushed once more, refused the same way, and the
     * reason comes back. One wasted request per launch, and it is self-limiting.
     *
     * What matters for recovery does not depend on this map at all: an order
     * with no `remoteId` is not on the account whatever the cause, and
     * [discardLocalOnlyOrder] is offered for every such order.
     */
    private val _refusedPushes = MutableStateFlow<Map<Long, String>>(emptyMap())
    val refusedPushes: StateFlow<Map<Long, String>> = _refusedPushes.asStateFlow()

    /**
     * Post one locally created order and record what the server assigned.
     *
     * Stock is deliberately not adjusted here. The local decrement happened when
     * the order was recorded, and the server's trigger takes its own units when
     * it accepts the order; touching stock again would double-count. The
     * authoritative figure arrives on the next catalogue sync.
     *
     * The return type is the point. This used to answer Boolean, so a refusal
     * and a dropped connection were the same answer and the caller retried both
     * forever — see [OrderPushOutcome].
     */
    suspend fun pushOrder(orderId: Long): OrderPushOutcome {
        val order = orderDao.byId(orderId) ?: return OrderPushOutcome.NotReady
        if (order.remoteId != null) return OrderPushOutcome.Accepted
        val key = order.idempotencyKey ?: return OrderPushOutcome.NotReady
        val phone = sessionStore.phone.first() ?: return OrderPushOutcome.Retryable("no_session")
        val secret = sessionStore.getOrCreateSecret()
        val lines = orderDao.itemsOf(orderId)
        val items = lines.mapNotNull { item ->
            // The server addresses products by their immutable public code. A
            // line whose product has never synced has none, so the order cannot
            // be expressed yet; it stays pending and the next sync, which pushes
            // the catalogue first, gives it one.
            db.productDao().byId(item.productId)?.productCode?.let { code ->
                NewOrderLineDto(product_code = code, qty = item.qty)
            }
        }
        if (items.size != lines.size) return OrderPushOutcome.NotReady
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
        if (response.ok) {
            orderDao.acceptRemoteId(orderId, response.order_no)
            _refusedPushes.update { it - orderId }
            return OrderPushOutcome.Accepted
        }
        val code = response.error ?: "bad_response"
        if (isRetryableOrderPushCode(code)) {
            _refusedPushes.update { it - orderId }
            return OrderPushOutcome.Retryable(code)
        }
        _refusedPushes.update { it + (orderId to code) }
        return OrderPushOutcome.Refused(code)
    }

    /**
     * Delete an order this device recorded and the server never accepted, and
     * give its stock back.
     *
     * Exists because until now there was no way out. An order the server refuses
     * — a payment method this store cannot use, a product that no longer
     * exists — has no `remoteId`, and without one it cannot be advanced,
     * cancelled or removed: the screens correctly refuse to move an order the
     * server does not have, so the row sat in the list forever with its stock
     * deducted on this phone and nowhere else.
     *
     * Stock is restored here because the local decrement at [create] was this
     * device's own bookkeeping for an order the server never took units for.
     * Returning them is what makes the counts agree again.
     *
     * Refuses an order the server holds. That case is a cancellation, which is a
     * different operation with a different server-side effect.
     */
    suspend fun discardLocalOnlyOrder(orderId: Long): Boolean = db.withTransaction {
        val order = orderDao.byId(orderId) ?: return@withTransaction false
        if (order.remoteId != null) return@withTransaction false
        orderDao.itemsOf(orderId).forEach { db.productDao().restoreStock(it.productId, it.qty) }
        orderDao.deleteItemsOf(orderId)
        orderDao.deletePaymentsOf(orderId)
        val removed = orderDao.deleteLocalOnly(orderId) > 0
        if (removed) _refusedPushes.update { it - orderId }
        removed
    }

    /**
     * Apply a seller's edit to a customer.
     *
     * Written locally and marked dirty, not posted here. The seller is often
     * offline, and an edit that failed because of that would either be lost or
     * would have to block the screen on a network call. [SyncRepository] posts
     * every dirty row on the next sync and clears the flag on acknowledgement;
     * until then the local value is the one shown.
     *
     * The phone is not a parameter. It is the identity — see CustomerDao.
     */
    suspend fun editCustomer(customerKey: String, name: String, altContact: String, note: String) {
        db.customerDao().applyEdit(
            key = customerKey,
            name = name.trim().ifBlank { null },
            altContact = altContact.trim().ifBlank { null },
            note = note.trim().ifBlank { null },
            updatedAt = System.currentTimeMillis(),
        )
    }

    /**
     * Post everything this device recorded and the server has not acknowledged.
     *
     * A refused order is not retried within the process and does not make the
     * sync report failure: the sync cannot fix it, and reporting failure would
     * make WorkManager retry the whole cycle on behalf of one order that will be
     * refused identically. The refusal is surfaced on the order instead, where
     * the seller can act on it.
     */
    suspend fun pushPendingOrders(): Boolean {
        var allSucceeded = true
        for (order in orderDao.pendingUpload()) {
            if (_refusedPushes.value.containsKey(order.id)) continue
            val outcome = runCatching { pushOrder(order.id) }
                .getOrElse { OrderPushOutcome.Retryable("network") }
            when (outcome) {
                is OrderPushOutcome.Accepted -> Unit
                is OrderPushOutcome.Refused -> Unit
                is OrderPushOutcome.NotReady -> allSucceeded = false
                is OrderPushOutcome.Retryable -> allSucceeded = false
            }
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
        val pushed = order.remoteId != null ||
            runCatching { pushOrder(id) }.getOrNull() is OrderPushOutcome.Accepted
        val remoteNo = (if (pushed) orderDao.byId(id)?.remoteId else null) ?: return false
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
