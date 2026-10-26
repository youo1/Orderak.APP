package app.orderak.seller.core.ui

import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.BoxScope
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.aspectRatio
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.selection.selectable
import androidx.compose.foundation.selection.selectableGroup
import androidx.compose.foundation.selection.toggleable
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.ArrowDropDown
import androidx.compose.material.icons.outlined.Add
import androidx.compose.material.icons.outlined.AddPhotoAlternate
import androidx.compose.material.icons.outlined.ErrorOutline
import androidx.compose.material.icons.outlined.Remove
import androidx.compose.material3.Checkbox
import androidx.compose.material3.FilterChip
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.LinearProgressIndicator
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Surface
import androidx.compose.material3.Switch
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.platform.LocalConfiguration
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.clearAndSetSemantics
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.error
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.semantics.stateDescription
import androidx.compose.ui.text.style.TextAlign
import app.orderak.seller.core.text.formatCount
import app.orderak.seller.core.ui.theme.LocalOrderakSpacing

/** The tile is a little wider than tall, so a photo of a product fits it. */
private const val ImageTileAspectRatio = 1.5f

/** The four looks of the approved ImagePickerTile design. */
enum class ImagePickerState {
    /** No image yet: an invitation to add one. */
    Placeholder,

    /** An image is chosen; tapping replaces it. */
    Preview,

    /** The image is being sent; a bar shows how far. */
    Uploading,

    /** Sending failed; the seller can try again. */
    FailedWithRetry,
}

/**
 * Changes a quantity: minus, the value, plus, each button a 48dp target.
 *
 * A button at its bound is disabled rather than hidden, so the control keeps its
 * width and the seller sees why nothing happens. The value is drawn in the
 * locale's digits. [max] is the stock, so a seller cannot order what is not there.
 */
@Composable
fun Stepper(
    value: Int,
    onValueChange: (Int) -> Unit,
    decreaseDescription: String,
    increaseDescription: String,
    modifier: Modifier = Modifier,
    min: Int = 0,
    max: Int = Int.MAX_VALUE,
    enabled: Boolean = true,
) {
    val spacing = LocalOrderakSpacing.current
    val locale = LocalConfiguration.current.locales[0]
    Row(
        modifier = modifier,
        verticalAlignment = Alignment.CenterVertically,
    ) {
        IconButton(
            onClick = { onValueChange((value - 1).coerceAtLeast(min)) },
            enabled = enabled && value > min,
            modifier = Modifier.size(spacing.minimumTouchTarget).testTag("orderak.stepper.minus"),
        ) {
            Icon(Icons.Outlined.Remove, contentDescription = decreaseDescription)
        }
        Text(
            text = isolated(formatCount(value, locale)),
            style = MaterialTheme.typography.titleMedium,
            textAlign = TextAlign.Center,
            modifier = Modifier.widthIn(min = spacing.space8).testTag("orderak.stepper.value"),
        )
        IconButton(
            onClick = { onValueChange((value + 1).coerceAtMost(max)) },
            enabled = enabled && value < max,
            modifier = Modifier.size(spacing.minimumTouchTarget).testTag("orderak.stepper.plus"),
        ) {
            Icon(Icons.Outlined.Add, contentDescription = increaseDescription)
        }
    }
}

/**
 * A field that opens a picker instead of taking typing.
 *
 * It looks like a text field and is one tap target over its whole area: the
 * screen opens a [PickerSheet] from [onClick]. The spoken label is the label
 * and the value together, because the value alone says nothing.
 */
@Composable
fun SelectField(
    label: String,
    value: String,
    onClick: () -> Unit,
    modifier: Modifier = Modifier,
    required: Boolean = false,
    error: String? = null,
    enabled: Boolean = true,
) {
    Box(modifier.fillMaxWidth()) {
        OutlinedTextField(
            value = value,
            onValueChange = {},
            readOnly = true,
            enabled = enabled,
            label = { Text(if (required) "$label *" else label) },
            trailingIcon = { Icon(Icons.Filled.ArrowDropDown, contentDescription = null) },
            supportingText = error?.let { { Text(it) } },
            isError = error != null,
            // The overlay below is the one control, so the field itself exposes
            // no actionable node of its own (two nodes on the same bounds would
            // be a duplicate target).
            modifier = Modifier.fillMaxWidth().clearAndSetSemantics {},
        )
        // The overlay is the one control: it takes every tap and names the field.
        Box(
            Modifier
                .matchParentSize()
                .clickable(enabled = enabled, role = Role.Button, onClick = onClick)
                .semantics {
                    contentDescription = "$label $value".trim()
                    if (error != null) error(error)
                }
                .testTag("orderak.select"),
        )
    }
}

/**
 * A yes or no with a label and an optional helper. The whole row is the switch,
 * so the target is the row, not the thumb.
 */
@Composable
fun SwitchRow(
    label: String,
    checked: Boolean,
    onCheckedChange: (Boolean) -> Unit,
    modifier: Modifier = Modifier,
    helper: String? = null,
    enabled: Boolean = true,
) {
    val spacing = LocalOrderakSpacing.current
    Row(
        modifier = modifier
            .fillMaxWidth()
            .heightIn(min = spacing.minimumTouchTarget)
            .toggleable(
                value = checked,
                enabled = enabled,
                role = Role.Switch,
                onValueChange = onCheckedChange,
            )
            .padding(vertical = spacing.space2),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(spacing.space4),
    ) {
        Column(Modifier.weight(1f)) {
            Text(label, style = MaterialTheme.typography.bodyLarge)
            if (helper != null) {
                Text(
                    helper,
                    style = MaterialTheme.typography.bodySmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                )
            }
        }
        Switch(checked = checked, onCheckedChange = null, enabled = enabled)
    }
}

/**
 * One of a few, shown side by side with the chosen one filled. For two to four
 * short options; a longer list is a [SelectField].
 */
@Composable
fun SegmentedChoice(
    options: List<String>,
    selectedIndex: Int,
    onSelect: (Int) -> Unit,
    modifier: Modifier = Modifier,
    enabled: Boolean = true,
) {
    val spacing = LocalOrderakSpacing.current
    val colors = MaterialTheme.colorScheme
    Row(
        modifier = modifier
            .fillMaxWidth()
            .clip(MaterialTheme.shapes.extraLarge)
            .border(spacing.space1 / 4, colors.outline, MaterialTheme.shapes.extraLarge)
            .selectableGroup(),
    ) {
        options.forEachIndexed { index, option ->
            val selected = index == selectedIndex
            Box(
                contentAlignment = Alignment.Center,
                modifier = Modifier
                    .weight(1f)
                    .heightIn(min = spacing.minimumTouchTarget)
                    .background(if (selected) colors.secondaryContainer else colors.surface)
                    .selectable(
                        selected = selected,
                        enabled = enabled,
                        role = Role.RadioButton,
                        onClick = { onSelect(index) },
                    )
                    .padding(horizontal = spacing.space2, vertical = spacing.space2),
            ) {
                Text(
                    text = option,
                    style = MaterialTheme.typography.labelLarge,
                    textAlign = TextAlign.Center,
                    color = if (selected) colors.onSecondaryContainer else colors.onSurface,
                )
            }
        }
    }
}

/**
 * A statement the seller confirms, such as their age. The error says what is
 * missing and is the row's semantic error.
 */
@Composable
fun CheckboxRow(
    label: String,
    checked: Boolean,
    onCheckedChange: (Boolean) -> Unit,
    modifier: Modifier = Modifier,
    error: String? = null,
    enabled: Boolean = true,
) {
    val spacing = LocalOrderakSpacing.current
    Column(modifier.fillMaxWidth()) {
        Row(
            modifier = Modifier
                .fillMaxWidth()
                .heightIn(min = spacing.minimumTouchTarget)
                .toggleable(
                    value = checked,
                    enabled = enabled,
                    role = Role.Checkbox,
                    onValueChange = onCheckedChange,
                )
                .semantics { if (error != null) error(error) },
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(spacing.space2),
        ) {
            Checkbox(checked = checked, onCheckedChange = null, enabled = enabled)
            Text(label, style = MaterialTheme.typography.bodyLarge, modifier = Modifier.weight(1f))
        }
        if (error != null) {
            Text(
                text = error,
                style = MaterialTheme.typography.bodySmall,
                color = MaterialTheme.colorScheme.error,
                modifier = Modifier.padding(horizontal = spacing.space4),
            )
        }
    }
}

/**
 * Picks one filter from a row that scrolls sideways. A last chip, when
 * [moreLabel] is given, opens a sheet for the long tail of choices.
 */
@Composable
fun FilterChipRow(
    options: List<String>,
    selectedIndex: Int,
    onSelect: (Int) -> Unit,
    modifier: Modifier = Modifier,
    moreLabel: String? = null,
    onMore: (() -> Unit)? = null,
    /** The last chip stands for a choice made in its sheet, so it is drawn chosen. */
    moreSelected: Boolean = false,
) {
    val spacing = LocalOrderakSpacing.current
    Row(
        modifier = modifier
            .fillMaxWidth()
            .horizontalScroll(rememberScrollState())
            .selectableGroup(),
        horizontalArrangement = Arrangement.spacedBy(spacing.space2),
    ) {
        options.forEachIndexed { index, option ->
            FilterChip(
                selected = index == selectedIndex,
                onClick = { onSelect(index) },
                label = { Text(option) },
            )
        }
        if (moreLabel != null && onMore != null) {
            FilterChip(
                selected = moreSelected,
                onClick = onMore,
                label = { Text(moreLabel) },
                trailingIcon = { Icon(Icons.Filled.ArrowDropDown, contentDescription = null) },
                modifier = Modifier.testTag("orderak.chips.more"),
            )
        }
    }
}

/**
 * Adds or replaces an image, in the four looks of [ImagePickerState].
 *
 * The tile is one target. [content] draws the chosen image; the kit does not
 * load images itself. While [ImagePickerState.Uploading] it shows [progress]
 * (0 to 1) under [uploadingLabel]; when [ImagePickerState.FailedWithRetry] it says
 * [failedLabel] and offers [retryLabel].
 */
@Composable
fun ImagePickerTile(
    state: ImagePickerState,
    label: String,
    addLabel: String,
    onPick: () -> Unit,
    modifier: Modifier = Modifier,
    progress: Float = 0f,
    uploadingLabel: String = "",
    failedLabel: String = "",
    retryLabel: String = "",
    onRetry: () -> Unit = {},
    content: @Composable BoxScope.() -> Unit = {},
) {
    val spacing = LocalOrderakSpacing.current
    val colors = MaterialTheme.colorScheme
    val failed = state == ImagePickerState.FailedWithRetry
    Column(modifier.fillMaxWidth(), verticalArrangement = Arrangement.spacedBy(spacing.space2)) {
        Surface(
            shape = MaterialTheme.shapes.large,
            color = colors.surfaceVariant,
            border = BorderStroke(spacing.space1 / 4, if (failed) colors.error else colors.outline),
            modifier = Modifier
                .fillMaxWidth()
                .aspectRatio(ImageTileAspectRatio)
                .clip(MaterialTheme.shapes.large)
                .clickable(
                    enabled = state != ImagePickerState.Uploading,
                    role = Role.Button,
                    onClick = onPick,
                )
                .semantics {
                    contentDescription = label
                    stateDescription = when (state) {
                        ImagePickerState.Placeholder -> addLabel
                        ImagePickerState.Preview -> label
                        ImagePickerState.Uploading -> uploadingLabel
                        ImagePickerState.FailedWithRetry -> failedLabel
                    }
                }
                .testTag("orderak.image.tile"),
        ) {
            Box(Modifier.fillMaxWidth(), contentAlignment = Alignment.Center) {
                when (state) {
                    ImagePickerState.Placeholder -> Column(
                        horizontalAlignment = Alignment.CenterHorizontally,
                        verticalArrangement = Arrangement.spacedBy(spacing.space1),
                        modifier = Modifier.padding(spacing.space6),
                    ) {
                        Icon(
                            Icons.Outlined.AddPhotoAlternate,
                            contentDescription = null,
                            tint = colors.onSurfaceVariant,
                            modifier = Modifier.size(spacing.iconMedium),
                        )
                        Text(addLabel, style = MaterialTheme.typography.labelLarge, color = colors.onSurfaceVariant)
                    }
                    else -> {
                        content()
                        if (state == ImagePickerState.Uploading) {
                            Column(
                                Modifier
                                    .align(Alignment.BottomCenter)
                                    .fillMaxWidth()
                                    .background(colors.surface)
                                    .padding(spacing.space3),
                                verticalArrangement = Arrangement.spacedBy(spacing.space1),
                            ) {
                                Text(uploadingLabel, style = MaterialTheme.typography.bodySmall)
                                LinearProgressIndicator(
                                    progress = { progress.coerceIn(0f, 1f) },
                                    modifier = Modifier.fillMaxWidth().testTag("orderak.image.progress"),
                                )
                            }
                        }
                    }
                }
            }
        }
        if (failed) {
            Row(
                verticalAlignment = Alignment.CenterVertically,
                horizontalArrangement = Arrangement.spacedBy(spacing.space2),
            ) {
                Icon(
                    Icons.Outlined.ErrorOutline,
                    contentDescription = null,
                    tint = colors.error,
                    modifier = Modifier.size(spacing.iconSmall),
                )
                Text(
                    failedLabel,
                    style = MaterialTheme.typography.bodySmall,
                    color = colors.error,
                    modifier = Modifier.weight(1f),
                )
                TextButton(
                    onClick = onRetry,
                    modifier = Modifier.heightIn(min = spacing.minimumTouchTarget).testTag("orderak.image.retry"),
                ) {
                    Text(retryLabel)
                }
            }
        }
    }
}
