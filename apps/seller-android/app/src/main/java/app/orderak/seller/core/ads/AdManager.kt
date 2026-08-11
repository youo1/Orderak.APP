package app.orderak.seller.core.ads

import android.content.Context
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier

interface AdProvider {
    @Composable
    fun BannerAd(modifier: Modifier)
    fun loadInterstitial(context: Context)
    fun showInterstitial(context: Context)
}

/**
 * Orchestrates multiple ad networks based on Remote Config and Entitlements.
 */
interface AdManager {
    @Composable
    fun Banner(modifier: Modifier)
    suspend fun prepareInterstitial(context: Context)
    suspend fun showInterstitial(context: Context)
}
