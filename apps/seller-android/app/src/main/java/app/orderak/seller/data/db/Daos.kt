package app.orderak.seller.data.db

import app.orderak.seller.data.remote.ProductCodeDto
import androidx.room.Dao
import androidx.room.Insert
import androidx.room.OnConflictStrategy
import androidx.room.Query
import androidx.room.Transaction
import androidx.room.Upsert
import kotlinx.coroutines.flow.Flow

@Dao
interface ProductDao {
    @Query("SELECT * FROM products ORDER BY createdAt DESC")
    fun all(): Flow<List<ProductEntity>>

    /** Cheap existence/count for the dashboard (avoids collecting the full list). */
    @Query("SELECT COUNT(*) FROM products")
    fun count(): Flow<Int>

    @Query("SELECT * FROM products WHERE id = :id")
    suspend fun byId(id: Long): ProductEntity?

    @Upsert
    suspend fun upsert(product: ProductEntity): Long

    @Query("DELETE FROM products WHERE id = :id")
    suspend fun delete(id: Long)

    @Query("UPDATE products SET stock = stock - :qty, syncedStockVersion = CASE WHEN syncedStockVersion IS NULL THEN NULL ELSE syncedStockVersion + 1 END WHERE id = :id")
    suspend fun decrementStock(id: Long, qty: Int)

    @Query("UPDATE products SET stock = stock + :qty WHERE id = :id")
    suspend fun restoreStock(id: Long, qty: Int)

    @Query("SELECT * FROM products")
    suspend fun allOnce(): List<ProductEntity>

    /** The local row holding a given server product, if this device has one. */
    @Query("SELECT * FROM products WHERE remoteUuid = :uuid LIMIT 1")
    suspend fun byRemoteUuid(uuid: String): ProductEntity?

    @Query("SELECT * FROM products WHERE productCode = :code LIMIT 1")
    suspend fun byProductCode(code: String): ProductEntity?

    /**
     * Take the server's catalogue onto this device, establishing a baseline.
     *
     * Upsert rather than replace. A device can reach this point with rows of its
     * own — cleared preferences, an app upgrade that predates baselines — and
     * deleting those to adopt the server's view would be the same data loss this
     * whole change exists to stop, only pointed the other way. Anything local and
     * unknown to the server survives and is pushed as an addition.
     *
     * Which local row a server product belongs to is decided by identity, never
     * by row id. Each of these arrives with the server's uuid and public code
     * and no local id, and this looks the row up. It used to arrive with
     * `id = app_id`, which is the row id on whichever device first pushed the
     * product — so adopting another device's catalogue upserted straight over
     * this device's own row 1, 2, 3… and the products that lived there were
     * gone. Nothing matching means the product is new here, and [adoptedProduct]
     * gives it a fresh row rather than claiming an occupied one.
     */
    @Transaction
    suspend fun adoptServerCatalog(products: List<ProductEntity>) {
        for (product in products) {
            val local = product.remoteUuid?.let { byRemoteUuid(it) }
                ?: product.productCode?.let { byProductCode(it) }
            upsert(adoptedProduct(product, local))
        }
    }

    @Query("UPDATE products SET productCode=:code, remoteUuid=:uuid, stock=:stock, syncedStockVersion=:version, stockDirty=0 WHERE id=:id")
    suspend fun acceptSync(id: Long, code: String?, uuid: String?, stock: Int, version: Long)

    @Query("UPDATE products SET productCode=:code, remoteUuid=:uuid, syncedStockVersion=:version WHERE id=:id")
    suspend fun rebaseConflict(id: Long, code: String?, uuid: String?, version: Long)

    /** Persist the public R2 URL returned after uploading the local product image. */
    @Query("UPDATE products SET imageUrl = :url WHERE id = :id")
    suspend fun setImageUrl(id: Long, url: String?)

    /** Match a pulled order line back to a local product by its public code. */
    @Query("UPDATE products SET stock = stock - :qty WHERE productCode = :code")
    suspend fun decrementStockByCode(code: String, qty: Int)

    /** Resolve a local product id from its immutable public code (pulled orders). */
    @Query("SELECT id FROM products WHERE productCode = :code")
    suspend fun idByCode(code: String): Long?

    /**
     * Write back the identity the server assigned to each product just pushed.
     *
     * Keyed by `app_id`, which is safe here and nowhere else: the sync reply
     * answers about the rows this device sent and echoes the app_id each was
     * sent with, so the number is this device's own row id by construction. It
     * used to describe every product in the store, including ones created on
     * another phone under app_ids that collide with this phone's row ids — which
     * stamped another device's product code onto a local product.
     */
    @Transaction
    suspend fun applySync(codes: List<ProductCodeDto>, conflicts: Set<Long>) {
        for (item in codes) {
            if (item.app_id in conflicts) {
                rebaseConflict(item.app_id, item.product_code, item.remote_uuid, item.stock_version)
            } else {
                acceptSync(item.app_id, item.product_code, item.remote_uuid, item.stock, item.stock_version)
            }
        }
    }
}

@Dao
interface CategoryDao {
    @Query("SELECT * FROM categories ORDER BY sortOrder, name")
    fun all(): Flow<List<CategoryEntity>>

    @Query("SELECT * FROM categories")
    suspend fun allOnce(): List<CategoryEntity>

    @Upsert
    suspend fun upsert(category: CategoryEntity): Long

    @Insert
    suspend fun insertAll(categories: List<CategoryEntity>)

    @Query("UPDATE categories SET categoryCode = :code WHERE id = :id")
    suspend fun setCode(id: Long, code: String?)

    @Query("DELETE FROM categories WHERE id = :id")
    suspend fun delete(id: Long)

    @Query("DELETE FROM categories")
    suspend fun clear()

    /** Mirror the backend category list locally (source of truth = backend). */
    @Transaction
    suspend fun replaceAll(categories: List<CategoryEntity>) {
        clear()
        insertAll(categories)
    }
}

@Dao
interface OrderDao {
    @Query("SELECT * FROM orders ORDER BY createdAt DESC")
    fun all(): Flow<List<OrderEntity>>

    @Transaction
    @Query("SELECT * FROM orders WHERE id = :id")
    fun withItems(id: Long): Flow<OrderWithItems?>

    /** One order row, without its items — used when a caller needs remoteId. */
    @Query("SELECT * FROM orders WHERE id = :id")
    suspend fun byId(id: Long): OrderEntity?

    @Query("SELECT * FROM order_items WHERE orderId = :orderId")
    suspend fun itemsOf(orderId: Long): List<OrderItemEntity>

    @Query("SELECT * FROM orders WHERE buyerPhone = :phone ORDER BY createdAt DESC")
    fun byPhone(phone: String): Flow<List<OrderEntity>>

    @Insert suspend fun insert(order: OrderEntity): Long
    @Insert suspend fun insertItems(items: List<OrderItemEntity>)

    @Query("UPDATE orders SET status = :status WHERE id = :id")
    suspend fun updateStatus(id: Long, status: String)

    @Query("SELECT COUNT(*) FROM orders WHERE createdAt >= :since")
    fun countSince(since: Long): Flow<Int>

    @Query("SELECT COUNT(*) FROM orders WHERE status IN ('NEW','CONFIRMED')")
    fun countUnpaid(): Flow<Int>

    @Query("SELECT COUNT(*) FROM orders WHERE status = 'PAID'")
    fun countToShip(): Flow<Int>

    @Query("SELECT MAX(remoteId) FROM orders")
    suspend fun maxRemoteId(): Long?

    @Query("SELECT COUNT(*) FROM orders WHERE remoteId = :remoteId")
    suspend fun countByRemoteId(remoteId: Long): Int
}

@Dao
interface CustomerDao {
    @Insert(onConflict = OnConflictStrategy.IGNORE)
    suspend fun insertIgnore(customer: CustomerEntity)

    @Query("UPDATE customers SET name = :name WHERE phone = :phone AND (name IS NULL OR name = '')")
    suspend fun fillName(phone: String, name: String)

    @Query(
        """SELECT c.phone AS phone, c.name AS name,
                  COUNT(o.id) AS ordersCount,
                  COALESCE(SUM(o.totalMinor), 0) AS totalMinor
           FROM customers c
           LEFT JOIN orders o ON o.buyerPhone = c.phone AND o.status != 'CANCELLED'
           GROUP BY c.phone ORDER BY totalMinor DESC"""
    )
    fun summaries(): Flow<List<CustomerSummary>>

    @Query("SELECT * FROM customers WHERE phone = :phone")
    fun byPhone(phone: String): Flow<CustomerEntity?>
}

@Dao
interface PaymentDao {
    // Fix(#11): unique ref index makes dedup DB-enforced; IGNORE keeps insert safe
    @Insert(onConflict = OnConflictStrategy.IGNORE)
    suspend fun insert(payment: PaymentEntity)

    @Query("SELECT COUNT(*) FROM payments WHERE ref = :ref")
    suspend fun countByRef(ref: String): Int

    @Query("SELECT * FROM payments WHERE orderId = :orderId ORDER BY createdAt DESC")
    fun byOrder(orderId: Long): Flow<List<PaymentEntity>>
}
