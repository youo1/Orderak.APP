package app.orderak.seller.data.remote

import androidx.room.withTransaction
import app.orderak.seller.data.db.OrderEntity
import app.orderak.seller.data.db.OrderItemEntity
import app.orderak.seller.data.db.CustomerEntity
import app.orderak.seller.data.db.OrderakDatabase
import app.orderak.seller.data.db.ProductEntity
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
 * Full sync cycle (Plan: Stage 3/5 backend link):
 * 1) Register/update the seller
 * 2) Push all products (mirror sync)
 * 3) Pull new buyer orders from backend
 */
@Singleton
class SyncRepository @Inject constructor(
    private val api: BackendApi,
    private val sessionStore: SessionStore,
    private val db: OrderakDatabase,
    private val entitlementRepository: EntitlementRepository,
    private val authRepository: AuthRepository,
) {

    /** Whether shop config changed since last sync — if not, skip register call. */
    private var lastRegisteredShopConfig: String? = null

    /**
     * Hash of the product payload last successfully pushed. When the current
     * catalog hashes the same, the full-mirror push is skipped entirely — it
     * was re-sending the whole catalog every 15 min even when nothing changed,
     * the single biggest recurring D1-write + Worker-CPU cost. Process-scoped
     * (like lastRegisteredShopConfig): worst case is one redundant push after a
     * cold start, which is harmless.
     */
    private var lastPushedProductsHash: Int? = null

    /**
     * One sync at a time. The one-time and periodic WorkManager queues have
     * different unique names, so without this two syncNow() calls could
     * interleave (double image uploads, racing mirror pushes, and concurrent
     * use of the shared SimpleDateFormat below, which is not thread-safe).
     */
    private val syncMutex = Mutex()

    suspend fun syncNow(): Boolean = withContext(Dispatchers.IO) {
        syncMutex.withLock { doSync() }
    }

    private suspend fun doSync(): Boolean {
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
                    pulled.orders.forEach { insertRemoteOrderInTransaction(it) }
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
                    ads_enabled = c.ads_enabled,
                    limits = c.limits,
                    features = c.features,
                    governance = c.governance,
                )
            }
            val entitlementResult = entitlementRepository.refresh(force = true)
            if (
                legacyConfig != null &&
                entitlementResult == EntitlementRefreshResult.FAILED &&
                (
                    entitlementRepository.state.value.config == null ||
                    entitlementRepository.state.value.error == "http_503"
                )
            ) {
                entitlementRepository.acceptConfig(legacyConfig)
            }
        }

        // 3) Upload any local product images that don't yet have a public URL,
        //    then push products (full mirror) and persist the returned codes.
        //    image_url must be the backend R2 URL — never the local file path,
        //    which only exists on this device and would render as a broken image.
        val prefetched = db.productDao().allOnce()
        val uploadedAny = uploadPendingProductImages(phone, secret, prefetched)
        // Re-read only if an upload changed an imageUrl; otherwise reuse.
        val products = if (uploadedAny) db.productDao().allOnce() else prefetched

        val dtos = products.map {
            ProductDto(
                app_id = it.id, name = it.name,
                price_piasters = it.pricePiasters,
                stock = it.stock, available = it.available,
                description = it.description,
                image_url = it.imageUrl,
                category_code = it.categoryCode,
                stock_dirty = it.stockDirty,
                expected_stock_version = it.syncedStockVersion,
            )
        }
        // Skip the whole mirror push when the catalog is byte-identical to the
        // last successful push. Deletions/edits/new products all change the hash.
        val hash = dtos.hashCode()
        var pushOk = true
        if (hash != lastPushedProductsHash) {
            val push = api.syncProducts(ProductsSyncReq(phone = phone, secret = secret, products = dtos))
            pushOk = push.ok
            if (push.products.isNotEmpty()) {
                // A batch may partially apply when only some compare-and-set
                // stock writes are stale. Accept authoritative state for the
                // successful rows while preserving local intent for conflicts.
                db.productDao().applySync(push.products, push.conflicts.toSet())
            }
            if (push.ok) {
                lastPushedProductsHash = hash
            }
        }

        return pushOk && pullOk
    }

    /**
     * Upload each product's local image to the backend (R2) once, caching the
     * returned public URL locally so we don't re-upload on every sync. Failures
     * are non-fatal: the product simply syncs without an image and retries next
     * time. Returns true if at least one image URL was persisted (caller re-reads).
     */
    private suspend fun uploadPendingProductImages(
        phone: String, secret: String, products: List<ProductEntity>,
    ): Boolean {
        val pending = products.filter { !it.imagePath.isNullOrBlank() && it.imageUrl.isNullOrBlank() }
        var uploadedAny = false
        for (p in pending) {
            val file = java.io.File(p.imagePath!!)
            if (!file.exists()) continue
            // Downscale + recompress before upload: camera photos are multi-MB
            // and readBytes() loaded them whole into memory. Sampled decode to
            // <= MAX_UPLOAD_DIM px keeps memory flat and saves the seller's
            // data plan. Falls back to raw bytes if decoding fails.
            val bytes = downscaledJpeg(file) ?: file.readBytes()
            val res = api.uploadMedia(
                phone = phone, secret = secret, kind = "product",
                bytes = bytes,
                fileName = "product_${p.id}.jpg",
                contentType = "image/jpeg",
            )
            if (res.ok && !res.url.isNullOrBlank()) {
                db.productDao().setImageUrl(p.id, res.url)
                uploadedAny = true
            }
        }
        return uploadedAny
    }

    /** Sampled decode to <= [MAX_UPLOAD_DIM] px, recompressed as JPEG. Null on failure. */
    private fun downscaledJpeg(file: java.io.File): ByteArray? = try {
        val bounds = android.graphics.BitmapFactory.Options().apply { inJustDecodeBounds = true }
        android.graphics.BitmapFactory.decodeFile(file.absolutePath, bounds)
        if (bounds.outWidth <= 0 || bounds.outHeight <= 0) null else {
            var sample = 1
            while (maxOf(bounds.outWidth, bounds.outHeight) / (sample * 2) >= MAX_UPLOAD_DIM) sample *= 2
            val opts = android.graphics.BitmapFactory.Options().apply { inSampleSize = sample }
            val bitmap = android.graphics.BitmapFactory.decodeFile(file.absolutePath, opts)
            if (bitmap == null) null else try {
                java.io.ByteArrayOutputStream().use { out ->
                    bitmap.compress(android.graphics.Bitmap.CompressFormat.JPEG, UPLOAD_JPEG_QUALITY, out)
                    out.toByteArray()
                }
            } finally {
                bitmap.recycle()
            }
        }
    } catch (e: Exception) {
        null
    } catch (e: OutOfMemoryError) {
        null
    }

    private suspend fun insertRemoteOrderInTransaction(o: RemoteOrder) {
        // Dedup by the per-store order number (buyer orders come from the link).
        if (db.orderDao().countByRemoteId(o.order_no) > 0) return
        db.customerDao().insertIgnore(CustomerEntity(phone = o.buyer_phone, name = o.buyer_name))
        o.buyer_name?.takeIf { it.isNotBlank() }
            ?.let { db.customerDao().fillName(o.buyer_phone, it) }
        val localId = db.orderDao().insert(
            OrderEntity(
                remoteId = o.order_no,
                buyerPhone = o.buyer_phone,
                buyerName = o.buyer_name,
                status = o.status,
                payMethod = o.pay_method,
                totalPiasters = o.total_piasters,
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
                    pricePiasters = item.price_piasters,
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

