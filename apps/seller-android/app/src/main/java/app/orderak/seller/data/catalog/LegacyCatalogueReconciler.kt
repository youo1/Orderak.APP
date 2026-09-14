package app.orderak.seller.data.catalog

import app.orderak.seller.data.db.ProductEntity
import java.util.UUID
import javax.inject.Inject
import javax.inject.Singleton

/**
 * How one legacy row's attempt ended, and therefore whether it may be retried.
 *
 * A failure is only terminal when the server has told us something about this
 * product that will not change by asking again. Everything else stays `UNSENT`,
 * because the alternative — deciding on the device that a product is
 * unrecoverable — is how a transient outage becomes data loss.
 */
internal enum class LegacyAttempt { CONVERTED, RETRY, TERMINAL }

/**
 * Convert products that predate the product routes into server records.
 *
 * WHY THIS JOB EXISTS
 *   Before the cutover a product lived on the device until a mirror push gave it
 *   a `productCode` and a `remoteUuid`. A row that never got one exists nowhere
 *   else: not on the server, not on another device, and not in any backup. The
 *   cutover removes the mirror, so this is the only remaining path from that
 *   state to a server record — and it has to run before the cache is replaced
 *   with the server's catalogue, or those products are overwritten by a list
 *   that never contained them.
 *
 * THE TRAP THIS JOB IS BUILT AROUND
 *   `remoteUuid == null` does NOT mean the server never saw the row.
 *
 *   The mirror wrote `productCode` and `remoteUuid` together, and only *after*
 *   the response came back; `RetryInterceptor` deliberately never replayed a
 *   mirror push. So "committed server-side, response lost" leaves a row that
 *   looks legacy forever. A blind create would make a duplicate of a product the
 *   seller already has, and the `count(UNSENT) == 0` gate would cheerfully
 *   retry it on every launch.
 *
 *   That is why every row gets an idempotency key the first time it is queued
 *   and reuses it on every attempt. The server resolves a repeated key to the
 *   product it already created. The key is stored, not generated per attempt —
 *   a key regenerated each time would be no key at all.
 *
 * THE RULE THIS JOB IS GATED BY
 *
 *       after the job:  count(state == UNSENT) == 0
 *
 *   Not "we tried everything once". Every legacy row ends converted, or ends
 *   explicitly discarded by the seller. Anything else means the job has not
 *   finished, and [ProductCacheWriter.replaceAll] must not run.
 */
@Singleton
class LegacyCatalogueReconciler @Inject constructor(
    private val products: LegacyProductSource,
    private val writes: ProductCreating,
    private val store: LegacyReconcileRecords,
) {

    /**
     * Push every unconverted legacy row, and report whether any remain.
     *
     * Returns true when nothing is left in `UNSENT` — which is the condition the
     * catalogue refresh is allowed to proceed on, and nothing weaker.
     */
    suspend fun reconcile(): Boolean {
        for (product in products.all().filter(::isLegacy)) {
            val existing = store.record(product.id)
            if (existing?.state == LegacyReconcileState.CONVERTED) continue
            if (existing?.state == LegacyReconcileState.REFUSED) continue

            val key = existing?.idempotencyKey ?: UUID.randomUUID().toString()
            // Recorded BEFORE the attempt. A process death between the request
            // and the response must not lose the key the request was made with,
            // or the retry becomes a duplicate — which is the exact failure this
            // whole mechanism exists to prevent.
            if (existing == null) {
                store.put(product.id, LegacyReconcileRecord(key, LegacyReconcileState.UNSENT))
            }

            when (val attempt = attempt(product, key)) {
                LegacyAttempt.CONVERTED ->
                    store.put(product.id, LegacyReconcileRecord(key, LegacyReconcileState.CONVERTED))
                LegacyAttempt.RETRY, LegacyAttempt.TERMINAL ->
                    store.put(
                        product.id,
                        LegacyReconcileRecord(
                            idempotencyKey = key,
                            // A terminal failure still stays UNSENT. The state
                            // machine has no transition a device can make on its
                            // own into REFUSED: only a seller, shown the product
                            // and the reason, can discard it. See [discard].
                            state = LegacyReconcileState.UNSENT,
                            lastError = attempt.name,
                        ),
                    )
            }
        }
        return store.unsentCount() == 0
    }

    /**
     * The seller has been shown a product that cannot be converted, and has said
     * to let it go.
     *
     * The only transition into `REFUSED`, and deliberately not reachable from
     * [reconcile]. "Permanently unconvertible" is not a judgement a device can
     * make from a failed request: a 409 on the plan limit clears when they
     * upgrade, a 5xx clears on its own, and a validation error may be fixable by
     * editing the product. What cannot be undone is deciding on their behalf
     * that a product they created is gone.
     */
    suspend fun discard(localId: Long) {
        val existing = store.record(localId) ?: return
        store.put(localId, existing.copy(state = LegacyReconcileState.REFUSED))
    }

    /** Rows still waiting, so a screen can show the seller what is holding. */
    suspend fun pending(): List<ProductEntity> {
        val records = store.all()
        return products.all()
            .filter(::isLegacy)
            .filter { records[it.id]?.state != LegacyReconcileState.CONVERTED }
            .filter { records[it.id]?.state != LegacyReconcileState.REFUSED }
    }

    private suspend fun attempt(product: ProductEntity, key: String): LegacyAttempt {
        val draft = ProductDraft(
            name = product.name,
            description = product.description,
            priceMinor = product.priceMinor,
            currency = product.currency,
            available = product.available,
            // Only a public URL, never `imagePath`: that is a file on this device
            // and would render as a broken image on the storefront. A product
            // whose image has not been uploaded yet converts without one and the
            // seller can re-attach it; the product itself is what matters here.
            imageUrl = product.imageUrl,
            categoryCode = product.categoryCode,
        )
        return when (writes.create(draft, key)) {
            is ProductWriteDecision.Store -> LegacyAttempt.CONVERTED
            // The server's opinion is unknown, so nothing has been ruled out.
            is ProductWriteDecision.Unreachable -> LegacyAttempt.RETRY
            // Cannot arise from a create, and is not a reason to give up on one.
            is ProductWriteDecision.StaleStock -> LegacyAttempt.RETRY
            is ProductWriteDecision.Deleted -> LegacyAttempt.RETRY
            is ProductWriteDecision.Refused -> LegacyAttempt.TERMINAL
        }
    }

    /**
     * A row the server has never acknowledged.
     *
     * `productCode` is the test rather than `remoteUuid`, because the code is
     * what every route now addresses a product by. The two were always written
     * together, so this is the same set — named after the identity that survives
     * the migration rather than the one that does not.
     */
    private fun isLegacy(product: ProductEntity): Boolean = product.productCode.isNullOrBlank()
}
