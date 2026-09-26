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
 */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun LanguageSheet(onDismiss: () -> Unit) {
    val spacing = LocalOrderakSpacing.current
    val currentTag = AppLocales.currentTag()

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
        Column(
            Modifier
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
                    isSelected = locale.tag == currentTag,
                    onClick = {
                        onDismiss()
                        AppLocales.set(locale.tag)
                    },
                )
            }
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
