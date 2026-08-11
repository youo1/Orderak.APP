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
import app.orderak.seller.core.ui.theme.OrderakTheme
import org.junit.Rule
import org.junit.Test
import java.util.Locale

/** Instrumented smoke coverage for every shipped and debug-only locale. */
class LocaleUiTest {

    @get:Rule
    val composeRule = createComposeRule()

    @Test fun english() = verifyLocale("en", LayoutDirection.Ltr)
    @Test fun arabicRtl() = verifyLocale("ar", LayoutDirection.Rtl)
    @Test fun french() = verifyLocale("fr", LayoutDirection.Ltr)
    @Test fun expandedPseudoLocale() = verifyLocale("en-XA", LayoutDirection.Ltr)
    @Test fun rtlPseudoLocale() = verifyLocale("ar-XB", LayoutDirection.Rtl)

    private fun verifyLocale(tag: String, expectedDirection: LayoutDirection) {
        val locale = Locale.forLanguageTag(tag)
        val base = ApplicationProvider.getApplicationContext<Context>()
        val configuration = Configuration(base.resources.configuration).apply {
            setLocales(LocaleList(locale))
            setLayoutDirection(locale)
        }
        val localizedContext = base.createConfigurationContext(configuration)
        val expectedTitle = localizedContext.getString(R.string.settings_title)

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
                    }
                }
            }
        }

        composeRule.onNodeWithTag("locale-root").assertExists()
        composeRule.onNodeWithTag("localized-title").assertTextEquals(expectedTitle)
    }
}
