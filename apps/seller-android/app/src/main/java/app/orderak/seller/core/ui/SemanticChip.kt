package app.orderak.seller.core.ui

import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.semantics.clearAndSetSemantics
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.unit.dp

/**
 * A status chip: colour, icon and text together, inside an outlined container.
 *
 * The icon and the outline are not styling. Remove the colour and the chip still
 * reads — that is the test, and [SemanticChipGreyscalePreview] is where it is
 * checked. Roughly one man in twelve cannot rely on hue, and a seller reading
 * this in daylight on a phone is not far from the same position.
 */
@Composable
fun SemanticChip(
    role: SemanticRole,
    label: String,
    modifier: Modifier = Modifier,
) {
    val colors = role.colors()
    val glyph = role.icon
    Surface(
        modifier = modifier.clearAndSetSemantics { contentDescription = label },
        shape = MaterialTheme.shapes.small,
        color = colors.container,
        contentColor = colors.onContainer,
        border = BorderStroke(1.dp, colors.containerOutline),
    ) {
        Row(
            modifier = Modifier.padding(horizontal = 8.dp, vertical = 2.dp),
            horizontalArrangement = Arrangement.spacedBy(4.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            if (glyph != null) {
                Icon(
                    imageVector = glyph,
                    contentDescription = null,
                    modifier = Modifier.size(14.dp),
                )
            }
            Text(text = label, style = MaterialTheme.typography.labelSmall)
        }
    }
}

/**
 * How a feature entry point may appear. Exactly three states reach the seller.
 *
 * The distinction between [LockedByPlan] and [NotBuilt] is the whole point. The
 * previous gate had two states and rendered every unbuilt feature as a premium
 * upsell — for a catalogue where most features are not built, and while purchase
 * is closed platform-wide, so the upsell led to a 403.
 */
enum class FeatureAvailability {
    /** Built, and this plan allows it. Draws nothing: the normal case needs no badge. */
    Available,

    /** Built, but this plan does not allow it. Carries an upgrade path. */
    LockedByPlan,

    /**
     * Not reachable, and no plan change makes it reachable — either it is not
     * built, or it is disabled by an operational flag. Never carries an upgrade
     * path: offering one would be a dead end.
     */
    NotBuilt,
}

/**
 * The badge for a feature entry point, or nothing when the feature is available.
 *
 * Every gated row in the app draws its badge through this, so the three states
 * cannot drift apart between screens.
 */
@Composable
fun FeatureAvailabilityChip(
    availability: FeatureAvailability,
    upgradeLabel: String,
    unavailableLabel: String,
    modifier: Modifier = Modifier,
) {
    when (availability) {
        FeatureAvailability.Available -> Unit
        FeatureAvailability.LockedByPlan ->
            SemanticChip(SemanticRole.Commerce, upgradeLabel, modifier)
        FeatureAvailability.NotBuilt ->
            SemanticChip(SemanticRole.Neutral, unavailableLabel, modifier)
    }
}
