package app.orderak.seller.core.ui

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.BoxScope
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.outlined.Send
import androidx.compose.material.icons.outlined.Check
import androidx.compose.material.icons.outlined.Image
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.platform.LocalConfiguration
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.clearAndSetSemantics
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.Dp
import app.orderak.seller.core.money.Money
import app.orderak.seller.core.money.formatMoneyLabel
import app.orderak.seller.core.text.formatCount
import app.orderak.seller.core.ui.theme.LocalOrderakLayout
import app.orderak.seller.core.ui.theme.LocalOrderakSpacing

/** One step of a [StepList]: what it is, one line of detail, and whether it is done. */
data class StepItem(val title: String, val detail: String, val done: Boolean)

/**
 * A count that opens what it counts.
 *
 * [value] is null when the count has not been read yet, which is not the same as
 * zero: it draws a dash and says so ([notReadDescription]), because a seller who
 * sees 0 believes there is nothing waiting. [loading] draws a placeholder.
 */
@Composable
fun MetricTile(
    label: String,
    value: Int?,
    role: SemanticRole,
    onClick: () -> Unit,
    modifier: Modifier = Modifier,
    loading: Boolean = false,
    notReadDescription: String = "",
) {
    val spacing = LocalOrderakSpacing.current
    val locale = LocalConfiguration.current.locales[0]
    val colors = role.colors()
    val spoken = if (value != null) "$label ${formatCount(value, locale)}" else "$label $notReadDescription".trim()
    Surface(
        onClick = onClick,
        shape = MaterialTheme.shapes.large,
        color = colors.container,
        contentColor = colors.onContainer,
        modifier = modifier
            .heightIn(min = spacing.minimumTouchTarget)
            .semantics(mergeDescendants = true) { contentDescription = spoken },
    ) {
        Column(Modifier.padding(spacing.space3), verticalArrangement = Arrangement.spacedBy(spacing.space1)) {
            if (loading) {
                Box(
                    Modifier
                        .size(width = spacing.space10, height = spacing.space6)
                        .clip(MaterialTheme.shapes.small)
                        .background(colors.onContainer.copy(alpha = 0.12f)),
                )
            } else {
                Text(
                    text = if (value != null) isolated(formatCount(value, locale)) else "—",
                    style = MaterialTheme.typography.headlineSmall,
                    modifier = Modifier.clearAndSetSemantics {},
                )
            }
            Text(label, style = MaterialTheme.typography.labelMedium, modifier = Modifier.clearAndSetSemantics {})
        }
    }
}

/**
 * Where something is in a short sequence, such as an order's steps.
 *
 * Each step is done, current or next, and none of them rests on colour: a done
 * step has a check, the current one a thicker ring. A cancelled thing replaces
 * the stepper with [cancelledLabel] in a Banner, since it has no next step.
 */
@Composable
fun StatusStepper(
    steps: List<String>,
    currentIndex: Int,
    modifier: Modifier = Modifier,
    cancelledLabel: String? = null,
) {
    val spacing = LocalOrderakSpacing.current
    val colors = MaterialTheme.colorScheme
    if (cancelledLabel != null) {
        Banner(state = BannerState.Error, title = cancelledLabel, modifier = modifier)
        return
    }
    Row(modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(spacing.space1)) {
        steps.forEachIndexed { index, step ->
            val done = index < currentIndex
            val current = index == currentIndex
            Column(
                modifier = Modifier.weight(1f),
                horizontalAlignment = Alignment.CenterHorizontally,
                verticalArrangement = Arrangement.spacedBy(spacing.space1),
            ) {
                Box(
                    contentAlignment = Alignment.Center,
                    modifier = Modifier
                        .size(spacing.space6)
                        .clip(CircleShape)
                        .background(if (done) colors.primary else colors.surface)
                        .border(
                            if (current) spacing.space1 / 2 else spacing.space1 / 4,
                            if (done || current) colors.primary else colors.outline,
                            CircleShape,
                        ),
                ) {
                    if (done) {
                        Icon(Icons.Outlined.Check, contentDescription = null, tint = colors.onPrimary, modifier = Modifier.size(spacing.iconSmall))
                    }
                }
                Text(
                    text = step,
                    style = MaterialTheme.typography.labelSmall,
                    textAlign = TextAlign.Center,
                    color = if (current) colors.onSurface else colors.onSurfaceVariant,
                )
            }
        }
    }
}

/**
 * A sequence read top to bottom, each step with a line of detail: the setup
 * checklist, the deletion timeline. A done step has a check, so it does not rest
 * on colour.
 */
@Composable
fun StepList(
    steps: List<StepItem>,
    modifier: Modifier = Modifier,
) {
    val spacing = LocalOrderakSpacing.current
    val colors = MaterialTheme.colorScheme
    Column(modifier.fillMaxWidth(), verticalArrangement = Arrangement.spacedBy(spacing.space3)) {
        steps.forEach { step ->
            Row(horizontalArrangement = Arrangement.spacedBy(spacing.space3)) {
                Box(
                    contentAlignment = Alignment.Center,
                    modifier = Modifier
                        .size(spacing.space6)
                        .clip(CircleShape)
                        .background(if (step.done) colors.primary else colors.surface)
                        .border(spacing.space1 / 4, if (step.done) colors.primary else colors.outline, CircleShape),
                ) {
                    if (step.done) {
                        Icon(Icons.Outlined.Check, contentDescription = null, tint = colors.onPrimary, modifier = Modifier.size(spacing.iconSmall))
                    }
                }
                Column(Modifier.weight(1f)) {
                    Text(step.title, style = MaterialTheme.typography.bodyLarge)
                    Text(step.detail, style = MaterialTheme.typography.bodySmall, color = colors.onSurfaceVariant)
                }
            }
        }
    }
}

/**
 * An amount with its currency, written the way the locale writes it. The text is
 * isolated from the surrounding direction so the digits and the symbol never
 * reorder inside an Arabic sentence.
 */
@Composable
fun MoneyText(
    money: Money,
    modifier: Modifier = Modifier,
    style: TextStyle = MaterialTheme.typography.titleMedium,
) {
    val locale = LocalConfiguration.current.locales[0]
    Text(text = isolated(formatMoneyLabel(money, locale)), style = style, modifier = modifier)
}

/** A count in the locale's own digits, isolated from the surrounding direction. */
@Composable
fun CountText(
    value: Int,
    modifier: Modifier = Modifier,
    style: TextStyle = MaterialTheme.typography.titleMedium,
) {
    val locale = LocalConfiguration.current.locales[0]
    Text(text = isolated(formatCount(value, locale)), style = style, modifier = modifier)
}

/** A person at a glance: their initials on the secondary container. */
@Composable
fun Avatar(
    name: String,
    modifier: Modifier = Modifier,
    size: Dp = LocalOrderakSpacing.current.space10,
) {
    val colors = MaterialTheme.colorScheme
    Box(
        contentAlignment = Alignment.Center,
        modifier = modifier
            .size(size)
            .clip(CircleShape)
            .background(colors.secondaryContainer)
            .clearAndSetSemantics {},
    ) {
        Text(
            text = initialsOf(name),
            style = MaterialTheme.typography.titleMedium,
            color = colors.onSecondaryContainer,
        )
    }
}

/** The first letter of the first two words of [name], or nothing for a blank name. */
internal fun initialsOf(name: String): String =
    name.trim().split(Regex("\\s+")).filter { it.isNotEmpty() }.take(2)
        .joinToString("") { it.first().toString() }

/**
 * A product at a glance: the image at 8dp corners, or a placeholder when there
 * is none. [content] draws the image; the kit does not load images itself.
 */
@Composable
fun Thumbnail(
    modifier: Modifier = Modifier,
    size: Dp = LocalOrderakSpacing.current.space12,
    content: (@Composable BoxScope.() -> Unit)? = null,
) {
    val colors = MaterialTheme.colorScheme
    Box(
        contentAlignment = Alignment.Center,
        modifier = modifier
            .size(size)
            .clip(MaterialTheme.shapes.small)
            .background(colors.surfaceVariant)
            .clearAndSetSemantics {},
    ) {
        if (content != null) {
            content()
        } else {
            Icon(Icons.Outlined.Image, contentDescription = null, tint = colors.onSurfaceVariant)
        }
    }
}

/**
 * One message in a conversation: the seller's at the end in the primary
 * container, the other side's at the start. [time] is already formatted.
 */
@Composable
fun ChatBubble(
    text: String,
    mine: Boolean,
    modifier: Modifier = Modifier,
    time: String? = null,
) {
    val spacing = LocalOrderakSpacing.current
    val colors = MaterialTheme.colorScheme
    Row(modifier.fillMaxWidth(), horizontalArrangement = if (mine) Arrangement.End else Arrangement.Start) {
        Surface(
            shape = MaterialTheme.shapes.large,
            color = if (mine) colors.primaryContainer else colors.surfaceContainerHigh,
            contentColor = if (mine) colors.onPrimaryContainer else colors.onSurface,
            modifier = Modifier.widthIn(max = LocalOrderakLayout.current.contentMaxWidth * 0.8f),
        ) {
            Column(Modifier.padding(horizontal = spacing.space3, vertical = spacing.space2)) {
                Text(text, style = MaterialTheme.typography.bodyMedium)
                if (time != null) {
                    Text(time, style = MaterialTheme.typography.labelSmall, modifier = Modifier.align(Alignment.End))
                }
            }
        }
    }
}

/**
 * Writes a message: a field and a send button. The closed variant says why the
 * conversation can no longer be written to, in place of the field.
 */
@Composable
fun Composer(
    value: String,
    onValueChange: (String) -> Unit,
    onSend: () -> Unit,
    placeholder: String,
    sendDescription: String,
    modifier: Modifier = Modifier,
    closedLabel: String? = null,
) {
    val spacing = LocalOrderakSpacing.current
    Surface(modifier.fillMaxWidth(), color = MaterialTheme.colorScheme.surfaceContainer) {
        if (closedLabel != null) {
            Text(
                text = closedLabel,
                style = MaterialTheme.typography.bodyMedium,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
                textAlign = TextAlign.Center,
                modifier = Modifier.fillMaxWidth().padding(spacing.space4),
            )
        } else {
            Row(
                modifier = Modifier.padding(spacing.space2),
                verticalAlignment = Alignment.CenterVertically,
                horizontalArrangement = Arrangement.spacedBy(spacing.space2),
            ) {
                OutlinedTextField(
                    value = value,
                    onValueChange = onValueChange,
                    placeholder = { Text(placeholder) },
                    modifier = Modifier.weight(1f).testTag("orderak.composer.input"),
                )
                IconButton(
                    onClick = onSend,
                    enabled = value.isNotBlank(),
                    modifier = Modifier.size(spacing.minimumTouchTarget).testTag("orderak.composer.send"),
                ) {
                    // The arrow points the way the language reads.
                    Icon(Icons.AutoMirrored.Outlined.Send, contentDescription = sendDescription)
                }
            }
        }
    }
}
