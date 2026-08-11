package app.orderak.seller.data.remote

import app.orderak.seller.data.session.SessionStore
import kotlinx.coroutines.flow.first
import javax.inject.Inject
import javax.inject.Singleton

/**
 * Resolves the store's public identifier (the "<ISO2>-<slug>-<CODE>" used to
 * build shareable links) on demand.
 *
 * The share buttons used to fall back to a URL-less text catalog whenever the
 * identifier wasn't cached locally yet — e.g. before the first background sync
 * finished, or after a reinstall — producing a share message with no link.
 * This fetches the identity from the backend just-in-time and persists it, so
 * a seller who is online always shares a real link. Null is returned only when
 * the identity is genuinely unavailable (offline and never registered), in
 * which case the caller may fall back to the plain text catalog.
 */
@Singleton
class StoreIdentityResolver @Inject constructor(
    private val api: BackendApi,
    private val sessionStore: SessionStore,
) {
    suspend fun ensure(): String? {
        // Fast path: already cached locally.
        sessionStore.storeIdentifier.first()?.let { return it }

        // Fetch from the backend and persist for next time.
        val phone = sessionStore.phone.first()?.ifBlank { null } ?: return null
        val secret = sessionStore.getOrCreateSecret()
        val store = api.getStore(phone, secret).store ?: return null
        val pid = store.public_identifier?.ifBlank { null } ?: return null

        sessionStore.saveStoreIdentity(
            slug = store.slug,
            publicIdentifier = pid,
            storeCode = store.store_code,
            countryCode = store.country_code,
            storeUrl = store.store_url,
        )
        return pid
    }
}
