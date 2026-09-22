package app.orderak.seller.feature.orders

import app.orderak.seller.data.db.OrderEntity
import app.orderak.seller.domain.OrderStatus
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test
import java.util.Calendar

/**
 * The counters and the list they open must answer the same question.
 *
 * WHY THIS TEST EXISTS
 *   The اليوم counters are Room `COUNT(*)` queries; the orders list is an
 *   in-memory predicate. Two definitions of "unpaid" in two languages is how a
 *   card reading 3 opens a list of 11 — and that is the defect this type was
 *   created to remove, so the agreement is asserted rather than assumed.
 *
 *   The SQL half lives in `Daos.kt`:
 *     countSince   createdAt >= :since
 *     countUnpaid  status IN ('NEW','CONFIRMED')
 *     countToShip  status = 'PAID'
 */
class OrdersFilterTest {

    private fun order(
        id: Long = 1,
        status: OrderStatus = OrderStatus.NEW,
        createdAt: Long = System.currentTimeMillis(),
    ) = OrderEntity(
        id = id,
        buyerPhone = "+201000000000",
        status = status.name,
        payMethod = "COD",
        totalMinor = 1500,
        currency = "EGP",
        createdAt = createdAt,
    )

    private val now = System.currentTimeMillis()
    private fun midnight() = OrdersFilter.startOfDay(now)

    // ---- Unpaid: the two statuses the counter counts ---------------------

    @Test
    fun `unpaid matches exactly the statuses countUnpaid counts`() {
        val unpaid = OrdersFilter.Unpaid
        assertTrue(unpaid.matches(order(status = OrderStatus.NEW), now))
        assertTrue(unpaid.matches(order(status = OrderStatus.CONFIRMED), now))

        // Everything else is money already taken, or an order that is over.
        for (st in listOf(OrderStatus.PAID, OrderStatus.SHIPPED, OrderStatus.DONE, OrderStatus.CANCELLED)) {
            assertFalse("$st must not count as unpaid", unpaid.matches(order(status = st), now))
        }
    }

    @Test
    fun `to ship matches exactly PAID`() {
        val toShip = OrdersFilter.ToShip
        assertTrue(toShip.matches(order(status = OrderStatus.PAID), now))
        for (st in OrderStatus.entries.filter { it != OrderStatus.PAID }) {
            assertFalse("$st must not count as ready to ship", toShip.matches(order(status = st), now))
        }
    }

    // ---- Today: a device day, not a UTC one ------------------------------

    @Test
    fun `today includes an order created at local midnight exactly`() {
        // The boundary the SQL uses is `>=`, so midnight itself is today. An
        // exclusive boundary here would drop the first order of the day.
        assertTrue(OrdersFilter.Today.matches(order(createdAt = midnight()), now))
    }

    @Test
    fun `today excludes one millisecond before local midnight`() {
        assertFalse(OrdersFilter.Today.matches(order(createdAt = midnight() - 1), now))
    }

    @Test
    fun `today ignores status entirely`() {
        // A cancelled order created today still happened today. The counter is a
        // count of orders, not of live ones.
        for (st in OrderStatus.entries) {
            assertTrue(OrdersFilter.Today.matches(order(status = st, createdAt = now), now))
        }
    }

    @Test
    fun `start of day is local midnight, matching the counter's own helper`() {
        // MainViewModel.startOfToday() builds the same value with Calendar. If
        // one moves to UTC and the other does not, the card and the list
        // disagree for everyone west or east of the line.
        val c = Calendar.getInstance().apply {
            timeInMillis = OrdersFilter.startOfDay(now)
        }
        assertEquals(0, c.get(Calendar.HOUR_OF_DAY))
        assertEquals(0, c.get(Calendar.MINUTE))
        assertEquals(0, c.get(Calendar.SECOND))
        assertEquals(0, c.get(Calendar.MILLISECOND))
    }

    // ---- All, and the status chips ---------------------------------------

    @Test
    fun `all matches everything including cancelled`() {
        for (st in OrderStatus.entries) {
            assertTrue(OrdersFilter.All.matches(order(status = st), now))
        }
    }

    @Test
    fun `status matches only its own status`() {
        val paid = OrdersFilter.Status(OrderStatus.PAID)
        assertTrue(paid.matches(order(status = OrderStatus.PAID), now))
        assertFalse(paid.matches(order(status = OrderStatus.SHIPPED), now))
    }

    @Test
    fun `status filters are equal by value, so a chip can be selected`() {
        // The chips compare with ==. A data class gives that; an identity
        // comparison would leave every status chip looking unselected.
        assertEquals(OrdersFilter.Status(OrderStatus.PAID), OrdersFilter.Status(OrderStatus.PAID))
    }

    // ---- The defect, stated as a test ------------------------------------

    @Test
    fun `the three counters are three different questions`() {
        // All three used to open the same unfiltered list. If any two of these
        // ever became equal, that bug would be back.
        val filters = listOf(OrdersFilter.Today, OrdersFilter.Unpaid, OrdersFilter.ToShip)
        assertEquals(filters.size, filters.toSet().size)

        // And they select genuinely different orders: a PAID order from today is
        // in Today and ToShip but never in Unpaid.
        val paidToday = order(status = OrderStatus.PAID, createdAt = now)
        assertTrue(OrdersFilter.Today.matches(paidToday, now))
        assertTrue(OrdersFilter.ToShip.matches(paidToday, now))
        assertFalse(OrdersFilter.Unpaid.matches(paidToday, now))
    }
}
