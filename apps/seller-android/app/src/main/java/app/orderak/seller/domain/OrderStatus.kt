package app.orderak.seller.domain

/** Order pipeline state machine (Plan §3.4): explicit allowed transitions only. */
enum class OrderStatus {
    NEW, CONFIRMED, PAID, SHIPPED, DONE, CANCELLED;

    val next: OrderStatus?
        get() = when (this) {
            NEW -> CONFIRMED
            CONFIRMED -> PAID
            PAID -> SHIPPED
            SHIPPED -> DONE
            DONE, CANCELLED -> null
        }

    val canCancel: Boolean get() = this == NEW || this == CONFIRMED

    /**
     * True while the order is still the seller's problem.
     *
     * One definition, because two places need it and they have to agree: the list's
     * row draws its rail and its chip from it, and the list's own order sorts by it.
     * It was a `private val` in `OrdersScreen.kt`, which is the copy the sort could
     * not see — so the surface said it was "ordered by whether they need the seller"
     * (`SellerSurface.Orders`) while its query said `ORDER BY createdAt DESC`.
     */
    val needsSeller: Boolean get() = this != DONE && this != CANCELLED
}

enum class PayMethod { VF_CASH, INSTAPAY, FAWRY, COD }
