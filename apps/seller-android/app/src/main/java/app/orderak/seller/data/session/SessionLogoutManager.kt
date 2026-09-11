package app.orderak.seller.data.session

import android.util.Log
import app.orderak.seller.data.auth.AuthRepository
import app.orderak.seller.data.billing.EntitlementRepository
import app.orderak.seller.data.db.OrderakDatabase
import app.orderak.seller.data.remote.BackendApi
import app.orderak.seller.feature.settings.runLogoutSequence
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.withContext
import javax.inject.Inject
import javax.inject.Singleton

/**
 * The single protected logout sequence used by every account state.
 *
 * It is now genuinely single. The settings screen used to assemble its own copy
 * of the sequence, so the class named for being the only one had a second caller
 * that was not it — and the two drifted by exactly one step, because neither
 * revoked the credential and adding that to one would have left the other
 * signing sellers out while leaving a working credential behind.
 */
@Singleton
class SessionLogoutManager @Inject constructor(
    private val authRepository: AuthRepository,
    private val backendApi: BackendApi,
    private val database: OrderakDatabase,
    private val entitlementRepository: EntitlementRepository,
    private val sessionStore: SessionStore,
) {
    suspend fun logout() {
        // Read before anything is torn down: the revocation authenticates with
        // exactly the credential this sequence is about to destroy.
        val phone = sessionStore.phone.first().orEmpty()
        val secret = sessionStore.readExistingSecret().orEmpty()

        runLogoutSequence(
            revokeCredential = { revokeCredential(phone, secret) },
            signOutProvider = { authRepository.signOut() },
            clearBusinessData = { withContext(Dispatchers.IO) { database.clearAllTables() } },
            clearEntitlements = { entitlementRepository.clear() },
            clearSession = { sessionStore.clear() },
            clearDeviceSecret = { sessionStore.clearDeviceSecret() },
        )
    }

    /**
     * Retire this device's credential server-side. Best effort, by necessity.
     *
     * A seller signing out on a train has no network, and refusing to sign them
     * out until they have one would be the wrong trade: the local teardown is
     * what protects the handset in front of them, and it must not be blocked on
     * reaching a server they cannot reach.
     *
     * So the failure is logged rather than surfaced, and the residual risk is
     * stated rather than hidden — an offline sign-out leaves a credential valid
     * on the server until the account's next sign-in replaces it. Closing that
     * fully needs a server-side lifetime, which a bearer device secret does not
     * have. Recorded in the auth contract under guarantee 10.
     */
    private suspend fun revokeCredential(phone: String, secret: String) {
        if (phone.isBlank() || secret.isBlank()) return
        try {
            val response = backendApi.logout(phone, secret)
            if (!response.ok) {
                Log.w(TAG, "Credential revocation was refused; it stays valid until re-login replaces it.")
            }
        } catch (cancelled: CancellationException) {
            throw cancelled
        } catch (_: Exception) {
            Log.w(TAG, "Credential revocation could not be sent; it stays valid until re-login replaces it.")
        }
    }

    private companion object {
        const val TAG = "SessionLogout"
    }
}
