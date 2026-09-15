package app.orderak.seller.data.catalog

import app.orderak.seller.data.remote.MoneyDto
import app.orderak.seller.data.remote.ProductWriteRes
import app.orderak.seller.data.remote.RemoteProductDto
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * The Class A invariant, checked rather than described.
 *
 *     network failure
 *       -> the operation fails, visibly
 *       -> the local database is unchanged
 *       -> NO pending mutation is created anywhere
 *
 * `ProductWriteRepository` has exactly one line that writes the cache, and it is
 * reachable only from [ProductWriteDecision.Store]. So the invariant reduces to
 * a claim about this function: no answer other than an accepted one carries a
 * product. That is what the sweep at the bottom asserts, over every failure
 * shape the transport and the server can produce.
 *
 * The defect this is aimed at is not a dramatic one. It is someone deciding, a
 * year from now, that a 409 carrying the server's current values may as well be
 * written to the cache while it is there — which silently converts a refusal
 * into an accepted overwrite of whatever the seller was looking at.
 */
class ProductWriteDecisionTest {

    private val product = RemoteProductDto(
        app_id = 1,
        remote_uuid = "018f-pizza",
        product_code = "p-A1B2C3D4",
        name = "Pizza",
        price = MoneyDto(15000, "EGP"),
        stock = 4,
        stock_version = 7,
    )

    @Test
    fun `an accepted write is the only answer that carries a product`() {
        val decision = decideProductWrite(ProductWriteRes(ok = true, product = product))
        assertTrue(decision is ProductWriteDecision.Store)
        assertEquals(product, (decision as ProductWriteDecision.Store).product)
    }

    @Test
    fun `ok without a product is not something to store`() {
        // A response claiming success with no product is not a description of
        // anything. Storing a half-decoded body would put a product in front of
        // the seller that the server never described.
        val decision = decideProductWrite(ProductWriteRes(ok = true, product = null))
        assertTrue(decision is ProductWriteDecision.Refused)
    }

    @Test
    fun `a dropped request is unreachable rather than refused`() {
        // The server's opinion is unknown. Telling the seller it was rejected
        // would be inventing a verdict nobody gave.
        for (code in listOf("network", "bad_response", "http_500", "http_503")) {
            assertEquals(
                "$code must not read as a refusal",
                ProductWriteDecision.Unreachable,
                decideProductWrite(ProductWriteRes(ok = false, error = code)),
            )
        }
    }

    @Test
    fun `a stale stock edit carries the pair the seller has to choose between`() {
        val decision = decideProductWrite(
            ProductWriteRes(ok = false, error = "stale_stock", stock = 8, stock_version = 6),
        )
        assertEquals(ProductWriteDecision.StaleStock(serverStock = 8, serverStockVersion = 6), decision)
    }

    @Test
    fun `a stale stock answer missing its numbers is a plain refusal`() {
        // Without both values there is nothing to show the seller, so this must
        // not claim to be a conflict it cannot describe.
        val decision = decideProductWrite(ProductWriteRes(ok = false, error = "stale_stock"))
        assertTrue(decision is ProductWriteDecision.Refused)
    }

    @Test
    fun `a server refusal keeps its code so the screen can name it`() {
        val decision = decideProductWrite(ProductWriteRes(ok = false, error = "unknown_category_code"))
        assertEquals(ProductWriteDecision.Refused("unknown_category_code"), decision)
    }

    @Test
    fun `no failure of any shape carries a product`() {
        // The sweep. Every way a write can fail, including a server that says no
        // while still sending the row back — which is the shape that would
        // quietly turn a refusal into an overwrite if `ok` were not required.
        val failures = listOf(
            ProductWriteRes(ok = false, error = "network"),
            ProductWriteRes(ok = false, error = "bad_response"),
            ProductWriteRes(ok = false, error = "http_503"),
            ProductWriteRes(ok = false, error = "stale_stock", stock = 8, stock_version = 6),
            ProductWriteRes(ok = false, error = "plan_limit_reached"),
            ProductWriteRes(ok = false, error = "unknown_category_code"),
            ProductWriteRes(ok = false, error = "price_required"),
            ProductWriteRes(ok = false, error = "not_found"),
            ProductWriteRes(ok = false, error = null),
            ProductWriteRes(ok = false, product = product, error = "stale_stock", stock = 8, stock_version = 6),
            ProductWriteRes(ok = false, product = product, error = "not_found"),
            ProductWriteRes(ok = true, product = null),
        )
        for (res in failures) {
            assertTrue(
                "error=${res.error} ok=${res.ok} must not be storable",
                decideProductWrite(res) !is ProductWriteDecision.Store,
            )
        }
    }
}
