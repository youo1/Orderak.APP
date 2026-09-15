package app.orderak.seller.data.catalog

import app.orderak.seller.data.remote.ProductWriteRes
import app.orderak.seller.data.remote.RemoteProductDto

/**
 * What one product write's answer means, and whether anything may be stored.
 *
 * WHY THIS IS A TYPE AND NOT AN `if` INSIDE THE REPOSITORY
 *   Because the Class A invariant is a claim about every branch at once:
 *
 *       network failure
 *         -> the operation fails, visibly
 *         -> the local database is unchanged
 *         -> NO pending mutation is created anywhere
 *
 *   Written as branches inside a suspend function that also holds the cache, the
 *   invariant is a property of whoever read the code last. Written as a value,
 *   it is checkable: exactly one variant carries a product, so exactly one
 *   branch can reach the cache, and a test can enumerate the rest and assert
 *   none of them does. [ProductWriteRepository] has one line that stores, and it
 *   is only reachable from [Store].
 *
 * WHY A TRANSPORT FAILURE IS NOT A REFUSAL
 *   `BackendApi` reports `network`, `bad_response` and `http_5xx` when the
 *   request never got an answer. In all three the server's opinion is unknown,
 *   so telling a seller their product was rejected would be inventing a verdict
 *   nobody gave. They are [Unreachable], which says only that it did not go
 *   through.
 *
 *   A create in that state may in fact have committed on the server. That is
 *   precisely why a create carries a `client_request_id` and a retry resolves to
 *   the same product rather than a second one.
 */
sealed interface ProductWriteDecision {

    /**
     * The server accepted it and sent back what it now holds. This is the only
     * variant that carries a product, and therefore the only one that may be
     * written to the cache.
     */
    data class Store(val product: RemoteProductDto) : ProductWriteDecision

    /** The server accepted a deletion. The product is gone from both sides. */
    data class Deleted(val productCode: String) : ProductWriteDecision

    /** The request never got an answer. Nothing is known and nothing changes. */
    data object Unreachable : ProductWriteDecision

    /**
     * A stock edit was decided against a revision that is no longer current.
     *
     * Carries the authoritative pair so the seller can be shown both numbers
     * without another request. It is deliberately not retried with
     * [serverStockVersion]: doing that automatically is last-write-wins wearing
     * a different name, and it would erase the decrement a buyer's order had
     * just made. A person decides which number is right.
     */
    data class StaleStock(
        val serverStock: Int,
        val serverStockVersion: Long,
    ) : ProductWriteDecision

    /** The server considered it and said no. [code] decides what the seller reads. */
    data class Refused(val code: String?) : ProductWriteDecision
}

/**
 * Codes that mean the request never got an answer, rather than being refused.
 *
 * See `BackendApi.apiCall` for where each is produced.
 */
private val TRANSPORT_FAILURES = setOf(
    "network", "bad_response",
    "http_500", "http_502", "http_503", "http_504",
)

private const val STALE_STOCK = "stale_stock"

/**
 * Read one product write's answer.
 *
 * `ok` alone is not enough to store: a response that claims success without a
 * product is not a description of anything, and writing a half-decoded body into
 * the cache would put a product in front of the seller that the server never
 * described. Both must be present.
 */
fun decideProductWrite(res: ProductWriteRes): ProductWriteDecision {
    val product = res.product
    if (res.ok && product != null) return ProductWriteDecision.Store(product)
    if (res.error in TRANSPORT_FAILURES) return ProductWriteDecision.Unreachable
    if (res.error == STALE_STOCK && res.stock != null && res.stock_version != null) {
        return ProductWriteDecision.StaleStock(res.stock, res.stock_version)
    }
    return ProductWriteDecision.Refused(res.error)
}
