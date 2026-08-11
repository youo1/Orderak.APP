package app.orderak.seller.data.session

import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import javax.inject.Inject
import javax.inject.Singleton

enum class SessionRouteSignalType { CREDENTIAL_REJECTED, ACCOUNT_RESTRICTED }

data class SessionRouteSignal(
    val id: Long,
    val type: SessionRouteSignalType,
    val accountStatus: String? = null,
)

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
    fun reportCredentialRejected() {
        _signal.value = SessionRouteSignal(++nextId, SessionRouteSignalType.CREDENTIAL_REJECTED)
    }

    @Synchronized
    fun reportRestricted(status: String?) {
        _signal.value = SessionRouteSignal(
            id = ++nextId,
            type = SessionRouteSignalType.ACCOUNT_RESTRICTED,
            accountStatus = status,
        )
    }

    @Synchronized
    fun acknowledge(id: Long) {
        if (_signal.value?.id == id) _signal.value = null
    }
}
