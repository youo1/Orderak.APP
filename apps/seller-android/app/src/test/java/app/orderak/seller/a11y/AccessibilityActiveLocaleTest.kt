package app.orderak.seller.a11y

import android.app.Application
import android.content.Context
import android.content.res.Configuration
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.size
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalConfiguration
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.LocalResources
import androidx.compose.ui.test.junit4.createComposeRule
import androidx.compose.ui.unit.dp
import androidx.test.core.app.ApplicationProvider
import androidx.test.ext.junit.runners.AndroidJUnit4
import java.util.Locale
import org.junit.Assert.assertTrue
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.annotation.Config
import org.robolectric.annotation.GraphicsMode

@RunWith(AndroidJUnit4::class)
@GraphicsMode(GraphicsMode.Mode.NATIVE)
@Config(sdk = [35], qualifiers = "ar-w411dp-h891dp-xxhdpi", application = Application::class)
class AccessibilityActiveLocaleTest {
    @get:Rule
    val rule = createComposeRule()

    @Test
    fun diagnosticsUseTheLocaleActiveInComposeContent() {
        val application = ApplicationProvider.getApplicationContext<Context>()
        val configuration = Configuration(application.resources.configuration).apply {
            setLocale(Locale.US)
        }
        val englishContext = application.createConfigurationContext(configuration)
        rule.setContent {
            CompositionLocalProvider(
                LocalConfiguration provides configuration,
                LocalContext provides englishContext,
                LocalResources provides englishContext.resources,
            ) {
                Box(Modifier.size(20.dp).clickable {})
            }
        }
        rule.waitForIdle()

        val diagnostics = auditAccessibility(rule, "activeLocaleProof")
        assertTrue("Expected an undersized target finding, got $diagnostics", diagnostics.isNotEmpty())
        assertTrue(
            "Diagnostics must identify the Compose content locale en-US, got $diagnostics",
            diagnostics.all { "[en-US]" in it },
        )
    }
}
