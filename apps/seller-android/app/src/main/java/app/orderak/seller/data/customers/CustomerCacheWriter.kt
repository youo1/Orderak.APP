package app.orderak.seller.data.customers

import app.orderak.seller.data.db.CustomerDao
import app.orderak.seller.data.db.CustomerEntity
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
    private val customerDao: CustomerDao,
) {

    /** Take the server's copy of every customer it sent. */
    suspend fun putAll(remote: List<CustomerDto>) {
        val now = System.currentTimeMillis()
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
