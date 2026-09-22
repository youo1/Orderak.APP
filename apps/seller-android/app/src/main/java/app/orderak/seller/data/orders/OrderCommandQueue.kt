package app.orderak.seller.data.orders

import javax.inject.Inject
import javax.inject.Singleton

/**
 * Orders the seller recorded that the server has not acknowledged.
 *
 * CLASS B: A DURABLE COMMAND LOG, NOT A SYNC ENGINE
 *
 *     network failure
 *       -> the command is persisted and survives process death
 *       -> a worker retries it until the server acknowledges it
 *       -> the drain is INDEPENDENT of any Class A call succeeding
 *
 * The distinction from the catalogue mirror this migration removes is not the
 * number of round trips. A mirror asked "make your state match mine", which
 * requires deciding who is right when they differ. This replays business intents
 * in order against one source of truth: each order is a thing that happened,
 * carried by an idempotency key, and replaying it converges rather than
 * conflicts. There is nothing to merge because only one side is writing.
 *
 * WHY ORDERS AND NOTHING ELSE
 *   The boundary is one question: does losing this write cost the seller money?
 *   A product edit that fails can be retyped in ten seconds. A sale taken at a
 *   market stall with no signal cannot be recovered at all, because the buyer has
 *   gone. Everything on the paying side of that line is here; everything else is
 *   Class A and fails visibly instead. Adding a second member to this queue means
 *   amending ADR-012 first.
 *
 * WHY IT IS A THIN WRAPPER AND NOT A REWRITE
 *   [OrderRepository.pushPendingOrders] already is this: append-only, keyed by a
 *   stored idempotency key, classifying its own outcomes as retryable, refused
 *   or not-ready, and surfacing refusals rather than swallowing them. It was the
 *   one part of the old sync that never needed fixing. This exists to give it a
 *   name that says what it is, and a seam the worker can depend on without
 *   reaching into the order repository.
 */
@Singleton
class OrderCommandQueue @Inject constructor(
    private val orders: OrderRepository,
) {

    /**
     * Post every unacknowledged order.
     *
     * Called before anything else in the worker, and deliberately not gated on a
     * refresh having succeeded. Under the old sync the order push sat behind a
     * successful catalogue pull, so a seller whose catalogue request failed also
     * could not deliver a sale they had already made — two unrelated failures
     * wired together by nothing more than statement order.
     */
    suspend fun drain(): Boolean = orders.pushPendingOrders()
}
