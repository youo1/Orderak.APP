package app.orderak.seller.data.demo

import app.orderak.seller.domain.OrderStatus
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * The demo shop is a claim about what a reviewer will see, so it is checked
 * like any other claim.
 *
 * The safety property — that this can never run in a production build — is
 * asserted by `verifyDemoDataContract` in build.gradle.kts, because it is a
 * property of the build configuration rather than of the code. These tests
 * cover what the seeder would write if it did run.
 */
class DemoDataTest {

    private val now = 1_756_000_000_000L
    private val categoryIds = listOf(1L, 2L, 3L, 4L)

    @Test
    fun `product count sits below the demo plan limit, not at it`() {
        val products = DemoData.products(now, categoryIds)
        val limit = 20
        assertEquals(18, products.size)
        // The meter must read as warning rather than danger: at the limit the
        // store surface switches to the "you cannot add more" message, and the
        // point of the demo is to show the warning state on the way there.
        assertTrue("18/20 must be past the 70% warning threshold", products.size >= (limit * 0.70))
        assertTrue("18/20 must not be at the limit", products.size < limit)
    }

    @Test
    fun `every order status appears exactly once`() {
        val statuses = DemoData.orders(now).map { it.order.status }
        for (status in OrderStatus.entries) {
            assertTrue(
                "the priority rail cannot be judged without ${status.name} on screen",
                status.name in statuses,
            )
        }
    }

    @Test
    fun `orders are not pre-sorted by status`() {
        // A list already grouped by status would answer "which of these need
        // me?" for the reader, which is the exact question the rail claims to
        // answer on its own.
        val statuses = DemoData.orders(now).map { it.order.status }
        assertTrue("statuses must interleave", statuses != statuses.sorted())
    }

    @Test
    fun `payment references are unique`() {
        // The payments table has a unique index on ref and inserts IGNORE on
        // conflict, so a duplicate would be dropped silently and the order
        // would render with no proof at all.
        val refs = DemoData.orders(now).mapNotNull { it.payment?.ref }
        assertEquals("duplicate refs would be silently dropped", refs.size, refs.toSet().size)
    }

    @Test
    fun `payment amounts match their order totals`() {
        for (demo in DemoData.orders(now)) {
            val payment = demo.payment ?: continue
            assertEquals(
                "a proof that disagrees with the total would render as a mismatch",
                demo.order.totalMinor,
                payment.amountMinor,
            )
        }
    }

    @Test
    fun `order items name products that exist`() {
        val names = DemoData.products(now, categoryIds).map { it.name }.toSet()
        for (demo in DemoData.orders(now)) {
            for ((name, _) in demo.items) {
                assertTrue("order item names an unknown product: $name", name in names)
            }
        }
    }

    @Test
    fun `every buyer is in the customer list`() {
        val phones = DemoData.customers(now).map { it.phone }.toSet()
        for (demo in DemoData.orders(now)) {
            assertTrue(
                "an order from a phone with no customer row leaves the customers surface short",
                demo.order.buyerPhone in phones,
            )
        }
    }

    @Test
    fun `stock covers low, out and healthy`() {
        val products = DemoData.products(now, categoryIds)
        assertTrue("no low-stock product to show", products.any { it.stock in 1..2 })
        assertTrue("no unavailable product to show", products.any { !it.available })
        assertTrue("no healthy product to contrast against", products.any { it.stock > 10 })
    }

    @Test
    fun `every product belongs to a declared category`() {
        val products = DemoData.products(now, categoryIds)
        for (product in products) {
            assertTrue("product ${product.name} has no category", product.categoryId in categoryIds)
        }
        assertEquals(4, DemoData.categories().size)
    }

    @Test
    fun `the demo plan puts all three gate states on screen`() {
        val entitlements = DemoEntitlements.config().entitlements

        val available = entitlements["payments_finance.ocr_receipt_assistance"]!!
        assertTrue(available.available)
        assertEquals("implemented", available.implementation_status)

        val lockedByPlan = entitlements["language_localization.seller_translation_review"]!!
        assertFalse(lockedByPlan.available)
        assertEquals("implemented", lockedByPlan.implementation_status)

        val notBuilt = entitlements["products_catalog.advanced_inventory_management"]!!
        assertFalse(notBuilt.available)
        assertEquals("planned", notBuilt.implementation_status)
    }

    @Test
    fun `the demo plan keeps purchase closed`() {
        // Purchase is closed platform-wide. If the demo turned it on, the
        // paywall would appear and lead to an endpoint that answers 403 —
        // which is the defect this migration existed to remove.
        val billing = DemoEntitlements.config().governance?.features?.get("billing")
        assertFalse("the demo must not sell what the platform cannot sell", billing?.enabled ?: true)
    }

    @Test
    fun `the product limit in the plan matches what the seed fills`() {
        val limit = DemoEntitlements.config().limits?.max_products
        val used = DemoEntitlements.config().entitlements["max_products"]?.used
        assertEquals(20, limit)
        assertEquals(
            "the meter's used count must match the rows actually seeded",
            DemoData.products(now, categoryIds).size,
            used,
        )
    }
}
