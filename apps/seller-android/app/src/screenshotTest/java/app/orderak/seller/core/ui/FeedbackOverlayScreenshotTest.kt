package app.orderak.seller.core.ui

import android.content.res.Configuration
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.material3.Surface
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalConfiguration
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.unit.dp
import app.orderak.seller.R
import app.orderak.seller.core.ui.theme.OrderakTheme
import com.android.tools.screenshot.PreviewTest

@Composable
private fun previewDark(): Boolean =
    (LocalConfiguration.current.uiMode and Configuration.UI_MODE_NIGHT_MASK) ==
        Configuration.UI_MODE_NIGHT_YES

@Composable
private fun FeedbackPreview(content: @Composable () -> Unit) {
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
fun bannerInformation() {
    FeedbackPreview {
        Banner(
            state = BannerState.Information,
            title = stringResource(R.string.banner_information_title),
            message = stringResource(R.string.banner_information_message),
        )
    }
}

@PreviewTest
@FeedbackPreviews
@Composable
fun bannerWarning() {
    FeedbackPreview {
        Banner(
            state = BannerState.Warning,
            title = stringResource(R.string.banner_warning_title),
            message = stringResource(R.string.banner_warning_message),
            actionLabel = stringResource(R.string.banner_warning_action),
            onAction = {},
        )
    }
}

@PreviewTest
@FeedbackPreviews
@Composable
fun bannerError() {
    FeedbackPreview {
        Banner(
            state = BannerState.Error,
            title = stringResource(R.string.banner_error_title),
            message = stringResource(R.string.banner_error_message),
        )
    }
}

@PreviewTest
@FeedbackPreviews
@Composable
fun bannerSuccess() {
    FeedbackPreview {
        Banner(
            state = BannerState.Success,
            title = stringResource(R.string.banner_success_title),
            message = stringResource(R.string.banner_success_message),
        )
    }
}

@PreviewTest
@FeedbackPreviews
@Composable
fun bannerLockedByPlan() {
    FeedbackPreview {
        Banner(
            state = BannerState.LockedByPlan,
            title = stringResource(R.string.banner_locked_by_plan_title),
            message = stringResource(R.string.banner_locked_by_plan_message),
            actionLabel = stringResource(R.string.banner_locked_by_plan_action),
            onAction = {},
        )
    }
}

@PreviewTest
@FeedbackPreviews
@Composable
fun bannerSyncInProgress() {
    FeedbackPreview {
        Banner(
            state = BannerState.SyncInProgress,
            title = stringResource(R.string.banner_sync_in_progress_title),
            message = stringResource(R.string.banner_sync_in_progress_message),
        )
    }
}

@PreviewTest
@FeedbackPreviews
@Composable
fun bannerSyncFailed() {
    FeedbackPreview {
        Banner(
            state = BannerState.SyncFailed,
            title = stringResource(R.string.banner_sync_failed_title),
            message = stringResource(R.string.banner_sync_failed_message),
            actionLabel = stringResource(R.string.banner_sync_failed_retry),
            onAction = {},
        )
    }
}

@PreviewTest
@FeedbackPreviews
@Composable
fun bannerVersionWarning() {
    FeedbackPreview {
        Banner(
            state = BannerState.VersionWarning,
            title = stringResource(R.string.banner_version_warning_title),
            message = stringResource(R.string.banner_version_warning_message),
            actionLabel = stringResource(R.string.banner_version_warning_action),
            onAction = {},
        )
    }
}

@PreviewTest
@FeedbackPreviews
@Composable
fun offlineStripOffline() {
    FeedbackPreview {
        OfflineStrip(state = OfflineStripState.Offline, lastUpdateMinutes = 5)
    }
}

@PreviewTest
@FeedbackPreviews
@Composable
fun offlineStripReconnecting() {
    FeedbackPreview {
        OfflineStrip(state = OfflineStripState.Reconnecting)
    }
}

@PreviewTest
@FeedbackPreviews
@Composable
fun skeletonListRows() {
    FeedbackPreview { Skeleton(variant = SkeletonVariant.ListRows) }
}

@PreviewTest
@FeedbackPreviews
@Composable
fun skeletonMetricTiles() {
    FeedbackPreview { Skeleton(variant = SkeletonVariant.MetricTiles) }
}

@PreviewTest
@FeedbackPreviews
@Composable
fun skeletonDetailBlock() {
    FeedbackPreview { Skeleton(variant = SkeletonVariant.DetailBlock) }
}
