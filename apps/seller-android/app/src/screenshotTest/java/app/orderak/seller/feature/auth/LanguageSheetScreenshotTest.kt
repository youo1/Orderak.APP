package app.orderak.seller.feature.auth

import androidx.compose.material3.Surface
import androidx.compose.runtime.Composable
import androidx.compose.ui.tooling.preview.Preview
import app.orderak.seller.core.ui.theme.OrderakTheme
import com.android.tools.screenshot.PreviewTest

/**
 * The language picker, in every language it can be showing.
 *
 * WHY THIS FILE DID NOT EXIST
 *   `LanguageSheet` had no baselines at all — not blank ones, none. It is reachable
 *   from two places a seller passes through on the first run (`AuthScreen.kt:139`
 *   and `SettingsScreen.kt:259`) and it is the only control that changes the
 *   language of every other screen, so it was the largest uncovered surface in the
 *   app. Nothing named it: `design-coverage.mjs` checks that the states in
 *   `screen-contracts.mjs` are rendered, and the picker was never a state in it.
 *
 * WHY IT RENDERS `LanguageSheetContent`
 *   Not for convenience. `ModalBottomSheet` composes into its own window and the
 *   screenshot harness does not capture it, so a preview of `LanguageSheet` would
 *   emit an empty frame — the exact defect that made three passkey baselines share
 *   one SHA256. The extraction is what makes these pixels real.
 *
 * WHAT EACH RENDER IS FOR
 *   The three languages are not three copies. A seller whose phone is in French
 *   opens this sheet and sees `Français` checked; a regression that hardcodes the
 *   check to Arabic, or that drops `selectedTag` in favour of a default, is invisible
 *   in an Arabic-only baseline and obvious here. The dark render is the one place the
 *   selected row's `primary` tick sits on `surface` in the dark scheme.
 *
 * `selectedTag` is passed explicitly rather than left to `AppLocales.currentTag()`.
 * A preview cannot set the application locale, so the ambient version of this
 * composable could only ever have produced one of these four images.
 */

@Composable
private fun languageSheet(selectedTag: String, dark: Boolean = false) {
    OrderakTheme(darkTheme = dark) {
        Surface { LanguageSheetContent(selectedTag = selectedTag, onSelect = {}) }
    }
}

@PreviewTest
@Preview(name = "Language sheet arabic", locale = "ar")
@Composable
fun languageSheetArabic() = languageSheet(selectedTag = "ar")

@PreviewTest
@Preview(name = "Language sheet english", locale = "en")
@Composable
fun languageSheetEnglish() = languageSheet(selectedTag = "en")

/** `Français` is the longest name and the app's least-exercised locale. */
@PreviewTest
@Preview(name = "Language sheet french", locale = "fr")
@Composable
fun languageSheetFrench() = languageSheet(selectedTag = "fr")

@PreviewTest
@Preview(name = "Language sheet dark", locale = "ar")
@Composable
fun languageSheetDark() = languageSheet(selectedTag = "ar", dark = true)
