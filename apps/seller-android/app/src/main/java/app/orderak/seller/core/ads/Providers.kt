package app.orderak.seller.core.ads

import android.content.Context
import android.util.Log
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp

class AdMobProvider : AdProvider {
    @Composable
    override fun BannerAd(modifier: Modifier) {
        // Real implementation would use AndroidView with AdView
        AdPlaceholder("AdMob Banner", modifier)
    }

    override fun loadInterstitial(context: Context) {
        Log.d("AdMob", "Loading Interstitial")
    }

    override fun showInterstitial(context: Context) {
        Log.d("AdMob", "Showing Interstitial")
    }
}

class AppLovinProvider : AdProvider {
    @Composable
    override fun BannerAd(modifier: Modifier) {
        AdPlaceholder("AppLovin Banner", modifier)
    }

    override fun loadInterstitial(context: Context) {
        Log.d("AppLovin", "Loading Interstitial")
    }

    override fun showInterstitial(context: Context) {
        Log.d("AppLovin", "Showing Interstitial")
    }
}

class EmptyAdProvider : AdProvider {
    @Composable override fun BannerAd(modifier: Modifier) {}
    override fun loadInterstitial(context: Context) {}
    override fun showInterstitial(context: Context) {}
}

@Composable
private fun AdPlaceholder(label: String, modifier: Modifier) {
    Box(
        modifier = modifier
            .fillMaxWidth()
            .height(50.dp)
            .background(MaterialTheme.colorScheme.surfaceVariant),
        contentAlignment = Alignment.Center
    ) {
        Text(label, style = MaterialTheme.typography.labelSmall)
    }
}
