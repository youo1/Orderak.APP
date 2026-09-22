package app.orderak.seller.feature.main

import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.tooling.preview.Preview
import app.orderak.seller.app.navigation.SellerSurface
import app.orderak.seller.core.ui.theme.OrderakTheme
import app.orderak.seller.data.remote.AppVersionPolicy
import com.android.tools.screenshot.PreviewTest

/**
 * The two shells: the frame every surface sits inside, and the screen that
 * replaces all of it when governance holds the app shut.
 *
 * Neither was renderable. `MainScreen` reads five flows off a Hilt view model,
 * and `VersionBlockingScreen` was private — it has always taken plain values and
 * needed a graph for nothing, which is the same gap `auth` had.
 *
 * `SurfaceBarScreenshotTest` next door renders the navigation bar on its own and
 * is classified as a component for that reason: it proves the bar, not the
 * shell that positions it beside a top bar and a surface-specific FAB.
 *
 * All Arabic: `ar` is the primary direction, so the render is what a seller sees.
 */

@Composable
private fun shell(
    surface: SellerSurface,
    shopName: String? = "بوتيك منى",
    dark: Boolean = false,
) {
    OrderakTheme(darkTheme = dark) {
        Surface {
            MainShellContent(
                shopName = shopName,
                surface = surface,
                onSurface = {},
                onNewOrder = {},
            ) {
                Box(Modifier.fillMaxSize(), contentAlignment = Alignment.Center) {
                    Text(
                        "…",
                        style = MaterialTheme.typography.displaySmall,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                    )
                }
            }
        }
    }
}

// ---- the frame, on each surface ---------------------------------------

/** اليوم: the only surface with a FAB, because its primary action is the shell's. */
@PreviewTest
@Preview(name = "Shell today light", locale = "ar")
@Composable
fun shellTodayLight() = shell(SellerSurface.Today)

@PreviewTest
@Preview(name = "Shell today dark", locale = "ar")
@Composable
fun shellTodayDark() = shell(SellerSurface.Today, dark = true)

/**
 * المتجر: no FAB here.
 *
 * The store surface has its own, and two floating actions on one screen compete
 * for the same corner and the same meaning.
 */
@PreviewTest
@Preview(name = "Shell store", locale = "ar")
@Composable
fun shellStore() = shell(SellerSurface.Store)

@PreviewTest
@Preview(name = "Shell account", locale = "ar")
@Composable
fun shellAccount() = shell(SellerSurface.Account)

/**
 * Before the shop name arrives.
 *
 * The app name, not a blank bar and not a guess — the same rule the rest of this
 * work applied to counters, catalogues and plan names.
 */
@PreviewTest
@Preview(name = "Shell no shop name", locale = "ar")
@Composable
fun shellNoShopName() = shell(SellerSurface.Today, shopName = null)

/** English, where the five labels are longest and most likely to clip. */
@PreviewTest
@Preview(name = "Shell English", locale = "en")
@Composable
fun shellEnglish() = shell(SellerSurface.Orders, shopName = "Mona Boutique")

// ---- governance ---------------------------------------------------------

@Composable
private fun blocking(
    mode: VersionUiMode,
    policy: AppVersionPolicy = AppVersionPolicy(),
    dark: Boolean = false,
) {
    OrderakTheme(darkTheme = dark) {
        Surface { VersionBlockingScreen(mode, policy, onRetry = {}) }
    }
}

/**
 * An update the seller must take.
 *
 * The only one of the three that offers a store link, because it is the only one
 * they can act on — the other two are waits, and a button that cannot help is
 * worse than no button.
 */
@PreviewTest
@Preview(name = "Version force update light", locale = "ar")
@Composable
fun versionForceUpdateLight() = blocking(
    VersionUiMode.FORCE_UPDATE,
    AppVersionPolicy(status = "blocked", store_url = "https://play.google.com/store/apps/details?id=app.orderak.seller"),
)

@PreviewTest
@Preview(name = "Version force update dark", locale = "ar")
@Composable
fun versionForceUpdateDark() = blocking(
    VersionUiMode.FORCE_UPDATE,
    AppVersionPolicy(status = "blocked", store_url = "https://play.google.com/store/apps/details?id=app.orderak.seller"),
    dark = true,
)

/** A build the server refuses outright. No store link: updating is not the fix. */
@PreviewTest
@Preview(name = "Version blocked", locale = "ar")
@Composable
fun versionBlocked() = blocking(VersionUiMode.BLOCKED)

/** A maintenance window — a wait, and the retry is the only thing to offer. */
@PreviewTest
@Preview(name = "Version maintenance", locale = "ar")
@Composable
fun versionMaintenance() = blocking(VersionUiMode.MAINTENANCE)

/**
 * The server's own wording, when it sent one.
 *
 * `blocking_message` is keyed by language, so this checks the Arabic entry is
 * the one picked rather than the English fallback.
 */
@PreviewTest
@Preview(name = "Version server message", locale = "ar")
@Composable
fun versionServerMessage() = blocking(
    VersionUiMode.MAINTENANCE,
    AppVersionPolicy(
        status = "maintenance",
        blocking_message = mapOf(
            "ar" to "بنعمل صيانة دلوقتي. جرب تاني خلال شوية.",
            "en" to "We are doing maintenance. Try again shortly.",
        ),
    ),
)
