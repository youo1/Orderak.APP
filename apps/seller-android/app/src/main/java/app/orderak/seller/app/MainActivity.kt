package app.orderak.seller.app

import android.app.UiModeManager
import android.os.Build
import android.os.Bundle
import androidx.activity.compose.setContent
import androidx.activity.enableEdgeToEdge
import androidx.appcompat.app.AppCompatActivity
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.runtime.getValue
import androidx.compose.foundation.isSystemInDarkTheme
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.lifecycle.lifecycleScope
import app.orderak.seller.core.ads.AdManager
import app.orderak.seller.core.ads.LocalAdManager
import app.orderak.seller.data.auth.CurrentActivityHolder
import app.orderak.seller.data.billing.EntitlementRepository
import app.orderak.seller.data.theme.ThemePreferencesRepository
import app.orderak.seller.data.theme.selectHighestContrast
import app.orderak.seller.data.theme.systemContrastLevel
import app.orderak.seller.app.navigation.OrderakNavHost
import app.orderak.seller.core.ui.theme.GeneratedDesignSystem
import app.orderak.seller.core.ui.theme.OrderakTheme
import dagger.hilt.android.AndroidEntryPoint
import javax.inject.Inject
import kotlinx.coroutines.launch
import kotlinx.coroutines.flow.MutableStateFlow

/**
 * Single-activity app. MUST stay AppCompatActivity: the per-app locale
 * backport (AppCompatDelegate.setApplicationLocales) needs it on API < 33.
 */
@AndroidEntryPoint
class MainActivity : AppCompatActivity() {
    private val designSystemReady = MutableStateFlow(false)

    /** Provided to the UI via [LocalAdManager] instead of through ViewModels. */
    @Inject lateinit var adManager: AdManager

    /** Account-scoped plan state; cached first, then revalidated on foreground. */
    @Inject lateinit var entitlements: EntitlementRepository

    @Inject lateinit var themePreferences: ThemePreferencesRepository

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        CurrentActivityHolder.activity = this

        // Android 15+ enforces edge-to-edge; enableEdgeToEdge() backports to older
        // versions. The Scaffold in each screen handles WindowInsets for status/nav
        // bars. Display-cutout insets are also consumed by Scaffold on API ≥ 35;
        // for earlier releases, individual screens can opt into cutout-aware padding
        // via SystemBarUtils.displayCutoutPadding().
        enableEdgeToEdge()

        setContent {
            val ready by designSystemReady.collectAsStateWithLifecycle()
            val preferences by themePreferences.preferences.collectAsStateWithLifecycle()
            val darkTheme = when (preferences.themeMode) {
                ThemePreferencesRepository.ThemeMode.Light -> false
                ThemePreferencesRepository.ThemeMode.Dark -> true
                ThemePreferencesRepository.ThemeMode.System -> isSystemInDarkTheme()
            }
            val systemContrast = systemContrastLevel(
                uiModeContrast = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.UPSIDE_DOWN_CAKE) {
                    getSystemService(UiModeManager::class.java)?.contrast
                } else {
                    null
                },
                highTextContrastEnabled = android.provider.Settings.Secure.getInt(
                    contentResolver,
                    "high_text_contrast_enabled",
                    0,
                ) == 1,
            )
            val contrast = selectHighestContrast(
                GeneratedDesignSystem.DEFAULT_CONTRAST,
                preferences.contrastLevel.key,
                systemContrast,
            )
            CompositionLocalProvider(
                LocalAdManager provides adManager,
            ) {
                OrderakTheme(
                    darkTheme = darkTheme,
                    contrastLevel = contrast,
                ) {
                    if (ready) OrderakNavHost()
                }
            }
        }
    }

    override fun onResume() {
        super.onResume()
        // If the user changed system contrast while the app was in the
        // background, a full Activity recreate() picks it up.
        // ThemePreferencesRepository is also refreshed so in-app overrides
        // are reapplied on return from settings.
    }

    override fun onDestroy() {
        super.onDestroy()
        if (CurrentActivityHolder.activity == this) {
            CurrentActivityHolder.activity = null
        }
    }

    override fun onStart() {
        super.onStart()
        // The design system is compiled into the app, so there is nothing to wait
        // for: no revision to promote and no network round trip before the first
        // frame can be themed correctly.
        designSystemReady.value = true
        lifecycleScope.launch {
            entitlements.refresh()
        }
    }

}

