package app.orderak.seller.feature.orders

import app.orderak.seller.data.db.OrderEntity
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * The marker exists to tell a seller which orders are not on their account, so
 * the only thing worth testing is that it points at the right ones. Getting this
 * backwards would be worse than having no marker: it would reassure the seller
 * about the orders that can actually be lost.
 */
class LocalOnlyOrderTest {

    private fun order(remoteId: Long?) = OrderEntity(
        id = 1,
        remoteId = remoteId,
        buyerPhone = "01000000000",
        buyerName = "Buyer",
        status = "NEW",
        payMethod = "COD",
        totalMinor = 15_000,
        currency = "EGP",
        note = null,
    )

    @Test
    fun `an order the server has never seen lives on this phone only`() {
        // What OrderRepository.create() produces: written to Room, posted nowhere.
        assertTrue(order(remoteId = null).livesOnlyOnThisPhone)
    }

    @Test
    fun `an order pulled from the server does not`() {
        // remoteId is written only by the inbound pull, so its presence is proof
        // the order exists on the account.
        assertFalse(order(remoteId = 42).livesOnlyOnThisPhone)
    }

    @Test
    fun `the marker clears itself once orders are posted, without touching this code`() {
        // Work item 05 posts manual orders and reconciles the server's answer,
        // which sets remoteId. Nothing in the UI needs changing for the marker to
        // disappear — this file is meant to be deleted, not maintained, and this
        // test is what says so.
        val beforeItem05 = order(remoteId = null)
        val afterItem05 = beforeItem05.copy(remoteId = 1001)
        assertTrue(beforeItem05.livesOnlyOnThisPhone)
        assertFalse(afterItem05.livesOnlyOnThisPhone)
    }
}
