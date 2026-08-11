package app.orderak.seller.feature.splash

import android.os.SystemClock
import android.util.Log
import app.orderak.seller.data.remote.BackendApi
import app.orderak.seller.data.session.AccountStage
import app.orderak.seller.data.session.LocalSessionSnapshot
import app.orderak.seller.data.session.OnboardingStage
import app.orderak.seller.data.session.SessionRouteMonitor
import app.orderak.seller.data.session.SessionRouteSignal
import app.orderak.seller.data.session.SessionRouteSignalType
import app.orderak.seller.data.session.SessionStore
import androidx.lifecycle.ViewModel
import dagger.hilt.android.lifecycle.HiltViewModel
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.TimeoutCancellationException
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.withTimeout
import javax.inject.Inject
import javax.inject.Singleton

enum class EntryTrigger {
    APP_LAUNCH,
    LOGIN_COMPLETED,
    SETUP_COMPLETED,
    RESTRICTION_RECHECK,
    MID_SESSION_SIGNAL,
    RETRY,
}

sealed interface EntryDecision {
    data object Auth : EntryDecision
    data class Restricted(val status: String) : EntryDecision
    data class ShopSetup(val resumeStep: Int?) : EntryDecision
    data class Main(val offline: Boolean) : EntryDecision
    data class Error(val category: EntryError) : EntryDecision
}

enum class EntryError { LOCAL_STORAGE_UNAVAILABLE }

internal sealed interface RemoteAccountState {
    data object Active : RemoteAccountState
    data class Restricted(val status: String) : RemoteAccountState
    data object CredentialRejected : RemoteAccountState
    data object Unavailable : RemoteAccountState
}

internal object EntryDecisionPolicy {
    fun decide(
        local: LocalSessionSnapshot,
        hasExistingSecret: Boolean,
        remote: RemoteAccountState,
    ): EntryDecision {
        if (local.phone.isNullOrBlank() || !hasExistingSecret) return EntryDecision.Auth

        if (remote is RemoteAccountState.Restricted) {
            return EntryDecision.Restricted(remote.status)
        }

        if (remote is RemoteAccountState.CredentialRejected && local.accountStage == AccountStage.REGISTERED) {
            return EntryDecision.Auth
        }

        if (remote is RemoteAccountState.Unavailable && local.cachedAccountStatus.isRestrictedStatus()) {
            return EntryDecision.Restricted(local.cachedAccountStatus!!)
        }

        // PRE_REGISTRATION is explicit local evidence that account/store
        // creation has not completed. It must never fall through to Main even
        // if an older app version left ONBOARDING_STAGE=COMPLETE behind.
        if (local.accountStage == AccountStage.PRE_REGISTRATION) {
            val resumeStep = local.onboardingStep.takeIf {
                local.onboardingStage == OnboardingStage.IN_PROGRESS
            }
            return EntryDecision.ShopSetup(resumeStep)
        }

        val setupComplete = local.onboardingStage == OnboardingStage.COMPLETE
        if (!setupComplete) {
            val resumeStep = local.onboardingStep.takeIf { local.onboardingStage == OnboardingStage.IN_PROGRESS }
            return EntryDecision.ShopSetup(resumeStep)
        }

        return EntryDecision.Main(
            offline = remote is RemoteAccountState.Unavailable ||
                remote is RemoteAccountState.CredentialRejected,
        )
    }

    private fun String?.isRestrictedStatus(): Boolean =
        !isNullOrBlank() && !equals("active", ignoreCase = true)
}

@Singleton
class EntryRouteResolver @Inject constructor(
    private val sessionStore: SessionStore,
    private val backendApi: BackendApi,
    private val sessionRouteMonitor: SessionRouteMonitor,
) {
    suspend fun resolve(trigger: EntryTrigger): EntryDecision {
        val startedAt = SystemClock.elapsedRealtime()
        val pendingSignal = sessionRouteMonitor.signal.value
        val decision = resolveInternal(pendingSignal)
        if (pendingSignal != null && decision !is EntryDecision.Error) {
            sessionRouteMonitor.acknowledge(pendingSignal.id)
        }
        Log.i(
            TAG,
            "trigger=${trigger.name} decision=${decision.logName()} durationMs=${SystemClock.elapsedRealtime() - startedAt}",
        )
        return decision
    }

    private suspend fun resolveInternal(pendingSignal: SessionRouteSignal?): EntryDecision {
        val localAndSecret = try {
            withTimeout(LOCAL_TIMEOUT_MS) {
                sessionStore.snapshot() to sessionStore.readExistingSecret()
            }
        } catch (cancelled: CancellationException) {
            if (cancelled !is TimeoutCancellationException) throw cancelled
            return EntryDecision.Error(EntryError.LOCAL_STORAGE_UNAVAILABLE)
        } catch (_: Exception) {
            return EntryDecision.Error(EntryError.LOCAL_STORAGE_UNAVAILABLE)
        }

        val (local, secret) = localAndSecret
        val phone = local.phone
        if (phone.isNullOrBlank() || secret.isNullOrBlank()) {
            return EntryDecision.Auth
        }

        if (pendingSignal != null) {
            val signaledRemote = when (pendingSignal.type) {
                SessionRouteSignalType.CREDENTIAL_REJECTED -> RemoteAccountState.CredentialRejected
                SessionRouteSignalType.ACCOUNT_RESTRICTED -> {
                    val status = pendingSignal.accountStatus?.ifBlank { null } ?: "restricted"
                    cacheStatus(status)
                    RemoteAccountState.Restricted(status)
                }
            }
            return EntryDecisionPolicy.decide(local, hasExistingSecret = true, remote = signaledRemote)
        }

        val response = try {
            withTimeout(STATUS_TIMEOUT_MS) { backendApi.getAccountStatus(phone, secret) }
        } catch (cancelled: CancellationException) {
            if (cancelled !is TimeoutCancellationException) throw cancelled
            null
        } catch (_: Exception) {
            null
        }

        val remote = when {
            response == null -> RemoteAccountState.Unavailable
            response.ok && response.status.equals("active", ignoreCase = true) -> {
                cacheStatus("active")
                RemoteAccountState.Active
            }
            response.ok -> {
                val status = response.status.ifBlank { "restricted" }
                cacheStatus(status)
                RemoteAccountState.Restricted(status)
            }
            response.error == "auth" || response.error == "http_401" -> RemoteAccountState.CredentialRejected
            else -> RemoteAccountState.Unavailable
        }

        return EntryDecisionPolicy.decide(local, hasExistingSecret = true, remote = remote)
    }

    private suspend fun cacheStatus(status: String) {
        try {
            sessionStore.saveAccountStatus(status)
        } catch (cancelled: CancellationException) {
            throw cancelled
        } catch (_: Exception) {
            // Routing uses the current authoritative response even if the cache
            // cannot be refreshed. A later entry check will retry persistence.
        }
    }

    private fun EntryDecision.logName(): String = when (this) {
        EntryDecision.Auth -> "auth"
        is EntryDecision.Restricted -> "restricted"
        is EntryDecision.ShopSetup -> "shop_setup"
        is EntryDecision.Main -> if (offline) "main_offline" else "main"
        is EntryDecision.Error -> "error_${category.name.lowercase()}"
    }

    private companion object {
        const val TAG = "EntryRouting"
        const val LOCAL_TIMEOUT_MS = 5_000L
        const val STATUS_TIMEOUT_MS = 3_000L
    }
}

@HiltViewModel
class SessionRoutingViewModel @Inject constructor(
    private val monitor: SessionRouteMonitor,
) : ViewModel() {
    val signal: StateFlow<SessionRouteSignal?> = monitor.signal

    fun acknowledge(signalId: Long) {
        monitor.acknowledge(signalId)
    }
}
