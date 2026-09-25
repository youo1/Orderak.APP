package app.orderak.seller.data.refresh

import androidx.room.withTransaction
import app.orderak.seller.core.phone.CustomerPhone
import app.orderak.seller.data.db.OrderEntity
import app.orderak.seller.data.db.OrderItemEntity
import app.orderak.seller.data.db.CustomerEntity
import app.orderak.seller.data.db.OrderakDatabase
import app.orderak.seller.data.catalog.CategoryCacheWriter
import app.orderak.seller.data.catalog.LegacyCatalogueReconciler
import app.orderak.seller.data.catalog.ProductCacheWriter
import app.orderak.seller.data.catalog.StockDrain
import app.orderak.seller.data.customers.CustomerCacheWriter
import app.orderak.seller.data.orders.OrderCommandQueue
import app.orderak.seller.data.remote.BackendApi
import app.orderak.seller.data.remote.BackendConfig
import app.orderak.seller.data.remote.RegisterReq
import app.orderak.seller.data.remote.RemoteOrder
import app.orderak.seller.data.session.SessionStore
import app.orderak.seller.data.auth.AuthRepository
import app.orderak.seller.data.billing.EntitlementRepository
import app.orderak.seller.data.billing.EntitlementRefreshResult
import app.orderak.seller.domain.OrderStatus
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import kotlinx.coroutines.withContext
import java.text.SimpleDateFormat
import java.util.Locale
import java.util.TimeZone
import javax.inject.Inject
import javax.inject.Singleton

/**
 * Pull the server's state onto this device.
 *
 * Everything here is a read, with one exception: the store profile is registered
 * when its configuration has changed. There is no catalogue push and no customer
 * push, because there is nothing left on the device that the server does not
 * already have — a product or customer edit is Class A and reached the server or
 * did not happen.
 *
 * WHAT THIS USED TO BE
 *   A repository that pulled orders and then pushed the whole catalogue as a
 *   mirror: whatever the payload omitted, the server deleted. Three guards
 *   existed to decide when a device's silence could be believed — a
 *   download-before-push baseline, a version check, a bulk-deletion prompt — and
 *   all three are gone with the shape that needed them. What is left is a
 *   refresh, which is why nothing here is called a sync.
 */
@Singleton
class SellerRefresher @Inject constructor(
    private val api: BackendApi,
    private val sessionStore: SessionStore,
    private val db: OrderakDatabase,
    private val entitlementRepository: EntitlementRepository,
    private val authRepository: AuthRepository,
    private val productCache: ProductCacheWriter,
    private val categoryCache: CategoryCacheWriter,
    private val customerCache: CustomerCacheWriter,
    private val legacyCatalogue: LegacyCatalogueReconciler,
    private val stockDrain: StockDrain,
    // Orders the seller recorded are posted from here rather than from the
    // screen that recorded them: the first attempt happens at creation, and
    // every attempt after that belongs to the command queue.
    private val orderCommands: OrderCommandQueue,
) {

    /** Whether shop config changed since the last refresh — if not, skip the register call. */
    private var lastRegisteredShopConfig: String? = null

    /**
     * One refresh at a time.
     *
     * The one-time and periodic WorkManager queues have different unique names,
     * so without this two refreshes could interleave — running the legacy
     * reconciliation twice over the same rows, and using the shared
     * SimpleDateFormat below, which is not thread-safe.
     */
    private val refreshMutex = Mutex()

    suspend fun refreshNow(): Boolean = withContext(Dispatchers.IO) {
        refreshMutex.withLock { refresh() }
    }

    private suspend fun refresh(): Boolean {
        val phone = sessionStore.phone.first() ?: return false
        val shopName = sessionStore.shopName.first() ?: return false
        val secret = sessionStore.getOrCreateSecret()

        // Country: onboarding choice wins; fall back to the phone dial prefix.
        val countryIso = sessionStore.countryIso.first()
            ?.takeIf { (it.isNotBlank() && it != "XX") } ?: phoneToCountryIso(phone)

        // 1) Only register/claim if shop config changed or first time
        val shopConfigKey = "$shopName|${sessionStore.instapay.first()}|${sessionStore.vfcash.first()}|${sessionStore.slug.first()}|$countryIso"
        if (shopConfigKey != lastRegisteredShopConfig) {
            // A fresh Firebase ID token lets the backend verify this phone before
            // creating a new store (existing stores are updated via device secret).
            val idToken = runCatching { authRepository.currentIdToken() }.getOrNull()
            val reg = api.register(
                RegisterReq(
                    phone = phone, secret = secret, shop_name = shopName,
                    instapay = sessionStore.instapay.first()?.ifBlank { null },
                    vfcash = sessionStore.vfcash.first()?.ifBlank { null },
                    slug = sessionStore.slug.first()?.ifBlank { null },
                    country_iso = countryIso,
                    id_token = idToken,
                )
            )
            if (!reg.ok) return false
            // Persist the structured public identity so shared links use the real URL.
            sessionStore.saveStoreIdentity(
                reg.slug, reg.public_identifier, reg.store_code, reg.country_code, reg.store_url,
            )
            lastRegisteredShopConfig = shopConfigKey
        }

        // 2) Pull new buyer orders FIRST (cursor = per-store order_no). Ordering
        //    matters: pulled orders adjust local stock, so the mirror push below
        //    sends corrected quantities instead of overwriting server-side
        //    decrements from orders we hadn't seen yet (lost-update window).
        //    The orders response also piggybacks the plan config, so we no
        //    longer spend a separate authenticated /api/v1/config request per sync.
        var cursor = db.orderDao().maxRemoteId() ?: 0L
        var pulled = api.fetchOrders(phone, secret, cursor)
        var pullOk = pulled.ok
        var pageCount = 0
        while (pulled.ok) {
            if (pulled.orders.isNotEmpty()) {
                db.withTransaction {
                    pulled.orders.forEach { insertRemoteOrderInTransaction(it, countryIso) }
                }
            }
            if (!pulled.has_more) break
            val next = pulled.next_since ?: pulled.orders.maxOfOrNull { it.order_no }
            if (next == null || next <= cursor || ++pageCount >= MAX_ORDER_PAGES) {
                pullOk = false
                break
            }
            cursor = next
            pulled = api.fetchOrders(phone, secret, cursor)
            pullOk = pulled.ok
        }
        if (pullOk) {
            val legacyConfig = pulled.config?.takeIf { it.ok }?.let { c ->
                BackendConfig(
                    plan_id = c.plan_id,
                    plan_name = c.plan_name,
                    // The paid period, carried rather than defaulted. Without
                    // these two the fallback config claimed an active
                    // subscription with no end date, which the period gate reads
                    // as "not expired" for every seller it is ever applied to.
                    subscription_status = c.subscription_status,
                    current_period_end = c.current_period_end,
                    ads_enabled = c.ads_enabled,
                    limits = c.limits,
                    features = c.features,
                    // Carried through, not dropped. This conversion used to omit
                    // it, so even once the server started sending the map the
                    // fallback would have handed the resolver an empty one.
                    entitlements = c.entitlements,
                    governance = c.governance,
                )
            }
            val entitlementResult = entitlementRepository.refresh(force = true)
            // Fall back only when the app has NO snapshot to work from.
            //
            // The "or the error was http_503" arm that used to sit here was the
            // one place the client read the server's engine state: 503 meant
            // ENTITLEMENTS_ENABLED was false, and the app changed what it did
            // because of it. /api/v1/entitlements answers with a snapshot in
            // either configuration now, so that arm described a response that no
            // longer exists — and while it did exist it was the reason a working
            // cached snapshot could be overwritten by the thinner legacy config
            // on any sync. What is left is not engine branching: it is "the
            // request failed and there is nothing cached", which is a network
            // condition and true of both engines alike (I-4).
            if (
                legacyConfig != null &&
                entitlementResult == EntitlementRefreshResult.FAILED &&
                entitlementRepository.state.value.config == null
            ) {
                entitlementRepository.acceptConfig(legacyConfig)
            }
        }

        // 2b) Legacy rows first, then stock, then the server's catalogue.
        //
        // The order is the whole safety property of this migration and is not
        // negotiable. A product that predates the product routes exists on this
        // device and nowhere else; replacing the cache with the server's list
        // before converting it destroys it. So: convert, drain, then adopt — and
        // adopt only if nothing is left unconverted.
        // 2c) ...and then post orders the seller recorded that the server has
        //      not seen, whatever any of that did.
        //
        // The four steps live in `runCatalogueAndOrderSteps` rather than here,
        // because the property that matters — the order queue drains even when
        // the catalogue fails — is invisible in four consecutive statements and
        // was a real defect before the cutover. It has a test there; it cannot
        // have one here without a database and an API.
        val (reconciled, stockDrained, catalogueRefreshed, ordersPushed) =
            runCatalogueAndOrderSteps(
                reconcile = { legacyCatalogue.reconcile() },
                drainStock = { stockDrain.drain() },
                refreshCatalogue = { refreshCatalogue(phone, secret) },
                drainOrders = { orderCommands.drain() },
            )

        // 2d) Take the server's customer list.
        //
        // A pull and nothing else. There is no push half any more: a customer
        // edit is Class A, so it either reached the server or did not happen,
        // and no local row can be carrying an unacknowledged change by the time
        // this runs. The rule that used to protect those rows was correct and is
        // now unreachable, which is why it was deleted rather than kept.
        val customersRefreshed = refreshCustomers(phone, secret)

        return pullOk && reconciled && stockDrained && catalogueRefreshed &&
            ordersPushed && customersRefreshed
    }

    /**
     * Take the server's catalogue as the complete set of products.
     *
     * Safe as a replacement, where the mirror's equivalent never was, for one
     * reason: the server is stating what exists. A device saying "these are all
     * the products" could only ever mean "these are all the products I have
     * heard of", and the gap between those two sentences is what deleted
     * catalogues.
     *
     * Runs only after [LegacyCatalogueReconciler.reconcile] reports nothing
     * unconverted. A row that exists on this device and nowhere else would
     * otherwise be erased by a list that never contained it.
     */
    private suspend fun refreshCatalogue(phone: String, secret: String): Boolean {
        val categories = api.listCategories(phone, secret)
        val categoriesApplied = categories.ok && categoryCache.replaceAll(categories.categories)

        val pulled = api.fetchProducts(phone, secret)
        if (!pulled.ok) return false
        val productsApplied = productCache.replaceAll(pulled.products)
        return categories.ok && categoriesApplied && productsApplied
    }

    /**
     * Take the server's customer list.
     *
     * A pull and nothing else. The push half is gone with the dirty flag it
     * depended on: a customer edit is Class A now, so it reached the server or
     * it did not happen, and no row can be holding an unacknowledged change when
     * this runs.
     */
    private suspend fun refreshCustomers(phone: String, secret: String): Boolean {
        val remote = api.listCustomers(phone, secret)
        if (!remote.ok) return false
        customerCache.putAll(remote.customers)
        return true
    }

    private suspend fun insertRemoteOrderInTransaction(o: RemoteOrder, region: String?) {
        // Dedup by the per-store order number (buyer orders come from the link).
        if (db.orderDao().countByRemoteId(o.order_no) > 0) return
        // The same key the server derives, so the customer this order belongs to
        // is the one the customer pull will land on rather than a second row for
        // the same person (I-6).
        val normalized = CustomerPhone.normalize(o.buyer_phone, region)
        db.customerDao().insertIgnore(
            CustomerEntity(
                customerKey = normalized.key,
                phone = o.buyer_phone,
                phoneE164 = normalized.e164,
                phoneStatus = normalized.status.name.lowercase(),
                name = o.buyer_name,
            )
        )
        o.buyer_name?.takeIf { it.isNotBlank() }
            ?.let { db.customerDao().fillName(normalized.key, it) }
        val localId = db.orderDao().insert(
            OrderEntity(
                remoteId = o.order_no,
                buyerPhone = o.buyer_phone,
                buyerName = o.buyer_name,
                status = o.status,
                payMethod = o.pay_method,
                totalMinor = o.total.amount_minor,
                currency = o.total.currency,
                note = o.note,
                createdAt = parseCreatedAt(o.created_at),
            )
        )
        // Resolve each line to the LOCAL product id via its immutable public code.
        // Storing a real productId (not 0) is what makes later stock adjustments
        // work — OrderRepository.cancel() restores stock by productId, so items
        // with id 0 would silently leak stock on every cancelled remote order.
        val lines = o.items.map { item ->
            val localProductId = item.product_code
                ?.let { db.productDao().idByCode(it) } ?: 0L
            item to localProductId
        }
        db.orderDao().insertItems(
            lines.map { (item, productId) ->
                OrderItemEntity(
                    orderId = localId,
                    productId = productId, // 0 only if the code didn't match locally
                    productName = item.product_name,
                    qty = item.qty,
                    priceMinor = item.price.amount_minor,
                )
            }
        )
        // Keep local stock in step with the server — but not for orders that
        // arrive already cancelled (their stock was never truly consumed).
        if (o.status != OrderStatus.CANCELLED.name) {
            lines.forEach { (item, productId) ->
                if (productId != 0L) db.productDao().decrementStock(productId, item.qty)
            }
        }
    }

    private fun phoneToCountryIso(phone: String): String {
        return try {
            val util = com.google.i18n.phonenumbers.PhoneNumberUtil.getInstance()
            val parsed = util.parse(if (phone.startsWith("+")) phone else "+$phone", null)
            util.getRegionCodeForNumber(parsed) ?: "XX"
        } catch (_: Exception) {
            // Manual fallback if parsing fails
            val d = phone.replace(Regex("\\D"), "")
            when {
                d.startsWith("20") || d.matches(Regex("^01[0-25].*")) -> "EG"
                d.startsWith("966") -> "SA"
                d.startsWith("971") -> "AE"
                else -> "XX"
            }
        }
    }

        companion object {
        /** Longest edge of an uploaded product image (px) — catalog thumbnails don't need more. */
        private const val MAX_UPLOAD_DIM = 1280

        /** JPEG quality for recompressed uploads. */
        private const val UPLOAD_JPEG_QUALITY = 85

        /** Defensive ceiling against a malformed pagination cursor. */
        private const val MAX_ORDER_PAGES = 100

        /** Parse SQLite datetime string (e.g. "2026-07-07 12:00:00") to epoch millis. */
        private val dbDateFormat = SimpleDateFormat("yyyy-MM-dd HH:mm:ss", Locale.US).apply {
            timeZone = TimeZone.getTimeZone("UTC")
        }

        fun parseCreatedAt(dateStr: String?): Long {
            if (dateStr == null) return System.currentTimeMillis()
            return try {
                dbDateFormat.parse(dateStr)?.time ?: System.currentTimeMillis()
            } catch (_: Exception) {
                System.currentTimeMillis()
            }
        }
    }
}

