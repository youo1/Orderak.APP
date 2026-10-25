package app.orderak.seller.core.ui

import android.content.res.Configuration
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.ContentCopy
import androidx.compose.material.icons.outlined.Print
import androidx.compose.material.icons.outlined.Share
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalConfiguration
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.res.stringArrayResource
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.unit.dp
import app.orderak.seller.R
import app.orderak.seller.core.ui.theme.OrderakTheme
import com.android.tools.screenshot.PreviewTest

/**
 * The overlay kit: BottomSheet, PickerSheet, ConfirmSheet and Snackbar.
 *
 * A sheet is rendered over a visible screen and a scrim, not inside a
 * `ModalBottomSheet`: that composes into a separate window, which the screenshot
 * harness does not capture (see `LanguageSheet`). The screen behind is the
 * kit's own skeleton, so the scrim has something to dim and the sheet's edge
 * has something to sit on.
 *
 * Every preview is named for its state: the name after the component is an
 * entry of the component's state enum, and `SheetKitStatesAcceptanceTest` fails
 * when one is not. The list in the pickers is long on purpose, so the sheet
 * reaches its 90% bound and the scrolling body is what the reference shows.
 */
@Composable
private fun previewDark(): Boolean =
    (LocalConfiguration.current.uiMode and Configuration.UI_MODE_NIGHT_MASK) ==
        Configuration.UI_MODE_NIGHT_YES

/** The screen, the scrim over it, and the sheet at the bottom of the area a screen gives it. */
@Composable
private fun SheetPreview(sheet: @Composable () -> Unit) {
    OrderakTheme(darkTheme = previewDark()) {
        Surface {
            Box(
                Modifier
                    .fillMaxWidth()
                    .height(560.dp)
                    .testTag("orderak.preview.available"),
            ) {
                Skeleton(variant = SkeletonVariant.ListRows, modifier = Modifier.padding(16.dp))
                Box(
                    Modifier
                        .matchParentSize()
                        .background(MaterialTheme.colorScheme.scrim.copy(alpha = 0.32f)),
                )
                Box(Modifier.align(Alignment.BottomCenter)) { sheet() }
            }
        }
    }
}

/** The screen and a snackbar at its bottom edge, with no scrim: a snackbar does not block the screen. */
@Composable
private fun SnackbarPreview(content: @Composable () -> Unit) {
    OrderakTheme(darkTheme = previewDark()) {
        Surface {
            Box(Modifier.fillMaxWidth().height(200.dp)) {
                Skeleton(variant = SkeletonVariant.ListRows, modifier = Modifier.padding(16.dp))
                Box(
                    Modifier
                        .align(Alignment.BottomCenter)
                        .padding(16.dp),
                ) { content() }
            }
        }
    }
}

@Composable
private fun cities(): List<PickerOption> =
    stringArrayResource(R.array.sheet_preview_cities).mapIndexed { index, name ->
        PickerOption(key = index.toString(), label = name)
    }

@PreviewTest
@FeedbackPreviews
@Composable
fun bottomSheetActions() {
    SheetPreview {
        BottomSheet(
            title = stringResource(R.string.sheet_actions_title),
            actions = listOf(
                SheetAction(stringResource(R.string.sheet_action_share), {}, Icons.Outlined.Share),
                SheetAction(stringResource(R.string.sheet_action_duplicate), {}, Icons.Outlined.ContentCopy),
                SheetAction(stringResource(R.string.sheet_action_print), {}, Icons.Outlined.Print),
            ),
            closeLabel = stringResource(R.string.sheet_close),
            onClose = {},
        )
    }
}

@PreviewTest
@FeedbackPreviews
@Composable
fun pickerSheetSingleChoice() {
    SheetPreview {
        PickerSheet(
            mode = PickerSheetMode.SingleChoice,
            title = stringResource(R.string.sheet_picker_title),
            options = cities(),
            selectedKey = "4",
            onSelect = {},
            closeLabel = stringResource(R.string.sheet_close),
            onClose = {},
        )
    }
}

/** A query no option matches: the list is empty and the sheet offers the value as entered. */
@PreviewTest
@FeedbackPreviews
@Composable
fun pickerSheetSearchableWithManualEntry() {
    val query = stringResource(R.string.sheet_preview_query_unlisted)
    SheetPreview {
        PickerSheet(
            mode = PickerSheetMode.SearchableWithManualEntry,
            title = stringResource(R.string.sheet_picker_title),
            options = cities(),
            selectedKey = null,
            onSelect = {},
            closeLabel = stringResource(R.string.sheet_close),
            onClose = {},
            query = query,
            onQueryChange = {},
            searchPlaceholder = stringResource(R.string.setup_city_search),
            noResultsLabel = stringResource(R.string.setup_city_no_results),
            manualEntryLabel = stringResource(R.string.setup_city_use_manual, query),
            onManualEntry = {},
        )
    }
}

@PreviewTest
@FeedbackPreviews
@Composable
fun confirmSheetDestructive() {
    SheetPreview {
        ConfirmSheet(
            state = ConfirmSheetState.Destructive,
            title = stringResource(R.string.sheet_confirm_delete_title),
            message = stringResource(R.string.sheet_confirm_delete_message),
            confirmLabel = stringResource(R.string.common_delete),
            cancelLabel = stringResource(R.string.common_cancel),
            onConfirm = {},
            onCancel = {},
        )
    }
}

@PreviewTest
@FeedbackPreviews
@Composable
fun confirmSheetRegular() {
    SheetPreview {
        ConfirmSheet(
            state = ConfirmSheetState.Regular,
            title = stringResource(R.string.sheet_confirm_ship_title),
            message = stringResource(R.string.sheet_confirm_ship_message),
            confirmLabel = stringResource(R.string.sheet_confirm_ship_action),
            cancelLabel = stringResource(R.string.common_cancel),
            onConfirm = {},
            onCancel = {},
        )
    }
}

@PreviewTest
@FeedbackPreviews
@Composable
fun confirmSheetInProgress() {
    SheetPreview {
        ConfirmSheet(
            state = ConfirmSheetState.InProgress,
            title = stringResource(R.string.sheet_confirm_delete_title),
            message = stringResource(R.string.sheet_confirm_delete_message),
            confirmLabel = stringResource(R.string.sheet_confirm_delete_in_progress),
            cancelLabel = stringResource(R.string.common_cancel),
            onConfirm = {},
            onCancel = {},
        )
    }
}

@PreviewTest
@FeedbackPreviews
@Composable
fun snackbarUndo() {
    SnackbarPreview {
        Snackbar(
            state = SnackbarState.Undo,
            message = stringResource(R.string.snackbar_undo_message),
            actionLabel = stringResource(R.string.snackbar_undo_action),
            onAction = {},
        )
    }
}

@PreviewTest
@FeedbackPreviews
@Composable
fun snackbarFailureWithRetry() {
    SnackbarPreview {
        Snackbar(
            state = SnackbarState.FailureWithRetry,
            message = stringResource(R.string.snackbar_failure_message),
            actionLabel = stringResource(R.string.common_retry),
            onAction = {},
        )
    }
}

@PreviewTest
@FeedbackPreviews
@Composable
fun snackbarNoAction() {
    SnackbarPreview {
        Snackbar(
            state = SnackbarState.NoAction,
            message = stringResource(R.string.snackbar_copied_message),
        )
    }
}
