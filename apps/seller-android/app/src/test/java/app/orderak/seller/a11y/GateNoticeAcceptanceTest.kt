package app.orderak.seller.a11y

import android.app.Application
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.ui.semantics.SemanticsActions
import androidx.compose.ui.semantics.SemanticsNode
import androidx.compose.ui.semantics.SemanticsProperties
import androidx.compose.ui.semantics.getOrNull
import androidx.compose.ui.test.hasClickAction
import androidx.compose.ui.test.isRoot
import androidx.compose.ui.test.junit4.createComposeRule
import androidx.compose.ui.test.onFirst
import androidx.compose.ui.test.performClick
import androidx.test.core.app.ApplicationProvider
import androidx.test.ext.junit.runners.AndroidJUnit4
import app.orderak.seller.R
import app.orderak.seller.core.ui.FeatureAvailability
import app.orderak.seller.core.ui.FeatureGate
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.annotation.Config
import org.robolectric.annotation.GraphicsMode

/**
 * Locked acceptance checks for the R1a GateNotice contract (the four states:
 * locked/purchase-open with an action, locked/purchase-closed without one,
 * not-built with no chip and no action, and available with only the feature
 * content). Exercised through `FeatureGate`'s existing `availability` overload,
 * which the spec requires to keep behaving the same way — not through
 * GateNotice's own (unspecified) signature — so this test does not depend on
 * which exact public API the implementer gives GateNotice.
 *
 * None of the assertions below pin today's colloquial Arabic copy: the title is
 * read back through `R.string.gate_locked_by_plan_title`, and the only literal
 * Arabic string compared against is the OLD colloquial wording, used only to
 * prove it has been replaced per D-15.
 */
@RunWith(AndroidJUnit4::class)
@GraphicsMode(GraphicsMode.Mode.NATIVE)
@Config(sdk = [35], qualifiers = "ar-w411dp-h891dp-xxhdpi", application = Application::class)
class GateNoticeAcceptanceTest {

    @get:Rule
    val rule = createComposeRule()

    private fun allTexts(): List<String> {
        val texts = mutableListOf<String>()
        val roots = rule.onAllNodes(isRoot(), useUnmergedTree = true).fetchSemanticsNodes()
        fun visit(node: SemanticsNode) {
            node.config.getOrNull(SemanticsProperties.Text)?.forEach { texts += it.text }
            node.children.forEach { visit(it) }
        }
        roots.forEach { visit(it) }
        return texts
    }

    private fun clickableTexts(): List<String> {
        val texts = mutableListOf<String>()
        val roots = rule.onAllNodes(isRoot(), useUnmergedTree = false).fetchSemanticsNodes()
        fun visit(node: SemanticsNode) {
            if (node.config.getOrNull(SemanticsActions.OnClick) != null) {
                node.config.getOrNull(SemanticsProperties.Text)?.forEach { texts += it.text }
            }
            node.children.forEach { visit(it) }
        }
        roots.forEach { visit(it) }
        return texts
    }

    private fun resourceString(id: Int): String =
        ApplicationProvider.getApplicationContext<Application>().resources.getString(id)

    @Test
    fun availableRendersOnlyFeatureContentWithNoWrapperChrome() {
        rule.setContent {
            MaterialTheme {
                FeatureGate(availability = FeatureAvailability.Available) {
                    Text("probe-feature-content")
                }
            }
        }
        rule.waitForIdle()
        val texts = allTexts()
        assertTrue("Available must render the feature content", "probe-feature-content" in texts)
        val chrome = listOf(
            resourceString(R.string.gate_locked_by_plan_title),
            resourceString(R.string.gate_not_built_title),
            resourceString(R.string.gate_upgrade_action),
            resourceString(R.string.gate_not_built_badge),
        )
        assertTrue("Available must draw no gate chrome, got $texts", texts.none { it in chrome })
    }

    @Test
    fun lockedByPlanWithoutButtonOffersNoActionableElement() {
        rule.setContent {
            MaterialTheme {
                FeatureGate(availability = FeatureAvailability.LockedByPlan, onUpgrade = null) {
                    Text("probe-feature-content")
                }
            }
        }
        rule.waitForIdle()
        assertTrue(
            "Purchase-closed must offer no clickable action, got ${clickableTexts()}",
            clickableTexts().none { it == resourceString(R.string.gate_upgrade_action) },
        )
        assertTrue(
            "Purchase-closed must still name the lock",
            resourceString(R.string.gate_locked_by_plan_title) in allTexts(),
        )
    }

    @Test
    fun notBuiltHasNoChipAndNoAction() {
        rule.setContent {
            MaterialTheme {
                FeatureGate(availability = FeatureAvailability.NotBuilt) {
                    Text("probe-feature-content")
                }
            }
        }
        rule.waitForIdle()
        val texts = allTexts()
        assertFalse("Not-built must draw no chip, got $texts", resourceString(R.string.gate_not_built_badge) in texts)
        assertTrue("Not-built must offer no clickable action, got ${clickableTexts()}", clickableTexts().isEmpty())
    }

    @Test
    fun lockedByPlanWithActionUsesTheApprovedResourceTitleAndIsTappable() {
        var upgraded = 0
        rule.setContent {
            MaterialTheme {
                FeatureGate(availability = FeatureAvailability.LockedByPlan, onUpgrade = { upgraded++ }) {
                    Text("probe-feature-content")
                }
            }
        }
        rule.waitForIdle()

        val title = resourceString(R.string.gate_locked_by_plan_title)
        assertTrue("The locked title must be read from its resource key", title in allTexts())
        assertTrue(
            "D-15 replaces today's colloquial title; the resource must no longer read it",
            title != "مش متضمّنة في خطتك",
        )

        val actionable = clickableTexts()
        assertTrue("Purchase-open must offer a clickable action, got $actionable", actionable.isNotEmpty())
        rule.onAllNodes(hasClickAction()).onFirst().performClick()
        assertEquals("Tapping the offered action must call onUpgrade", 1, upgraded)
    }
}
