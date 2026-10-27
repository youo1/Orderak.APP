package app.orderak.seller.core.ui

import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.outlined.ArrowBack
import androidx.compose.material.icons.automirrored.outlined.KeyboardArrowRight
import androidx.compose.material.icons.outlined.Close
import androidx.compose.material.icons.outlined.MoreVert
import androidx.compose.material3.Badge
import androidx.compose.material3.BadgedBox
import androidx.compose.material3.Button
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.NavigationBar
import androidx.compose.material3.NavigationBarItem
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.platform.LocalConfiguration
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.heading
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.style.TextOverflow
import app.orderak.seller.core.text.formatCount
import app.orderak.seller.core.ui.theme.LocalOrderakSpacing

/** An icon action in a [TopBar]. [dot] marks something unread. */
data class TopBarAction(
    val icon: ImageVector,
    val description: String,
    val onClick: () -> Unit,
    val dot: Boolean = false,
)

/** An item of the [BottomNav]. [badge] is a count, 0 for none; [dot] marks something unread. */
data class NavItem(
    val label: String,
    val icon: ImageVector,
    val selectedIcon: ImageVector,
    val badge: Int = 0,
    val dot: Boolean = false,
)

/**
 * Names the screen and holds at most two actions.
 *
 * Back (or close) at the start, the title and an optional subtitle, up to two
 * icon actions and an overflow at the end. A surface uses the large title,
 * under the row. Every icon has a spoken label and is a 48dp target.
 */
@Composable
fun TopBar(
    title: String,
    modifier: Modifier = Modifier,
    subtitle: String? = null,
    onBack: (() -> Unit)? = null,
    backDescription: String = "",
    /** A form closes with an X; a page goes back with an arrow that points the way the language reads. */
    closeIcon: Boolean = false,
    large: Boolean = false,
    actions: List<TopBarAction> = emptyList(),
    onOverflow: (() -> Unit)? = null,
    overflowDescription: String = "",
) {
    val spacing = LocalOrderakSpacing.current
    Column(modifier.fillMaxWidth().padding(horizontal = spacing.space2)) {
        Row(
            modifier = Modifier.fillMaxWidth().heightIn(min = spacing.space16),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            if (onBack != null) {
                IconButton(onClick = onBack, modifier = Modifier.size(spacing.minimumTouchTarget)) {
                    Icon(
                        if (closeIcon) Icons.Outlined.Close else Icons.AutoMirrored.Outlined.ArrowBack,
                        contentDescription = backDescription,
                    )
                }
            }
            Column(Modifier.weight(1f).padding(horizontal = spacing.space2)) {
                if (!large) {
                    Text(
                        text = title,
                        style = MaterialTheme.typography.titleLarge,
                        maxLines = 1,
                        overflow = TextOverflow.Ellipsis,
                        modifier = Modifier.semantics { heading() },
                    )
                }
                if (subtitle != null && !large) {
                    Text(
                        text = subtitle,
                        style = MaterialTheme.typography.bodySmall,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                        maxLines = 1,
                        overflow = TextOverflow.Ellipsis,
                    )
                }
            }
            actions.take(2).forEach { action ->
                IconButton(onClick = action.onClick, modifier = Modifier.size(spacing.minimumTouchTarget)) {
                    BadgedBox(badge = { if (action.dot) Badge() }) {
                        Icon(action.icon, contentDescription = action.description)
                    }
                }
            }
            if (onOverflow != null) {
                IconButton(onClick = onOverflow, modifier = Modifier.size(spacing.minimumTouchTarget)) {
                    Icon(Icons.Outlined.MoreVert, contentDescription = overflowDescription)
                }
            }
        }
        if (large) {
            Column(Modifier.padding(horizontal = spacing.space2).padding(bottom = spacing.space4)) {
                Text(
                    text = title,
                    style = MaterialTheme.typography.headlineMedium,
                    modifier = Modifier.semantics { heading() },
                )
                if (subtitle != null) {
                    Text(
                        text = subtitle,
                        style = MaterialTheme.typography.bodyMedium,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                    )
                }
            }
        }
    }
}

/**
 * Moves between the five surfaces. Labels are always shown, the chosen item has
 * the filled icon and the secondary-container indicator, and an item can carry a
 * count or a dot.
 */
@Composable
fun BottomNav(
    items: List<NavItem>,
    selectedIndex: Int,
    onSelect: (Int) -> Unit,
    modifier: Modifier = Modifier,
) {
    val locale = LocalConfiguration.current.locales[0]
    NavigationBar(modifier) {
        items.forEachIndexed { index, item ->
            val selected = index == selectedIndex
            NavigationBarItem(
                selected = selected,
                onClick = { onSelect(index) },
                alwaysShowLabel = true,
                label = { Text(item.label) },
                icon = {
                    BadgedBox(
                        badge = {
                            when {
                                item.badge > 0 -> Badge { Text(formatCount(item.badge, locale)) }
                                item.dot -> Badge()
                            }
                        },
                    ) {
                        Icon(if (selected) item.selectedIcon else item.icon, contentDescription = null)
                    }
                },
            )
        }
    }
}

/**
 * Commits a form or advances a thing: a primary button, an optional secondary
 * and an optional summary such as a total.
 *
 * A disabled primary says why in [disabledReason], on screen, because a disabled
 * button cannot be asked.
 */
@Composable
fun BottomActionBar(
    primaryLabel: String,
    onPrimary: () -> Unit,
    modifier: Modifier = Modifier,
    secondaryLabel: String? = null,
    onSecondary: (() -> Unit)? = null,
    summaryLabel: String? = null,
    summaryValue: String? = null,
    primaryEnabled: Boolean = true,
    disabledReason: String? = null,
) {
    val spacing = LocalOrderakSpacing.current
    Surface(modifier.fillMaxWidth(), tonalElevation = spacing.space2, color = MaterialTheme.colorScheme.surfaceContainer) {
        Column(
            Modifier.padding(horizontal = spacing.space4, vertical = spacing.space3),
            verticalArrangement = Arrangement.spacedBy(spacing.space2),
        ) {
            if (summaryLabel != null && summaryValue != null) {
                Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween) {
                    Text(summaryLabel, style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.colorScheme.onSurfaceVariant)
                    Text(summaryValue, style = MaterialTheme.typography.titleMedium)
                }
            }
            if (!primaryEnabled && disabledReason != null) {
                Text(disabledReason, style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
            }
            Row(horizontalArrangement = Arrangement.spacedBy(spacing.space2)) {
                if (secondaryLabel != null && onSecondary != null) {
                    OutlinedButton(
                        onClick = onSecondary,
                        modifier = Modifier.weight(1f).heightIn(min = spacing.minimumTouchTarget),
                    ) { Text(secondaryLabel) }
                }
                Button(
                    onClick = onPrimary,
                    enabled = primaryEnabled,
                    modifier = Modifier.weight(1f).heightIn(min = spacing.minimumTouchTarget),
                ) { Text(primaryLabel) }
            }
        }
    }
}

/** Creates the thing the surface lists: an extended button, icon and label. */
@Composable
fun Fab(
    label: String,
    icon: ImageVector,
    onClick: () -> Unit,
    modifier: Modifier = Modifier,
) {
    val spacing = LocalOrderakSpacing.current
    // One clickable surface whose text names it: the icon and the label are read as
    // one control, and the button has no second node of its own.
    Surface(
        onClick = onClick,
        shape = MaterialTheme.shapes.large,
        color = MaterialTheme.colorScheme.primaryContainer,
        contentColor = MaterialTheme.colorScheme.onPrimaryContainer,
        shadowElevation = spacing.space2,
        modifier = modifier.heightIn(min = spacing.space16 - spacing.space2),
    ) {
        Row(
            modifier = Modifier.padding(horizontal = spacing.space4),
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(spacing.space2),
        ) {
            Icon(icon, contentDescription = null)
            Text(label, style = MaterialTheme.typography.labelLarge)
        }
    }
}

/** Titles a group, with an optional count and an optional action at the end. */
@Composable
fun SectionHeader(
    title: String,
    modifier: Modifier = Modifier,
    count: Int? = null,
    actionLabel: String? = null,
    onAction: (() -> Unit)? = null,
) {
    val spacing = LocalOrderakSpacing.current
    val locale = LocalConfiguration.current.locales[0]
    Row(
        modifier = modifier.fillMaxWidth().heightIn(min = spacing.minimumTouchTarget),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Text(
            text = if (count != null) "$title ${isolated(formatCount(count, locale))}" else title,
            style = MaterialTheme.typography.titleSmall,
            color = MaterialTheme.colorScheme.onSurfaceVariant,
            modifier = Modifier.weight(1f).semantics { heading() },
        )
        if (actionLabel != null && onAction != null) {
            TextButton(onClick = onAction, modifier = Modifier.heightIn(min = spacing.minimumTouchTarget)) {
                Text(actionLabel)
            }
        }
    }
}

/** A label and its value; the emphasised variant is for totals. */
@Composable
fun KeyValueRow(
    label: String,
    value: String,
    modifier: Modifier = Modifier,
    emphasised: Boolean = false,
) {
    val spacing = LocalOrderakSpacing.current
    Row(
        modifier = modifier.fillMaxWidth().padding(vertical = spacing.space1),
        horizontalArrangement = Arrangement.SpaceBetween,
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Text(
            text = label,
            style = if (emphasised) MaterialTheme.typography.titleMedium else MaterialTheme.typography.bodyMedium,
            color = if (emphasised) MaterialTheme.colorScheme.onSurface else MaterialTheme.colorScheme.onSurfaceVariant,
            modifier = Modifier.weight(1f),
        )
        Text(
            text = value,
            style = if (emphasised) MaterialTheme.typography.titleMedium else MaterialTheme.typography.bodyMedium,
            color = MaterialTheme.colorScheme.onSurface,
        )
    }
}

/**
 * An entry in a grouped list: icon, title, an optional value, and a chevron that
 * mirrors in Arabic. The danger variant is for the entry that cannot be undone.
 */
@Composable
fun SettingsRow(
    title: String,
    onClick: () -> Unit,
    modifier: Modifier = Modifier,
    icon: ImageVector? = null,
    value: String? = null,
    danger: Boolean = false,
) {
    val spacing = LocalOrderakSpacing.current
    val color = if (danger) MaterialTheme.colorScheme.error else MaterialTheme.colorScheme.onSurface
    Row(
        modifier = modifier
            .fillMaxWidth()
            .heightIn(min = spacing.space16 - spacing.space2)
            .clickable(role = Role.Button, onClick = onClick)
            .padding(horizontal = spacing.space4, vertical = spacing.space2),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(spacing.space4),
    ) {
        if (icon != null) {
            Icon(icon, contentDescription = null, tint = if (danger) color else MaterialTheme.colorScheme.onSurfaceVariant)
        }
        Text(title, style = MaterialTheme.typography.bodyLarge, color = color, modifier = Modifier.weight(1f))
        if (value != null) {
            Text(value, style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.colorScheme.onSurfaceVariant)
        }
        Icon(
            Icons.AutoMirrored.Outlined.KeyboardArrowRight,
            contentDescription = null,
            tint = MaterialTheme.colorScheme.onSurfaceVariant,
        )
    }
}
