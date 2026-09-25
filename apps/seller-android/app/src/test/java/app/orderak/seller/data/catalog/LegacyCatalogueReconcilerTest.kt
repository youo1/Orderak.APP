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

    /**
     * A server that answers a stock push however the test says, and remembers
     * every call — succeeds by default so the tests above this section, which
     * do not care about stock, do not have to configure it.
     */
    private class Seeder(
        private val answer: (call: Int) -> ProductWriteDecision = {
            // A nested (non-inner) class cannot call the outer class's stored()
            // directly, so this repeats its shape rather than sharing it — any
            // non-Unreachable decision satisfies the default "just succeed".
            ProductWriteDecision.Store(RemoteProductDto(app_id = 1, product_code = "p-SEEDED", name = "Cola", price = MoneyDto(0, "EGP")))
        },
    ) : LegacyProductStockSeeding {
        val calls = mutableListOf<Triple<String, Int, Long>>()

        override suspend fun seedStock(productCode: String, stock: Int, expectedStockVersion: Long): ProductWriteDecision {
            calls += Triple(productCode, stock, expectedStockVersion)
            return answer(calls.size)
        }
    }

    private fun reconciler(
        products: List<ProductEntity>,
        creator: Creator,
        records: Records = Records(),
        stamps: Stamps = Stamps(),
        seeder: Seeder = Seeder(),
    ) = Triple(
        LegacyCatalogueReconciler({ products }, creator, records, stamps, seeder),
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

    @Test
    fun `a stuck row carries the name and the reason a screen has to show`() = runTest {
        // The seller is being asked to delete something that exists nowhere
        // else, so the list they are asked to decide from has to name the
        // product and say why it is stuck. A list of bare ids would be a
        // confirmation dialog with nothing in it.
        val creator = Creator { ProductWriteDecision.Refused("name_required") }
        val (job, _, _) = reconciler(listOf(legacyProduct(7, name = "Mango juice")), creator)
        job.reconcile()

        val stuck = job.pending().single()
        assertEquals(7L, stuck.localId)
        assertEquals("Mango juice", stuck.name)
        // TERMINAL rather than the server's own code: the screen's only
        // decision is "will this ever send", and that is what the reconciler
        // has already classified.
        assertEquals("TERMINAL", stuck.lastError)
    }

    @Test
    fun `a row that has not been tried yet reports no reason`() = runTest {
        // Null is "not asked yet", not "no problem". The screen phrases this as
        // waiting rather than refused, so telling the two apart matters: a
        // seller shown "this will never send" over an unattempted row would
        // delete a product for no reason at all.
        val (job, _, _) = reconciler(listOf(legacyProduct(3, name = "Water")), Creator { stored() })

        val stuck = job.pending().single()
        assertEquals("Water", stuck.name)
        assertEquals(null, stuck.lastError)
    }

    @Test
    fun `a transport failure leaves the row waiting rather than refused`() = runTest {
        // The distinction the screen renders. A network failure must not read
        // as "your account rejected this", because the action those two call
        // for are opposites: wait, versus delete.
        val creator = Creator { ProductWriteDecision.Unreachable }
        val (job, _, _) = reconciler(listOf(legacyProduct(4)), creator)
        job.reconcile()

        assertEquals("RETRY", job.pending().single().lastError)
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

    // ---- 5. Stock survives the conversion --------------------------------
    //
    // DATA-001: `POST /api/v1/products` has no stock field, so a converted
    // product used to land on the server with whatever it defaults a new
    // product's stock to (effectively zero) while this device's real count
    // — the only copy of it that ever existed — was deleted by the next
    // catalogue refresh. Silently, with nothing for the seller to notice.

    @Test
    fun `a converted product's real stock is pushed to the server it was just created on`() = runTest {
        val seeder = Seeder()
        val (job, _, _) = reconciler(listOf(legacyProduct(1).copy(stock = 7)), Creator { stored("p-XYZ") }, seeder = seeder)

        assertTrue(job.reconcile())

        assertEquals("the code from the create response, the stock this device held", Triple("p-XYZ", 7, 0L), seeder.calls.single())
    }

    @Test
    fun `a legacy product with no stock needs no stock call at all`() = runTest {
        val seeder = Seeder()
        val (job, _, records) = reconciler(listOf(legacyProduct(1).copy(stock = 0)), Creator { stored() }, seeder = seeder)

        assertTrue(job.reconcile())

        assertTrue("nothing to push, nothing pushed", seeder.calls.isEmpty())
        assertEquals(LegacyReconcileState.CONVERTED, records.rows[1]?.state)
    }

    @Test
    fun `an unreachable stock push retries the whole attempt under the same key`() = runTest {
        // The create already succeeded and must not be repeated as a distinct
        // product — it is repeated under the same idempotency key, which the
        // server resolves back to the product it already made.
        val seeder = Seeder { call -> if (call == 1) ProductWriteDecision.Unreachable else stored("p-XYZ") }
        val creator = Creator { stored("p-XYZ") }
        val (job, _, records) = reconciler(listOf(legacyProduct(1).copy(stock = 5)), creator, seeder = seeder)

        assertFalse("an unpushed stock figure must hold the gate shut", job.reconcile())
        assertEquals(LegacyReconcileState.UNSENT, records.rows[1]?.state)

        assertTrue(job.reconcile())
        assertEquals(LegacyReconcileState.CONVERTED, records.rows[1]?.state)
        assertEquals("both attempts must carry the one key the product was created under", 1, creator.keys.toSet().size)
        assertEquals(2, seeder.calls.size)
    }

    @Test
    fun `a stale stock version after seeding still counts as converted`() = runTest {
        // Stale here means some write already reached this product since the
        // create response — an earlier push whose own response was lost, or a
        // buyer's order. Either way a real server figure is already in place,
        // and retrying with a newer version risks clobbering it.
        val seeder = Seeder { ProductWriteDecision.StaleStock(serverStock = 4, serverStockVersion = 2) }
        val (job, _, records) = reconciler(listOf(legacyProduct(1).copy(stock = 5)), Creator { stored() }, seeder = seeder)

        assertTrue(job.reconcile())
        assertEquals(LegacyReconcileState.CONVERTED, records.rows[1]?.state)
    }

    @Test
    fun `a refused stock push still lets the product convert`() = runTest {
        // The server has an opinion about the number, not about whether the
        // product should exist. Losing the product over a rejected stock figure
        // would be worse than the figure being wrong for the seller to notice.
        val seeder = Seeder { ProductWriteDecision.Refused("stock_out_of_range") }
        val (job, _, records) = reconciler(listOf(legacyProduct(1).copy(stock = 5)), Creator { stored() }, seeder = seeder)

        assertTrue(job.reconcile())
        assertEquals(LegacyReconcileState.CONVERTED, records.rows[1]?.state)
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
