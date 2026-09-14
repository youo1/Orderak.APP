package app.orderak.seller.data.customers

import app.orderak.seller.data.remote.BackendApi
import app.orderak.seller.data.remote.CustomerUpdateReq
import app.orderak.seller.data.session.SessionStore
import kotlinx.coroutines.flow.first
import javax.inject.Inject
import javax.inject.Singleton

/** What became of a customer edit, in terms a screen can render. */
sealed interface CustomerWriteResult {
    data object Saved : CustomerWriteResult

    /** It did not reach the server. Nothing local changed. */
    data object Offline : CustomerWriteResult

    /** The server refused it. Nothing local changed. */
    data class Refused(val code: String?) : CustomerWriteResult
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
        if (!res.ok) {
            return if (res.error in TRANSPORT_FAILURES) {
                CustomerWriteResult.Offline
            } else {
                CustomerWriteResult.Refused(res.error)
            }
        }
        res.customer?.let { cache.putAll(listOf(it)) }
        return CustomerWriteResult.Saved
    }

    private companion object {
        /** The codes `BackendApi` reports when a request never got an answer. */
        val TRANSPORT_FAILURES = setOf(
            "network", "bad_response",
            "http_500", "http_502", "http_503", "http_504",
        )
    }
}
