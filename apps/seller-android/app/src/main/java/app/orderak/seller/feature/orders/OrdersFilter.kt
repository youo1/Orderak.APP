package app.orderak.seller.feature.orders

import app.orderak.seller.data.db.OrderEntity
import app.orderak.seller.domain.OrderStatus
import java.util.Calendar

/**
 * What a seller can be looking at when they look at the orders list.
 *
 * WHY THIS IS A TYPE AND NOT AN `OrderStatus?`
 *   The list used to filter on a single `OrderStatus`, which covered the status
 *   chips and nothing else. The اليوم counters do not map onto that vocabulary:
 *
 *     أوردرات النهاردة   createdAt >= startOfToday   a date, not a status
 *     لسه مدفعوش          status IN (NEW, CONFIRMED)  two statuses, not one
 *     جاهز للشحن          status = PAID               the only clean fit
 *
 *   So all three counters navigated to the *unfiltered* list, and tapping
 *   "لسه مدفعوش ٣" showed everything. Widening `setFilter` to take a second
 *   argument, or a set, would have made one method mean several different
 *   things. Naming the question instead keeps one vocabulary that both the
 *   counters and the chips speak.
 *
 * WHY THE PREDICATE LIVES HERE
 *   [matches] is the single definition of what each filter means. The counters
 *   are Room `COUNT(*)` queries and this is an in-memory predicate, so the two
 *   can disagree — and a counter that disagrees with the list it opens is the
 *   defect this type exists to remove. [OrdersFilterTest] pins them to the same
 *   rule; `Daos.kt` holds the SQL side.
 */
sealed interface OrdersFilter {

    /** Everything the device holds. The list's default. */
    data object All : OrdersFilter

    /**
     * Created since local midnight.
     *
     * Deliberately a *device* day, matching `OrderDao.countSince(startOfToday)`:
     * the seller's day ends when their shop closes, not at UTC midnight.
     */
    data object Today : OrdersFilter

    /** Money not yet taken — the counter a seller acts on first. */
    data object Unpaid : OrdersFilter

    /** Paid and waiting to leave the shop. */
    data object ToShip : OrdersFilter

    /** One exact status, which is what the chips have always offered. */
    data class Status(val status: OrderStatus) : OrdersFilter

    fun matches(order: OrderEntity, now: Long = System.currentTimeMillis()): Boolean = when (this) {
        All -> true
        Today -> order.createdAt >= startOfDay(now)
        // Mirrors OrderDao.countUnpaid(): NEW or CONFIRMED.
        Unpaid -> order.status == OrderStatus.NEW.name || order.status == OrderStatus.CONFIRMED.name
        // Mirrors OrderDao.countToShip(): PAID.
        ToShip -> order.status == OrderStatus.PAID.name
        is Status -> order.status == status.name
    }

    companion object {
        /**
         * Local midnight for the day containing [now].
         *
         * Duplicated from the counters' own helper rather than shared through a
         * utility, because the two are only allowed to agree by *definition* —
         * [OrdersFilterTest] asserts it, so a change to one that forgets the
         * other fails rather than silently drifting.
         */
        fun startOfDay(now: Long): Long = Calendar.getInstance().apply {
            timeInMillis = now
            set(Calendar.HOUR_OF_DAY, 0)
            set(Calendar.MINUTE, 0)
            set(Calendar.SECOND, 0)
            set(Calendar.MILLISECOND, 0)
        }.timeInMillis
    }
}
