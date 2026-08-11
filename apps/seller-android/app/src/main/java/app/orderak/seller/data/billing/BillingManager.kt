package app.orderak.seller.data.billing

import android.app.Activity
import android.content.Context
import android.util.Base64
import com.android.billingclient.api.BillingClient
import com.android.billingclient.api.BillingClientStateListener
import com.android.billingclient.api.BillingFlowParams
import com.android.billingclient.api.BillingResult
import com.android.billingclient.api.PendingPurchasesParams
import com.android.billingclient.api.ProductDetails
import com.android.billingclient.api.Purchase
import com.android.billingclient.api.PurchasesUpdatedListener
import com.android.billingclient.api.QueryProductDetailsParams
import com.android.billingclient.api.QueryPurchasesParams
import dagger.hilt.android.qualifiers.ApplicationContext
import app.orderak.seller.data.remote.BackendApi
import app.orderak.seller.data.remote.BillingProductDto
import app.orderak.seller.data.session.SessionStore
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.launch
import java.security.MessageDigest
import javax.inject.Inject
import javax.inject.Singleton

sealed interface BillingState {
    data object Disabled : BillingState
    data object Connecting : BillingState
    data object Ready : BillingState
    data object Verifying : BillingState
    data class VerificationPending(
        val verificationId: String,
        val retryAtEpochMs: Long,
    ) : BillingState
    data class Error(val code: String) : BillingState
}

/**
 * Google Play is only a purchase UI. The Worker verifies every token with the
 * Play Developer API and returns the authoritative entitlement snapshot. This
 * class never grants access from a local Purchase object.
 */
@Singleton
class BillingManager @Inject constructor(
    @param:ApplicationContext private val context: Context,
    private val backendApi: BackendApi,
    private val sessionStore: SessionStore,
    private val entitlementRepository: EntitlementRepository,
) : PurchasesUpdatedListener {

    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.Main)
    private val _state = MutableStateFlow<BillingState>(BillingState.Disabled)
    val state: StateFlow<BillingState> = _state.asStateFlow()
    private val _catalog = MutableStateFlow<List<BillingProductDto>>(emptyList())
    val catalog: StateFlow<List<BillingProductDto>> = _catalog.asStateFlow()
    private var initialized = false

    private val billingClient = BillingClient.newBuilder(context)
        .setListener(this)
        .enablePendingPurchases(
            PendingPurchasesParams.newBuilder()
                .enableOneTimeProducts()
                .enablePrepaidPlans()
                .build()
        )
        .enableAutoServiceReconnection()
        .build()

    fun initialize() {
        if (initialized) return
        initialized = true
        scope.launch {
            sessionStore.pendingBillingVerification.first()?.let { pending ->
                reportVerificationPending(pending.verificationId, pending.retryAtEpochMs)
                BillingVerificationScheduler.schedule(context, pending.verificationId, pending.retryAtEpochMs)
            }
            val remote = backendApi.getBillingCatalog()
            _catalog.value = remote.products
            if (remote.ok && remote.lifecycle_enabled) startConnection()
        }
    }

    private fun startConnection() {
        if (billingClient.isReady) return
        _state.value = BillingState.Connecting
        billingClient.startConnection(object : BillingClientStateListener {
            override fun onBillingSetupFinished(result: BillingResult) {
                if (result.responseCode == BillingClient.BillingResponseCode.OK) {
                    _state.value = BillingState.Ready
                    queryPurchases()
                } else {
                    _state.value = BillingState.Error("play_${result.responseCode}")
                }
            }
            override fun onBillingServiceDisconnected() {
                _state.value = BillingState.Connecting
            }
        })
    }

    override fun onPurchasesUpdated(result: BillingResult, purchases: List<Purchase>?) {
        when (result.responseCode) {
            BillingClient.BillingResponseCode.OK -> purchases.orEmpty().forEach(::verifyWithBackend)
            BillingClient.BillingResponseCode.USER_CANCELED -> _state.value = BillingState.Ready
            else -> _state.value = BillingState.Error("play_${result.responseCode}")
        }
    }

    private fun verifyWithBackend(purchase: Purchase) {
        if (purchase.purchaseState == Purchase.PurchaseState.PENDING) {
            _state.value = BillingState.Verifying
            return
        }
        if (purchase.purchaseState != Purchase.PurchaseState.PURCHASED) return
        scope.launch {
            _state.value = BillingState.Verifying
            val phone = sessionStore.phone.first().orEmpty()
            val secret = sessionStore.getOrCreateSecret()
            if (phone.isBlank()) {
                _state.value = BillingState.Error("session_missing")
                return@launch
            }
            val verified = backendApi.verifyPlayPurchase(phone, secret, purchase.purchaseToken)
            val snapshot = verified.entitlements
            if (verified.ok && snapshot?.ok == true) {
                entitlementRepository.acceptSnapshot(snapshot)
                sessionStore.clearPendingBillingVerification()
                _state.value = BillingState.Ready
            } else if (verified.pending && !verified.verification_id.isNullOrBlank()) {
                val retrySeconds = (verified.retry_after_seconds ?: 15L).coerceIn(15L, 21_600L)
                val retryAt = System.currentTimeMillis() + retrySeconds * 1_000L
                val verificationId = verified.verification_id
                sessionStore.savePendingBillingVerification(verificationId, retryAt)
                BillingVerificationScheduler.schedule(context, verificationId, retryAt)
                reportVerificationPending(verificationId, retryAt)
            } else {
                _state.value = BillingState.Error(verified.error ?: "verification_failed")
            }
        }
    }

    private fun queryPurchases() {
        if (!billingClient.isReady) return
        val params = QueryPurchasesParams.newBuilder().setProductType(BillingClient.ProductType.SUBS).build()
        billingClient.queryPurchasesAsync(params) { result, purchases ->
            if (result.responseCode == BillingClient.BillingResponseCode.OK) purchases.forEach(::verifyWithBackend)
        }
    }

    /** Re-query Play and re-verify owned subscriptions with the backend. */
    fun recoverPurchases() {
        if (billingClient.isReady) queryPurchases()
    }

    fun reportVerificationPending(verificationId: String, retryAtEpochMs: Long) {
        _state.value = BillingState.VerificationPending(verificationId, retryAtEpochMs)
    }

    fun reportVerificationSuccess() {
        _state.value = BillingState.Ready
    }

    fun reportVerificationFailure(code: String) {
        _state.value = BillingState.Error(code)
    }

    fun queryProductDetails(productIds: List<String>, onResult: (List<ProductDetails>) -> Unit) {
		if (!billingClient.isReady) { onResult(emptyList()); return }
		val products = productIds.distinct().map {
			QueryProductDetailsParams.Product.newBuilder()
				.setProductId(it)
				.setProductType(BillingClient.ProductType.SUBS)
				.build()
        }
		val params = QueryProductDetailsParams.newBuilder().setProductList(products).build()
		billingClient.queryProductDetailsAsync(params) { result, details ->
			onResult(if (result.responseCode == BillingClient.BillingResponseCode.OK) details.productDetailsList else emptyList())
		}
    }

    /** ProductDetails is queried immediately before this call; callers do not cache it. */
    fun launchBillingFlow(activity: Activity, details: ProductDetails, basePlanId: String) {
        scope.launch {
            val offer = details.subscriptionOfferDetails?.firstOrNull { it.basePlanId == basePlanId }
            if (offer == null) { _state.value = BillingState.Error("offer_not_found"); return@launch }
            val phone = sessionStore.phone.first().orEmpty()
            val secret = sessionStore.getOrCreateSecret()
            val snapshot = backendApi.getEntitlements(phone, secret)
            val organizationId = snapshot.organization_id
            if (!snapshot.ok || organizationId.isNullOrBlank()) {
                _state.value = BillingState.Error(snapshot.error ?: "organization_missing")
                return@launch
            }
            val product = BillingFlowParams.ProductDetailsParams.newBuilder()
                .setProductDetails(details)
                .setOfferToken(offer.offerToken)
                .build()
            val flow = BillingFlowParams.newBuilder()
                .setProductDetailsParamsList(listOf(product))
                .setObfuscatedAccountId(obfuscatedId(organizationId))
                .build()
            val result = billingClient.launchBillingFlow(activity, flow)
            if (result.responseCode != BillingClient.BillingResponseCode.OK) {
                _state.value = BillingState.Error("play_${result.responseCode}")
            }
        }
    }

    private fun obfuscatedId(value: String): String = Base64.encodeToString(
        MessageDigest.getInstance("SHA-256").digest(value.toByteArray(Charsets.UTF_8)),
        Base64.URL_SAFE or Base64.NO_WRAP or Base64.NO_PADDING,
    )
}
