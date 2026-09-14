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
 *   of its blast radius: it reads products, it creates products, and it records
 *   what happened. It cannot delete, edit, or adjust stock.
 */

/** The products on this device, as the reconciler sees them. */
fun interface LegacyProductSource {
    suspend fun all(): List<ProductEntity>
}

/** Creating one product on the server, under a caller-chosen retry key. */
fun interface ProductCreating {
    suspend fun create(draft: ProductDraft, clientRequestId: String): ProductWriteDecision
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
