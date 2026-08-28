package app.orderak.seller.core.ui

import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.CheckCircle
import androidx.compose.material.icons.outlined.ErrorOutline
import androidx.compose.material.icons.outlined.Info
import androidx.compose.material.icons.outlined.Lock
import androidx.compose.material.icons.outlined.WarningAmber
import androidx.compose.material3.MaterialTheme
import androidx.compose.runtime.Composable
import androidx.compose.runtime.Immutable
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.vector.ImageVector
import app.orderak.seller.core.ui.theme.LocalOrderakExtendedColors

/**
 * The semantic layer of the colour system: what is happening, as opposed to who
 * Orderak is.
 *
 * One meaning per role and one role per meaning. The rule matters because the
 * previous UI shared `secondaryContainer` between "ready to ship" and "upgrade",
 * which left both signals meaning nothing. If a new meaning appears, it gets its
 * own palette — it never borrows one that is already spoken for.
 *
 * Brand colour deliberately has no entry here. Identity never signals state.
 */
enum class SemanticRole {
    /** Completed, paid, published. */
    Success,

    /** Approaching a limit, needs attention. The seller has done nothing wrong. */
    Warning,

    /** Failed, unpaid, over a limit. */
    Danger,

    /** Neutral information. No action required. */
    Info,

    /**
     * Anything monetary: plans, upgrades, subscription, paid limits.
     * Its own hue because upgrade prompts appear on nearly every surface, and
     * reading them as warnings would put the seller in a permanent alarm state.
     */
    Commerce,

    /** Not built yet, disabled, inert. Carries no hue of its own. */
    Neutral,
}

/**
 * Resolved colours for one role.
 *
 * [containerOutline] is not decoration. A container at tone 90 on a tone 98
 * surface separates from it by hue alone, which a colour-blind seller cannot
 * see; the outline gives every semantic surface an edge that survives
 * greyscale. Every pair below is contrast-checked at generation.
 */
@Immutable
data class SemanticColors(
    val container: Color,
    val onContainer: Color,
    val containerOutline: Color,
    val solid: Color,
    val onSolid: Color,
)

/**
 * Colours for [role], read from the generated palette. Nothing here is a literal:
 * every value comes from the extended colour set or [MaterialTheme.colorScheme],
 * both produced by the pinned generator.
 */
@Composable
fun SemanticRole.colors(): SemanticColors {
    val extended = LocalOrderakExtendedColors.current
    val scheme = MaterialTheme.colorScheme
    return when (this) {
        SemanticRole.Success -> SemanticColors(
            container = extended.successSoft,
            onContainer = extended.onSuccessContainer,
            containerOutline = extended.successContainerOutline,
            solid = extended.success,
            onSolid = extended.onSuccess,
        )
        SemanticRole.Warning -> SemanticColors(
            container = extended.warningSoft,
            onContainer = extended.onWarningContainer,
            containerOutline = extended.warningContainerOutline,
            solid = extended.warning,
            onSolid = extended.onWarning,
        )
        // `error` is a first-class Material 3 role produced by the dynamic scheme
        // rather than by the semantic generator, so it has no generated outline.
        // The base role stands in: it sits at the tone the other outlines use and
        // clears the same thresholds — 6.2:1 on surface light, 10.9:1 dark.
        SemanticRole.Danger -> SemanticColors(
            container = scheme.errorContainer,
            onContainer = scheme.onErrorContainer,
            containerOutline = scheme.error,
            solid = scheme.error,
            onSolid = scheme.onError,
        )
        SemanticRole.Info -> SemanticColors(
            container = extended.informationSoft,
            onContainer = extended.onInformationContainer,
            containerOutline = extended.informationContainerOutline,
            solid = extended.information,
            onSolid = extended.onInformation,
        )
        SemanticRole.Commerce -> SemanticColors(
            container = extended.commerceSoft,
            onContainer = extended.onCommerceContainer,
            containerOutline = extended.commerceContainerOutline,
            solid = extended.commerce,
            onSolid = extended.onCommerce,
        )
        SemanticRole.Neutral -> SemanticColors(
            container = scheme.surfaceVariant,
            onContainer = scheme.onSurfaceVariant,
            containerOutline = scheme.outlineVariant,
            solid = scheme.surfaceVariant,
            onSolid = scheme.onSurfaceVariant,
        )
    }
}

/**
 * The icon that carries [role] when colour cannot.
 *
 * Every semantic surface pairs colour with an icon and text, so the meaning
 * survives greyscale, colour blindness and a phone in bright sunlight. Neutral
 * has none: "not built yet" is the absence of a signal, and inventing a glyph
 * for it would give inert rows a presence they should not have.
 */
val SemanticRole.icon: ImageVector?
    get() = when (this) {
        SemanticRole.Success -> Icons.Outlined.CheckCircle
        SemanticRole.Warning -> Icons.Outlined.WarningAmber
        SemanticRole.Danger -> Icons.Outlined.ErrorOutline
        SemanticRole.Info -> Icons.Outlined.Info
        SemanticRole.Commerce -> Icons.Outlined.Lock
        SemanticRole.Neutral -> null
    }
