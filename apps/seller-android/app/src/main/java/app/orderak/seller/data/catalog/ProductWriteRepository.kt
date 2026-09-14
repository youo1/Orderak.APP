package app.orderak.seller.data.catalog

import app.orderak.seller.data.remote.BackendApi
import app.orderak.seller.data.remote.MoneyDto
import app.orderak.seller.data.remote.ProductWriteRes
import app.orderak.seller.data.remote.ProductWriteReq
import app.orderak.seller.data.remote.StockAdjustReq
import app.orderak.seller.data.session.SessionStore
import kotlinx.coroutines.flow.first
import java.util.UUID
import javax.inject.Inject
import javax.inject.Singleton

/**
 * A product as a screen describes it, before the server has an opinion.
 *
 * Carries no identity and no stock. The product is named by its code at the call
 * site, and stock moves through a buyer's order or [ProductWriteRepository
 * .adjustStock] — never through a metadata write that happens to hold a number.
 */
data class ProductDraft(
    val name: String,
    val description: String? = null,
    val priceMinor: Long,
    val currency: String,
    val available: Boolean = true,
    val imageUrl: String? = null,
    val categoryCode: String? = null,
    val discountType: String? = null,
    val discountValue: Long? = null,
) {
    internal fun toRequest(clientRequestId: String?) = ProductWriteReq(
        name = name,
        description = description,
        price = MoneyDto(priceMinor, currency),
        available = available,
        image_url = imageUrl,
        category_code = categoryCode,
        discount_type = discountType,
        discount_value = discountValue,
        client_request_id = clientRequestId,
    )
}

/**
 * Product writes, which reach the server or do not happen.
 *
 * CLASS A: THE INVARIANT THIS FILE EXISTS TO HOLD
 *
 *     network failure
 *       -> the operation fails, visibly
 *       -> the local database is unchanged
 *       -> NO pending mutation is created anywhere
 *
 * There is no offline queue here and there must never be one. A product edit
 * that fails can be retyped in ten seconds; that is the whole reason products
 * are Class A and order creation is not. An offline write queued here would need
 * a conflict rule on replay, and three such rules is a merge engine with extra
 * steps — the thing ADR-012 exists to avoid.
 *
 * Every path to the cache runs through [ProductCacheWriter], and only ever with
 * a value the server sent back.
 */
@Singleton
class ProductWriteRepository @Inject constructor(
    private val api: BackendApi,
    private val sessionStore: SessionStore,
    private val cache: ProductCacheWriter,
) {

    /**
     * Create one product.
     *
     * [clientRequestId] is generated here, and **a caller that retries must pass
     * the same one back**. That is the difference between a lost response costing
     * nothing and costing a duplicate product: the server resolves a repeated id
     * to the product it already made rather than making a second.
     */
    suspend fun create(
        draft: ProductDraft,
        clientRequestId: String = UUID.randomUUID().toString(),
    ): ProductWriteDecision = write { phone, secret ->
        api.createProduct(phone, secret, draft.toRequest(clientRequestId))
    }

    /** Replace one product's metadata. A field the draft leaves null is cleared. */
    suspend fun update(productCode: String, draft: ProductDraft): ProductWriteDecision =
        write { phone, secret -> api.updateProduct(phone, secret, productCode, draft.toRequest(null)) }

    /**
     * Set a product's stock against the revision it was decided on.
     *
     * A mismatch is [ProductWriteDecision.StaleStock] and writes nothing. It is
     * never retried here with the revision the server returned — that is
     * last-write-wins wearing a different name, and it would erase the decrement
     * a buyer's order had just made. The seller decides which number is right.
     */
    suspend fun adjustStock(
        productCode: String,
        stock: Int,
        expectedStockVersion: Long,
    ): ProductWriteDecision = write { phone, secret ->
        api.adjustProductStock(phone, secret, productCode, StockAdjustReq(stock, expectedStockVersion))
    }

    /** Remove one product, and forget it locally only once the server has. */
    suspend fun delete(productCode: String): ProductWriteDecision {
        val (phone, secret) = credentials() ?: return ProductWriteDecision.Unreachable
        val res = api.deleteProduct(phone, secret, productCode)
        if (!res.ok) return decideProductWrite(ProductWriteRes(ok = false, error = res.error))
        cache.remove(productCode)
        return ProductWriteDecision.Deleted(productCode)
    }

    /**
     * One shape for every write that answers with a product.
     *
     * The cache is touched on exactly one line, inside the one branch that has a
     * product to store. Every other decision returns without writing, which is
     * what makes the Class A invariant a property of this function rather than
     * of each caller remembering it.
     */
    private suspend fun write(
        call: suspend (phone: String, secret: String) -> ProductWriteRes,
    ): ProductWriteDecision {
        val (phone, secret) = credentials() ?: return ProductWriteDecision.Unreachable
        return when (val decision = decideProductWrite(call(phone, secret))) {
            is ProductWriteDecision.Store -> decision.also { cache.put(it.product) }
            else -> decision
        }
    }

    private suspend fun credentials(): Pair<String, String>? {
        val phone = sessionStore.phone.first() ?: return null
        return phone to sessionStore.getOrCreateSecret()
    }
}
