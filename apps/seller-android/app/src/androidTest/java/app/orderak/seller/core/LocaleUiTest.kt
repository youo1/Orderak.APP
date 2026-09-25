package app.orderak.seller.core

import android.content.Context
import android.content.res.Configuration
import android.os.LocaleList
import androidx.compose.foundation.layout.Row
import androidx.compose.material3.Text
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalConfiguration
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.LocalLayoutDirection
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.unit.LayoutDirection
import androidx.compose.ui.layout.layout
import androidx.test.core.app.ApplicationProvider
import androidx.compose.ui.test.assertTextEquals
import androidx.compose.ui.test.junit4.createComposeRule
import androidx.compose.ui.test.onNodeWithTag
import app.orderak.seller.R
import app.orderak.seller.core.text.formatCount
import app.orderak.seller.core.ui.theme.OrderakTheme
import org.junit.Assert.assertNotEquals
import org.junit.Rule
import org.junit.Test
import java.text.NumberFormat
import java.util.Locale

/**
 * Instrumented smoke coverage for every shipped and debug-only locale.
 *
 * UI-05: the digit-formatting assertions below are the one thing nothing else
 * in this repo checks against a real Android rendering pipeline. `CountsTest`
 * (a JVM unit test) already pins `formatCount`'s algorithm with a real
 * `java.text.Bidi` oracle, and the screenshot suite renders it through
 * Layoutlib — which, per this project's own notes, renders digits in Latin
 * form under Layoutlib regardless of the configured locale, so a regression
 * reverting `formatCount` to a bare `.toString()` would not show up as a
 * screenshot diff. This test renders through Compose on a real device/
 * emulator instead, which is the one pipeline that actually shapes
 * Arabic-Indic digits the way a seller's phone will.
 */
class LocaleUiTest {

    @get:Rule
    val composeRule = createComposeRule()

    @Test fun english() = verifyLocale("en", LayoutDirection.Ltr)
    @Test fun arabicRtl() = verifyLocale("ar", LayoutDirection.Rtl)
    @Test fun french() = verifyLocale("fr", LayoutDirection.Ltr)
    @Test fun expandedPseudoLocale() = verifyLocale("en-XA", LayoutDirection.Ltr)
    @Test fun rtlPseudoLocale() = verifyLocale("ar-XB", LayoutDirection.Rtl)

    /**
     * Arabic is the one shipped locale whose digits actually differ from
     * Latin — CLDR gives `ar` (Egypt) Arabic-Indic digits and `ar-XB` is a
     * pseudo-locale built from it. Asserted apart from [verifyLocale] because
     * the interesting claim here is not "matches what the same API would
     * produce" (every locale would trivially pass that) but "differs from the
     * plain Latin string a raw `Int.toString()` would have rendered" — which
     * is exactly the regression this app has shipped before (see Counts.kt's
     * own history) and the one Layoutlib cannot catch.
     */
    @Test fun arabicDigitsAreShapedNotLatin() = verifyDigitsDifferFromLatin("ar")
    @Test fun arabicPseudoLocaleDigitsAreShapedNotLatin() = verifyDigitsDifferFromLatin("ar-XB")

    private fun verifyLocale(tag: String, expectedDirection: LayoutDirection) {
        val locale = Locale.forLanguageTag(tag)
        val base = ApplicationProvider.getApplicationContext<Context>()
        val configuration = Configuration(base.resources.configuration).apply {
            setLocales(LocaleList(locale))
            setLayoutDirection(locale)
        }
        val localizedContext = base.createConfigurationContext(configuration)
        val expectedTitle = localizedContext.getString(R.string.settings_title)
        // The same digit-shaping pipeline `formatCount` uses in production —
        // computed here, not hardcoded, because the claim under test is
        // "Compose renders what this API produces", not "this API produces a
        // literal this test happens to hardcode".
        val expectedCount = formatCount(1234, locale)

        composeRule.setContent {
            CompositionLocalProvider(
                LocalContext provides localizedContext,
                LocalConfiguration provides configuration,
                LocalLayoutDirection provides expectedDirection,
            ) {
                OrderakTheme {
                    Row(
                        Modifier
                            .testTag("locale-root")
                            .layout { measurable, constraints ->
                                check(layoutDirection == expectedDirection) {
                                    "$tag resolved to $layoutDirection instead of $expectedDirection"
                                }
                                val placeable = measurable.measure(constraints)
                                layout(placeable.width, placeable.height) {
                                    placeable.placeRelative(0, 0)
                                }
                            },
                    ) {
                        Text(
                            text = stringResource(R.string.settings_title),
                            modifier = Modifier.testTag("localized-title"),
                        )
                        Text(
                            text = formatCount(1234, locale),
                            modifier = Modifier.testTag("localized-count"),
                        )
                    }
                }
            }
        }

        composeRule.onNodeWithTag("locale-root").assertExists()
        composeRule.onNodeWithTag("localized-title").assertTextEquals(expectedTitle)
        composeRule.onNodeWithTag("localized-count").assertTextEquals(expectedCount)
    }

    private fun verifyDigitsDifferFromLatin(tag: String) {
        val locale = Locale.forLanguageTag(tag)
        val rendered = formatCount(1234, locale)
        val latin = NumberFormat.getIntegerInstance(Locale.US).format(1234L)
        assertNotEquals(
            "$tag must render Arabic-Indic digits, not the Latin string " +
                "a raw Int.toString()/Locale.US formatter would produce",
            latin,
            rendered,
        )
    }
}
