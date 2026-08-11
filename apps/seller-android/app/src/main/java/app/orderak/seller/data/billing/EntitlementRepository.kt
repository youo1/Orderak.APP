package app.orderak.seller.data.billing

import android.content.Context
import androidx.datastore.preferences.core.edit
import androidx.datastore.preferences.core.longPreferencesKey
import androidx.datastore.preferences.core.stringPreferencesKey
import androidx.datastore.preferences.preferencesDataStore
import app.orderak.seller.data.remote.BackendConfig
import app.orderak.seller.data.remote.BackendApi
import app.orderak.seller.data.remote.EntitlementFetchResult
import app.orderak.seller.data.remote.EntitlementSnapshotRes
import app.orderak.seller.data.remote.toBackendConfig
import app.orderak.seller.core.network.NetworkJson
import app.orderak.seller.data.session.SessionStore
import dagger.hilt.android.qualifiers.ApplicationContext
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import javax.inject.Inject
import javax.inject.Singleton

private val Context.entitlementStore by preferencesDataStore(name = "entitlements")

enum class EntitlementFreshness { EMPTY, CACHED, FRESH, OFFLINE }

data class EntitlementSyncState(
    val config: BackendConfig? = null,
    val freshness: EntitlementFreshness = EntitlementFreshness.EMPTY,
    val isRefreshing: Boolean = false,
    val lastUpdatedEpochMs: Long? = null,
    val error: String? = null,
)

enum class EntitlementRefreshResult { UPDATED, NOT_MODIFIED, CACHED, SKIPPED, FAILED }

/**
 * Account-scoped stale-while-revalidate storage for the backend-authoritative
 * entitlement snapshot. Cached data is UI guidance; write endpoints remain the
 * enforcement boundary and can always return a fresher denial.
 */
@Singleton
class EntitlementRepository @Inject constructor(
    @param:ApplicationContext private val context: Context,
    private val backendApi: BackendApi,
    private val sessionStore: SessionStore,
    private val entitlementManager: EntitlementManager,
) {
    private object Keys {
        val ACCOUNT = stringPreferencesKey("account")
        val CONFIG = stringPreferencesKey("config_json")
        val ETAG = stringPreferencesKey("etag")
        val UPDATED_AT = longPreferencesKey("updated_at")
        val CHECKED_AT = longPreferencesKey("checked_at")
    }

    private val json = NetworkJson.decoder
    private val refreshMutex = Mutex()
    private val _state = MutableStateFlow(EntitlementSyncState())
    val state: StateFlow<EntitlementSyncState> = _state.asStateFlow()
    private var loadedAccount: String? = null

    suspend fun refresh(force: Boolean = false): EntitlementRefreshResult = refreshMutex.withLock {
        val phone = sessionStore.phone.first().orEmpty()
        if (phone.isBlank()) return EntitlementRefreshResult.SKIPPED
        loadCache(phone)

        val now = System.currentTimeMillis()
        val checkedAt = context.entitlementStore.data.first()[Keys.CHECKED_AT] ?: 0L
        if (!force && now - checkedAt < STALE_AFTER_MS && _state.value.config != null) {
            return EntitlementRefreshResult.CACHED
        }

        _state.value = _state.value.copy(isRefreshing = true, error = null)
        val prefs = context.entitlementStore.data.first()
        // Never send a validator when its cached representation is missing or
        // corrupt; otherwise a valid 304 could leave the app with no config.
        val etag = prefs[Keys.ETAG].takeIf { _state.value.config != null }
        val secret = sessionStore.getOrCreateSecret()
        try {
            when (val result = backendApi.fetchEntitlements(phone, secret, etag)) {
                is EntitlementFetchResult.Updated -> {
                    acceptConfig(phone, result.snapshot.toBackendConfig(), result.snapshot.etag, now)
                    EntitlementRefreshResult.UPDATED
                }
                is EntitlementFetchResult.NotModified -> {
                    context.entitlementStore.edit { values ->
                        values[Keys.CHECKED_AT] = now
                        result.etag?.let { values[Keys.ETAG] = it }
                    }
                    _state.value = _state.value.copy(
                        freshness = EntitlementFreshness.FRESH,
                        isRefreshing = false,
                        error = null,
                    )
                    EntitlementRefreshResult.NOT_MODIFIED
                }
                is EntitlementFetchResult.Failed -> {
                    _state.value = _state.value.copy(
                        freshness = if (_state.value.config == null) EntitlementFreshness.EMPTY else EntitlementFreshness.OFFLINE,
                        isRefreshing = false,
                        error = result.error,
                    )
                    EntitlementRefreshResult.FAILED
                }
            }
        } catch (cancelled: CancellationException) {
            _state.value = _state.value.copy(isRefreshing = false)
            throw cancelled
        }
    }

    suspend fun acceptSnapshot(snapshot: EntitlementSnapshotRes) {
        val phone = sessionStore.phone.first().orEmpty()
        if (phone.isNotBlank() && snapshot.ok) {
            acceptConfig(phone, snapshot.toBackendConfig(), snapshot.etag, System.currentTimeMillis())
        }
    }

    /** Compatibility input while ENTITLEMENTS_ENABLED remains false. */
    suspend fun acceptConfig(config: BackendConfig) {
        val phone = sessionStore.phone.first().orEmpty()
        if (phone.isNotBlank()) acceptConfig(phone, config, null, System.currentTimeMillis())
    }

    suspend fun clear() {
        context.entitlementStore.edit { it.clear() }
        loadedAccount = null
        entitlementManager.clear()
        _state.value = EntitlementSyncState()
    }

    private suspend fun loadCache(account: String) {
        if (loadedAccount == account) return
        val prefs = context.entitlementStore.data.first()
        val cached = if (prefs[Keys.ACCOUNT] == account) {
            prefs[Keys.CONFIG]?.let { encoded ->
                runCatching { json.decodeFromString<BackendConfig>(encoded) }.getOrNull()
            }
        } else null
        if (cached != null) {
            entitlementManager.updateFromBackend(cached)
            _state.value = EntitlementSyncState(
                config = cached,
                freshness = EntitlementFreshness.CACHED,
                lastUpdatedEpochMs = prefs[Keys.UPDATED_AT],
            )
        } else {
            entitlementManager.clear()
            _state.value = EntitlementSyncState()
        }
        loadedAccount = account
    }

    private suspend fun acceptConfig(
        account: String,
        config: BackendConfig,
        etag: String?,
        now: Long,
    ) {
        context.entitlementStore.edit { values ->
            values[Keys.ACCOUNT] = account
            values[Keys.CONFIG] = json.encodeToString(BackendConfig.serializer(), config)
            if (etag == null) values.remove(Keys.ETAG) else values[Keys.ETAG] = etag
            values[Keys.UPDATED_AT] = now
            values[Keys.CHECKED_AT] = now
        }
        entitlementManager.updateFromBackend(config)
        _state.value = EntitlementSyncState(
            config = config,
            freshness = EntitlementFreshness.FRESH,
            isRefreshing = false,
            lastUpdatedEpochMs = now,
        )
    }

    companion object {
        private const val STALE_AFTER_MS = 5 * 60 * 1_000L
    }
}
