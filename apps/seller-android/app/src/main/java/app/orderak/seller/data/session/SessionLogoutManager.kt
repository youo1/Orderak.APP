package app.orderak.seller.data.session

import app.orderak.seller.data.auth.AuthRepository
import app.orderak.seller.data.billing.EntitlementRepository
import app.orderak.seller.data.db.OrderakDatabase
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import javax.inject.Inject
import javax.inject.Singleton

/** The single protected logout sequence used by every account state. */
@Singleton
class SessionLogoutManager @Inject constructor(
    private val authRepository: AuthRepository,
    private val database: OrderakDatabase,
    private val entitlementRepository: EntitlementRepository,
    private val sessionStore: SessionStore,
) {
    suspend fun logout() {
        authRepository.signOut()
        withContext(Dispatchers.IO) { database.clearAllTables() }
        entitlementRepository.clear()
        sessionStore.clear()
    }
}
