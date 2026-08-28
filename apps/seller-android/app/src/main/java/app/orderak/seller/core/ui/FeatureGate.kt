package app.orderak.seller.core.ui

import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.unit.dp
import app.orderak.seller.R
import app.orderak.seller.core.ui.theme.LocalOrderakSpacing
import app.orderak.seller.data.billing.EntitlementManager
import app.orderak.seller.data.billing.Feature
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

    when (decision.availability) {
        FeatureAvailability.Available -> content()
        FeatureAvailability.LockedByPlan -> LockedByPlanNotice(modifier, onUpgrade)
        FeatureAvailability.NotBuilt -> NotBuiltNotice(modifier)
    }
}

/**
 * Built, but this plan does not include it. The only branch that may offer an
 * upgrade, and only because the feature genuinely exists behind one.
 */
@Composable
private fun LockedByPlanNotice(
    modifier: Modifier = Modifier,
    onUpgrade: (() -> Unit)? = null,
) {
    val spacing = LocalOrderakSpacing.current
    val colors = SemanticRole.Commerce.colors()
    Surface(
        modifier = modifier.fillMaxWidth(),
        shape = MaterialTheme.shapes.large,
        color = colors.container,
        contentColor = colors.onContainer,
        border = BorderStroke(1.dp, colors.containerOutline),
    ) {
        Row(
            modifier = Modifier.padding(spacing.space4),
            horizontalArrangement = Arrangement.spacedBy(spacing.space3),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            SemanticRole.Commerce.icon?.let {
                Icon(imageVector = it, contentDescription = null, modifier = Modifier.size(20.dp))
            }
            Column(
                modifier = Modifier.weight(1f),
                verticalArrangement = Arrangement.spacedBy(2.dp),
            ) {
                Text(
                    text = stringResource(R.string.gate_locked_by_plan_title),
                    style = MaterialTheme.typography.labelLarge,
                )
                Text(
                    text = stringResource(R.string.gate_locked_by_plan_body),
                    style = MaterialTheme.typography.bodySmall,
                )
            }
            if (onUpgrade != null) {
                SemanticChip(SemanticRole.Commerce, stringResource(R.string.gate_upgrade_action))
            }
        }
    }
}

/**
 * Not reachable, and no plan change makes it reachable.
 *
 * Deliberately quiet and deliberately actionless: a seller who taps here should
 * find nothing to tap, because there is nothing that would help.
 */
@Composable
private fun NotBuiltNotice(modifier: Modifier = Modifier) {
    val spacing = LocalOrderakSpacing.current
    Surface(
        modifier = modifier.fillMaxWidth(),
        shape = MaterialTheme.shapes.large,
        color = MaterialTheme.colorScheme.surfaceVariant,
        contentColor = MaterialTheme.colorScheme.onSurfaceVariant,
    ) {
        Row(
            modifier = Modifier.padding(spacing.space4),
            horizontalArrangement = Arrangement.spacedBy(spacing.space3),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Column(
                modifier = Modifier.weight(1f),
                verticalArrangement = Arrangement.spacedBy(2.dp),
            ) {
                Text(
                    text = stringResource(R.string.gate_not_built_title),
                    style = MaterialTheme.typography.labelLarge,
                )
                Text(
                    text = stringResource(R.string.gate_not_built_body),
                    style = MaterialTheme.typography.bodySmall,
                )
            }
            SemanticChip(SemanticRole.Neutral, stringResource(R.string.gate_not_built_badge))
        }
    }
}

/**
 * Legacy overload for the six-value [Feature] enum.
 *
 * Kept so existing call sites keep compiling while they migrate to catalogue
 * keys. The enum addresses six features out of 242, which is why it cannot stay:
 * every new gated surface would need a new enum constant and a new branch in
 * [EntitlementManager.isFeatureEnabled].
 */
@Deprecated(
    message = "Address features by catalogue key so the gate can tell " +
        "'not on your plan' from 'not built'. The enum cannot express that.",
    replaceWith = ReplaceWith("FeatureGate(resolver, featureKey, modifier, onUpgrade, content)"),
)
@Composable
fun FeatureGate(
    entitlementManager: EntitlementManager,
    feature: Feature,
    content: @Composable () -> Unit,
) {
    val isEnabled = entitlementManager.isFeatureEnabled(feature)
    LaunchedEffect(isEnabled) { entitlementManager.logAttempt(feature) }
    if (isEnabled) content() else NotBuiltNotice()
}
