package app.orderak.seller.feature.orders

import app.orderak.seller.data.db.OrderEntity
import app.orderak.seller.domain.OrderStatus
import app.orderak.seller.domain.PayMethod
import org.junit.Assert.assertEquals
import org.junit.Test

/**
 * The order the list draws its rows in.
 *
 * This exists because the surface described itself one way and behaved another, and
 * nothing could tell: `SellerSurface.Orders` says "Orders, ordered by whether they
 * need the seller" and `OrderCard` says "the list's job is 'which of these still
 * need me?'", while the query behind the list was `ORDER BY createdAt DESC`. An
 * unpaid order from three weeks ago sat below twenty orders finished this morning.
 *
 * A comparator is the cheapest place to hold that claim, because it can be tested
 * without a database — which is why it is a comparator and not a Room `ORDER BY
 * CASE` clause.
 */
class NeedsSellerFirstTest {

    private fun order(id: Long, status: OrderStatus, createdAt: Long) = OrderEntity(
        id = id,
        buyerName = "buyer $id",
        buyerPhone = "0100000000$id",
        status = status.name,
        payMethod = PayMethod.COD.name,
        totalMinor = 1000,
        currency = "EGP",
        createdAt = createdAt,
    )

    @Test
    fun `an order still waiting on the seller outranks a finished one, however old`() {
        val waitingSinceLastMonth = order(1, OrderStatus.CONFIRMED, createdAt = 1_000)
        val finishedThisMorning = order(2, OrderStatus.DONE, createdAt = 9_000)

        val sorted = listOf(finishedThisMorning, waitingSinceLastMonth).sortedWith(needsSellerFirst)

        assertEquals(listOf(1L, 2L), sorted.map { it.id })
    }

    /** Within "waiting", the most recent first — see the comparator's own reasoning. */
    @Test
    fun `among orders waiting on the seller, the newest comes first`() {
        val older = order(1, OrderStatus.NEW, createdAt = 1_000)
        val newer = order(2, OrderStatus.PAID, createdAt = 5_000)

        val sorted = listOf(older, newer).sortedWith(needsSellerFirst)

        assertEquals(listOf(2L, 1L), sorted.map { it.id })
    }

    /** A cancelled order is finished, not waiting, and sorts with the finished ones. */
    @Test
    fun `cancelled counts as finished`() {
        val cancelled = order(1, OrderStatus.CANCELLED, createdAt = 9_000)
        val shipped = order(2, OrderStatus.SHIPPED, createdAt = 1_000)

        val sorted = listOf(cancelled, shipped).sortedWith(needsSellerFirst)

        assertEquals(listOf(2L, 1L), sorted.map { it.id })
    }

    /**
     * Every pipeline status is classified, so adding one is a compile-visible
     * decision rather than a row that quietly sorts as "finished". If a new status
     * lands, this test names it.
     */
    @Test
    fun `the split covers the whole pipeline`() {
        val waiting = OrderStatus.entries.filter { it.needsSeller }.map { it.name }
        val finished = OrderStatus.entries.filterNot { it.needsSeller }.map { it.name }

        assertEquals(listOf("NEW", "CONFIRMED", "PAID", "SHIPPED"), waiting)
        assertEquals(listOf("DONE", "CANCELLED"), finished)
    }

    /**
     * A status the enum does not know is treated as waiting, not as finished.
     *
     * The database is written by a server that may be ahead of this build, so a
     * status added there reaches a phone that cannot parse it. Sorting it as
     * "finished" would bury the one order nobody has looked at yet.
     */
    @Test
    fun `an unrecognised status sorts as waiting rather than as finished`() {
        val unknown = order(1, OrderStatus.NEW, createdAt = 1_000).copy(status = "REFUND_PENDING")
        val finished = order(2, OrderStatus.DONE, createdAt = 9_000)

        val sorted = listOf(finished, unknown).sortedWith(needsSellerFirst)

        assertEquals(listOf(1L, 2L), sorted.map { it.id })
    }
}
