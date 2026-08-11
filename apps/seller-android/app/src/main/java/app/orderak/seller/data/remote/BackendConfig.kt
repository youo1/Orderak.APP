package app.orderak.seller.data.remote

import kotlinx.serialization.Serializable
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.booleanOrNull
import kotlinx.serialization.json.intOrNull

/**
 * The single source of truth from the Policy Engine.
 * Mirrors GET /api/v1/config JSON.
 */
@Serializable
data class BackendConfig(
    val schema_version: Int = 1,
    val organization_id: String? = null,
    val plan_id: String? = null,
    val plan_name: String? = null,
    val plan_revision_id: String? = null,
    val plan_version: Int = 0,
    val subscription_status: String = "active",
    val current_period_end: String? = null,
    val pending_revision_id: String? = null,
    val pending_effective_at: String? = null,
    val server_time: String? = null,
    val etag: String? = null,
    val ads_enabled: Boolean = true,
    val limits: ConfigLimits? = null,
    val features: ConfigFeatures? = null,
    val entitlements: Map<String, EntitlementDto> = emptyMap(),
    val governance: GovernanceConfig? = null,
)

@Serializable
data class GovernanceConfig(
    val schema_version: Int = 1,
    val server_time: String? = null,
    val version: AppVersionPolicy = AppVersionPolicy(),
    val features: Map<String, GovernedFeature> = emptyMap(),
)

@Serializable
data class AppVersionPolicy(
    val status: String = "ok",
    val policy_id: String? = null,
    val minimum_version_code: Int? = null,
    val recommended_version_code: Int? = null,
    val enforce_after: String? = null,
    val store_url: String? = null,
    val warning_message: Map<String, String> = emptyMap(),
    val blocking_message: Map<String, String> = emptyMap(),
)

@Serializable
data class GovernedFeature(
    val enabled: Boolean = false,
    val source: String = "missing",
)

@Serializable
data class EntitlementDto(
    val key: String = "",
    val name: String = "",
    val category: String = "",
    val implementation_status: String = "planned",
    val mode: String = "disabled",
    val value: JsonElement? = null,
    val display_value: String = "",
    val available: Boolean = false,
    val used: Int? = null,
    val remaining: Int? = null,
    val reset_at: String? = null,
    val custom_required: Boolean = false,
)

@Serializable
data class ConfigLimits(
    val max_categories: Int? = null,
    val max_products: Int? = null,
    val max_orders_per_month: Int? = null,
    val max_ai_requests_per_month: Int? = null,
    val max_team_members: Int? = null,
    val max_concurrent_devices: Int? = null,
)

@Serializable
data class ConfigFeatures(
    val custom_domain: Boolean = false,
    val analytics: Boolean = false,
    val priority_support: Boolean = false,
    val ai_assistant: Boolean = true,
    val multi_device: Boolean = false,
)

fun EntitlementSnapshotRes.toBackendConfig(): BackendConfig {
    fun limit(key: String): Int? {
        val item = entitlements[key] ?: return null
        if (item.mode == "unlimited") return null
        return (item.value as? JsonPrimitive)?.intOrNull ?: 0
    }
    fun enabled(key: String): Boolean = entitlements[key]?.available == true
    val ads = (entitlements["show_ads"]?.value as? JsonPrimitive)?.booleanOrNull ?: true
    val devices = limit("max_concurrent_devices")
    return BackendConfig(
        schema_version = schema_version,
        organization_id = organization_id,
        plan_id = plan_key,
        plan_name = plan_name,
        plan_revision_id = plan_revision_id,
        plan_version = plan_version,
        subscription_status = subscription_status,
        current_period_end = current_period_end,
        pending_revision_id = pending_revision_id,
        pending_effective_at = pending_effective_at,
        server_time = server_time,
        etag = etag,
        ads_enabled = ads,
        limits = ConfigLimits(
            max_categories = limit("max_categories"),
            max_products = limit("max_products"),
            max_orders_per_month = limit("max_orders_per_month"),
            max_ai_requests_per_month = limit("max_ai_requests_per_month"),
            max_team_members = limit("max_team_members"),
            max_concurrent_devices = devices,
        ),
        features = ConfigFeatures(
            custom_domain = enabled("products_catalog.custom_domain"),
            analytics = enabled("analytics_reporting.operational_dashboard"),
			priority_support = enabled("support_service.priority_queue"),
			ai_assistant = enabled("ai_capabilities.basic_ai_assistance"),
            multi_device = devices == null || devices > 1,
        ),
        governance = governance,
        entitlements = entitlements,
    )
}
