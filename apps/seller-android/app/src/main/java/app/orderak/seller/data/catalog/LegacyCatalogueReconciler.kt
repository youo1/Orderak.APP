package app.orderak.seller.data.catalog

import app.orderak.seller.data.db.ProductEntity
import app.orderak.seller.data.remote.RemoteProductDto
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
 * A product that exists on this phone and has not reached the server, as a
 * screen needs to show it.
 *
 * [localId] is Room's row id rather than a product code, deliberately: a row in
 * this state has no code — that is precisely what makes it stuck — so the id is
 * the only handle a discard can be addressed by.
 *
 * [lastError] is null before the first attempt and after a transport failure
 * that produced no server answer. A null reason is not "no problem"; it is "the
 * request never got far enough to be told one", which is why the screen phrases
 * it as waiting rather than refused.
 */
data class StuckLegacyProduct(
    val localId: Long,
    val name: String,
    val lastError: String?,
)

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
    private val orderLines: OrderLineStamping,
    private val stockSeeding: LegacyProductStockSeeding,
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

    /**
     * Rows still waiting, so a screen can show the seller what is holding.
     *
     * Carries the last error alongside the name because the seller's decision
     * needs both: "this product is stuck" is not something anyone can act on,
     * and the reason is the only part that distinguishes "wait for signal" from
     * "this will never send".
     */
    suspend fun pending(): List<StuckLegacyProduct> {
        val records = store.all()
        return products.all()
            .filter(::isLegacy)
            .filter { records[it.id]?.state != LegacyReconcileState.CONVERTED }
            .filter { records[it.id]?.state != LegacyReconcileState.REFUSED }
            .map { StuckLegacyProduct(it.id, it.name, records[it.id]?.lastError) }
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
        return when (val decision = writes.create(draft, key)) {
            is ProductWriteDecision.Store -> {
                // The moment this product acquires an identity is the only moment
                // its unsent orders can be given one. The catalogue refresh runs
                // next and deletes rows without a code — including the row these
                // lines point at — so a line left unstamped here can never be
                // resolved again.
                orderLines.stamp(product.id, decision.product.product_code)
                // Same urgency as the order-line stamp above, and for the same
                // reason: the create response is the only moment this device
                // knows both the new product_code and the stock it needs to
                // carry across. Miss it here and the next catalogue refresh
                // deletes the local row this device's real count lived on.
                if (seedStock(product.stock, decision.product)) {
                    LegacyAttempt.CONVERTED
                } else {
                    LegacyAttempt.RETRY
                }
            }
            // The server's opinion is unknown, so nothing has been ruled out.
            is ProductWriteDecision.Unreachable -> LegacyAttempt.RETRY
            // Cannot arise from a create, and is not a reason to give up on one.
            is ProductWriteDecision.StaleStock -> LegacyAttempt.RETRY
            is ProductWriteDecision.Deleted -> LegacyAttempt.RETRY
            is ProductWriteDecision.Refused -> LegacyAttempt.TERMINAL
        }
    }

    /**
     * Push this device's real stock onto a product the create call above just
     * made, and report whether the server now holds a real figure — which is
     * not the same question as whether this specific push succeeded.
     *
     * Nothing to push is success: the server already defaults a fresh product's
     * stock to zero, so a legacy row with none needs no call, and treating zero
     * as "done" is what keeps a re-attempt after some other step's failure from
     * re-sending a push that already landed.
     *
     * A version mismatch ([ProductWriteDecision.StaleStock]) also counts as
     * done, never as a reason to retry — the create response's version is only
     * ever stale here because *some* write already reached this product since
     * it was made: an earlier attempt's push whose response this device never
     * saw, or a buyer's order. Either way a real, server-authoritative number is
     * now in place, which is what this exists to guarantee. Retrying it with a
     * newer version would risk clobbering exactly that write — the same reason
     * [ProductWriteRepository.adjustStock] never retries a stale write itself.
     *
     * A refusal is likewise not retried: the server has considered the number
     * this device holds and rejected it (a validation rule this call cannot
     * satisfy by asking again), which is a reason to let the seller notice a
     * wrong-looking stock figure post-conversion, not a reason to leave the
     * product itself unconverted forever.
     *
     * Only [ProductWriteDecision.Unreachable] is a real retry: the server's
     * opinion of this specific push is unknown, and the create call it follows
     * is safe to repeat under the same idempotency key regardless.
     */
    private suspend fun seedStock(localStock: Int, created: RemoteProductDto): Boolean {
        if (localStock <= 0) return true
        return when (stockSeeding.seedStock(created.product_code, localStock, created.stock_version)) {
            is ProductWriteDecision.Unreachable -> false
            is ProductWriteDecision.Store,
            is ProductWriteDecision.StaleStock,
            is ProductWriteDecision.Refused,
            is ProductWriteDecision.Deleted,
            -> true
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
