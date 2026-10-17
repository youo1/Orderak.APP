package app.orderak.seller.a11y

import android.app.Application
import androidx.compose.ui.test.junit4.createComposeRule
import androidx.test.ext.junit.runners.AndroidJUnit4
import app.orderak.seller.feature.products.storeSearchEmpty
import org.junit.Assert.assertTrue
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.annotation.Config
import org.robolectric.annotation.GraphicsMode

/**
 * A Label finding is fixed with semantics only (no pixel change), so it must not be
 * deferred to KNOWN_FINDINGS. The search-empty store state must expose a label on
 * every actionable node.
 */
@RunWith(AndroidJUnit4::class)
@GraphicsMode(GraphicsMode.Mode.NATIVE)
@Config(sdk = [35], qualifiers = "ar-w411dp-h891dp-xxhdpi", application = Application::class)
class StoreSearchEmptyLabelReproTest {

    @get:Rule
    val rule = createComposeRule()

    @Test
    fun storeSearchEmptyHasNoUnlabelledActionableNodes() {
        rule.setContent { storeSearchEmpty() }
        rule.waitForIdle()
        val labels = auditAccessibility(rule, "StoreScreenshotTestKt.storeSearchEmpty [ar]")
            .filter { "Label:" in it }
        assertTrue("Semantics-only Label findings must be fixed, got $labels", labels.isEmpty())
    }
}
