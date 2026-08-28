package app.orderak.seller.data.billing

import app.orderak.seller.core.ui.FeatureAvailability
import app.orderak.seller.data.remote.BackendConfig
import javax.inject.Inject
import javax.inject.Singleton

/**
 * Why an entry point resolved the way it did.
 *
 * The seller never sees these. They exist so that "the gate said no" can be
 * logged with a cause, and so the difference between a missing catalogue entry
 * and a plan boundary is not lost the moment it matters.
 */
enum class AvailabilityReason {
    /** Built, entitled, and no flag is holding it back. */
    Entitled,

    /** Built and reachable, but this plan does not include it. */
    PlanExcluded,

    /** Built, but this plan needs an explicit organisation override first. */
    CustomPlanRequired,

    /** The catalogue says the feature is not implemented. */
    NotImplemented,

    /** Built and entitled, but an operational flag holds it closed. */
    DisabledByFlag,

    /** The key is not in the entitlement snapshot at all. */
    UnknownKey,

    /** No snapshot has loaded, so free-plan limits apply. */
    NoSnapshot,

    /** The authoritative paid period has ended. */
    PeriodExpired,
}

/** What the gate decided, and why. */
data class FeatureDecision(
    val availability: FeatureAvailability,
    val reason: AvailabilityReason,
)

/**
 * Resolves a catalogue feature key to one of the three states the UI may draw.
 *
 * The gate this replaces was binary — entitled, or a "Premium feature" overlay.
 * With 212 of 242 catalogue features unbuilt and purchase closed platform-wide,
 * that overlay pointed most of the product at an upgrade that returns 403. The
 * split below exists so an unbuilt feature and a plan boundary can never again
 * render as the same thing.
 *
 * Nothing here fails open. Every path that cannot prove entitlement resolves to
 * a state that shows less, never more; an unknown key resolves to [NotBuilt]
 * rather than [Available], because a key the snapshot has never heard of is not
 * evidence of permission.
 */
@Singleton
class FeatureAvailabilityResolver @Inject constructor(
    private val entitlements: EntitlementManager,
) {

    /**
     * Operational flags that gate a built feature independently of any plan.
     *
     * A feature held closed by one of these is drawn as [FeatureAvailability.NotBuilt]:
     * it is real code, but no plan change opens it, so an upgrade path would be a
     * dead end. Keyed by catalogue feature, valued by governance flag.
     */
    private val governanceFlagFor = mapOf(
        "ai_capabilities.basic_ai_assistance" to "ai_assistant",
        "ai_capabilities.ai_usage_dashboard" to "ai_assistant",
    )

    fun decide(key: String): FeatureDecision {
        val config = entitlements.config.value
            ?: return FeatureDecision(FeatureAvailability.NotBuilt, AvailabilityReason.NoSnapshot)

        val entitlement = config.entitlements[key]
            ?: return FeatureDecision(FeatureAvailability.NotBuilt, AvailabilityReason.UnknownKey)

        // A feature the catalogue has not built cannot be unlocked by paying for
        // it. This branch is checked before the plan so that a mis-seeded
        // entitlement row can never turn an unbuilt feature into an upsell.
        if (entitlement.implementation_status != "implemented") {
            return FeatureDecision(FeatureAvailability.NotBuilt, AvailabilityReason.NotImplemented)
        }

        governanceFlagFor[key]?.let { flag ->
            val governed = config.governance?.features?.get(flag)
            if (governed?.enabled != true) {
                return FeatureDecision(FeatureAvailability.NotBuilt, AvailabilityReason.DisabledByFlag)
            }
        }

        if (isPeriodExpired(config)) {
            return FeatureDecision(FeatureAvailability.LockedByPlan, AvailabilityReason.PeriodExpired)
        }
        if (entitlement.custom_required) {
            return FeatureDecision(FeatureAvailability.LockedByPlan, AvailabilityReason.CustomPlanRequired)
        }
        if (!entitlement.available) {
            return FeatureDecision(FeatureAvailability.LockedByPlan, AvailabilityReason.PlanExcluded)
        }
        return FeatureDecision(FeatureAvailability.Available, AvailabilityReason.Entitled)
    }

    fun availability(key: String): FeatureAvailability = decide(key).availability

    /**
     * Records that a gate resolved, with its cause.
     *
     * The cause is the point: "the seller did not see this" is not actionable,
     * while "the key was absent from the snapshot" and "the plan excludes it"
     * lead to different fixes.
     */
    fun log(key: String, decision: FeatureDecision) {
        entitlements.logKeyedAttempt(key, decision.availability.name, decision.reason.name)
    }

    /**
     * Mirrors [EntitlementManager]'s own expiry rule rather than reaching into
     * it, so an expired paid period reads as a plan boundary here too.
     */
    private fun isPeriodExpired(config: BackendConfig): Boolean =
        config.subscription_status in EXPIRABLE_STATUSES &&
            config.current_period_end != null &&
            !entitlements.isEntitlementAvailable(EXPIRY_PROBE_KEY) &&
            config.entitlements[EXPIRY_PROBE_KEY]?.available == true

    private companion object {
        val EXPIRABLE_STATUSES = setOf("active", "grace", "canceled")

        /**
         * Any always-present entitlement works as a probe: when the authoritative
         * period has ended, EntitlementManager reports every key unavailable while
         * the snapshot itself still says otherwise, and that disagreement is the
         * signal.
         */
        const val EXPIRY_PROBE_KEY = "max_products"
    }
}

/**
 * Catalogue keys the app gates on by name.
 *
 * A key written inline at the call site is a string nothing checks. Named here,
 * it sits next to the resolver that consumes it, and
 * `tooling/ux/verify-implementation-status.mjs` verifies the catalogue still
 * carries the feature and still calls it built.
 */
object FeatureKeys {
    const val OCR_RECEIPT_ASSISTANCE = "payments_finance.ocr_receipt_assistance"
}
