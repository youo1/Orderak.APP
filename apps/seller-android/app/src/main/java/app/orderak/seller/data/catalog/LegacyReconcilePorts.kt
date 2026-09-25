package app.orderak.seller.data.catalog

import app.orderak.seller.data.db.ProductEntity

/**
 * The three things [LegacyCatalogueReconciler] needs from outside itself.
 *
 * WHY THESE EXIST
 *   The reconciliation is the one job in this migration that can lose a seller's
 *   products. It runs once, on a device holding rows that exist nowhere else,
 *   and every decision it makes is irreversible in the direction that matters:
 *   a duplicate is visible and deletable, but a row it skips and then lets the
 *   catalogue refresh overwrite is gone.
 *
 *   Code like that has to be testable, and it was not. Its collaborators were
 *   three concrete classes — a Room DAO with fifteen methods, a DataStore that
 *   needs an Android `Context`, and a repository that needs an HTTP client — so
 *   the loop could only be exercised on a device, which is precisely where
 *   nobody exercises the legacy path because a fresh install has no legacy rows.
 *
 *   These are the narrowest interfaces that make it a unit. Each names exactly
 *   what the reconciler uses and nothing more, which is also a readable summary
 *   of its blast radius: it reads products, it creates products, it records
 *   what happened, and it may give a product it just created the stock this
 *   device actually holds. It cannot delete or edit an existing product, and it
 *   cannot adjust the stock of one it did not itself just create.
 */

/** The products on this device, as the reconciler sees them. */
fun interface LegacyProductSource {
    suspend fun all(): List<ProductEntity>
}

/**
 * Stamping a converted product's new code onto the order lines that name it.
 *
 * Narrow on purpose: the reconciliation may fill a code in where there is none,
 * and nothing else. It cannot change a line, a quantity or a price.
 */
fun interface OrderLineStamping {
    suspend fun stamp(localProductId: Long, productCode: String)
}

/** Creating one product on the server, under a caller-chosen retry key. */
fun interface ProductCreating {
    suspend fun create(draft: ProductDraft, clientRequestId: String): ProductWriteDecision
}

/**
 * Giving a just-created product the stock this device actually holds.
 *
 * `POST /api/v1/products` has no stock field, so a legacy row's real remaining
 * stock cannot travel with the create request that converts it — the server
 * defaults a newly created product's stock to zero. This is the one narrow
 * exception to "cannot adjust stock" above: it is not a general stock edit, it
 * is completing a creation the create endpoint cannot carry all the way by
 * itself, and it is CAS-checked against the version the create response just
 * returned — a mismatch means the number has already moved (a concurrent
 * order, or an earlier attempt's push that this is only retrying because its
 * own response was lost), never that this push corrupted something.
 */
fun interface LegacyProductStockSeeding {
    suspend fun seedStock(productCode: String, stock: Int, expectedStockVersion: Long): ProductWriteDecision
}

/**
 * Durable per-row state for the reconciliation.
 *
 * Deliberately not a general key-value store: `unsentCount` is here because the
 * gate is a count over rows rather than a flag, and a caller that had to compute
 * it from [all] could compute it differently.
 */
interface LegacyReconcileRecords {
    suspend fun all(): Map<Long, LegacyReconcileRecord>
    suspend fun record(localId: Long): LegacyReconcileRecord?
    suspend fun put(localId: Long, record: LegacyReconcileRecord)
    suspend fun unsentCount(): Int
}
