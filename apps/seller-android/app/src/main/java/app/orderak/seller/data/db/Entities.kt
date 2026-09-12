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
    /**
     * No default. A defaulted currency is how a row acquires one nobody chose:
     * every construction site that omitted it wrote "EGP" over whatever the
     * amount beside it actually was, and the compiler had nothing to say. Money
     * is an amount plus a currency (ADR-009) and this is the half that was
     * optional.
     */
    val currency: String,
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

/**
 * A customer the seller can edit, rather than a shape derived from orders.
 *
 * The primary key is [customerKey], not [phone]. The phone a buyer types is not
 * normalised anywhere it is captured — the storefront strips it to digits, the
 * manual-order screen takes eleven digits and no country — so `01012345678` and
 * `+201012345678` are one person and two strings. Keying on the raw value would
 * inherit that split permanently (I-6). The key is the canonically normalised
 * number when the value resolved, and the raw value itself when it did not, so
 * an unresolvable customer keys only to itself and can never be merged with
 * someone else by accident.
 *
 * [phone] is kept beside the key rather than replaced by it: it is what the
 * order carries, what the seller recognises, and what the server's own raw
 * column holds.
 */
@Entity(tableName = "customers")
@Immutable
data class CustomerEntity(
    @PrimaryKey val customerKey: String,
    /** Exactly what was entered on the order. Never rewritten. */
    val phone: String,
    /** Present only when the number resolved; null records that it did not. */
    val phoneE164: String? = null,
    /** "valid" | "ambiguous" | "invalid" — anything but valid is unmergeable. */
    val phoneStatus: String = "valid",
    val name: String? = null,
    val altContact: String? = null,
    val note: String? = null,
    val createdAt: Long = System.currentTimeMillis(),
    val updatedAt: Long = System.currentTimeMillis(),
    /**
     * Set when the device has an edit the server has not acknowledged.
     *
     * The editor writes locally first so a seller at a stall with no signal can
     * still correct a name. Sync posts every dirty row and clears the flag on
     * acknowledgement; until then the local value is the one displayed, because
     * showing the seller their own unsaved edit reverted is worse than showing
     * it unsynced.
     */
    val dirty: Boolean = false
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
    val currency: String,
    val note: String? = null,
    /**
     * The key this order is posted under, stable across every retry.
     *
     * Set when the seller records the order and never changed, so a retry after
     * a dropped response returns the order already written instead of creating a
     * second one. Null for orders pulled from the server: those were created
     * elsewhere and are already on the account.
     *
     * There is no separate sync-state column. `remoteId` already answers the
     * only question anyone asks — is this order on the account — and a second
     * field meaning the same thing is a second field to keep in step.
     */
    val idempotencyKey: String? = null,
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
    val currency: String,
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
    /** The identity, and what navigation carries. See [CustomerEntity]. */
    val customerKey: String,
    /** What the seller recognises, and what the order rows join on. */
    val phone: String,
    val name: String?,
    val ordersCount: Int,
    val totalMinor: Long,
    /**
     * How many distinct currencies the summed orders were in.
     *
     * 0 for a customer with no orders, 1 for the ordinary case, more than 1 when
     * [totalMinor] is a sum of unlike things and must not be shown as a total.
     */
    val currencyCount: Int,
    /** The currency of those orders when there is exactly one; null with none. */
    val currency: String?
)

