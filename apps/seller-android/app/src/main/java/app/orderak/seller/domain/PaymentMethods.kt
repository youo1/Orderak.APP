package app.orderak.seller.domain

/**
 * Which payment methods this store may actually record an order under.
 *
 * WHY THIS EXISTS
 *   The server decides, and it decides from the store's own payout details:
 *
 *     services/backend/src/domains/catalog/catalog.ts, createOrder()
 *       const payMethods = ["COD"];
 *       if (store.vfcash)   payMethods.push("VF_CASH");
 *       if (store.instapay) payMethods.push("INSTAPAY");
 *       if (!payMethods.includes(payMethod)) -> 400 payment_unavailable
 *
 *   The storefront already derives its `<option>` list from exactly those two
 *   fields (catalog.ts, renderStorePage). The seller app did not: it rendered
 *   `PayMethod.entries` — all four values, unfiltered — and pre-selected
 *   VF_CASH. Onboarding collects neither payout detail, so a seller who
 *   completed sign-up and recorded their first order was refused by the server
 *   with a method the app had chosen for them, and [FAWRY] was refused for
 *   every store on every plan because the server has never accepted it.
 *
 *   So there were two clients of one rule and only the seller-facing one was
 *   wrong. This is the rule, in one place, mirroring the server.
 *
 * WHY COD IS FIRST AND IS THE DEFAULT
 *   COD is the one method the server accepts unconditionally. Putting it first
 *   means the pre-selected value can never be the thing that gets the order
 *   refused — which is the property that matters, and the one the previous
 *   default did not have. A seller who takes payment another way changes it in
 *   one tap; a seller who has configured nothing cannot be led into a refusal.
 *
 * WHY FAWRY IS STILL IN THE ENUM
 *   Orders recorded before this change may hold "FAWRY" in Room, and
 *   `PayMethod.valueOf` has to keep resolving it so those rows still render.
 *   It is unreachable from [availablePayMethods], which is what stops a new
 *   order being recorded under it.
 */
fun availablePayMethods(vfcash: String?, instapay: String?): List<PayMethod> = buildList {
    add(PayMethod.COD)
    if (!vfcash.isNullOrBlank()) add(PayMethod.VF_CASH)
    if (!instapay.isNullOrBlank()) add(PayMethod.INSTAPAY)
}

/**
 * The method to select when the screen opens, or when the available set changed
 * underneath the seller's choice.
 *
 * Keeps [current] when it is still available, so re-reading the store's details
 * does not silently move a deliberate selection.
 */
fun resolvePayMethod(available: List<PayMethod>, current: PayMethod?): PayMethod =
    current?.takeIf { it in available } ?: available.first()
