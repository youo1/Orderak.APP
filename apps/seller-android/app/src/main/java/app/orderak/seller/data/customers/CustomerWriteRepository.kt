package app.orderak.seller.data.customers

import app.orderak.seller.data.remote.BackendApi
import app.orderak.seller.data.remote.CustomerDto
import app.orderak.seller.data.remote.CustomerRes
import app.orderak.seller.data.remote.CustomerUpdateReq
import app.orderak.seller.data.session.SessionStore
import kotlinx.coroutines.flow.first
import javax.inject.Inject
import javax.inject.Singleton

/**
 * What became of a customer edit.
 *
 * Exactly one variant carries a customer, so exactly one branch can reach the
 * cache — the same shape the product writes use, and for the same reason: the
 * Class A invariant is a claim about every branch at once, and written as a
 * value it can be enumerated by a test instead of re-read by a person.
 */
sealed interface CustomerWriteResult {
    data class Saved(val customer: CustomerDto) : CustomerWriteResult

    /** It did not reach the server. Nothing local changed, and nothing queued. */
    data object Offline : CustomerWriteResult

    /** The server considered it and said no. Nothing local changed. */
    data class Refused(val code: String?) : CustomerWriteResult
}

/** The codes `BackendApi` reports when a request never got an answer. */
private val TRANSPORT_FAILURES = setOf(
    "network", "bad_response",
    "http_500", "http_502", "http_503", "http_504",
)

/**
 * Read one customer write's answer.
 *
 * `ok` alone is not enough to store: a response claiming success without a
 * customer describes nothing, and writing a half-decoded body into the cache
 * would put a record in front of the seller that the server never sent.
 */
fun decideCustomerWrite(res: CustomerRes): CustomerWriteResult {
    val customer = res.customer
    if (res.ok && customer != null) return CustomerWriteResult.Saved(customer)
    if (res.error in TRANSPORT_FAILURES) return CustomerWriteResult.Offline
    return CustomerWriteResult.Refused(res.error)
}

/**
 * Customer edits, which reach the server or do not happen.
 *
 * WHAT THIS REPLACES
 *   `OrderRepository.editCustomer` wrote the edit locally and raised a `dirty`
 *   flag; the sync posted it later and cleared the flag on acknowledgement. That
 *   was a reasonable design under the mirror and is Class A now:
 *
 *       network failure
 *         -> the operation fails, visibly
 *         -> the local database is unchanged
 *         -> NO pending mutation is created anywhere
 *
 *   The old comment argued that a seller is often offline and a blocking edit
 *   would be lost. The answer this migration gives is that a customer note is
 *   not worth a second source of truth: it can be retyped, and the alternative
 *   is a `dirty` flag whose whole purpose is deciding which copy wins — which is
 *   the merge problem ADR-012 exists to remove rather than solve.
 *
 *   The `dirty` column survives until Room's next version, unused. Nothing sets
 *   it any more, which is why [CustomerCacheWriter] no longer consults it.
 */
@Singleton
class CustomerWriteRepository @Inject constructor(
    private val api: BackendApi,
    private val sessionStore: SessionStore,
    private val cache: CustomerCacheWriter,
) {

    /**
     * Save a seller's edit to a customer.
     *
     * The phone is not a parameter: it is the identity, and an edit that could
     * change it would be an edit that changes who this record is about.
     */
    suspend fun edit(
        customerKey: String,
        name: String,
        altContact: String,
        note: String,
    ): CustomerWriteResult {
        val phone = sessionStore.phone.first() ?: return CustomerWriteResult.Offline
        val secret = sessionStore.getOrCreateSecret()
        val res = api.updateCustomer(
            phone, secret, customerKey,
            CustomerUpdateReq(
                name = name.trim(),
                alt_contact = altContact.trim(),
                note = note.trim(),
            ),
        )
        val decision = decideCustomerWrite(res)
        // The cache is touched on exactly one line, inside the one branch that
        // has a customer to store. Every other outcome returns without writing.
        if (decision is CustomerWriteResult.Saved) cache.putAll(listOf(decision.customer))
        return decision
    }
}
