package app.orderak.seller.feature.auth

import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.shape.CornerSize
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Check
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.ModalBottomSheet
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.unit.dp
import app.orderak.seller.R
import app.orderak.seller.core.locale.AppLocales
import app.orderak.seller.core.ui.theme.LocalOrderakSpacing

/**
 * Language selection bottom sheet. System language is the first-launch
 * behavior only; every choice shown here creates an explicit app override.
 *
 * This composable is the sheet — its container, its corners, the dismissal. The
 * rows are [LanguageSheetContent], which is what the screenshot tests render.
 */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun LanguageSheet(onDismiss: () -> Unit) {
    val spacing = LocalOrderakSpacing.current

    ModalBottomSheet(
        onDismissRequest = onDismiss,
        containerColor = MaterialTheme.colorScheme.surface,
        // Only the top corners are drawn: the sheet is attached to the bottom of
        // the window. Taking the corner from the shape scale rather than writing
        // 24.dp here is what keeps it in step if the scale moves — a square
        // bottom is a property of the sheet, not a second radius.
        //
        // All four corners are named because the CornerSize overload has no
        // defaults; the bottom two are square on purpose, not by omission.
        shape = RoundedCornerShape(
            topStart = MaterialTheme.shapes.extraLarge.topStart,
            topEnd = MaterialTheme.shapes.extraLarge.topEnd,
            bottomEnd = CornerSize(spacing.space0),
            bottomStart = CornerSize(spacing.space0),
        ),
    ) {
        LanguageSheetContent(
            selectedTag = AppLocales.currentTag(),
            onSelect = { tag ->
                onDismiss()
                AppLocales.set(tag)
            },
        )
    }
}

/**
 * The picker's content, without the sheet around it.
 *
 * `ModalBottomSheet` is not captured by the screenshot harness: it composes into a
 * separate window, so a preview of [LanguageSheet] renders an empty frame. That is
 * how the three passkey baselines came to share one SHA256 — see the note in
 * `AuthScreenshotTest`. This sheet had no baselines at all, which is the same defect
 * with nothing to notice it by.
 *
 * The split also hoists the two pieces of hidden state. [selectedTag] used to be read
 * from `AppLocales.currentTag()` deep inside the composable, and the selection used to
 * call `AppLocales.set` directly; a render whose appearance depends on ambient global
 * state cannot be asked to show a chosen state, and a preview cannot simulate a tap
 * that mutates the real application locale. Both are parameters now, so the preview
 * decides what is checked and [LanguageSheet] stays the only caller that touches
 * `AppLocales`.
 *
 * The padding travels with the content rather than staying in the sheet, so the
 * preview's pixels are the sheet's pixels.
 */
@Composable
fun LanguageSheetContent(
    selectedTag: String,
    onSelect: (String) -> Unit,
    modifier: Modifier = Modifier,
) {
    val spacing = LocalOrderakSpacing.current
    Column(
        modifier
            .padding(horizontal = spacing.space6, vertical = spacing.space4)
            .padding(bottom = spacing.space8),
    ) {
        Text(
            text = stringResource(R.string.language_pick_title),
            style = MaterialTheme.typography.titleLarge,
            color = MaterialTheme.colorScheme.onBackground,
            modifier = Modifier.padding(bottom = spacing.space6),
        )

        // The sheet intentionally exposes only explicit app languages.
        AppLocales.supported.forEach { locale ->
            LanguageRow(
                text = locale.nativeName,
                isSelected = locale.tag == selectedTag,
                onClick = { onSelect(locale.tag) },
            )
        }
    }
}

@Composable
private fun LanguageRow(
    text: String,
    isSelected: Boolean,
    onClick: () -> Unit,
) {
    val spacing = LocalOrderakSpacing.current
    Row(
        verticalAlignment = Alignment.CenterVertically,
        modifier = Modifier
            .fillMaxWidth()
            .padding(vertical = spacing.space2)
            .clip(MaterialTheme.shapes.large)
            .clickable { onClick() }
            .padding(spacing.space4),
    ) {
        Text(
            text = text,
            style = MaterialTheme.typography.bodyLarge,
            color = if (isSelected) {
                MaterialTheme.colorScheme.onBackground
            } else {
                MaterialTheme.colorScheme.onSurfaceVariant
            },
            modifier = Modifier.weight(1f),
        )
        if (isSelected) {
            Spacer(Modifier.width(spacing.space3))
            Icon(
                imageVector = Icons.Default.Check,
                contentDescription = null,
                tint = MaterialTheme.colorScheme.primary,
            )
        }
    }
}
