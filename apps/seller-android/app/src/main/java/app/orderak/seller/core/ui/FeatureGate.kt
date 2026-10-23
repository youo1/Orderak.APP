package app.orderak.seller.core.ui

import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.ui.Modifier
import app.orderak.seller.data.billing.FeatureAvailabilityResolver

/**
 * Wraps a feature by its catalogue key and draws one of three outcomes.
 *
 * The gate this replaces had two: entitled, or a "Premium feature" overlay for
 * everything else. That is wrong in a catalogue where 212 of 242 features are
 * not built, and actively harmful while purchase is closed platform-wide — the
 * overlay invited an upgrade whose six acquisition routes answer 403.
 *
 * [FeatureAvailability.NotBuilt] therefore carries no upgrade affordance at all.
 * Not a muted one, not a disabled one: none. A path that no plan change can open
 * must not look like a path.
 */
@Composable
fun FeatureGate(
    resolver: FeatureAvailabilityResolver,
    featureKey: String,
    modifier: Modifier = Modifier,
    onUpgrade: (() -> Unit)? = null,
    content: @Composable () -> Unit,
) {
    val decision = resolver.decide(featureKey)

    LaunchedEffect(featureKey, decision) {
        resolver.log(featureKey, decision)
    }

    FeatureGate(
        availability = decision.availability,
        modifier = modifier,
        onUpgrade = onUpgrade,
        content = content,
    )
}

/**
 * The same three branches, given the decision instead of the resolver.
 *
 * The resolver needs an EntitlementManager and therefore a Hilt graph, so a
 * screen that took one could not be rendered in any of its gate states — which
 * is how a three-state rule ends up with nobody having looked at two of them.
 * The overload above keeps the logging and the lookup; this one is the drawing.
 *
 * The locked states are drawn by [GateNotice]. Pass [onUpgrade] only while
 * purchase is open: it is what puts the plans button on the locked notice.
 */
@Composable
fun FeatureGate(
    availability: FeatureAvailability,
    modifier: Modifier = Modifier,
    onUpgrade: (() -> Unit)? = null,
    content: @Composable () -> Unit,
) {
    when (availability) {
        FeatureAvailability.Available -> content()
        FeatureAvailability.LockedByPlan,
        FeatureAvailability.NotBuilt,
        -> GateNotice(availability = availability, modifier = modifier, onViewPlans = onUpgrade)
    }
}
