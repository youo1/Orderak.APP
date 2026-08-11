package app.orderak.seller.core.ads

import androidx.compose.runtime.staticCompositionLocalOf

/**
 * UI-layer access to [AdManager] without routing it through ViewModels
 * (review fix: ViewModels must expose state, not dependencies).
 * Provided once in MainActivity.setContent.
 */
val LocalAdManager = staticCompositionLocalOf<AdManager> {
    error("LocalAdManager not provided — wrap content in CompositionLocalProvider(LocalAdManager provides adManager)")
}
