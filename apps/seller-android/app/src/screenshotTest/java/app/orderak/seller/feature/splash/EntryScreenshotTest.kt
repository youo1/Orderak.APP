package app.orderak.seller.feature.splash

import androidx.compose.material3.Surface
import androidx.compose.runtime.Composable
import androidx.compose.ui.tooling.preview.Preview
import app.orderak.seller.core.ui.theme.OrderakTheme
import app.orderak.seller.feature.operations.RestrictedAccountContent
import com.android.tools.screenshot.PreviewTest

/**
 * The two screens that decide whether a seller gets into the app at all.
 *
 * Splash had no name until now — it was an anonymous block inside
 * `composable<SplashRoute> { }`, which is the least visible way to have a screen
 * with two declared states and renders of neither. Restricted-account had a
 * name and a view model it used for exactly one thing.
 *
 * Neither had ever been rendered. Between them they are what a seller sees when
 * the app cannot start and when their account has been suspended — the two
 * moments where a confusing screen costs the most and gets looked at the least.
 *
 * All Arabic: `ar` is the primary direction, so the render is what a seller sees.
 */

// ================= splash =================

@PreviewTest
@Preview(name = "Splash loading light", locale = "ar")
@Composable
fun splashLoadingLight() {
    OrderakTheme(darkTheme = false) { SplashScreen(isError = false, onRetry = {}) }
}

@PreviewTest
@Preview(name = "Splash loading dark", locale = "ar")
@Composable
fun splashLoadingDark() {
    OrderakTheme(darkTheme = true) { SplashScreen(isError = false, onRetry = {}) }
}

/**
 * The entry gate could not resolve.
 *
 * It carries a retry, because the alternative on the very first screen is an
 * app that appears to be broken with no way to disagree with it.
 */
@PreviewTest
@Preview(name = "Splash error light", locale = "ar")
@Composable
fun splashErrorLight() {
    OrderakTheme(darkTheme = false) { SplashScreen(isError = true, onRetry = {}) }
}

@PreviewTest
@Preview(name = "Splash error dark", locale = "ar")
@Composable
fun splashErrorDark() {
    OrderakTheme(darkTheme = true) { SplashScreen(isError = true, onRetry = {}) }
}

// ================= restricted account =================

/**
 * Three ways out, and none of them is "try signing in again".
 *
 * Retry rechecks the restriction, contact opens mail, sign-out leaves. The
 * contract declares only `content` for this screen and that is right: there is
 * nothing here to load.
 */
@PreviewTest
@Preview(name = "Restricted account light", locale = "ar")
@Composable
fun restrictedAccountLight() {
    OrderakTheme(darkTheme = false) {
        Surface {
            RestrictedAccountContent(onCheckAgain = {}, onContactSupport = {}, onLogout = {})
        }
    }
}

@PreviewTest
@Preview(name = "Restricted account dark", locale = "ar")
@Composable
fun restrictedAccountDark() {
    OrderakTheme(darkTheme = true) {
        Surface {
            RestrictedAccountContent(onCheckAgain = {}, onContactSupport = {}, onLogout = {})
        }
    }
}
