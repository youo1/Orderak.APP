package app.orderak.seller.data.db

import androidx.compose.runtime.Immutable
import androidx.room.Embedded
import androidx.room.ColumnInfo
import androidx.room.Entity
import androidx.room.PrimaryKey
import androidx.room.Relation

// Money = an amount in the currency's minor units, plus the currency (ADR-009).
// The minor unit is not always a hundredth: KWD, BHD and OMR use 1000.

@Entity(
    tableName = "products",
    // all() sorts by createdAt DESC on the products list + dashboard.
    indices = [androidx.room.Index(value = ["createdAt"])]
)
@Immutable
data class ProductEntity(
    @PrimaryKey(autoGenerate = true) val id: Long = 0,
    val name: String,
    val description: String? = null,
    val priceMinor: Long,
    val currency: String = "EGP",
    val stock: Int,
    val discountType: String? = null, // "PERCENTAGE", "AMOUNT", or null
    val discountValue: Double? = null,
    val imagePath: String? = null,
    // Public R2 URL returned by /api/v1/media/upload. Sent to the backend as
    // image_url so catalog pages embed a real image (imagePath is a local,
    // app-private file path that only exists on this device). Null until the
    // local image has been uploaded; reset to null when the image changes.
    val imageUrl: String? = null,
    val available: Boolean = true,
    // Immutable public code + server UUID assigned on first sync (for share links).
    val productCode: String? = null,
    val remoteUuid: String? = null,
    // Optimistic stock revision returned by the backend. Only explicit local
    // stock edits are pushed; ordinary mirror syncs cannot overwrite orders.
    val syncedStockVersion: Long? = null,
    @ColumnInfo(defaultValue = "0") val stockDirty: Boolean = false,
    // Optional category: local FK (categories.id) + the server category_code.
    val categoryId: Long? = null,
    val categoryCode: String? = null,
    val createdAt: Long = System.currentTimeMillis()
)

@Entity(tableName = "categories")
@Immutable
data class CategoryEntity(
    @PrimaryKey(autoGenerate = true) val id: Long = 0,
    val name: String,
    val categoryCode: String? = null, // immutable public code from backend (c-XXXXXX)
    val slug: String? = null,
    val sortOrder: Int = 0,
    val createdAt: Long = System.currentTimeMillis()
)

@Entity(tableName = "customers")
@Immutable
data class CustomerEntity(
    @PrimaryKey val phone: String,
    val name: String? = null,
    val createdAt: Long = System.currentTimeMillis()
)

@Entity(
    tableName = "orders",
    indices = [
        androidx.room.Index(value = ["remoteId"], unique = true),
        androidx.room.Index(value = ["buyerPhone"]),
        // Orders list + byPhone sort by createdAt DESC; dashboard countSince
        // filters createdAt >= ; the count-by-status flows filter on status.
        androidx.room.Index(value = ["createdAt"]),
        androidx.room.Index(value = ["status"])
    ]
)
@Immutable
data class OrderEntity(
    @PrimaryKey(autoGenerate = true) val id: Long = 0,
    val remoteId: Long? = null,       // معرف الأوردر على الباك اند (طلبات المشترين من اللينك)
    val buyerPhone: String,
    val buyerName: String? = null,
    val status: String,             // OrderStatus.name
    val payMethod: String,          // PayMethod.name
    val totalMinor: Long,
    val currency: String = "EGP",
    val note: String? = null,
    val createdAt: Long = System.currentTimeMillis()
)

@Entity(
    tableName = "order_items",
    indices = [androidx.room.Index(value = ["orderId"])]
)
@Immutable
data class OrderItemEntity(
    @PrimaryKey(autoGenerate = true) val id: Long = 0,
    val orderId: Long,
    val productId: Long,
    val productName: String,        // denormalized: order history survives product edits
    val qty: Int,
    val priceMinor: Long
)

@Entity(tableName = "payments", indices = [androidx.room.Index(value = ["ref"], unique = true)])
@Immutable
data class PaymentEntity(
    @PrimaryKey(autoGenerate = true) val id: Long = 0,
    val orderId: Long,
    val ref: String,
    val amountMinor: Long,
    val currency: String = "EGP",
    val verified: Boolean,
    val proofPath: String? = null,
    val createdAt: Long = System.currentTimeMillis()
)

@Immutable
data class OrderWithItems(
    @Embedded val order: OrderEntity,
    @Relation(parentColumn = "id", entityColumn = "orderId")
    val items: List<OrderItemEntity>
)

@Immutable
data class CustomerSummary(
    val phone: String,
    val name: String?,
    val ordersCount: Int,
    val totalMinor: Long
)

