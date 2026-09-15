package app.orderak.seller.data.catalog

import app.orderak.seller.data.db.ProductEntity
import app.orderak.seller.data.remote.MoneyDto
import app.orderak.seller.data.remote.RemoteProductDto
import kotlinx.coroutines.test.runTest
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * The one-time conversion of products that exist on a device and nowhere else.
 *
 * WHY THIS IS THE MOST IMPORTANT TEST IN THE MIGRATION
 *   Every other job in the cutover works on data the server already has. This
 *   one works on data it does not, and it runs immediately before the catalogue
 *   refresh replaces the cache with the server's copy. A row this misses is not
 *   degraded or stale; it is gone, and the seller created it.
 *
 *   It is also the job nobody can exercise by hand. A fresh install has no
 *   legacy rows, so reaching this path on a device means having run the app
 *   before the migration — which is why it shipped unverified and why it gets a
 *   test now rather than a manual pass.
 *
 * THE FOUR PROPERTIES
 *   1. A row is converted exactly once, and a second run does not resend it.
 *   2. The retry key is written BEFORE the attempt, so a process death between
 *      the request and the response cannot turn the retry into a duplicate.
 *   3. A device never decides on its own that a product is unrecoverable.
 *   4. The gate is a count over rows, and it stays shut while any row is unsent.
 */
class LegacyCatalogueReconcilerTest {

    // ---- Fakes ----------------------------------------------------------

    private class Records : LegacyReconcileRecords {
        val rows = mutableMapOf<Long, LegacyReconcileRecord>()
        /** Every write in order, so ordering claims can be asserted rather than assumed. */
        val writes = mutableListOf<Pair<Long, LegacyReconcileRecord>>()

        override suspend fun all() = rows.toMap()
        override suspend fun record(localId: Long) = rows[localId]
        override suspend fun put(localId: Long, record: LegacyReconcileRecord) {
            rows[localId] = record
            writes += localId to record
        }
        override suspend fun unsentCount() = rows.values.count { it.state == LegacyReconcileState.UNSENT }
    }

    /**
     * A server that answers however the test says, and remembers what it was
     * asked — including the retry key, which is the whole point.
     */
    private class Creator(
        private val answer: (attempt: Int) -> ProductWriteDecision,
    ) : ProductCreating {
        val keys = mutableListOf<String>()
        val drafts = mutableListOf<ProductDraft>()
        var calls = 0

        override suspend fun create(draft: ProductDraft, clientRequestId: String): ProductWriteDecision {
            calls += 1
            keys += clientRequestId
            drafts += draft
            return answer(calls)
        }
    }

    private fun legacyProduct(id: Long, name: String = "Cola") = ProductEntity(
        id = id,
        name = name,
        priceMinor = 1500,
        currency = "EGP",
        stock = 3,
        productCode = null,
    )

    private fun stored(code: String = "p-A1B2C3D4") = ProductWriteDecision.Store(
        RemoteProductDto(
            app_id = 1,
            product_code = code,
            name = "Cola",
            price = MoneyDto(1500, "EGP"),
        ),
    )

    /** Records which local product ids had a code stamped onto their order lines. */
    private class Stamps : OrderLineStamping {
        val stamped = mutableListOf<Pair<Long, String>>()
        override suspend fun stamp(localProductId: Long, productCode: String) {
            stamped += localProductId to productCode
        }
    }

    private fun reconciler(
        products: List<ProductEntity>,
        creator: Creator,
        records: Records = Records(),
        stamps: Stamps = Stamps(),
    ) = Triple(
        LegacyCatalogueReconciler({ products }, creator, records, stamps),
        creator,
        records,
    )

    // ---- 1. Converted exactly once --------------------------------------

    @Test
    fun `a legacy row is converted and not sent again`() = runTest {
        val creator = Creator { stored() }
        val (job, _, records) = reconciler(listOf(legacyProduct(1)), creator)

        assertTrue("nothing should remain unsent", job.reconcile())
        assertEquals(LegacyReconcileState.CONVERTED, records.rows[1]?.state)

        // A second pass must not resend it. The row still has no productCode —
        // the cache write happens elsewhere — so "already converted" has to come
        // from the record, not from the product.
        assertTrue(job.reconcile())
        assertEquals("converted rows must not be resent", 1, creator.calls)
    }

    @Test
    fun `a row the server already knows about is left alone`() = runTest {
        // productCode present means the mirror acknowledged it. Not legacy, not
        // this job's business, and creating it again would duplicate it.
        val creator = Creator { stored() }
        val known = legacyProduct(1).copy(productCode = "p-KNOWN123")
        val (job, _, records) = reconciler(listOf(known), creator)

        assertTrue(job.reconcile())
        assertEquals(0, creator.calls)
        assertTrue(records.rows.isEmpty())
    }

    // ---- 2. The key is written before the attempt ------------------------

    @Test
    fun `the retry key is recorded before the request is made`() = runTest {
        // The failure this prevents: the app dies between sending the create and
        // receiving the response. On restart the row still looks legacy, and
        // without the key already on disk the retry invents a new one — which the
        // server cannot recognise, so it makes a second product.
        var recordedWhenCalled: LegacyReconcileRecord? = null
        val records = Records()
        val creator = Creator {
            recordedWhenCalled = records.rows[1]
            stored()
        }
        val (job, _, _) = reconciler(listOf(legacyProduct(1)), creator, records)

        job.reconcile()

        assertNotNull("the record must exist before the create is attempted", recordedWhenCalled)
        assertEquals(LegacyReconcileState.UNSENT, recordedWhenCalled?.state)
        assertEquals(
            "the key sent must be the key already on disk",
            recordedWhenCalled?.idempotencyKey,
            creator.keys.single(),
        )
    }

    @Test
    fun `a retry after an unreachable server reuses the original key`() = runTest {
        // Same key twice is what makes the whole job safe to repeat: the server
        // resolves the second request to the product the first one may already
        // have created.
        val creator = Creator { attempt ->
            if (attempt == 1) ProductWriteDecision.Unreachable else stored()
        }
        val (job, _, records) = reconciler(listOf(legacyProduct(1)), creator)

        assertFalse("an unreachable server must leave the gate shut", job.reconcile())
        assertEquals(LegacyReconcileState.UNSENT, records.rows[1]?.state)

        assertTrue(job.reconcile())
        assertEquals(2, creator.calls)
        assertEquals("both attempts must carry one key", 1, creator.keys.toSet().size)
    }

    // ---- 3. A device never gives up on a product -------------------------

    @Test
    fun `a refusal leaves the row unsent rather than discarding it`() = runTest {
        // "Permanently unconvertible" is not a judgement a device can make from a
        // failed request. A plan-limit refusal clears when the seller upgrades; a
        // validation error may be fixable by editing the product. What cannot be
        // undone is deciding on their behalf that a product they created is gone.
        val creator = Creator { ProductWriteDecision.Refused("plan_limit_reached") }
        val (job, _, records) = reconciler(listOf(legacyProduct(1)), creator)

        assertFalse(job.reconcile())
        assertEquals(LegacyReconcileState.UNSENT, records.rows[1]?.state)
        assertEquals("plan_limit_reached must be remembered", "TERMINAL", records.rows[1]?.lastError)
    }

    @Test
    fun `only an explicit discard moves a row to refused`() = runTest {
        val creator = Creator { ProductWriteDecision.Refused("name_required") }
        val (job, _, records) = reconciler(listOf(legacyProduct(1)), creator)
        job.reconcile()

        job.discard(1)

        assertEquals(LegacyReconcileState.REFUSED, records.rows[1]?.state)
        assertTrue("a discarded row stops blocking the gate", job.reconcile())
        assertEquals("a discarded row is never resent", 1, creator.calls)
    }

    @Test
    fun `a discarded row disappears from what the seller is shown`() = runTest {
        val creator = Creator { ProductWriteDecision.Refused("name_required") }
        val (job, _, _) = reconciler(listOf(legacyProduct(1)), creator)
        job.reconcile()

        assertEquals(1, job.pending().size)
        job.discard(1)
        assertTrue(job.pending().isEmpty())
    }

    // ---- 4. The gate is a count, and it stays shut -----------------------

    @Test
    fun `one unconverted row among many holds the gate shut`() = runTest {
        // The property the catalogue refresh depends on. Adoption replaces the
        // cache with the server's copy, so proceeding while a single row is
        // unconverted destroys that row — and "mostly converted" is not a state
        // this gate is allowed to report as finished.
        val creator = Creator { attempt ->
            if (attempt == 2) ProductWriteDecision.Unreachable else stored("p-CODE$attempt")
        }
        val (job, _, records) = reconciler(
            listOf(legacyProduct(1, "A"), legacyProduct(2, "B"), legacyProduct(3, "C")),
            creator,
        )

        assertFalse("two of three converted is not finished", job.reconcile())
        assertEquals(1, records.rows.values.count { it.state == LegacyReconcileState.UNSENT })
        assertEquals(2, records.rows.values.count { it.state == LegacyReconcileState.CONVERTED })
    }

    @Test
    fun `an empty catalogue is finished rather than blocked`() = runTest {
        val creator = Creator { stored() }
        val (job, _, _) = reconciler(emptyList(), creator)

        assertTrue(job.reconcile())
        assertEquals(0, creator.calls)
    }

    @Test
    fun `the draft never carries a local file path as an image`() = runTest {
        // imagePath is a file on this device. Sending it would put a broken image
        // on a public storefront, so a product whose upload never happened
        // converts without one and the seller can re-attach it.
        val creator = Creator { stored() }
        val withLocalImage = legacyProduct(1).copy(imagePath = "/data/user/0/app/files/cola.jpg", imageUrl = null)
        val (job, _, _) = reconciler(listOf(withLocalImage), creator)

        job.reconcile()

        assertEquals(null, creator.drafts.single().imageUrl)
    }
}
