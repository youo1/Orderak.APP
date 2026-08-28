package app.orderak.seller.core.ui

import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.defaultMinSize
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextDirection
import androidx.compose.ui.unit.dp
import app.orderak.seller.core.ui.theme.LocalOrderakSpacing

/** Fraction of a plan limit at which usage starts warning. */
private const val USAGE_WARN_AT = 0.70f

/**
 * Severity of usage against a limit, derived in one place.
 *
 * The dashboard used to compute its own thresholds and the products screen
 * passed its own boolean, so "how close is close" had two answers in one app.
 * Deriving it here means every meter agrees, and no caller can get it wrong by
 * forgetting to pass something.
 *
 * At the limit is a failure, not a warning: the seller is blocked, and calling
 * that the same thing as "getting close" hides the moment that actually matters.
 */
private fun usageRole(used: Int, limit: Int): SemanticRole = when {
    limit <= 0 -> SemanticRole.Neutral
    used >= limit -> SemanticRole.Danger
    used.toFloat() / limit >= USAGE_WARN_AT -> SemanticRole.Warning
    else -> SemanticRole.Neutral
}

/**
 * Usage against a plan limit.
 *
 * Reads as a number first and a bar second: a seller wants "43 of 50", not a
 * proportion. Severity comes from [usageRole], so the near-limit signal stays a
 * warning everywhere it appears and never borrows the brand or the commerce
 * colour. [role] overrides it only where a caller genuinely knows better.
 */
@Composable
fun UsageMeter(
    label: String,
    used: Int,
    limit: Int,
    modifier: Modifier = Modifier,
    role: SemanticRole = usageRole(used, limit),
) {
    val spacing = LocalOrderakSpacing.current
    val warn = role != SemanticRole.Neutral
    val colors = role.colors()
    val track = MaterialTheme.colorScheme.surfaceVariant
    val fill = if (warn) colors.solid else MaterialTheme.colorScheme.primary
    val fraction = if (limit <= 0) 0f else (used.toFloat() / limit).coerceIn(0f, 1f)

    Column(
        modifier = modifier.semantics { contentDescription = "$label $used / $limit" },
        verticalArrangement = Arrangement.spacedBy(spacing.space1 + 2.dp),
    ) {
        Row(
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(spacing.space1),
        ) {
            Text(
                text = label,
                style = MaterialTheme.typography.bodyMedium,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
                modifier = Modifier.weight(1f),
            )
            // Near-limit needs a signal that is not colour. Without the glyph the
            // warning meter and an ordinary one are the same bar in greyscale,
            // which is where this was caught.
            if (warn) {
                val glyph = role.icon
                if (glyph != null) {
                    Icon(
                        imageVector = glyph,
                        contentDescription = null,
                        tint = colors.solid,
                        modifier = Modifier.size(14.dp),
                    )
                }
            }
            Text(
                // "14 / 20" is a left-to-right run. Left to the paragraph it
                // reorders inside Arabic and renders as "20 / 14", which reads as
                // twenty of fourteen — the count and the limit swapped.
                text = "$used / $limit",
                style = MaterialTheme.typography.labelMedium.copy(
                    textDirection = TextDirection.Ltr,
                    fontWeight = if (warn) FontWeight.Bold else null,
                ),
                color = if (warn) colors.solid else MaterialTheme.colorScheme.onSurface,
            )
        }
        Box(
            modifier = Modifier
                .fillMaxWidth()
                .height(6.dp)
                .clip(RoundedCornerShape(4.dp))
                .background(track),
        ) {
            Box(
                modifier = Modifier
                    .fillMaxWidth(fraction)
                    .fillMaxHeight()
                    .clip(RoundedCornerShape(4.dp))
                    .background(fill),
            )
        }
    }
}

/**
 * An inline notice: an icon, a title and a line of explanation.
 *
 * Sits above content rather than replacing it. That matters most for the offline
 * case — a seller working on an intermittent connection still needs the last
 * synced orders on screen, so losing the network must not blank the surface.
 */
@Composable
fun NoticeBanner(
    role: SemanticRole,
    title: String,
    message: String,
    modifier: Modifier = Modifier,
) {
    val spacing = LocalOrderakSpacing.current
    val colors = role.colors()
    val glyph = role.icon
    Surface(
        modifier = modifier.fillMaxWidth(),
        shape = MaterialTheme.shapes.large,
        color = colors.container,
        contentColor = colors.onContainer,
        border = BorderStroke(1.dp, colors.containerOutline),
    ) {
        Row(
            modifier = Modifier.padding(horizontal = spacing.space3 + 2.dp, vertical = spacing.space3),
            horizontalArrangement = Arrangement.spacedBy(spacing.space2 + 2.dp),
        ) {
            if (glyph != null) {
                Icon(
                    imageVector = glyph,
                    contentDescription = null,
                    modifier = Modifier.size(20.dp),
                )
            }
            Column(verticalArrangement = Arrangement.spacedBy(2.dp)) {
                Text(text = title, style = MaterialTheme.typography.labelLarge)
                Text(text = message, style = MaterialTheme.typography.bodySmall)
            }
        }
    }
}

/**
 * A list row that says whether it needs the seller, before it says anything else.
 *
 * The leading rail is filled when [needsAction] and hollow when it does not, so
 * a seller scanning a list sorts it by shape. Colour repeats the signal; it does
 * not carry it. That is the job an order list actually has: "which of these
 * need me?" rather than "what stage is each one at".
 */
@Composable
fun PriorityListRow(
    title: String,
    modifier: Modifier = Modifier,
    subtitle: String? = null,
    needsAction: Boolean = false,
    trailing: @Composable (() -> Unit)? = null,
) {
    val spacing = LocalOrderakSpacing.current
    val outline = MaterialTheme.colorScheme.outlineVariant
    Surface(
        modifier = modifier.fillMaxWidth(),
        shape = MaterialTheme.shapes.large,
        color = MaterialTheme.colorScheme.surfaceContainerLowest,
    ) {
        Row(
            modifier = Modifier
                .defaultMinSize(minHeight = spacing.minimumTouchTarget)
                .padding(horizontal = spacing.space3 + 2.dp, vertical = spacing.space3),
            horizontalArrangement = Arrangement.spacedBy(spacing.space2 + 2.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Box(
                modifier = Modifier
                    .width(4.dp)
                    .height(spacing.space6 + 8.dp)
                    .clip(RoundedCornerShape(2.dp))
                    .then(
                        if (needsAction) {
                            Modifier.background(MaterialTheme.colorScheme.primary)
                        } else {
                            Modifier.background(outline.copy(alpha = 0.45f))
                        },
                    ),
            )
            Column(
                modifier = Modifier.weight(1f),
                verticalArrangement = Arrangement.spacedBy(2.dp),
            ) {
                Text(text = title, style = MaterialTheme.typography.titleSmall)
                if (subtitle != null) {
                    Text(
                        text = subtitle,
                        style = MaterialTheme.typography.bodySmall,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                    )
                }
            }
            trailing?.invoke()
        }
    }
}
