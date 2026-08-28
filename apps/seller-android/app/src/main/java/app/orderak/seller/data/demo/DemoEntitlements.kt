package app.orderak.seller.data.demo

import app.orderak.seller.data.remote.AppVersionPolicy
import app.orderak.seller.data.remote.BackendConfig
import app.orderak.seller.data.remote.ConfigFeatures
import app.orderak.seller.data.remote.ConfigLimits
import app.orderak.seller.data.remote.EntitlementDto
import app.orderak.seller.data.remote.GovernanceConfig
import app.orderak.seller.data.remote.GovernedFeature
import kotlinx.serialization.json.JsonPrimitive

/**
 * The plan snapshot the demo shop is on.
 *
 * Sync is off for the demo account, so nothing will fetch this from the server;
 * without it every gate would resolve to `NotBuilt / NoSnapshot` and the app
 * would show a reviewer the failure mode rather than the feature.
 *
 * The values are chosen to put each of the three gate states on screen at once:
 *
 *  - `max_products` at 20 with 18 used — the meter reads **warning**, and the
 *    store surface names the limit.
 *  - OCR receipt assistance **available and implemented** — the gate renders the
 *    feature, which is what an `Available` decision looks like.
 *  - Seller translation review **implemented but not on this plan** — the gate
 *    renders `LockedByPlan`, and because `billing` is governed off below, it
 *    states the limit without offering a checkout.
 *  - Advanced inventory **planned** — the gate renders `NotBuilt`, with no
 *    upgrade path at all, because no plan change can open it.
 *
 * `billing.enabled = false` mirrors the platform: purchase is closed, so an
 * upgrade button anywhere in this build would lead to a 403.
 */
internal object DemoEntitlements {

    private fun entitlement(
        key: String,
        name: String,
        category: String,
        available: Boolean,
        implemented: Boolean,
        mode: String = "boolean",
        value: Int? = null,
        used: Int? = null,
        display: String = if (available) "متاح" else "—",
    ) = EntitlementDto(
        key = key,
        name = name,
        category = category,
        implementation_status = if (implemented) "implemented" else "planned",
        mode = mode,
        value = value?.let { JsonPrimitive(it) },
        display_value = display,
        available = available,
        used = used,
        remaining = if (value != null && used != null) value - used else null,
    )

    fun config(): BackendConfig = BackendConfig(
        organization_id = "demo-org",
        plan_id = "paid1",
        plan_name = "الباقة الأساسية",
        plan_version = 1,
        subscription_status = "active",
        ads_enabled = false,
        limits = ConfigLimits(
            max_categories = 8,
            max_products = 20,
            max_orders_per_month = 300,
            max_ai_requests_per_month = 0,
            max_team_members = 1,
            max_concurrent_devices = 2,
        ),
        features = ConfigFeatures(
            custom_domain = false,
            analytics = false,
            priority_support = false,
            ai_assistant = false,
            multi_device = true,
        ),
        entitlements = listOf(
            entitlement("max_products", "عدد المنتجات", "Products & catalog",
                available = true, implemented = true, mode = "limited",
                value = 20, used = 18, display = "٢٠"),
            entitlement("max_categories", "عدد التصنيفات", "Products & catalog",
                available = true, implemented = true, mode = "limited",
                value = 8, used = 4, display = "٨"),
            entitlement("max_concurrent_devices", "الأجهزة المتزامنة", "Team & security",
                available = true, implemented = true, mode = "limited",
                value = 2, used = 1, display = "٢"),
            entitlement("max_orders_per_month", "الطلبات شهرياً", "Orders & fulfilment",
                available = true, implemented = true, mode = "limited",
                value = 300, used = 7, display = "٣٠٠"),

            // Available + implemented -> the gate shows the feature.
            entitlement("payments_finance.ocr_receipt_assistance", "قراءة إيصال التحويل",
                "Payments & finance", available = true, implemented = true),

            // Implemented but excluded by this plan -> LockedByPlan.
            entitlement("language_localization.seller_translation_review", "مراجعة ترجمة الكتالوج",
                "Language & localization", available = false, implemented = true),
            entitlement("support_service.in_app_support_tickets", "تذاكر الدعم",
                "Support & service", available = false, implemented = true),

            // Not built -> NotBuilt, and never an upgrade path.
            entitlement("products_catalog.advanced_inventory_management", "إدارة مخزون متقدمة",
                "Products & catalog", available = false, implemented = false),
            entitlement("analytics_reporting.operational_dashboard", "لوحة التحليلات",
                "Analytics & reporting", available = false, implemented = false),
        ).associateBy { it.key },
        governance = GovernanceConfig(
            version = AppVersionPolicy(status = "ok"),
            features = mapOf(
                // Purchase is closed platform-wide. A paywall in this build
                // would be selling something the API answers 403 to.
                "billing" to GovernedFeature(enabled = false, source = "demo"),
                "ai_assistant" to GovernedFeature(enabled = false, source = "demo"),
                "first_party_ads" to GovernedFeature(enabled = false, source = "demo"),
            ),
        ),
    )
}
