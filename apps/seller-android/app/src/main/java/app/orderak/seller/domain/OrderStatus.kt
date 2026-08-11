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
}

enum class PayMethod { VF_CASH, INSTAPAY, FAWRY, COD }
