package app.orderak.seller.core.ads

import android.content.Context
import android.content.Intent
import android.net.Uri
import androidx.compose.runtime.Composable
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.material3.Card
import androidx.compose.material3.Text
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.unit.dp
import androidx.compose.ui.platform.LocalContext
import coil3.compose.AsyncImage
import app.orderak.seller.data.billing.EntitlementManager
import app.orderak.seller.data.billing.Feature
import app.orderak.seller.data.remote.RemoteConfig
import app.orderak.seller.data.session.SessionStore
import app.orderak.seller.data.remote.BackendApi
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.launch
import kotlinx.coroutines.withTimeoutOrNull
import java.util.UUID
import java.util.concurrent.atomic.AtomicLong
import kotlin.random.Random
import javax.inject.Inject
import javax.inject.Singleton

@Singleton
class AdManagerImpl @Inject constructor(
    private val remoteConfig: RemoteConfig,
    private val sessionStore: SessionStore,
    private val entitlementManager: EntitlementManager,
    private val backendApi: BackendApi,
) : AdManager {

    private val admob = AdMobProvider()
    private val applovin = AppLovinProvider()
    private val empty = EmptyAdProvider()
    private val bannerOpportunity = AtomicLong(0)

    @Composable
    override fun Banner(modifier: Modifier) {
        val remoteAdsEnabled by remoteConfig.adsEnabled.collectAsState()
        val config by entitlementManager.config.collectAsState()
        val context = LocalContext.current
        val scope = rememberCoroutineScope()
        var ad by remember { mutableStateOf<app.orderak.seller.data.remote.AdDto?>(null) }
        val enabled = remoteAdsEnabled && entitlementManager.isFeatureEnabled(Feature.SHOW_ADS)

        LaunchedEffect(enabled, config?.plan_id) {
            ad = null
            if (!enabled) return@LaunchedEffect
            val phone = sessionStore.phone.first().orEmpty()
            if (phone.isBlank()) return@LaunchedEffect
            val secret = sessionStore.getOrCreateSecret()
            val opportunity = bannerOpportunity.incrementAndGet()
            val eligible = backendApi.listAds(phone, secret).ads.filter {
                opportunity % it.frequency.coerceAtLeast(1) == 0L
            }
            val totalWeight = eligible.sumOf { it.weight.coerceAtLeast(0) }
            val selected = when {
                eligible.isEmpty() -> null
                totalWeight <= 0 -> eligible.first()
                else -> {
                    var draw = Random.nextInt(totalWeight)
                    eligible.first { campaign ->
                        draw -= campaign.weight.coerceAtLeast(0)
                        draw < 0
                    }
                }
            }
            ad = selected
            selected?.let {
                backendApi.trackAd(phone, secret, it.id, "impression", "android:${it.id}:${UUID.randomUUID()}")
            }
        }

        ad?.let { campaign ->
            val destination = campaign.click_url?.takeIf { runCatching { Uri.parse(it).scheme == "https" }.getOrDefault(false) }
            Card(modifier.fillMaxWidth().clickable(enabled = destination != null) {
                val url = destination ?: return@clickable
                scope.launch {
                    val phone = sessionStore.phone.first().orEmpty()
                    if (phone.isNotBlank()) withTimeoutOrNull(1_500) {
                        backendApi.trackAd(phone, sessionStore.getOrCreateSecret(), campaign.id, "click", "android-click:${campaign.id}:${UUID.randomUUID()}")
                    }
                    context.startActivity(Intent(Intent.ACTION_VIEW, Uri.parse(url)))
                }
            }) {
                Column {
                    AsyncImage(model = campaign.image_url, contentDescription = campaign.title, modifier = Modifier.fillMaxWidth().height(96.dp), contentScale = ContentScale.Crop)
                    Text(campaign.title, Modifier.padding(10.dp))
                }
            }
        }
    }

    override suspend fun prepareInterstitial(context: Context) {
        // External SDK adapters remain intentionally disabled pending consent/privacy approval.
    }

    override suspend fun showInterstitial(context: Context) {
        // External SDK adapters remain intentionally disabled pending consent/privacy approval.
    }

    private fun getProvider(network: String): AdProvider = when (network) {
        "ADMOB" -> admob
        "APPLOVIN" -> applovin
        else -> empty
    }
}
