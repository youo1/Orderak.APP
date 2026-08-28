package app.orderak.seller.data.billing

import app.orderak.seller.data.remote.BackendConfig
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.booleanOrNull
import kotlinx.serialization.json.intOrNull
import java.text.SimpleDateFormat
import java.util.Locale
import java.util.TimeZone
import javax.inject.Inject
import javax.inject.Singleton

/**
 * The two features still addressed by enum rather than catalogue key.
 *
 * Both resolve to a platform governance flag rather than a plan entitlement, so
 * a catalogue key would not describe them: they are on or off for everyone.
 * Everything that is genuinely per-plan is addressed by key through
 * [FeatureAvailabilityResolver]; four members that were never referenced outside
 * this file have been removed with the gate that used them.
 */
enum class Feature {
    AI_ASSISTANT,
    SHOW_ADS
}

@Singleton
class EntitlementManager @Inject constructor(
    private val usageLogger: UsageLogger
) {
    private val _config = MutableStateFlow<BackendConfig?>(null)
    val config: StateFlow<BackendConfig?> = _config

    fun updateFromBackend(newConfig: BackendConfig) {
        _config.value = newConfig
    }

    fun clear() {
        _config.value = null
    }

    fun planId(): String {
        return _config.value?.plan_id ?: "free"
    }

    fun planName(): String = _config.value?.plan_name ?: "Free"

    fun isEntitlementAvailable(key: String): Boolean =
        _config.value?.takeUnless(::isAuthoritativePeriodExpired)?.entitlements?.get(key)?.let {
            it.implementation_status == "implemented" && it.available && !it.custom_required
        } ?: false

    fun integerLimit(key: String): Int? {
        val item = _config.value?.entitlements?.get(key) ?: return null
        if (_config.value?.let(::isAuthoritativePeriodExpired) == true) return 0
        if (item.mode == "unlimited") return Int.MAX_VALUE
        return (item.value as? JsonPrimitive)?.intOrNull
    }

    fun isFeatureEnabled(feature: Feature): Boolean {
        val current = _config.value
        if (current == null) return feature == Feature.SHOW_ADS
        if (isAuthoritativePeriodExpired(current)) return feature == Feature.SHOW_ADS
        return when (feature) {
            Feature.AI_ASSISTANT -> current.governance?.features?.get("ai_assistant")?.enabled
                ?: (integerLimit("max_ai_requests_per_month")?.let { it > 0 }
                    ?: current.limits?.max_ai_requests_per_month?.let { it > 0 }
                    ?: false)
            Feature.SHOW_ADS -> current.governance?.features?.get("first_party_ads")?.enabled
                ?: (current.entitlements["show_ads"]?.let { (it.value as? JsonPrimitive)?.booleanOrNull } ?: current.ads_enabled)
        }
    }

    /** Usage log for gates addressed by catalogue key. */
    fun logKeyedAttempt(key: String, availability: String, reason: String) {
        usageLogger.logKeyedFeatureAttempt(key, planId(), availability, reason)
    }

    fun getProductLimit(): Int {
        // Backend sends max_products = null to mean "unlimited". Only fall back to
        // the free default (20) when no config has loaded yet — never treat
        // "unlimited" as 20, which would wrongly cap paying sellers.
        integerLimit("max_products")?.let { return it }
        val limits = _config.value?.limits ?: return 20
        return limits.max_products ?: Int.MAX_VALUE
    }

    /**
     * Whether a seller can actually buy anything right now.
     *
     * The six acquisition routes answer 403 while billing is closed, so an
     * upgrade affordance shown without consulting this leads nowhere. The
     * backend has always sent the flag in `governance.features.billing`; the app
     * simply never asked, and offered the upgrade on the strength of a higher
     * plan existing.
     *
     * Absent governance means absent permission: a snapshot that predates the
     * flag must not be read as consent to sell.
     */
    fun isPurchaseOpen(): Boolean =
        _config.value?.governance?.features?.get("billing")?.enabled == true

    fun nextUpgradePlanKey(): String? = when (planId()) {
        "free" -> "paid1"
        "paid1" -> "paid2"
        "paid2" -> "paid3"
        else -> null
    }

    /** Never extend paid access beyond the server-provided authoritative end. */
    private fun isAuthoritativePeriodExpired(config: BackendConfig): Boolean {
        if (config.subscription_status !in setOf("active", "grace", "canceled")) return false
        val value = config.current_period_end ?: return false
        // RFC 3339 permits more than millisecond precision; SimpleDateFormat
        // accepts milliseconds, so truncate additional fractional digits.
        val normalizedValue = value.replace(Regex("""\.(\d{3})\d+(?=Z|[+-])"""), ".$1")
        val expiryMs = listOf(
            "yyyy-MM-dd'T'HH:mm:ss.SSSXXX",
            "yyyy-MM-dd'T'HH:mm:ssXXX",
            "yyyy-MM-dd HH:mm:ss",
        ).firstNotNullOfOrNull { pattern ->
            runCatching {
                SimpleDateFormat(pattern, Locale.US).apply {
                    isLenient = false
                    timeZone = TimeZone.getTimeZone("UTC")
                }.parse(normalizedValue)?.time
            }.getOrNull()
        } ?: return true
        return expiryMs <= System.currentTimeMillis()
    }
}



