package app.orderak.seller.data.db

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

/**
 * Adopting the server's catalogue must never claim a local row it does not own.
 *
 * The regression: a downloaded product arrived as `id = app_id`, the Room row id
 * on whichever device pushed it first. Two phones in one store both number their
 * products 1, 2, 3…, so the second phone's download landed on top of its own
 * rows and deleted products that had never reached the server.
 */
class CatalogAdoptionTest {
    private fun server(name: String, uuid: String?, code: String?) = ProductEntity(
        name = name, priceMinor = 1500, stock = 4,
        productCode = code, remoteUuid = uuid, createdAt = 1_000L,
    )

    @Test
    fun `a product this device has never seen takes a fresh row`() {
        val adopted = adoptedProduct(server("Cola", "uuid-cola", "p-COLA01"), local = null)

        // 0 is Room's "allocate one". Anything else would be another device's
        // row id, and this device's row of that number is somebody else's product.
        assertEquals(0L, adopted.id)
        assertEquals("Cola", adopted.name)
        assertEquals("uuid-cola", adopted.remoteUuid)
    }

    @Test
    fun `a product already held here updates that row, whatever its id`() {
        val local = ProductEntity(
            id = 42, name = "Cola", priceMinor = 1000, stock = 1,
            productCode = "p-COLA01", remoteUuid = "uuid-cola", createdAt = 7L,
        )

        val adopted = adoptedProduct(server("Cola 500ml", "uuid-cola", "p-COLA01"), local)

        assertEquals(42L, adopted.id)
        assertEquals("Cola 500ml", adopted.name)
        assertEquals(1500L, adopted.priceMinor)
    }

    @Test
    fun `the fields that belong to this device survive the download`() {
        val local = ProductEntity(
            id = 42, name = "Cola", priceMinor = 1000, stock = 1,
            imagePath = "/data/user/0/app/files/cola.jpg",
            productCode = "p-COLA01", remoteUuid = "uuid-cola",
            categoryId = 9, createdAt = 7L,
        )

        val adopted = adoptedProduct(server("Cola", "uuid-cola", "p-COLA01"), local)

        // The photo lives on this phone; the server has never had a copy of it.
        assertEquals("/data/user/0/app/files/cola.jpg", adopted.imagePath)
        // The local categories row id — the server round-trips categoryCode.
        assertEquals(9L, adopted.categoryId)
        // What the seller's list is ordered by. "Now" on every download would
        // reshuffle the catalogue each time a second device synced.
        assertEquals(7L, adopted.createdAt)
    }

    @Test
    fun `a first sync stamps the identity onto a row that lacks one`() {
        // Rows adopted before the server sent remote_uuid down carry only the
        // public code. The next download is what completes them.
        val local = ProductEntity(
            id = 3, name = "Cola", priceMinor = 1500, stock = 4,
            productCode = "p-COLA01", remoteUuid = null, createdAt = 7L,
        )
        assertNull(local.remoteUuid)

        val adopted = adoptedProduct(server("Cola", "uuid-cola", "p-COLA01"), local)

        assertEquals(3L, adopted.id)
        assertEquals("uuid-cola", adopted.remoteUuid)
    }
}
