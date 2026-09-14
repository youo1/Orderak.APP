package app.orderak.seller.data.catalog

import app.orderak.seller.data.db.ProductDao
import javax.inject.Inject
import javax.inject.Singleton

/**
 * Post the stock edits the mirror era left behind.
 *
 * WHAT A `stockDirty` ROW IS
 *   Under the mirror, a seller editing stock set the number locally and raised a
 *   flag; the next push sent it with the revision it was decided against. After
 *   the cutover nothing sets that flag — a stock edit is a `PATCH` that succeeds
 *   or is refused — but a device upgrading into this build can still be carrying
 *   rows that were flagged and never pushed.
 *
 *   Those are real seller intent, held only on that device. This drains them
 *   through the route that owns stock now, so they are not silently dropped when
 *   the column is removed in a later release.
 *
 * WHY A 409 IS NOT A FAILURE HERE
 *   A stale revision means a buyer's order moved the stock first. The local
 *   value and the flag both stay exactly as they are, so nothing is lost and the
 *   conflict surfaces through the ordinary stock-conflict path the seller
 *   already has. This drain is not the place to decide whose number wins — it
 *   has no seller to ask.
 */
@Singleton
class StockDrain @Inject constructor(
    private val productDao: ProductDao,
    private val writes: ProductWriteRepository,
) {

    /**
     * Push every pending stock edit, and report whether the set is now empty.
     *
     * Returns true when nothing is left flagged. A false answer is not an error
     * in itself — it means a later pass should try again — but it does keep the
     * refresh from reporting a clean run it did not have.
     */
    suspend fun drain(): Boolean {
        var allSettled = true
        for (product in productDao.allOnce().filter { it.stockDirty }) {
            val code = product.productCode
            val expected = product.syncedStockVersion
            if (code.isNullOrBlank() || expected == null) {
                // Never synced, so there is no revision to compare against and no
                // code to address. The legacy reconciliation owns this row; it
                // creates the product, and its stock follows from there.
                allSettled = false
                continue
            }
            when (writes.adjustStock(code, product.stock, expected)) {
                is ProductWriteDecision.Store -> Unit
                // Both leave the flag up on purpose: the edit is still the
                // seller's and still unsent, and clearing it here would discard
                // a number nobody has seen the server accept.
                is ProductWriteDecision.StaleStock -> allSettled = false
                else -> allSettled = false
            }
        }
        return allSettled
    }
}
