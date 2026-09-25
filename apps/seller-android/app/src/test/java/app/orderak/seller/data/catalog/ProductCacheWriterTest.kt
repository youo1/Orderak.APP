package app.orderak.seller.data.catalog

import app.orderak.seller.data.db.ProductEntity
import app.orderak.seller.data.remote.MoneyDto
import app.orderak.seller.data.remote.RemoteProductDto
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * DATA-002: the old catalogue mirror deleted whatever a push omitted, and it
 * shipped once. Removing the mirror closed that direction; this is the same
 * shape in the direction that is left — a *pull* whose response is empty or
 * wrong must not read as "this store now has zero products".
 */
class ProductCacheWriterTest {

    private fun synced(code: String = "p-A1") = ProductEntity(
        name = "Cola", priceMinor = 1500, currency = "EGP", stock = 3, productCode = code,
    )

    private fun unsynced() = ProductEntity(
        name = "Legacy", priceMinor = 1500, currency = "EGP", stock = 3, productCode = null,
    )

    @Test
    fun `an empty response over a synced catalogue is refused`() {
        assertTrue(refusesEmptyProductReplacement(remote = emptyList(), existing = listOf(synced())))
    }

    @Test
    fun `an empty response over an empty catalogue is accepted`() {
        // The seller genuinely has zero products — nothing to refuse.
        assertFalse(refusesEmptyProductReplacement(remote = emptyList(), existing = emptyList()))
    }

    @Test
    fun `an empty response over only unconverted legacy rows is accepted`() {
        // Never actually reachable — LegacyCatalogueReconciler gates replaceAll
        // from running while a row is unconverted — but the predicate itself
        // should not conflate "has local rows" with "has synced rows".
        assertFalse(refusesEmptyProductReplacement(remote = emptyList(), existing = listOf(unsynced())))
    }

    @Test
    fun `a non-empty response is never refused, even over a larger local catalogue`() {
        assertFalse(refusesEmptyProductReplacement(remote = listOf(stored()), existing = listOf(synced("p-A1"), synced("p-A2"), synced("p-A3"))))
    }

    private fun stored(code: String = "p-B1") = RemoteProductDto(
        app_id = 1, product_code = code, name = "Cola", price = MoneyDto(1500, "EGP"),
    )
}
