package app.orderak.seller.core.ui

import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.BoxWithConstraints
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.selection.selectable
import androidx.compose.foundation.selection.selectableGroup
import androidx.compose.foundation.shape.CornerSize
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Check
import androidx.compose.material.icons.outlined.Edit
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.Icon
import androidx.compose.material3.LocalContentColor
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.heading
import androidx.compose.ui.semantics.semantics
import app.orderak.seller.core.text.SearchText
import app.orderak.seller.core.ui.theme.LocalOrderakSpacing
import app.orderak.seller.core.ui.theme.full

/** How much of the height a screen offers a sheet may take: nine tenths, never more. */
private const val SheetMaxHeightFraction = 0.9f

/** How much of the height a screen offers the pinned header may take before it scrolls. */
private const val SheetHeaderMaxFraction = 0.3f

/** The two modes of the approved PickerSheet design. */
enum class PickerSheetMode {
    /** A short list: pick one row. */
    SingleChoice,

    /** A long list the seller can search, with a row for a value that is not listed. */
    SearchableWithManualEntry,
}

/** The three states of the approved ConfirmSheet design. */
enum class ConfirmSheetState {
    /** The action cannot be undone: the confirm button is red and names the destructive verb. */
    Destructive,

    /** An ordinary confirmation. */
    Regular,

    /** The action is running: both buttons are disabled until it finishes. */
    InProgress,
}

/** One row of a [BottomSheet] action list. */
data class SheetAction(
    val label: String,
    val onClick: () -> Unit,
    val icon: ImageVector? = null,
)

/** One choice in a [PickerSheet]. [key] identifies it; [label] is what the seller reads. */
data class PickerOption(val key: String, val label: String)

/**
 * The frame every sheet shares: a rounded top edge, a handle, a pinned header,
 * a body that scrolls and pinned actions.
 *
 * It is the sheet's content, not a window. A `ModalBottomSheet` composes into a
 * separate window that the screenshot harness does not capture (see
 * `LanguageSheet`), so the kit draws the sheet itself, and the screen that
 * adopts it puts it inside whichever host it uses.
 *
 * The sheet is never taller than [SheetMaxHeightFraction] of the height it is
 * given. The body takes what the header and the actions leave and scrolls
 * inside it, so the actions stay in reach at 200% text and on a short screen.
 */
@Composable
private fun SheetFrame(
    modifier: Modifier,
    header: @Composable () -> Unit,
    actions: @Composable () -> Unit,
    body: @Composable () -> Unit,
) {
    val spacing = LocalOrderakSpacing.current
    BoxWithConstraints(modifier.fillMaxWidth()) {
        // Read once here: the layout scopes below hide this scope's maxHeight.
        val available = maxHeight
        Surface(
            modifier = Modifier
                .fillMaxWidth()
                .heightIn(max = available * SheetMaxHeightFraction)
                .testTag("orderak.sheet"),
            // Only the top corners are drawn: the sheet is attached to the bottom
            // of the screen. The corner comes from the shape scale, as in
            // LanguageSheet, so it follows the scale if the scale moves.
            shape = RoundedCornerShape(
                topStart = MaterialTheme.shapes.extraLarge.topStart,
                topEnd = MaterialTheme.shapes.extraLarge.topEnd,
                bottomEnd = CornerSize(spacing.space0),
                bottomStart = CornerSize(spacing.space0),
            ),
            color = MaterialTheme.colorScheme.surface,
            contentColor = MaterialTheme.colorScheme.onSurface,
        ) {
            Column(Modifier.fillMaxWidth()) {
                Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.Center) {
                    Spacer(
                        Modifier
                            .padding(top = spacing.space3, bottom = spacing.space2)
                            .size(width = spacing.space8, height = spacing.space1)
                            .clip(MaterialTheme.shapes.full)
                            .background(MaterialTheme.colorScheme.outlineVariant),
                    )
                }
                // The header is capped and scrolls on its own: a title that wraps to many
                // lines at 200% must not leave the body no height and push the actions
                // past the sheet's edge.
                Column(
                    Modifier
                        .heightIn(max = available * SheetHeaderMaxFraction)
                        .verticalScroll(rememberScrollState())
                        .padding(horizontal = spacing.space6),
                ) { header() }
                Column(
                    modifier = Modifier
                        .weight(1f, fill = false)
                        .testTag("orderak.sheet.content")
                        .verticalScroll(rememberScrollState())
                        .padding(horizontal = spacing.space6),
                ) { body() }
                // The tag comes before the padding so the actions' bounds reach the
                // sheet's bottom edge.
                Column(
                    modifier = Modifier
                        .fillMaxWidth()
                        .testTag("orderak.sheet.actions")
                        .padding(horizontal = spacing.space6)
                        .padding(top = spacing.space3, bottom = spacing.space6),
                    verticalArrangement = Arrangement.spacedBy(spacing.space2),
                ) { actions() }
            }
        }
    }
}

@Composable
private fun SheetTitle(text: String) {
    val spacing = LocalOrderakSpacing.current
    Text(
        text = text,
        style = MaterialTheme.typography.titleLarge,
        color = MaterialTheme.colorScheme.onSurface,
        modifier = Modifier
            .padding(vertical = spacing.space2)
            .semantics { heading() },
    )
}

/** A full-width secondary button at the 48dp minimum, used for closing and cancelling. */
@Composable
private fun SheetSecondaryButton(
    label: String,
    onClick: () -> Unit,
    modifier: Modifier = Modifier,
    enabled: Boolean = true,
) {
    val spacing = LocalOrderakSpacing.current
    OutlinedButton(
        onClick = onClick,
        enabled = enabled,
        modifier = modifier
            .fillMaxWidth()
            .heightIn(min = spacing.minimumTouchTarget),
    ) {
        Text(label, style = MaterialTheme.typography.labelLarge)
    }
}

/**
 * A list of actions on one thing, with a closing action pinned below it.
 *
 * Each row is a 48dp target. The close button is the last thing in the sheet, so
 * a seller who opened it by accident always has a way out in the same place.
 */
@Composable
fun BottomSheet(
    title: String,
    actions: List<SheetAction>,
    closeLabel: String,
    onClose: () -> Unit,
    modifier: Modifier = Modifier,
) {
    val spacing = LocalOrderakSpacing.current
    SheetFrame(
        modifier = modifier,
        header = { SheetTitle(title) },
        actions = { SheetSecondaryButton(label = closeLabel, onClick = onClose) },
        body = {
            actions.forEach { action ->
                Row(
                    verticalAlignment = Alignment.CenterVertically,
                    horizontalArrangement = Arrangement.spacedBy(spacing.space4),
                    modifier = Modifier
                        .fillMaxWidth()
                        .heightIn(min = spacing.minimumTouchTarget)
                        .clip(MaterialTheme.shapes.large)
                        .clickable(role = Role.Button, onClick = action.onClick)
                        .padding(horizontal = spacing.space2, vertical = spacing.space3),
                ) {
                    if (action.icon != null) {
                        Icon(
                            imageVector = action.icon,
                            contentDescription = null,
                            tint = MaterialTheme.colorScheme.onSurfaceVariant,
                            modifier = Modifier.size(spacing.iconMedium),
                        )
                    }
                    Text(
                        text = action.label,
                        style = MaterialTheme.typography.bodyLarge,
                        color = MaterialTheme.colorScheme.onSurface,
                    )
                }
            }
        },
    )
}

/**
 * Pick one value from a list.
 *
 * [PickerSheetMode.SingleChoice] is a short list. [PickerSheetMode.SearchableWithManualEntry]
 * adds a search field in the pinned header: the list is filtered by [query], and
 * when the query matches no option exactly the sheet offers [manualEntryLabel]
 * (already worded for the query, such as “Use “Qena” as entered”) so the
 * seller is never stuck with a value the list does not know. [noResultsLabel]
 * is shown when nothing matches.
 *
 * The caller owns [query] and the selection; the sheet only draws them.
 */
@Composable
fun PickerSheet(
    mode: PickerSheetMode,
    title: String,
    options: List<PickerOption>,
    selectedKey: String?,
    onSelect: (PickerOption) -> Unit,
    closeLabel: String,
    onClose: () -> Unit,
    modifier: Modifier = Modifier,
    query: String = "",
    onQueryChange: (String) -> Unit = {},
    searchPlaceholder: String = "",
    noResultsLabel: String = "",
    manualEntryLabel: String = "",
    onManualEntry: (String) -> Unit = {},
) {
    val spacing = LocalOrderakSpacing.current
    val searchable = mode == PickerSheetMode.SearchableWithManualEntry
    val trimmed = query.trim()
    // The same folding the customer and product searches use: the spellings of an
    // Arabic name a seller types interchangeably find each other, so the sheet
    // does not offer a manual entry for a name the list already has.
    val needle = SearchText.fold(trimmed)
    val shown = if (searchable && trimmed.isNotEmpty()) {
        options.filter { SearchText.matches(trimmed, it.label) }
    } else {
        options
    }
    val offerManualEntry = searchable && manualEntryLabel.isNotBlank() && trimmed.isNotEmpty() &&
        options.none { SearchText.fold(it.label) == needle }
    SheetFrame(
        modifier = modifier,
        header = {
            SheetTitle(title)
            if (searchable) {
                SearchField(
                    query = query,
                    onQueryChange = onQueryChange,
                    placeholder = searchPlaceholder,
                    modifier = Modifier.padding(bottom = spacing.space2),
                )
            }
        },
        actions = { SheetSecondaryButton(label = closeLabel, onClick = onClose) },
        body = {
            Column(Modifier.selectableGroup()) {
                if (searchable && shown.isEmpty()) {
                    Text(
                        text = noResultsLabel,
                        style = MaterialTheme.typography.bodyMedium,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                        modifier = Modifier.padding(vertical = spacing.space3),
                    )
                }
                shown.forEach { option ->
                    val selected = option.key == selectedKey
                    Row(
                        verticalAlignment = Alignment.CenterVertically,
                        modifier = Modifier
                            .fillMaxWidth()
                            .heightIn(min = spacing.minimumTouchTarget)
                            .clip(MaterialTheme.shapes.large)
                            .selectable(
                                selected = selected,
                                role = Role.RadioButton,
                                onClick = { onSelect(option) },
                            )
                            .padding(horizontal = spacing.space2, vertical = spacing.space3),
                    ) {
                        Text(
                            text = option.label,
                            style = MaterialTheme.typography.bodyLarge,
                            color = if (selected) {
                                MaterialTheme.colorScheme.onSurface
                            } else {
                                MaterialTheme.colorScheme.onSurfaceVariant
                            },
                            modifier = Modifier.weight(1f),
                        )
                        if (selected) {
                            Spacer(Modifier.width(spacing.space3))
                            Icon(
                                imageVector = Icons.Default.Check,
                                contentDescription = null,
                                tint = MaterialTheme.colorScheme.primary,
                            )
                        }
                    }
                }
            }
            if (offerManualEntry) {
                Row(
                    verticalAlignment = Alignment.CenterVertically,
                    horizontalArrangement = Arrangement.spacedBy(spacing.space3),
                    modifier = Modifier
                        .fillMaxWidth()
                        .heightIn(min = spacing.minimumTouchTarget)
                        .clip(MaterialTheme.shapes.large)
                        .clickable(role = Role.Button) { onManualEntry(trimmed) }
                        .padding(horizontal = spacing.space2, vertical = spacing.space3),
                ) {
                    Icon(
                        imageVector = Icons.Outlined.Edit,
                        contentDescription = null,
                        tint = MaterialTheme.colorScheme.primary,
                        modifier = Modifier.size(spacing.iconMedium),
                    )
                    Text(
                        text = manualEntryLabel,
                        style = MaterialTheme.typography.bodyLarge,
                        color = MaterialTheme.colorScheme.primary,
                    )
                }
            }
        },
    )
}

/**
 * Ask the seller to confirm an action.
 *
 * [ConfirmSheetState.Destructive] draws the confirm button in the error colour,
 * and the caller words it with the destructive verb (“Delete”, never “OK” or
 * “Yes”). [ConfirmSheetState.InProgress] shows a progress indicator in the
 * confirm button and disables both buttons, so a second tap cannot repeat the
 * action and the seller cannot walk away from it half done.
 */
@Composable
fun ConfirmSheet(
    state: ConfirmSheetState,
    title: String,
    message: String,
    confirmLabel: String,
    cancelLabel: String,
    onConfirm: () -> Unit,
    onCancel: () -> Unit,
    modifier: Modifier = Modifier,
) {
    val spacing = LocalOrderakSpacing.current
    val busy = state == ConfirmSheetState.InProgress
    val colors = if (state == ConfirmSheetState.Regular) {
        ButtonDefaults.buttonColors()
    } else {
        ButtonDefaults.buttonColors(
            containerColor = MaterialTheme.colorScheme.error,
            contentColor = MaterialTheme.colorScheme.onError,
        )
    }
    SheetFrame(
        modifier = modifier,
        header = { SheetTitle(title) },
        actions = {
            Button(
                onClick = onConfirm,
                enabled = !busy,
                colors = colors,
                modifier = Modifier
                    .fillMaxWidth()
                    .heightIn(min = spacing.minimumTouchTarget)
                    .testTag("orderak.sheet.confirm"),
            ) {
                if (busy) {
                    CircularProgressIndicator(
                        modifier = Modifier.size(spacing.iconSmall),
                        strokeWidth = spacing.space1 / 2,
                        color = LocalContentColor.current,
                    )
                    Spacer(Modifier.width(spacing.space2))
                }
                Text(confirmLabel, style = MaterialTheme.typography.labelLarge)
            }
            SheetSecondaryButton(
                label = cancelLabel,
                onClick = onCancel,
                enabled = !busy,
                modifier = Modifier.testTag("orderak.sheet.cancel"),
            )
        },
        body = {
            Text(
                text = message,
                style = MaterialTheme.typography.bodyLarge,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
                modifier = Modifier.padding(bottom = spacing.space2),
            )
        },
    )
}
