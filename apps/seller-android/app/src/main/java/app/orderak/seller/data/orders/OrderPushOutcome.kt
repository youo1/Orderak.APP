package app.orderak.seller.data.orders

/**
 * What happened when this device tried to put a locally recorded order on the
 * account, and whether trying again can change it.
 *
 * WHY THE DISTINCTION HAS TO EXIST
 *   `pushOrder` used to return a bare Boolean, and every caller read `false` as
 *   "not yet". That is right for a dropped connection and wrong for a refusal:
 *   a 400 saying the store cannot accept this payment method answers the same
 *   way on the thousandth attempt as on the first, so the order was retried on
 *   every sync forever while the seller was shown "it will send on the next
 *   sync" and given no way to correct or remove it.
 *
 *   Separating the two is what lets the app stop retrying, say which of the two
 *   it is, and offer the seller an action that works.
 */
sealed interface OrderPushOutcome {
    /** On the account — including the replay case, where it already was. */
    data object Accepted : OrderPushOutcome

    /**
     * Not on the account yet, and another attempt is the right response.
     * Transport failure, a 5xx, or rate limiting.
     */
    data class Retryable(val code: String) : OrderPushOutcome

    /**
     * The server refused this order as it stands, and will refuse it again.
     * [code] is the stable backend code, so the screen can say which refusal.
     */
    data class Refused(val code: String) : OrderPushOutcome

    /**
     * The order cannot be expressed yet — a line names a product that has never
     * synced, so it has no server-side code. Not a failure: the catalogue push
     * gives it one and the next sync carries the order.
     */
    data object NotReady : OrderPushOutcome
}

/**
 * Which backend answers are worth another attempt.
 *
 * Kept as a function over the code rather than over the HTTP status because
 * that is what reaches this layer: `BackendApi.apiCall` maps a transport
 * failure to "network", an unparseable body to "bad_response", a 5xx or a
 * bodyless 4xx to "http_<code>", and passes a structured 4xx through as its
 * own domain code.
 *
 * Everything not named here is terminal. That direction matters: a new refusal
 * code the server adds tomorrow should stop the retry loop and surface itself,
 * not spin quietly — an unknown refusal is far more likely to be permanent than
 * transient, and a terminal classification is recoverable by the seller while
 * an infinite retry is not.
 */
fun isRetryableOrderPushCode(code: String): Boolean =
    code == "network" ||
        code == "bad_response" ||
        code == "rate_limited" ||
        code == "server" ||
        code == "http_408" ||
        code == "http_429" ||
        code.startsWith("http_5")
