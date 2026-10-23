package app.orderak.seller.core.ui

import android.content.res.Configuration
import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.CloudOff
import androidx.compose.material.icons.outlined.ErrorOutline
import androidx.compose.material.icons.outlined.FilterAlt
import androidx.compose.material.icons.outlined.Inbox
import androidx.compose.material.icons.outlined.Sync
import androidx.compose.material.icons.outlined.WifiOff
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.Shape
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.layout.onSizeChanged
import androidx.compose.ui.platform.LocalConfiguration
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.res.pluralStringResource
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.tooling.preview.Preview
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import app.orderak.seller.R
import app.orderak.seller.core.text.formatCount
import app.orderak.seller.core.ui.theme.LocalOrderakSpacing
import java.util.Locale

/**
 * The approved preview matrix for the feedback kit.
 *
 * One annotation so every component state renders in Arabic and English, light
 * and dark, at 100% and 200% font scale. The parameter list is deliberately
 * explicit: the reference file name carries a hash of these values.
 */
@Preview(name = "AR light 100", locale = "ar", uiMode = Configuration.UI_MODE_NIGHT_NO, fontScale = 1f)
@Preview(name = "AR dark 100", locale = "ar", uiMode = Configuration.UI_MODE_NIGHT_YES, fontScale = 1f)
@Preview(name = "AR light 200", locale = "ar", uiMode = Configuration.UI_MODE_NIGHT_NO, fontScale = 2f)
@Preview(name = "AR dark 200", locale = "ar", uiMode = Configuration.UI_MODE_NIGHT_YES, fontScale = 2f)
@Preview(name = "EN light 100", locale = "en", uiMode = Configuration.UI_MODE_NIGHT_NO, fontScale = 1f)
@Preview(name = "EN dark 100", locale = "en", uiMode = Configuration.UI_MODE_NIGHT_YES, fontScale = 1f)
@Preview(name = "EN light 200", locale = "en", uiMode = Configuration.UI_MODE_NIGHT_NO, fontScale = 2f)
@Preview(name = "EN dark 200", locale = "en", uiMode = Configuration.UI_MODE_NIGHT_YES, fontScale = 2f)
annotation class FeedbackPreviews

/** The eight states the approved Banner design draws. */
enum class BannerState {
    Information,
    Warning,
    Error,
    Success,
    LockedByPlan,
    SyncInProgress,
    SyncFailed,
    VersionWarning,
}

/** The two states the approved OfflineStrip design draws. */
enum class OfflineStripState {
    Offline,
    Reconnecting,
}

/** The three shapes the approved Skeleton design draws. */
enum class SkeletonVariant {
    ListRows,
    MetricTiles,
    DetailBlock,
}

/**
 * The two situations the approved EmptyState design keeps apart. Nothing here
 * yet and nothing matching a filter have different fixes, so they never share
 * a sentence or an action.
 */
enum class EmptyStateKind {
    Empty,
    FilteredToNothing,
}

/** The two failures the approved ErrorState design draws. */
enum class ErrorStateKind {
    NoConnection,
    ServiceUnavailable,
}

private fun roleFor(state: BannerState): SemanticRole = when (state) {
    BannerState.Information -> SemanticRole.Info
    BannerState.Warning -> SemanticRole.Warning
    BannerState.Error -> SemanticRole.Danger
    BannerState.Success -> SemanticRole.Success
    BannerState.LockedByPlan -> SemanticRole.Commerce
    BannerState.SyncInProgress -> SemanticRole.Info
    BannerState.SyncFailed -> SemanticRole.Danger
    BannerState.VersionWarning -> SemanticRole.Warning
}

/** A count in the locale's own digits, isolated from the paragraph direction. */
private fun isolatedCount(value: Int, locale: Locale): String =
    "\u2066${formatCount(value, locale)}\u2069"

/**
 * Inline feedback with a role icon, a title, an optional message and an
 * optional action.
 *
 * The action moves below the message, on its own full-width row, when 200% text
 * pushes the message past three lines; a side-by-side action would leave the
 * message a few words wide. The action row keeps the 48dp target.
 *
 * [BannerState.VersionWarning] is non-dismissible: it has no close control, so
 * updating stays the only way out of the warning.
 */
@Composable
fun Banner(
    state: BannerState,
    title: String,
    message: String? = null,
    modifier: Modifier = Modifier,
    actionLabel: String? = null,
    onAction: (() -> Unit)? = null,
) {
    val spacing = LocalOrderakSpacing.current
    val configuration = LocalConfiguration.current
    val fontScale = maxOf(LocalDensity.current.fontScale, configuration.fontScale)
    val role = roleFor(state)
    val colors = role.colors()
    // Sync in progress shares the information colours but not their glyph: the
    // approved design draws the sync arrows, so the state still reads without
    // colour and is not mistaken for a plain notice.
    val glyph = if (state == BannerState.SyncInProgress) Icons.Outlined.Sync else role.icon
    // Measure once per width in the side-by-side arrangement. Updating the
    // counts after the action moves would change the text width, change the line
    // count and flip the arrangement again, so the layout would never settle. A
    // new width (rotation, split screen) starts a fresh measurement, because a
    // message that fit a wide row can need far more lines on a narrow one.
    var width by remember { mutableIntStateOf(0) }
    var titleLines by remember(title, fontScale, width) { mutableIntStateOf(0) }
    var messageLines by remember(message, fontScale, width) { mutableIntStateOf(0) }
    val stacked = fontScale >= 2f && titleLines + messageLines > 3
    val hasAction = actionLabel != null && onAction != null
    Surface(
        modifier = modifier
            .fillMaxWidth()
            .onSizeChanged { width = it.width },
        shape = MaterialTheme.shapes.large,
        color = colors.container,
        contentColor = colors.onContainer,
        border = BorderStroke(1.dp, colors.containerOutline),
    ) {
        Column(
            modifier = Modifier.padding(
                horizontal = spacing.space3 + spacing.space1,
                vertical = spacing.space3,
            ),
            verticalArrangement = Arrangement.spacedBy(spacing.space1),
        ) {
            Row(
                horizontalArrangement = Arrangement.spacedBy(spacing.space2 + spacing.space1),
                verticalAlignment = Alignment.Top,
            ) {
                if (glyph != null) {
                    Icon(
                        imageVector = glyph,
                        contentDescription = null,
                        modifier = Modifier.size(spacing.iconMedium),
                    )
                }
                Column(
                    modifier = Modifier.weight(1f),
                    verticalArrangement = Arrangement.spacedBy(spacing.space1),
                ) {
                    Text(
                        text = title,
                        style = MaterialTheme.typography.titleSmall,
                        onTextLayout = { if (titleLines == 0) titleLines = it.lineCount },
                    )
                    if (message != null) {
                        Text(
                            text = message,
                            style = MaterialTheme.typography.bodySmall,
                            onTextLayout = { if (messageLines == 0) messageLines = it.lineCount },
                        )
                    }
                }
                if (hasAction && !stacked) {
                    TextButton(
                        onClick = onAction!!,
                        contentPadding = PaddingValues(horizontal = 0.dp, vertical = 0.dp),
                        modifier = Modifier
                            .align(Alignment.CenterVertically)
                            .heightIn(min = spacing.minimumTouchTarget),
                    ) {
                        Text(actionLabel!!, style = MaterialTheme.typography.labelLarge)
                    }
                }
            }
            if (hasAction && stacked) {
                TextButton(
                    onClick = onAction!!,
                    modifier = Modifier
                        .fillMaxWidth()
                        .heightIn(min = spacing.minimumTouchTarget),
                ) {
                    Text(actionLabel!!, style = MaterialTheme.typography.labelLarge)
                }
            }
        }
    }
}

/**
 * Connectivity strip for the top of a surface.
 *
 * [OfflineStripState.Offline] names the last update when the caller knows it,
 * with Arabic-Indic digits and an explicit direction island under Arabic.
 */
@Composable
fun OfflineStrip(
    state: OfflineStripState,
    modifier: Modifier = Modifier,
    lastUpdateMinutes: Int? = null,
) {
    val spacing = LocalOrderakSpacing.current
    val locale = LocalConfiguration.current.locales[0]
    val glyph = if (state == OfflineStripState.Offline) {
        Icons.Outlined.CloudOff
    } else {
        Icons.Outlined.Sync
    }
    Surface(
        modifier = modifier.fillMaxWidth(),
        shape = MaterialTheme.shapes.medium,
        color = MaterialTheme.colorScheme.inverseSurface,
        contentColor = MaterialTheme.colorScheme.inverseOnSurface,
    ) {
        Row(
            modifier = Modifier.padding(
                horizontal = spacing.space3 + spacing.space1,
                vertical = spacing.space3,
            ),
            horizontalArrangement = Arrangement.spacedBy(spacing.space2 + spacing.space1),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Icon(
                imageVector = glyph,
                contentDescription = null,
                modifier = Modifier.size(spacing.iconMedium),
            )
            Column(
                modifier = Modifier.weight(1f),
                verticalArrangement = Arrangement.spacedBy(spacing.space1),
            ) {
                Text(
                    text = stringResource(
                        if (state == OfflineStripState.Offline) {
                            R.string.offline_strip_offline
                        } else {
                            R.string.offline_strip_reconnecting
                        },
                    ),
                    style = MaterialTheme.typography.titleSmall,
                )
                if (state == OfflineStripState.Offline && lastUpdateMinutes != null) {
                    // Count-aware: Arabic takes a different noun form for 1, 2,
                    // 3–10 and 11 or more, so one fixed «دقائق» was wrong for most
                    // counts.
                    Text(
                        text = pluralStringResource(
                            R.plurals.offline_strip_last_update,
                            lastUpdateMinutes,
                            isolatedCount(lastUpdateMinutes, locale),
                        ),
                        style = MaterialTheme.typography.bodySmall,
                    )
                }
            }
        }
    }
}

/** A static placeholder block: no animation, so reduced motion changes nothing. */
private fun Modifier.skeletonBlock(width: Dp, height: Dp, color: Color, shape: Shape): Modifier =
    this.width(width).height(height).clip(shape).background(color)

/**
 * A static loading skeleton.
 *
 * It never animates, so it is already correct under reduced motion. The three
 * shapes match the list, metric and detail regions a caller is waiting for.
 */
@Composable
fun Skeleton(
    variant: SkeletonVariant,
    modifier: Modifier = Modifier,
) {
    val spacing = LocalOrderakSpacing.current
    val placeholder = MaterialTheme.colorScheme.surfaceVariant
    val label = stringResource(R.string.skeleton_loading)

    Surface(
        modifier = modifier
            .fillMaxWidth()
            .semantics { contentDescription = label },
        shape = MaterialTheme.shapes.large,
        color = MaterialTheme.colorScheme.surfaceContainerLowest,
    ) {
        when (variant) {
            SkeletonVariant.ListRows -> Column(
                modifier = Modifier.padding(spacing.space4),
                verticalArrangement = Arrangement.spacedBy(spacing.space3),
            ) {
                // Three rows, as the approved design draws them.
                repeat(3) {
                    Row(
                        horizontalArrangement = Arrangement.spacedBy(spacing.space3),
                        verticalAlignment = Alignment.CenterVertically,
                    ) {
                        Box(
                            modifier = Modifier
                                .size(spacing.space10)
                                .clip(CircleShape)
                                .background(placeholder),
                        )
                        Column(
                            modifier = Modifier.weight(1f),
                            verticalArrangement = Arrangement.spacedBy(spacing.space2),
                        ) {
                            Box(Modifier.skeletonBlock(spacing.space16 + spacing.space8, spacing.space3, placeholder, MaterialTheme.shapes.small))
                            Box(Modifier.skeletonBlock(spacing.space16, spacing.space2, placeholder, MaterialTheme.shapes.small))
                        }
                    }
                }
            }
            SkeletonVariant.MetricTiles -> Row(
                modifier = Modifier.padding(spacing.space4),
                horizontalArrangement = Arrangement.spacedBy(spacing.space3),
            ) {
                repeat(3) {
                    Surface(
                        modifier = Modifier.weight(1f),
                        shape = MaterialTheme.shapes.medium,
                        color = MaterialTheme.colorScheme.surfaceContainerHigh,
                    ) {
                        Column(
                            modifier = Modifier.padding(spacing.space3),
                            verticalArrangement = Arrangement.spacedBy(spacing.space2),
                        ) {
                            Box(Modifier.skeletonBlock(spacing.space16, spacing.space2, placeholder, MaterialTheme.shapes.small))
                            Box(Modifier.skeletonBlock(spacing.space16 + spacing.space8, spacing.space6, placeholder, MaterialTheme.shapes.small))
                        }
                    }
                }
            }
            SkeletonVariant.DetailBlock -> Column(
                modifier = Modifier.padding(spacing.space4),
                verticalArrangement = Arrangement.spacedBy(spacing.space3),
            ) {
                Box(Modifier.skeletonBlock(spacing.space16 + spacing.space16, spacing.space6, placeholder, MaterialTheme.shapes.small))
                Box(Modifier.skeletonBlock(spacing.space16 + spacing.space16 + spacing.space8, spacing.space2, placeholder, MaterialTheme.shapes.small))
                Box(Modifier.skeletonBlock(spacing.space16 + spacing.space16, spacing.space2, placeholder, MaterialTheme.shapes.small))
                Spacer(Modifier.height(spacing.space1))
                Box(Modifier.skeletonBlock(spacing.space12, spacing.space3, placeholder, MaterialTheme.shapes.small))
                Box(Modifier.skeletonBlock(spacing.space16 + spacing.space8, spacing.space2, placeholder, MaterialTheme.shapes.small))
            }
        }
    }
}

/**
 * The centred layout EmptyState and ErrorState share: a glyph in a circle, a
 * title, an optional message and one optional button.
 */
@Composable
private fun CenteredState(
    icon: ImageVector,
    circleColor: Color,
    iconColor: Color,
    title: String,
    message: String?,
    modifier: Modifier,
    action: (@Composable () -> Unit)?,
) {
    val spacing = LocalOrderakSpacing.current
    Box(
        modifier = modifier.fillMaxSize().padding(spacing.space8),
        contentAlignment = Alignment.Center,
    ) {
        Column(
            horizontalAlignment = Alignment.CenterHorizontally,
            verticalArrangement = Arrangement.spacedBy(spacing.space2),
        ) {
            Box(
                modifier = Modifier
                    .size(spacing.space16)
                    .clip(CircleShape)
                    .background(circleColor),
                contentAlignment = Alignment.Center,
            ) {
                Icon(
                    imageVector = icon,
                    contentDescription = null,
                    tint = iconColor,
                    modifier = Modifier.size(spacing.iconMedium),
                )
            }
            Spacer(Modifier.height(spacing.space2))
            Text(
                text = title,
                style = MaterialTheme.typography.titleMedium,
                textAlign = TextAlign.Center,
                color = MaterialTheme.colorScheme.onSurface,
            )
            if (message != null) {
                Text(
                    text = message,
                    style = MaterialTheme.typography.bodyMedium,
                    textAlign = TextAlign.Center,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                )
            }
            if (action != null) {
                Spacer(Modifier.height(spacing.space2))
                action()
            }
        }
    }
}

/**
 * A surface with nothing to show, saying why and offering one next step.
 *
 * [EmptyStateKind.FilteredToNothing] is for a filter or search that hides
 * every row: its action clears the filter, never sells something, because the
 * seller's data is still there.
 */
@Composable
fun EmptyState(
    kind: EmptyStateKind,
    title: String,
    modifier: Modifier = Modifier,
    message: String? = null,
    actionLabel: String? = null,
    onAction: (() -> Unit)? = null,
    icon: ImageVector = if (kind == EmptyStateKind.Empty) Icons.Outlined.Inbox else Icons.Outlined.FilterAlt,
) {
    val spacing = LocalOrderakSpacing.current
    CenteredState(
        icon = icon,
        circleColor = MaterialTheme.colorScheme.surfaceContainerHigh,
        iconColor = MaterialTheme.colorScheme.onSurfaceVariant,
        title = title,
        message = message,
        modifier = modifier,
        action = if (actionLabel != null && onAction != null) {
            {
                Button(
                    onClick = onAction,
                    modifier = Modifier.heightIn(min = spacing.minimumTouchTarget),
                ) { Text(actionLabel) }
            }
        } else {
            null
        },
    )
}

/**
 * A failure that replaces a surface's content.
 *
 * Every error names the cause (the [title], which defaults to the failure
 * [kind] describes), the way out (the [message]) and, when the caller knows it,
 * what was kept: "what you typed is still here" belongs in the message too.
 */
@Composable
fun ErrorState(
    kind: ErrorStateKind,
    message: String,
    modifier: Modifier = Modifier,
    title: String = stringResource(
        if (kind == ErrorStateKind.NoConnection) {
            R.string.error_state_no_connection_title
        } else {
            R.string.error_state_service_unavailable_title
        },
    ),
    onRetry: (() -> Unit)? = null,
) {
    val spacing = LocalOrderakSpacing.current
    val danger = SemanticRole.Danger.colors()
    CenteredState(
        icon = if (kind == ErrorStateKind.NoConnection) Icons.Outlined.WifiOff else Icons.Outlined.ErrorOutline,
        circleColor = danger.container,
        iconColor = danger.onContainer,
        title = title,
        message = message,
        modifier = modifier,
        action = if (onRetry != null) {
            {
                OutlinedButton(
                    onClick = onRetry,
                    modifier = Modifier.heightIn(min = spacing.minimumTouchTarget),
                ) { Text(stringResource(R.string.common_retry)) }
            }
        } else {
            null
        },
    )
}

/**
 * What a gated feature draws instead of itself.
 *
 * - [FeatureAvailability.LockedByPlan] with [onViewPlans]: the feature exists
 *   behind a higher plan and purchase is open, so the notice offers the plans.
 * - [FeatureAvailability.LockedByPlan] without it: purchase is closed, so the
 *   notice states the lock and offers nothing to press.
 * - [FeatureAvailability.NotBuilt]: no chip and no button. No plan change opens
 *   it, and a path that leads nowhere must not look like a path.
 * - [FeatureAvailability.Available]: nothing. The caller draws the feature
 *   itself, without a wrapper; [FeatureGate] does exactly that.
 */
@Composable
fun GateNotice(
    availability: FeatureAvailability,
    modifier: Modifier = Modifier,
    onViewPlans: (() -> Unit)? = null,
) {
    val spacing = LocalOrderakSpacing.current
    when (availability) {
        FeatureAvailability.Available -> Unit
        FeatureAvailability.LockedByPlan -> {
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
                        Icon(imageVector = it, contentDescription = null, modifier = Modifier.size(spacing.iconMedium))
                    }
                    Column(
                        modifier = Modifier.weight(1f),
                        verticalArrangement = Arrangement.spacedBy(spacing.space1),
                    ) {
                        Text(
                            text = stringResource(R.string.gate_locked_by_plan_title),
                            style = MaterialTheme.typography.titleSmall,
                        )
                        Text(
                            text = stringResource(R.string.gate_locked_by_plan_body),
                            style = MaterialTheme.typography.bodySmall,
                        )
                    }
                    if (onViewPlans != null) {
                        OutlinedButton(
                            onClick = onViewPlans,
                            colors = ButtonDefaults.outlinedButtonColors(contentColor = colors.onContainer),
                            border = BorderStroke(1.dp, colors.onContainer),
                            modifier = Modifier.heightIn(min = spacing.minimumTouchTarget),
                        ) { Text(stringResource(R.string.gate_upgrade_action)) }
                    }
                }
            }
        }
        FeatureAvailability.NotBuilt -> Surface(
            modifier = modifier.fillMaxWidth(),
            shape = MaterialTheme.shapes.large,
            color = MaterialTheme.colorScheme.surfaceVariant,
            contentColor = MaterialTheme.colorScheme.onSurfaceVariant,
        ) {
            Column(
                modifier = Modifier.padding(spacing.space4),
                verticalArrangement = Arrangement.spacedBy(spacing.space1),
            ) {
                Text(
                    text = stringResource(R.string.gate_not_built_title),
                    style = MaterialTheme.typography.titleSmall,
                )
                Text(
                    text = stringResource(R.string.gate_not_built_body),
                    style = MaterialTheme.typography.bodySmall,
                )
            }
        }
    }
}
