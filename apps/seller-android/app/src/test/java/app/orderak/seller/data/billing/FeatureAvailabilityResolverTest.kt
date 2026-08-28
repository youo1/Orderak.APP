package app.orderak.seller.data.billing

import app.orderak.seller.core.ui.FeatureAvailability
import app.orderak.seller.data.remote.BackendConfig
import app.orderak.seller.data.remote.EntitlementDto
import app.orderak.seller.data.remote.GovernanceConfig
import app.orderak.seller.data.remote.GovernedFeature
import kotlinx.serialization.json.JsonPrimitive
import org.junit.Assert.assertEquals
import org.junit.Test

/**
 * The gate's three outcomes, and the technical states that must not become a
 * fourth one the seller can see.
 */
class FeatureAvailabilityResolverTest {

    private fun resolver(config: BackendConfig?): FeatureAvailabilityResolver {
        val manager = EntitlementManager(UsageLogger())
        if (config != null) manager.updateFromBackend(config)
        return FeatureAvailabilityResolver(manager)
    }

    private fun entitlement(
        key: String,
        status: String = "implemented",
        available: Boolean = true,
        customRequired: Boolean = false,
    ) = EntitlementDto(
        key = key,
        implementation_status = status,
        mode = "value",
        value = JsonPrimitive(20),
        available = available,
        custom_required = customRequired,
    )

    private fun config(
        vararg items: EntitlementDto,
        governance: GovernanceConfig? = null,
    ) = BackendConfig(
        plan_id = "free",
        subscription_status = "active",
        entitlements = items.associateBy { it.key },
        governance = governance,
    )

    // ---------- the three states a seller can see ----------

    @Test
    fun `built and entitled is available`() {
        val decision = resolver(config(entitlement("max_products"))).decide("max_products")
        assertEquals(FeatureAvailability.Available, decision.availability)
        assertEquals(AvailabilityReason.Entitled, decision.reason)
    }

    @Test
    fun `built but excluded by the plan is locked by plan`() {
        val decision = resolver(config(entitlement("max_products", available = false)))
            .decide("max_products")
        assertEquals(FeatureAvailability.LockedByPlan, decision.availability)
        assertEquals(AvailabilityReason.PlanExcluded, decision.reason)
    }

    @Test
    fun `built but needing a custom plan is locked by plan`() {
        val decision = resolver(config(entitlement("max_products", customRequired = true)))
            .decide("max_products")
        assertEquals(FeatureAvailability.LockedByPlan, decision.availability)
        assertEquals(AvailabilityReason.CustomPlanRequired, decision.reason)
    }

    // ---------- the regression this whole gate exists to prevent ----------

    /**
     * The defect in the gate this replaces: an unbuilt feature rendered as a
     * premium upsell. With purchase closed platform-wide, following that upsell
     * ends in a 403, so an unbuilt feature must never offer an upgrade.
     */
    @Test
    fun `a planned feature is never offered as an upgrade`() {
        val decision = resolver(config(entitlement("inventory.reorder_points", status = "planned")))
            .decide("inventory.reorder_points")
        assertEquals(FeatureAvailability.NotBuilt, decision.availability)
        assertEquals(AvailabilityReason.NotImplemented, decision.reason)
    }

    /**
     * And it stays NotBuilt even when the snapshot claims the plan allows it.
     * A mis-seeded entitlement row must not be able to turn something that does
     * not exist into something a seller can pay for.
     */
    @Test
    fun `a planned feature stays not built even when marked available`() {
        val decision = resolver(
            config(entitlement("inventory.reorder_points", status = "planned", available = true)),
        ).decide("inventory.reorder_points")
        assertEquals(FeatureAvailability.NotBuilt, decision.availability)
    }

    // ---------- technical states: none of them may fail open ----------

    @Test
    fun `an unknown key resolves to not built, never available`() {
        val decision = resolver(config(entitlement("max_products"))).decide("does.not.exist")
        assertEquals(FeatureAvailability.NotBuilt, decision.availability)
        assertEquals(AvailabilityReason.UnknownKey, decision.reason)
    }

    @Test
    fun `no snapshot resolves to not built, never available`() {
        val decision = resolver(null).decide("max_products")
        assertEquals(FeatureAvailability.NotBuilt, decision.availability)
        assertEquals(AvailabilityReason.NoSnapshot, decision.reason)
    }

    @Test
    fun `an empty snapshot resolves every key to not built`() {
        val decision = resolver(config()).decide("max_products")
        assertEquals(FeatureAvailability.NotBuilt, decision.availability)
        assertEquals(AvailabilityReason.UnknownKey, decision.reason)
    }

    /**
     * Built, entitled, and still closed by an operational flag. It must read as
     * "not built" rather than as an upgrade, because no plan change opens a flag.
     */
    @Test
    fun `a feature closed by an operational flag offers no upgrade`() {
        val decision = resolver(
            config(
                entitlement("ai_capabilities.basic_ai_assistance"),
                governance = GovernanceConfig(features = mapOf("ai_assistant" to GovernedFeature(enabled = false))),
            ),
        ).decide("ai_capabilities.basic_ai_assistance")
        assertEquals(FeatureAvailability.NotBuilt, decision.availability)
        assertEquals(AvailabilityReason.DisabledByFlag, decision.reason)
    }

    @Test
    fun `the same feature is available once the flag opens`() {
        val decision = resolver(
            config(
                entitlement("ai_capabilities.basic_ai_assistance"),
                governance = GovernanceConfig(features = mapOf("ai_assistant" to GovernedFeature(enabled = true))),
            ),
        ).decide("ai_capabilities.basic_ai_assistance")
        assertEquals(FeatureAvailability.Available, decision.availability)
    }

    /** A missing governance block is absence of permission, not permission. */
    @Test
    fun `a flagged feature with no governance block stays closed`() {
        val decision = resolver(config(entitlement("ai_capabilities.basic_ai_assistance")))
            .decide("ai_capabilities.basic_ai_assistance")
        assertEquals(FeatureAvailability.NotBuilt, decision.availability)
        assertEquals(AvailabilityReason.DisabledByFlag, decision.reason)
    }
}
