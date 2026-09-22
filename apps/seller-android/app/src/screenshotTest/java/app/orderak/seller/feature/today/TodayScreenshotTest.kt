package app.orderak.seller.feature.today

import androidx.compose.foundation.layout.Column
import androidx.compose.material3.Surface
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.drawWithContent
import androidx.compose.ui.geometry.Rect
import androidx.compose.ui.graphics.ColorFilter
import androidx.compose.ui.graphics.ColorMatrix
import androidx.compose.ui.graphics.Paint
import androidx.compose.ui.tooling.preview.Preview
import app.orderak.seller.core.ui.NoticeBanner
import app.orderak.seller.core.ui.SemanticRole
import app.orderak.seller.core.ui.theme.OrderakTheme
import com.android.tools.screenshot.PreviewTest

private fun Modifier.greyscale(): Modifier = drawWithContent {
    val paint = Paint().apply {
        colorFilter = ColorFilter.colorMatrix(ColorMatrix().apply { setToSaturation(0f) })
    }
    drawContext.canvas.saveLayer(Rect(0f, 0f, size.width, size.height), paint)
    drawContent()
    drawContext.canvas.restore()
}

/**
 * The اليوم surface, in every state its contract declares.
 *
 * WHY THIS FILE DID NOT EXIST BEFORE
 *   The surface was a private `DashboardTab` inside a 450-line `MainScreen.kt`,
 *   reachable only through a Hilt view model — nothing a screenshot test can
 *   construct. `TodayScreen` takes a [TodayUiState] and renders it, so each
 *   state is a literal here.
 *
 *   `design-coverage.mjs` has always mapped this contract's four states to
 *   artboards (`TodayLoading`, `Main`, `TodayEmpty`, `TodayError`) and passed,
 *   because it checks that an artboard is *named* — never that the state is
 *   built. Two of the four were not.
 *
 * Arabic throughout: `ar` is the primary direction for this app, so the state
 * that gets screenshotted is the one a seller actually sees.
 */
private val LOADED = TodayUiState(
    shopName = "حلواني الأمل",
    todayCount = 7,
    unpaidCount = 3,
    toShipCount = 2,
    hasProducts = true,
    hasPlanSnapshot = true,
)

@Composable
private fun Today(state: TodayUiState, notices: @Composable () -> Unit = {}) {
    Surface {
        TodayScreen(
            state = state,
            onOpenCounter = {},
            onShareCatalog = {},
            onOpenAnnouncements = {},
            onRetry = {},
            planNotices = notices,
        )
    }
}

// ---- content ---------------------------------------------------------

@PreviewTest
@Preview(name = "Today content light", locale = "ar")
@Composable
fun todayContentLight() {
    OrderakTheme(darkTheme = false) { Today(LOADED) }
}

@PreviewTest
@Preview(name = "Today content dark", locale = "ar")
@Composable
fun todayContentDark() {
    OrderakTheme(darkTheme = true) { Today(LOADED) }
}

// ---- the same three counters in English ------------------------------
// The control for the numeral change: these figures are Arabic-Indic under `ar`
// and Latin here, and both renders have to agree with the rest of their screen.

@PreviewTest
@Preview(name = "Today content English", locale = "en")
@Composable
fun todayContentEnglish() {
    OrderakTheme(darkTheme = false) { Today(LOADED.copy(shopName = "Al Amal Sweets")) }
}

// ---- loading ---------------------------------------------------------
// Counts are null, not 0. The distinction is the whole point: a 0 is a figure
// the seller acts on, and rendering one before the data is read is a lie.

@PreviewTest
@Preview(name = "Today loading light", locale = "ar")
@Composable
fun todayLoadingLight() {
    OrderakTheme(darkTheme = false) { Today(TodayUiState(shopName = "حلواني الأمل")) }
}

@PreviewTest
@Preview(name = "Today loading dark", locale = "ar")
@Composable
fun todayLoadingDark() {
    OrderakTheme(darkTheme = true) { Today(TodayUiState(shopName = "حلواني الأمل")) }
}

// ---- empty -----------------------------------------------------------
// Counts are real zeros and there are no products: known, and none. This must
// not look like the loading state above.

private val EMPTY = TodayUiState(
    shopName = "حلواني الأمل",
    todayCount = 0,
    unpaidCount = 0,
    toShipCount = 0,
    hasProducts = false,
)

@PreviewTest
@Preview(name = "Today empty light", locale = "ar")
@Composable
fun todayEmptyLight() {
    OrderakTheme(darkTheme = false) { Today(EMPTY) }
}

@PreviewTest
@Preview(name = "Today empty dark", locale = "ar")
@Composable
fun todayEmptyDark() {
    OrderakTheme(darkTheme = true) { Today(EMPTY) }
}

// ---- error -----------------------------------------------------------
// The counters stay REAL here. They come from local Room queries and do not
// depend on the network, so blanking them would hide data the seller has. Only
// the plan refresh failed, and only that is reported.

private val ERRORED = LOADED.copy(planError = "ماقدرناش نوصل للسيرفر. الأرقام تحت من الجهاز.")

@PreviewTest
@Preview(name = "Today error light", locale = "ar")
@Composable
fun todayErrorLight() {
    OrderakTheme(darkTheme = false) { Today(ERRORED) }
}

@PreviewTest
@Preview(name = "Today error dark", locale = "ar")
@Composable
fun todayErrorDark() {
    OrderakTheme(darkTheme = true) { Today(ERRORED) }
}

// ---- offline ---------------------------------------------------------
// A modifier, not a state: a banner over content. That is the repo's own model
// (`states` is closed to loading/content/empty/error, `offline` is a separate
// boolean, and OFFLINE_ARTBOARDS is keyed by surface).

@Composable
private fun offlineNotice() {
    NoticeBanner(
        role = SemanticRole.Info,
        title = "يتم استخدام إعدادات الباقة المحفوظة",
        message = "حدود الخطة المعروضة هي آخر حاجة اتزامنت. هتتحدّث أول ما الاتصال يرجع.",
    )
}

@PreviewTest
@Preview(name = "Today offline light", locale = "ar")
@Composable
fun todayOfflineLight() {
    OrderakTheme(darkTheme = false) {
        Today(LOADED.copy(usingOfflinePlan = true)) { offlineNotice() }
    }
}

@PreviewTest
@Preview(name = "Today offline dark", locale = "ar")
@Composable
fun todayOfflineDark() {
    OrderakTheme(darkTheme = true) {
        Today(LOADED.copy(usingOfflinePlan = true)) { offlineNotice() }
    }
}

// ---- greyscale -------------------------------------------------------

/**
 * The counters must stay readable without colour.
 *
 * Unpaid is drawn in the warning role and ready-to-ship in success; if either
 * carried its meaning in hue alone, this render would flatten them into the
 * same card. Icon, number and label all say it — the rule `SemanticChip`
 * already sets for this app.
 */
@PreviewTest
@Preview(name = "Today greyscale", locale = "ar")
@Composable
fun todayGreyscale() {
    OrderakTheme(darkTheme = false) {
        Surface { Column(modifier = Modifier.greyscale()) { Today(LOADED) } }
    }
}
