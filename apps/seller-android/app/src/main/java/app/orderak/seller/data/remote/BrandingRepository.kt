package app.orderak.seller.data.remote

import android.content.Context
import androidx.datastore.preferences.core.edit
import androidx.datastore.preferences.core.stringPreferencesKey
import androidx.datastore.preferences.preferencesDataStore
import app.orderak.seller.core.network.Backend
import app.orderak.seller.core.network.ApiRoutes
import dagger.hilt.android.qualifiers.ApplicationContext
import javax.inject.Inject
import javax.inject.Singleton
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.flow.map
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import kotlinx.serialization.Serializable
import app.orderak.seller.core.network.NetworkJson
import okhttp3.OkHttpClient
import okhttp3.Request

private val Context.brandingStore by preferencesDataStore(name = "branding")

/**
 * Validated server-driven branding and design-system revisions.
 *
 * The active revision is stable for the entire foreground session. A refresh
 * only stores a newer response as pending; the pending snapshot is promoted at
 * the next foreground transition. Invalid or malformed responses never replace
 * the last-known-good snapshot.
 */
@Singleton
class BrandingRepository @Inject constructor(
    @param:ApplicationContext private val context: Context,
    private val okHttpClient: OkHttpClient,
) {
    private object Keys {
        val ACTIVE_JSON = stringPreferencesKey("active_config_json")
        val PENDING_JSON = stringPreferencesKey("pending_config_json")
        val ETAG = stringPreferencesKey("etag")
    }

    @Serializable
    data class RemoteTheme(
        val primary: String? = null,
        val primary_strong: String? = null,
        val primary_soft: String? = null,
        val primary_tint: String? = null,
        val canvas: String? = null,
        val surface: String? = null,
        val ink: String? = null,
        val muted: String? = null,
        val line: String? = null,
        val danger: String? = null,
        val danger_soft: String? = null,
        val warning: String? = null,
        val warning_soft: String? = null,
        val accent: String? = null,
    )

    @Serializable
    data class BrandingConfig(
        val schemaVersion: Int = 1,
        val version: String = "",
        val revisionId: Long = 0,
        val generatorVersion: String = "",
        val source: DesignSystemSource? = null,
        val designSystem: DesignSystemSnapshot? = null,
        val theme: RemoteTheme = RemoteTheme(),
        val assets: Map<String, String> = emptyMap(),
    )

    @Serializable
    data class DesignSystemSource(
        val colors: ColorSource = ColorSource(),
    )

    @Serializable
    data class ColorSource(
        val defaultContrast: String = "standard",
    )

    @Serializable
    data class DesignSystemSnapshot(
        val schemaVersion: Int = 0,
        val generatorVersion: String = "",
        val schemes: Map<String, Map<String, Map<String, String>>> = emptyMap(),
        val semantic: Map<String, Map<String, Map<String, String>>> = emptyMap(),
        val typography: TypographySnapshot = TypographySnapshot(),
        val spacing: SpacingSnapshot = SpacingSnapshot(),
        val shapes: Map<String, Double> = emptyMap(),
        val components: ComponentConstraints = ComponentConstraints(),
        val contentHash: String = "",
    )

    @Serializable
    data class TypographySnapshot(
        val family: String = "cairo",
        val multiplier: Double = 1.0,
        val roles: Map<String, TypographyRole> = emptyMap(),
    )

    @Serializable
    data class TypographyRole(
        val sizeSp: Double = 0.0,
        val lineHeight: Double = 0.0,
        val weight: Int = 400,
        val letterSpacingEm: Double = 0.0,
    )

    @Serializable
    data class SpacingSnapshot(
        val values: List<Double> = emptyList(),
        val tokens: Map<String, Double> = emptyMap(),
    )

    @Serializable
    data class ComponentConstraints(
        val minimumTouchTargetDp: Double = 48.0,
    )

    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.Main)
    private val _config = MutableStateFlow<BrandingConfig?>(null)

    /** Stable active config for the current foreground session. */
    val config: StateFlow<BrandingConfig?> = _config.asStateFlow()

    init {
        scope.launch {
            runCatching {
                val cached = context.brandingStore.data.map { it[Keys.ACTIVE_JSON] }.first()
                if (!cached.isNullOrBlank()) decodeValidated(cached)?.let { _config.value = it }
            }
        }
    }

    /** Promote the previously downloaded pending revision at foreground entry. */
    suspend fun applyPendingOnForeground() = withContext(Dispatchers.IO) {
        runCatching {
            val stored = context.brandingStore.data.first()
            if (_config.value == null) {
                stored[Keys.ACTIVE_JSON]?.let { activeJson ->
                    decodeValidated(activeJson)?.let { active -> _config.value = active }
                }
            }
            val pendingJson = stored[Keys.PENDING_JSON]
                ?: return@runCatching
            val pending = decodeValidated(pendingJson) ?: return@runCatching
            val currentRevision = _config.value?.revisionId ?: 0L
            val current = _config.value
            val shouldPromote = current == null ||
                pending.revisionId > currentRevision ||
                (pending.schemaVersion < 2 && current.schemaVersion < 2 && pending.version != current.version)
            if (shouldPromote) {
                context.brandingStore.edit {
                    it[Keys.ACTIVE_JSON] = pendingJson
                    it.remove(Keys.PENDING_JSON)
                }
                _config.value = pending
            } else {
                context.brandingStore.edit { it.remove(Keys.PENDING_JSON) }
            }
        }
    }

    /** Download a newer config as pending. This never changes the active UI. */
    suspend fun refresh() = withContext(Dispatchers.IO) {
        runCatching {
            val etag = context.brandingStore.data.map { it[Keys.ETAG] }.first()
            val request = Request.Builder()
                .url(Backend.BASE_URL + ApiRoutes.v1("theme"))
                .apply { if (!etag.isNullOrBlank()) header("If-None-Match", etag) }
                .build()
            okHttpClient.newCall(request).execute().use { response ->
                if (response.code == 304 || !response.isSuccessful) return@use
                val body = response.body?.string() ?: return@use
                val parsed = decodeValidated(body) ?: return@use
                val current = _config.value
                if (parsed.schemaVersion >= 2 && parsed.revisionId <= (current?.revisionId ?: 0L)) return@use
                if (parsed.schemaVersion < 2 && current?.schemaVersion == 1 && parsed.version == current.version) return@use
                context.brandingStore.edit {
                    it[Keys.PENDING_JSON] = body
                    response.header("ETag")?.let { tag -> it[Keys.ETAG] = tag }
                }
            }
        }
    }

    internal fun decodeValidated(body: String): BrandingConfig? = decodeBrandingConfig(body)
}

private val designSystemJson = NetworkJson.decoder
private val designSystemHex = Regex("^#[0-9A-Fa-f]{6}$")
private val approvedDesignSystemFonts = setOf("cairo", "tajawal", "noto-arabic")
private val requiredDesignSystemColorRoles = setOf(
    "primary", "onPrimary", "primaryContainer", "onPrimaryContainer",
    "secondary", "onSecondary", "secondaryContainer", "onSecondaryContainer",
    "tertiary", "onTertiary", "tertiaryContainer", "onTertiaryContainer",
    "error", "onError", "errorContainer", "onErrorContainer",
    "background", "onBackground", "surface", "onSurface",
    "surfaceVariant", "onSurfaceVariant", "outline", "outlineVariant",
    "inverseSurface", "inverseOnSurface", "inversePrimary", "surfaceTint", "scrim",
)

internal fun decodeBrandingConfig(body: String): BrandingRepository.BrandingConfig? = runCatching {
    val parsed = designSystemJson.decodeFromString<BrandingRepository.BrandingConfig>(body)
    if (parsed.schemaVersion < 2) return@runCatching parsed
    val snapshot = parsed.designSystem ?: error("schema-v2 snapshot missing")
    require(snapshot.schemaVersion == 2)
    require(snapshot.contentHash.isNotBlank() && snapshot.contentHash == parsed.version)
    require(snapshot.schemes.keys.containsAll(listOf("standard", "medium", "high")))
    for (contrast in listOf("standard", "medium", "high")) {
        val variants = snapshot.schemes[contrast] ?: error("contrast missing")
        require(variants.keys.containsAll(listOf("light", "dark")))
        for (mode in listOf("light", "dark")) {
            val roles = variants[mode] ?: error("mode missing")
            require(requiredDesignSystemColorRoles.all { role ->
                roles[role]?.matches(designSystemHex) == true
            })
        }
    }
    require(snapshot.typography.roles.size == 15)
    require(snapshot.components.minimumTouchTargetDp >= 48.0)
    require(snapshot.typography.family in approvedDesignSystemFonts)
    parsed
}.getOrNull()
