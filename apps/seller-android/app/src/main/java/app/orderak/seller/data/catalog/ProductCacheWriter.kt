package app.orderak.seller.data.catalog

import androidx.room.withTransaction
import app.orderak.seller.data.db.OrderakDatabase
import app.orderak.seller.data.db.ProductEntity
import app.orderak.seller.data.remote.RemoteProductDto
import javax.inject.Inject
import javax.inject.Singleton

/**
 * The only place a product row is written.
 *
 * WHY THIS FILE EXISTS AT ALL
 *   Room is a cache of what D1 holds. That is easy to say and easy to stop being
 *   true: one `productDao().upsert(entity)` in a view model, six months from now,
 *   written by someone reasonably assuming the local database is where products
 *   live, and the app is quietly treating a device as authoritative again.
 *
 *   Putting every write behind one small file makes that a reviewable event
 *   rather than a line in a diff, and gives the build-time guard something exact
 *   to enforce: `verify-cache-write-boundary.mjs` forbids the mutating product
 *   DAO calls anywhere except here.
 *
 * WHAT THE GUARD CANNOT SEE, AND THIS FILE THEREFORE MUST
 *   A guard can prove that only this file writes. It cannot prove that what this
 *   file writes came from the server, because `put(serverResponse.toEntity())`
 *   and `put(someLocalGuess)` are the same shape to any text scan. That is the
 *   value question, and it is answered by the parameter types here: every entry
 *   point takes a [RemoteProductDto] — a wire type, which only a response can
 *   produce. There is deliberately no entry point that takes a caller-built
 *   [ProductEntity].
 */
@Singleton
class ProductCacheWriter @Inject constructor(
    private val db: OrderakDatabase,
) {

    /**
     * Record one product exactly as the server just described it.
     *
     * Matched on `product_code`, which is the server's identity for the product
     * and stable for its whole life. The local row id is preserved when one
     * already exists, because `order_items` still references it — a create that
     * replaced the row would strand any unsent order naming that product.
     */
    suspend fun put(remote: RemoteProductDto): ProductEntity = db.withTransaction {
        val existing = db.productDao().byProductCode(remote.product_code)
        val merged = existing.merge(remote)
        val id = db.productDao().upsert(merged)
        // Returned rather than re-read: the caller almost always wants the row it
        // just wrote, and an id alone makes every caller do this lookup itself.
        merged.copy(id = if (merged.id == 0L) id else merged.id)
    }

    /**
     * Replace the whole cache with the server's catalogue.
     *
     * One transaction, not delete-all-then-insert-each: a crash halfway through
     * the second form leaves a seller looking at a partial catalogue with no
     * indication that is what they are seeing. Rows the server did not send are
     * removed, because this is the server stating the complete set — which is
     * safe here for the reason it was never safe in the mirror: the server is
     * saying it, not a device.
     */
    suspend fun replaceAll(remote: List<RemoteProductDto>) = db.withTransaction {
        val keep = remote.map { it.product_code }.toSet()
        db.productDao().allOnce()
            .filter { it.productCode == null || it.productCode !in keep }
            .forEach { db.productDao().delete(it.id) }
        remote.forEach { put(it) }
    }

    /** Forget one product, after the server has confirmed it is gone. */
    suspend fun remove(productCode: String) = db.withTransaction {
        db.productDao().byProductCode(productCode)?.let { db.productDao().delete(it.id) }
    }

    /**
     * Forget a product the server never knew about.
     *
     * The one deletion not preceded by a server confirmation, and it is not an
     * exception to the rule: a row with no `productCode` was never accepted by
     * the server, so there is nothing to confirm and this device holds the only
     * copy. Removing it is exactly what the seller asked for.
     *
     * Every other deletion goes through [remove] after the server has agreed.
     */
    suspend fun removeNeverSynced(localId: Long) = db.withTransaction {
        val row = db.productDao().byId(localId)
        if (row != null && row.productCode.isNullOrBlank()) db.productDao().delete(localId)
    }

    /** Record the public URL an uploaded image landed on. */
    suspend fun setImageUrl(localId: Long, url: String?) = db.productDao().setImageUrl(localId, url)

    /**
     * Fold a server product onto the local row, keeping only what is local.
     *
     * `id`, `imagePath` and `categoryId` are the three fields the server has no
     * opinion about: Room's own key, a file on this device, and a local foreign
     * key whose public counterpart `categoryCode` is what actually travels. Every
     * other value comes from the response, including stock — a cache that kept
     * its own idea of stock would be asserting inventory, which is the whole
     * thing this migration removes.
     */
    private fun ProductEntity?.merge(remote: RemoteProductDto): ProductEntity = ProductEntity(
        id = this?.id ?: 0L,
        name = remote.name,
        description = remote.description,
        priceMinor = remote.price.amount_minor,
        currency = remote.price.currency,
        stock = remote.stock,
        discountType = remote.discount_type,
        discountValue = remote.discount_value?.toDouble(),
        imagePath = this?.imagePath,
        imageUrl = remote.image_url,
        available = remote.available,
        productCode = remote.product_code,
        remoteUuid = remote.remote_uuid,
        syncedStockVersion = remote.stock_version,
        stockDirty = false,
        categoryId = this?.categoryId,
        categoryCode = remote.category_code,
        createdAt = this?.createdAt ?: System.currentTimeMillis(),
    )
}
