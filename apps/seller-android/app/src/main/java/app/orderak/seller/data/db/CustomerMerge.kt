package app.orderak.seller.data.db

/**
 * Whether the server's copy of a customer may replace the device's.
 *
 * Extracted from the sync loop so it can be asserted directly. The rule is one
 * line and the consequence of getting it wrong is a seller watching their own
 * correction disappear: sync pulls the server's list after pushing local edits,
 * and a row whose edit has not been acknowledged must survive that pull. If it
 * did not, the seller would see the old name return, and then see the new one
 * come back a sync later — which reads as the app losing the edit and then
 * changing its mind.
 *
 * `dirty` is cleared only by a successful PATCH, so this is exactly "the server
 * has not confirmed it knows about this edit yet".
 */
fun mayAcceptServerCopy(local: CustomerEntity?): Boolean = local?.dirty != true

/**
 * The device's row for a customer the server has sent.
 *
 * `createdAt` is the device's own first-seen time rather than the server's: the
 * server's is a datetime string in another format, nothing on the device reads
 * it, and overwriting a local timestamp with a reformatted one would make the
 * list reorder itself for no reason a seller could explain.
 */
fun adoptedCustomer(
    customerKey: String,
    phoneRaw: String,
    phoneE164: String?,
    phoneStatus: String,
    name: String?,
    altContact: String?,
    note: String?,
    local: CustomerEntity?,
    now: Long,
): CustomerEntity = CustomerEntity(
    customerKey = customerKey,
    phone = phoneRaw,
    phoneE164 = phoneE164,
    phoneStatus = phoneStatus,
    name = name,
    altContact = altContact,
    note = note,
    createdAt = local?.createdAt ?: now,
    updatedAt = now,
    dirty = false,
)
