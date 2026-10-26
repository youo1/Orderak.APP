package app.orderak.seller.core.ui

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.defaultMinSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalConfiguration
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.semantics.LiveRegionMode
import androidx.compose.ui.semantics.liveRegion
import androidx.compose.ui.semantics.semantics
import app.orderak.seller.core.ui.theme.LocalOrderakSpacing

/** The three snackbars the approved design draws. */
enum class SnackbarState {
    /** Something was done and can be taken back: the action is “Undo”. */
    Undo,

    /** Something failed and can be tried again: the action is “Retry”. */
    FailureWithRetry,

    /** A short confirmation with nothing to press. */
    NoAction,
}

/** From this font scale the message wraps and the action moves below it. */
private const val StackedFontScale = 1.5f

/**
 * A short message at the bottom of a screen, with at most one action.
 *
 * The action is a 48dp target. Beside the message at normal text sizes; below
 * it, with the message across the full width, from a font scale of
 * [StackedFontScale], because a side-by-side action would leave the message a
 * few words wide.
 *
 * This is the snackbar's content, not its host: the screen that adopts it keeps
 * its `SnackbarHost` and draws this as the host's snackbar.
 */
@Composable
fun Snackbar(
    state: SnackbarState,
    message: String,
    modifier: Modifier = Modifier,
    actionLabel: String? = null,
    onAction: (() -> Unit)? = null,
) {
    val spacing = LocalOrderakSpacing.current
    val fontScale = maxOf(LocalDensity.current.fontScale, LocalConfiguration.current.fontScale)
    // A snackbar with no action state has none, whatever the caller passed.
    val hasAction = state != SnackbarState.NoAction && actionLabel != null && onAction != null
    val stacked = hasAction && fontScale >= StackedFontScale

    @Composable
    fun Message(textModifier: Modifier) {
        Text(
            text = message,
            style = MaterialTheme.typography.bodyMedium,
            modifier = textModifier
                .testTag("orderak.snackbar.message")
                .semantics { liveRegion = LiveRegionMode.Polite },
        )
    }

    @Composable
    fun Action(actionModifier: Modifier) {
        TextButton(
            onClick = onAction!!,
            modifier = actionModifier
                .defaultMinSize(
                    minWidth = spacing.minimumTouchTarget,
                    minHeight = spacing.minimumTouchTarget,
                )
                .testTag("orderak.snackbar.action"),
        ) {
            Text(
                text = actionLabel!!,
                style = MaterialTheme.typography.labelLarge,
                color = MaterialTheme.colorScheme.inversePrimary,
            )
        }
    }

    Surface(
        modifier = modifier
            .fillMaxWidth()
            .testTag("orderak.snackbar"),
        shape = MaterialTheme.shapes.medium,
        color = MaterialTheme.colorScheme.inverseSurface,
        contentColor = MaterialTheme.colorScheme.inverseOnSurface,
    ) {
        when {
            !hasAction -> Message(
                Modifier.padding(horizontal = spacing.space4, vertical = spacing.space4),
            )
            stacked -> Column(
                modifier = Modifier.padding(horizontal = spacing.space4, vertical = spacing.space3),
                verticalArrangement = Arrangement.spacedBy(spacing.space1),
            ) {
                Message(Modifier.fillMaxWidth().padding(top = spacing.space1))
                Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.End) {
                    Action(Modifier)
                }
            }
            else -> Row(
                modifier = Modifier.padding(start = spacing.space4, end = spacing.space2),
                verticalAlignment = Alignment.CenterVertically,
                horizontalArrangement = Arrangement.spacedBy(spacing.space2),
            ) {
                Message(Modifier.weight(1f).padding(vertical = spacing.space4))
                Action(Modifier)
            }
        }
    }
}
