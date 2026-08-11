package app.orderak.seller.data.theme

import android.content.Context
import androidx.datastore.preferences.core.booleanPreferencesKey
import androidx.datastore.preferences.core.edit
import androidx.datastore.preferences.core.stringPreferencesKey
import androidx.datastore.preferences.preferencesDataStore
import dagger.hilt.android.qualifiers.ApplicationContext
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.SharingStarted
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.map
import kotlinx.coroutines.flow.stateIn
import javax.inject.Inject
import javax.inject.Singleton

private val Context.themePreferencesStore by preferencesDataStore(name = "theme_preferences")

/**
 * Persisted user theme override preferences.
 *
 * When [themeMode] is System, the app follows the device's night-mode setting.
 * When [themeMode] is Light or Dark, the app overrides the system setting.
 * [contrastLevel] is the user's chosen contrast level; when Standard the app
 * falls back to the system's high-contrast accessibility flag at startup and
 * the user can still override it. [dynamicColorEnabled] controls whether the
 * app uses Material You dynamic color (Android 12+).
 *
 * All preferences are backed by DataStore and survive process death.
 */
@Singleton
class ThemePreferencesRepository @Inject constructor(
    @param:ApplicationContext private val context: Context,
) {
    enum class ThemeMode(val key: String) {
        System("system"),
        Light("light"),
        Dark("dark");

        companion object {
            fun fromKey(key: String): ThemeMode =
                entries.firstOrNull { it.key == key } ?: System
        }
    }

    enum class ContrastLevel(val key: String) {
        Standard("standard"),
        Medium("medium"),
        High("high");

        companion object {
            fun fromKey(key: String): ContrastLevel =
                entries.firstOrNull { it.key == key } ?: Standard
        }
    }

    private object Keys {
        val THEME_MODE = stringPreferencesKey("theme_mode")
        val CONTRAST_LEVEL = stringPreferencesKey("contrast_level")
        val DYNAMIC_COLOR = booleanPreferencesKey("dynamic_color_enabled")
    }

    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.Main)

    private val preferencesFlow: Flow<ThemePreferences> =
        context.themePreferencesStore.data.map { prefs ->
            ThemePreferences(
                themeMode = ThemeMode.fromKey(prefs[Keys.THEME_MODE] ?: "system"),
                contrastLevel = ContrastLevel.fromKey(prefs[Keys.CONTRAST_LEVEL] ?: "standard"),
                dynamicColorEnabled = false,
            )
        }

    /** Reactive state of all theme preferences. */
    val preferences: StateFlow<ThemePreferences> = preferencesFlow.stateIn(
        scope = scope,
        started = SharingStarted.WhileSubscribed(5_000),
        initialValue = ThemePreferences(),
    )

    suspend fun setThemeMode(mode: ThemeMode) {
        context.themePreferencesStore.edit { it[Keys.THEME_MODE] = mode.key }
    }

    suspend fun setContrastLevel(level: ContrastLevel) {
        context.themePreferencesStore.edit { it[Keys.CONTRAST_LEVEL] = level.key }
    }

    suspend fun setDynamicColorEnabled(enabled: Boolean) {
        context.themePreferencesStore.edit { it[Keys.DYNAMIC_COLOR] = false }
    }
}

data class ThemePreferences(
    val themeMode: ThemePreferencesRepository.ThemeMode = ThemePreferencesRepository.ThemeMode.System,
    val contrastLevel: ThemePreferencesRepository.ContrastLevel = ThemePreferencesRepository.ContrastLevel.Standard,
    val dynamicColorEnabled: Boolean = false,
)
