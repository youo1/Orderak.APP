package app.orderak.seller.data.orders

import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * Which answers from the order-create endpoint are worth another attempt.
 *
 * WHY THE DISTINCTION IS THE WHOLE FIX
 *   `pushOrder` returned a Boolean and every caller read `false` as "not yet".
 *   For a dropped connection that is right. For a 400 saying the store cannot
 *   accept this payment method it is not: the server answers identically on the
 *   thousandth attempt, so the order was retried on every sync forever while the
 *   seller was shown "it will send on the next sync" and offered no action that
 *   could work.
 *
 *   The classification below is what lets the app stop retrying, name the
 *   reason, and offer removal instead.
 */
class OrderPushOutcomeTest {

    @Test
    fun `transport and server failures are retried`() {
        for (code in listOf("network", "bad_response", "server", "http_500", "http_503", "http_429", "http_408")) {
            assertTrue(code, isRetryableOrderPushCode(code))
        }
    }

    @Test
    fun `rate limiting is retried, because it is a wait and not a refusal`() {
        assertTrue(isRetryableOrderPushCode("rate_limited"))
    }

    @Test
    fun `the refusals that caused this are terminal`() {
        // Every one of these answers the same way on every attempt. They are the
        // codes createOrder() can return for an order that cannot be accepted as
        // it stands — see catalog.ts.
        for (code in listOf(
            "payment_unavailable",
            "products",
            "duplicate_products",
            "stock_changed",
            "mixed_currency_order",
            "invalid",
            "idempotency_key_required",
            "orders_disabled",
            "buyer_restricted",
            "plan_limit_reached",
        )) {
            assertFalse(code, isRetryableOrderPushCode(code))
        }
    }

    @Test
    fun `an unknown code is terminal, which is the safe direction`() {
        // A refusal the server adds tomorrow should stop the loop and surface
        // itself rather than spin quietly. Terminal is recoverable by the seller;
        // an infinite retry is not.
        assertFalse(isRetryableOrderPushCode("some_code_added_later"))
    }

    @Test
    fun `a 4xx that is not a wait is never retried`() {
        for (code in listOf("http_400", "http_403", "http_404", "http_409", "http_413")) {
            assertFalse(code, isRetryableOrderPushCode(code))
        }
    }
}
