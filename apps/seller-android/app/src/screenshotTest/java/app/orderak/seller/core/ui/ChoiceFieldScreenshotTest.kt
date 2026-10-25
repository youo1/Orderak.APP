package app.orderak.seller.core.ui

import android.content.res.Configuration
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalConfiguration
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.unit.dp
import app.orderak.seller.R
import app.orderak.seller.core.ui.theme.OrderakTheme
import com.android.tools.screenshot.PreviewTest

/**
 * The choice kit: Stepper, SelectField, SwitchRow, SegmentedChoice, CheckboxRow,
 * FilterChipRow and ImagePickerTile, each in the eight-variant matrix. A preview
 * that has a state enum is named for it (`imagePickerTile` + an `ImagePickerState`
 * entry); `SheetKitStatesAcceptanceTest`'s rule applies to it here.
 */
@Composable
private fun previewDark(): Boolean =
    (LocalConfiguration.current.uiMode and Configuration.UI_MODE_NIGHT_MASK) ==
        Configuration.UI_MODE_NIGHT_YES

@Composable
private fun ChoicePreview(content: @Composable () -> Unit) {
    OrderakTheme(darkTheme = previewDark()) {
        Surface {
            Column(
                modifier = Modifier.fillMaxWidth().padding(16.dp),
                verticalArrangement = Arrangement.spacedBy(12.dp),
            ) {
                content()
            }
        }
    }
}

@PreviewTest
@FeedbackPreviews
@Composable
fun stepperValue() {
    ChoicePreview {
        Stepper(
            value = 3,
            onValueChange = {},
            decreaseDescription = stringResource(R.string.stepper_decrease),
            increaseDescription = stringResource(R.string.stepper_increase),
            max = 12,
        )
    }
}

@PreviewTest
@FeedbackPreviews
@Composable
fun stepperAtMinimum() {
    ChoicePreview {
        Stepper(
            value = 0,
            onValueChange = {},
            decreaseDescription = stringResource(R.string.stepper_decrease),
            increaseDescription = stringResource(R.string.stepper_increase),
            max = 12,
        )
    }
}

@PreviewTest
@FeedbackPreviews
@Composable
fun stepperAtMaximum() {
    ChoicePreview {
        Stepper(
            value = 12,
            onValueChange = {},
            decreaseDescription = stringResource(R.string.stepper_decrease),
            increaseDescription = stringResource(R.string.stepper_increase),
            max = 12,
        )
    }
}

@PreviewTest
@FeedbackPreviews
@Composable
fun selectFieldEmpty() {
    ChoicePreview {
        SelectField(label = stringResource(R.string.choice_preview_city_label), value = "", onClick = {}, required = true)
    }
}

@PreviewTest
@FeedbackPreviews
@Composable
fun selectFieldFilled() {
    ChoicePreview {
        SelectField(
            label = stringResource(R.string.choice_preview_city_label),
            value = stringResource(R.string.choice_preview_city_value),
            onClick = {},
            required = true,
        )
    }
}

@PreviewTest
@FeedbackPreviews
@Composable
fun selectFieldError() {
    ChoicePreview {
        SelectField(
            label = stringResource(R.string.choice_preview_city_label),
            value = "",
            onClick = {},
            required = true,
            error = stringResource(R.string.choice_preview_city_error),
        )
    }
}

@PreviewTest
@FeedbackPreviews
@Composable
fun switchRowOn() {
    ChoicePreview {
        SwitchRow(
            label = stringResource(R.string.choice_preview_switch_label),
            checked = true,
            onCheckedChange = {},
            helper = stringResource(R.string.choice_preview_switch_helper),
        )
    }
}

@PreviewTest
@FeedbackPreviews
@Composable
fun switchRowOff() {
    ChoicePreview {
        SwitchRow(
            label = stringResource(R.string.choice_preview_switch_label),
            checked = false,
            onCheckedChange = {},
            helper = stringResource(R.string.choice_preview_switch_helper),
        )
    }
}

@PreviewTest
@FeedbackPreviews
@Composable
fun segmentedChoiceSelected() {
    ChoicePreview {
        SegmentedChoice(
            options = listOf(
                stringResource(R.string.choice_preview_cash),
                stringResource(R.string.choice_preview_instapay),
                stringResource(R.string.choice_preview_wallet),
            ),
            selectedIndex = 1,
            onSelect = {},
        )
    }
}

@PreviewTest
@FeedbackPreviews
@Composable
fun checkboxRowUnchecked() {
    ChoicePreview {
        CheckboxRow(label = stringResource(R.string.choice_preview_age_label), checked = false, onCheckedChange = {})
    }
}

@PreviewTest
@FeedbackPreviews
@Composable
fun checkboxRowChecked() {
    ChoicePreview {
        CheckboxRow(label = stringResource(R.string.choice_preview_age_label), checked = true, onCheckedChange = {})
    }
}

@PreviewTest
@FeedbackPreviews
@Composable
fun checkboxRowError() {
    ChoicePreview {
        CheckboxRow(
            label = stringResource(R.string.choice_preview_age_label),
            checked = false,
            onCheckedChange = {},
            error = stringResource(R.string.choice_preview_age_error),
        )
    }
}

@PreviewTest
@FeedbackPreviews
@Composable
fun filterChipRowWithMore() {
    ChoicePreview {
        FilterChipRow(
            options = listOf(
                stringResource(R.string.choice_preview_filter_all),
                stringResource(R.string.choice_preview_filter_new),
                stringResource(R.string.choice_preview_filter_unpaid),
                stringResource(R.string.choice_preview_filter_ready),
            ),
            selectedIndex = 1,
            onSelect = {},
            moreLabel = stringResource(R.string.choice_preview_filter_more),
            onMore = {},
        )
    }
}

@Composable
private fun imagePreview(state: ImagePickerState, progress: Float = 0f) {
    ChoicePreview {
        ImagePickerTile(
            state = state,
            label = stringResource(R.string.choice_preview_image_label),
            addLabel = stringResource(R.string.choice_preview_image_add),
            onPick = {},
            progress = progress,
            uploadingLabel = stringResource(R.string.choice_preview_image_uploading),
            failedLabel = stringResource(R.string.choice_preview_image_failed),
            retryLabel = stringResource(R.string.common_retry),
        ) {
            // The picture is the caller's: a flat block stands in for it.
            androidx.compose.foundation.layout.Box(
                Modifier.fillMaxSize().background(MaterialTheme.colorScheme.secondaryContainer),
            )
        }
    }
}

@PreviewTest
@FeedbackPreviews
@Composable
fun imagePickerTilePlaceholder() = imagePreview(ImagePickerState.Placeholder)

@PreviewTest
@FeedbackPreviews
@Composable
fun imagePickerTilePreview() = imagePreview(ImagePickerState.Preview)

@PreviewTest
@FeedbackPreviews
@Composable
fun imagePickerTileUploading() = imagePreview(ImagePickerState.Uploading, progress = 0.6f)

@PreviewTest
@FeedbackPreviews
@Composable
fun imagePickerTileFailedWithRetry() = imagePreview(ImagePickerState.FailedWithRetry)
