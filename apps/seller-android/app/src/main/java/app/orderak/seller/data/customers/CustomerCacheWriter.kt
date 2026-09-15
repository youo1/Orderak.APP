package app.orderak.seller.data.customers

import androidx.room.withTransaction
import app.orderak.seller.data.db.CustomerEntity
import app.orderak.seller.data.db.OrderakDatabase
import app.orderak.seller.data.remote.CustomerDto
import javax.inject.Inject
import javax.inject.Singleton

/**
 * The only place a customer row is written from server state.
 *
 * WHAT THIS REPLACES
 *   The sync loop pushed local edits, then pulled the server's list and took
 *   each row *unless* it was still dirty — the rule `mayAcceptServerCopy`
 *   existed for. That rule was correct and is now unnecessary: a customer edit
 *   is Class A, so it either reached the server or did not happen, and no row
 *   can be carrying an unacknowledged local change by the time a pull lands.
 *
 *   Deleting a rule because the case it guarded can no longer arise is the point
 *   of this migration. Deleting one because it seems unlikely is not, which is
 *   why this comment records which of the two happened.
 */
@Singleton
class CustomerCacheWriter @Inject constructor(
    private val db: OrderakDatabase,
) {

    /**
     * Take the server's copy of every customer it sent.
     *
     * WHY THE WHOLE LIST IS ONE TRANSACTION
     *   Each row is a read (`findByKey`) followed by a write, and the read is
     *   what preserves this device's own first-seen time — see [createdAt]
     *   below. Orders write customers too, through `insertIgnore` and `fillName`
     *   on the order path, and those are deliberately outside this boundary
     *   because an order is Class B and genuinely owns that projection.
     *
     *   So without a transaction an order arriving mid-refresh can insert a
     *   customer between this loop's read and its write, and the write then
     *   stamps `createdAt = now` over a row that already had an earlier one.
     *   The result is the customer list reordering itself for a reason the
     *   seller cannot explain — which is precisely what reading the local value
     *   exists to prevent.
     *
     *   This is not the delete-all-then-insert-N shape the contract forbids:
     *   nothing here deletes, so a failure loses no customer. It is the weaker
     *   half of the same rule — a partial cache must not be observable — and it
     *   is the one writer that was not holding it.
     */
    suspend fun putAll(remote: List<CustomerDto>) = db.withTransaction {
        val now = System.currentTimeMillis()
        val customerDao = db.customerDao()
        for (dto in remote) {
            val local = customerDao.findByKey(dto.customer_key)
            customerDao.upsert(
                CustomerEntity(
                    customerKey = dto.customer_key,
                    phone = dto.phone_raw,
                    phoneE164 = dto.phone_e164,
                    phoneStatus = dto.phone_status,
                    name = dto.name,
                    altContact = dto.alt_contact,
                    note = dto.note,
                    // The device's own first-seen time, not the server's. The
                    // server's is a datetime string in another format, nothing
                    // on the device reads it, and overwriting a local timestamp
                    // with a reformatted one would make the list reorder itself
                    // for no reason a seller could explain.
                    createdAt = local?.createdAt ?: now,
                    updatedAt = now,
                ),
            )
        }
    }
}
