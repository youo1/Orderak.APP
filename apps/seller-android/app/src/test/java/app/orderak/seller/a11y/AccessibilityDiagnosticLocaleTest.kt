package app.orderak.seller.a11y

import android.app.Application
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.size
import androidx.compose.ui.Modifier
import androidx.compose.ui.test.junit4.createComposeRule
import androidx.compose.ui.unit.dp
import androidx.test.ext.junit.runners.AndroidJUnit4
import org.junit.Assert.assertTrue
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.annotation.Config
import org.robolectric.annotation.GraphicsMode

@RunWith(AndroidJUnit4::class)
@GraphicsMode(GraphicsMode.Mode.NATIVE)
@Config(sdk = [35], qualifiers = "ar-w411dp-h891dp-xxhdpi", application = Application::class)
class AccessibilityDiagnosticLocaleTest {
    @get:Rule
    val rule = createComposeRule()

    @Test
    fun diagnosticsIncludeTheActiveLocaleWithoutCallerSupplyingIt() {
        rule.setContent { Box(Modifier.size(20.dp).clickable {}) }
        rule.waitForIdle()

        val diagnostics = auditAccessibility(rule, "localeProof")
        assertTrue("Expected a finding for the undersized target, got $diagnostics", diagnostics.isNotEmpty())
        assertTrue("Every diagnostic must identify the active Arabic locale: $diagnostics", diagnostics.all { "ar" in it })
    }
}
