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
import org.junit.Assert.assertEquals
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
     * Arabic is the one shipped, real-user-selectable locale whose digits
     * actually differ from Latin. Asserted apart from [verifyLocale] because
     * the interesting claim here is not "matches what the same API would
     * produce" (every locale would trivially pass that) but "differs from the
     * plain Latin string a raw `Int.toString()` would have rendered" — which
     * is exactly the regression this app has shipped before (see Counts.kt's
     * own history) and the one Layoutlib cannot catch.
     *
     * Deliberately not asserted for `ar-XB`. It looks like it should hold —
     * `ar-XB` is built from `ar` — but a real device run of this exact
     * assertion proved otherwise: `NumberFormat.getIntegerInstance` renders
     * `ar-XB` in plain Latin digits with grouping ("1,234"), not Arabic-Indic.
     * `ar-XB` is Android's synthetic pseudo-locale for RTL *layout* testing —
     * text expansion and mirroring — and CLDR does not carry a distinct
     * Arabic numbering system for it the way it does for `ar`/`ar-EG`. No
     * real seller can select it, so this is a fact about the test locale, not
     * a product gap; asserting it anyway is exactly how a CI-discovered
     * finding becomes a permanent regression test.
     */
    @Test fun arabicDigitsAreShapedNotLatin() = verifyDigitsDifferFromLatin("ar")

    /**
     * The exact regression this app shipped: [arabicDigitsAreShapedNotLatin]
     * only asserts the rendered string is *not* the Latin one, which a
     * grouping-separator difference alone could satisfy even if the digits
     * themselves stayed Latin. This pins the literal Eastern Arabic-Indic
     * glyphs (U+0660–U+0669, the `nu=arab` set — not `arabext`'s
     * U+06F0–U+06F9 Persian/Urdu variant) for the exact tag
     * `AppLocales.set("ar")` applies: bare `ar`, no region, no `-u-nu-`
     * extension. Confirmed failing before `arabicIndicLocale` existed —
     * `formatCount(1, Locale.forLanguageTag("ar"))` rendered plain `"1"` on
     * this emulator's real ICU, not `"١"`, even though the equivalent JVM
     * assertion in `CountsTest` was already green.
     */
    @Test fun bareArabicTagRendersEasternArabicIndicDigits() {
        val locale = Locale.forLanguageTag("ar")
        assertEquals("١", formatCount(1, locale))
        assertEquals("٢٠", formatCount(20, locale))
        assertEquals("١٠٠", formatCount(100, locale))
    }

    /** The other half of the claim: fixing Arabic must not touch English. */
    @Test fun englishTagRendersLatinDigits() {
        val locale = Locale.forLanguageTag("en")
        assertEquals("1", formatCount(1, locale))
        assertEquals("20", formatCount(20, locale))
        assertEquals("100", formatCount(100, locale))
    }

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
