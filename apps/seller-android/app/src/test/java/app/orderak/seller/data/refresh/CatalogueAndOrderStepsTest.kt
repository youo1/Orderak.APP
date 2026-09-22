package app.orderak.seller.data.refresh

import kotlinx.coroutines.test.runTest
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * The ordering rule the migration's safety rests on, and the coupling it forbids.
 *
 * WHY THIS IS TESTED AT ALL
 *   These are four consecutive statements. Nothing about reading them says which
 *   order is load-bearing and which line must never acquire an `if`, and both
 *   facts were learned the expensive way:
 *
 *     * adopting the server's catalogue before converting legacy rows deletes
 *       products that exist on one phone and nowhere else;
 *     * putting the order drain behind the catalogue pull — which is what
 *       `SyncRepository` did, returning early on a failed pull with the order
 *       push below that return — means a seller with a catalogue problem quietly
 *       stops delivering orders.
 *
 *   The second is a Class A failure taking a Class B command down with it, which
 *   is precisely what the two classes exist to prevent.
 */
class CatalogueAndOrderStepsTest {

    /** Records what ran, in order, so sequencing is asserted rather than assumed. */
    private class Steps(
        val reconcile: Boolean = true,
        val stock: Boolean = true,
        val catalogue: Boolean = true,
        val orders: Boolean = true,
    ) {
        val ran = mutableListOf<String>()
        suspend fun run() = runCatalogueAndOrderSteps(
            reconcile = { ran += "reconcile"; reconcile },
            drainStock = { ran += "stock"; stock },
            refreshCatalogue = { ran += "catalogue"; catalogue },
            drainOrders = { ran += "orders"; orders },
        )
    }

    // ---- The coupling that must not come back ----------------------------

    @Test
    fun `orders are posted even when the catalogue refresh fails`() {
        // The invariant. A Class B command does not wait on a Class A read.
        runTest {
            val steps = Steps(catalogue = false)
            val outcome = steps.run()

            assertTrue("the order queue must drain", outcome.ordersPushed)
            assertTrue(steps.ran.contains("orders"))
            assertFalse(outcome.catalogueRefreshed)
        }
    }

    @Test
    fun `orders are posted even when every catalogue step fails`() {
        // Not just the refresh: a device that cannot reconcile, cannot drain
        // stock and cannot adopt the catalogue is exactly the device most likely
        // to be holding a sale nobody has been paid for.
        runTest {
            val steps = Steps(reconcile = false, stock = false, catalogue = false)
            val outcome = steps.run()

            assertTrue("the order queue must drain regardless", outcome.ordersPushed)
            assertTrue(steps.ran.contains("orders"))
        }
    }

    @Test
    fun `orders are posted even when the catalogue was never attempted`() {
        // The skip case rather than the failure case. An unconverted legacy row
        // stops the catalogue refresh from running at all, and that must not be
        // mistaken for a reason to hold the orders back too.
        runTest {
            val steps = Steps(reconcile = false)
            val outcome = steps.run()

            assertFalse("the catalogue must not be adopted", steps.ran.contains("catalogue"))
            assertTrue("the order queue must still drain", outcome.ordersPushed)
        }
    }

    // ---- The ordering that must not be rearranged -------------------------

    @Test
    fun `the catalogue is not adopted while a legacy row is unconverted`() {
        // The property that stops a seller's own products being deleted by a
        // list that never contained them.
        runTest {
            val steps = Steps(reconcile = false)
            steps.run()

            assertFalse(steps.ran.contains("catalogue"))
        }
    }

    @Test
    fun `conversion runs before adoption, and orders run last`() {
        runTest {
            val steps = Steps()
            steps.run()

            assertEquals(listOf("reconcile", "stock", "catalogue", "orders"), steps.ran)
        }
    }

    @Test
    fun `stock is drained before the catalogue replaces the rows it edits`() {
        // A pending stock edit lives on the cached row. Adopting first would
        // overwrite the row and the edit with the server's figure, which is the
        // seller's own correction being silently discarded.
        runTest {
            val steps = Steps()
            steps.run()

            assertTrue(steps.ran.indexOf("stock") < steps.ran.indexOf("catalogue"))
        }
    }

    // ---- What the outcome reports ----------------------------------------

    @Test
    fun `a skipped catalogue reports incomplete rather than successful`() {
        // "Not attempted" and "failed" are both false here deliberately: the
        // caller's only question is whether the pass may be called complete, and
        // a skipped adoption means it may not. The next pass tries again.
        runTest {
            assertFalse(Steps(reconcile = false).run().catalogueRefreshed)
        }
    }

    @Test
    fun `an all-clear pass reports every step succeeded`() {
        runTest {
            val outcome = Steps().run()

            assertEquals(
                CatalogueAndOrderOutcome(
                    reconciled = true,
                    stockDrained = true,
                    catalogueRefreshed = true,
                    ordersPushed = true,
                ),
                outcome,
            )
        }
    }
}
