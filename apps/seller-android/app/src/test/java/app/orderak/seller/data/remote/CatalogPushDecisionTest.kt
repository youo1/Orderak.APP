package app.orderak.seller.data.remote

import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * The catalogue baseline, and the refusal that used to disarm it.
 *
 * BACKGROUND
 *   POST /api/v1/products/sync is a full mirror: whatever the payload omits, the
 *   server deletes. `baseline_version` is what stops a device deleting products
 *   it has never seen — it may only overwrite a catalogue it has proved it
 *   downloaded.
 *
 *   The client cleared its baseline on `stale_catalog` and then, on the next
 *   line, unconditionally saved whatever `catalog_version` the response carried.
 *   The 409 carries one. So the clear was undone in the same breath, the next
 *   sync found a baseline and skipped the protective download, and the mirror
 *   that followed was accepted against a baseline the device had not earned —
 *   deleting every product added on another phone.
 *
 *   The first test below is that bug. It fails against the old code.
 */
class CatalogPushDecisionTest {

    private fun res(
        ok: Boolean = false,
        error: String? = null,
        catalogVersion: Long? = null,
        deleting: Int? = null,
        of: Int? = null,
    ) = ProductsSyncRes(
        ok = ok,
        catalog_version = catalogVersion,
        deleting = deleting,
        of = of,
        error = error,
    )

    @Test
    fun `a stale catalogue never yields a version to adopt`() {
        // THE REGRESSION. The server sends catalog_version with this refusal to
        // say where the store now stands — not to hand the device a baseline it
        // has not downloaded. The decision carries no version, so a caller
        // structurally cannot save one.
        val decision = decideCatalogPush(res(error = "stale_catalog", catalogVersion = 99))
        assertEquals(CatalogPushDecision.Redownload, decision)
    }

    @Test
    fun `a missing baseline is treated the same way`() {
        // catalog_baseline_required carries catalog_version for the same reason
        // and had the same effect: adopting it would let the very next push skip
        // the download the refusal exists to demand.
        val decision = decideCatalogPush(res(error = "catalog_baseline_required", catalogVersion = 99))
        assertEquals(CatalogPushDecision.Redownload, decision)
    }

    @Test
    fun `an accepted push hands back the version it earned`() {
        val decision = decideCatalogPush(res(ok = true, catalogVersion = 12))
        assertEquals(CatalogPushDecision.Accepted(12), decision)
    }

    @Test
    fun `a stale stock conflict is still an accepted push`() {
        // The metadata and deletions landed; only some compare-and-set stock
        // writes were refused, and the server returns the new version with them.
        // Treating this as a baseline failure would throw away a baseline the
        // device is entitled to and force a pointless re-download every time a
        // seller edited stock while an order was arriving.
        val decision = decideCatalogPush(res(error = "stale_stock", catalogVersion = 13))
        assertEquals(CatalogPushDecision.Accepted(13), decision)
    }

    @Test
    fun `a bulk deletion carries the counts the seller has to be shown`() {
        val decision = decideCatalogPush(res(error = "bulk_deletion_unconfirmed", deleting = 10, of = 12))
        assertEquals(CatalogPushDecision.ConfirmDeletion(deleting = 10, of = 12), decision)
    }

    @Test
    fun `a bulk deletion without counts still asks, rather than silently retrying`() {
        val decision = decideCatalogPush(res(error = "bulk_deletion_unconfirmed"))
        assertEquals(CatalogPushDecision.ConfirmDeletion(deleting = 0, of = 0), decision)
    }

    @Test
    fun `everything else leaves the baseline alone`() {
        for (code in listOf("network", "http_503", "products_required", "currency_not_enabled", null)) {
            val decision = decideCatalogPush(res(error = code))
            assertEquals(CatalogPushDecision.Failed(code), decision)
        }
    }

    @Test
    fun `only an accepted push can ever produce a version`() {
        // The invariant behind all of the above, stated once: no refusal, of any
        // kind, present or future, may hand a baseline to a device that has not
        // downloaded the catalogue it describes.
        val refusals = listOf(
            "stale_catalog", "catalog_baseline_required", "bulk_deletion_unconfirmed",
            "products_required", "currency_not_enabled", "network", "http_500",
        )
        for (code in refusals) {
            val decision = decideCatalogPush(res(error = code, catalogVersion = 99))
            assertTrue(
                "$code must not yield a baseline",
                decision !is CatalogPushDecision.Accepted,
            )
        }
    }
}
