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
    fun `the marker clears itself the moment the server accepts the order`() {
        // OrderRepository.pushOrder writes the returned order number into
        // remoteId, and nothing else has to happen for the chip, the banner and
        // the disabled status controls to resolve. The marker owns no state of
        // its own, which is why it cannot get stuck showing the wrong thing.
        val beforePost = order(remoteId = null)
        val afterPost = beforePost.copy(remoteId = 1001)
        assertTrue(beforePost.livesOnlyOnThisPhone)
        assertFalse(afterPost.livesOnlyOnThisPhone)
    }

    @Test
    fun `an order that failed to post is still marked, and still has its key`() {
        // The retry path: SyncRepository.pushPendingOrders finds it by
        // remoteId IS NULL AND idempotencyKey IS NOT NULL, and the key is what
        // makes the retry return the same order rather than a second one.
        val queued = order(remoteId = null).copy(idempotencyKey = "b8f1-0000")
        assertTrue(queued.livesOnlyOnThisPhone)
        assertTrue(queued.idempotencyKey != null)
    }
}
