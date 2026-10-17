package app.orderak.seller.data.session

import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import java.security.MessageDigest
import javax.inject.Inject
import javax.inject.Singleton

enum class SessionRouteSignalType { CREDENTIAL_REJECTED, ACCOUNT_RESTRICTED }

/**
 * A server verdict about one device credential.
 *
 * [credentialFingerprint] names the credential the verdict is about. It is the
 * part that makes the signal safe to act on: a 401 says "the secret this request
 * carried is not valid", never "whatever secret the device holds now is not
 * valid". Without it, a late answer to a request sent with the previous
 * credential — a background sync, a retrying worker, or the logout revocation
 * itself, which always carries the credential being retired — was read as a
 * rejection of the session the seller had just signed in with, and signed them
 * straight back out. See [appliesTo].
 */
data class SessionRouteSignal(
    val id: Long,
    val type: SessionRouteSignalType,
    val credentialFingerprint: String,
    val accountStatus: String? = null,
)

/**
 * Whether this signal is about [currentSecret], the credential the device holds
 * right now. A signal about any other credential is history and must not route.
 */
fun SessionRouteSignal.appliesTo(currentSecret: String?): Boolean =
    !currentSecret.isNullOrBlank() && credentialFingerprint == credentialFingerprint(currentSecret)

/**
 * A one-way name for a device secret, so the monitor can compare credentials
 * without holding a bearer secret in a long-lived, observable object.
 */
fun credentialFingerprint(secret: String): String =
    MessageDigest.getInstance("SHA-256")
        .digest(secret.toByteArray(Charsets.UTF_8))
        .joinToString("") { "%02x".format(it) }

/**
 * Durable in-process signal for authenticated API responses that invalidate
 * the currently rendered root flow. StateFlow avoids losing the signal while
 * Compose is briefly stopped or recomposing.
 */
@Singleton
class SessionRouteMonitor @Inject constructor() {
    private val _signal = MutableStateFlow<SessionRouteSignal?>(null)
    val signal: StateFlow<SessionRouteSignal?> = _signal.asStateFlow()
    private var nextId = 0L

    @Synchronized
    fun reportCredentialRejected(credentialFingerprint: String) {
        _signal.value = SessionRouteSignal(
            id = ++nextId,
            type = SessionRouteSignalType.CREDENTIAL_REJECTED,
            credentialFingerprint = credentialFingerprint,
        )
    }

    @Synchronized
    fun reportRestricted(status: String?, credentialFingerprint: String) {
        _signal.value = SessionRouteSignal(
            id = ++nextId,
            type = SessionRouteSignalType.ACCOUNT_RESTRICTED,
            credentialFingerprint = credentialFingerprint,
            accountStatus = status,
        )
    }

    @Synchronized
    fun acknowledge(id: Long) {
        if (_signal.value?.id == id) _signal.value = null
    }
}
