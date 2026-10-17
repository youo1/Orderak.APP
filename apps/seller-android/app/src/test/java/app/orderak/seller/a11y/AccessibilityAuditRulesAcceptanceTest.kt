package app.orderak.seller.a11y

import android.app.Application
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Close
import androidx.compose.material.icons.filled.Info
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.test.junit4.createComposeRule
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.test.ext.junit.runners.AndroidJUnit4
import org.junit.Assert.assertTrue
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.annotation.Config
import org.robolectric.annotation.GraphicsMode

/**
 * Locked acceptance checks for the public `auditAccessibility(rule, preview)` entry point.
 *
 * Each case sets its own content once, then audits it. The three proofs must fail for
 * their intended rule; the controls must produce no diagnostics, so an audit that
 * fails everything cannot satisfy the proofs.
 */
@RunWith(AndroidJUnit4::class)
@GraphicsMode(GraphicsMode.Mode.NATIVE)
@Config(sdk = [35], qualifiers = "ar-w411dp-h891dp-xxhdpi", application = Application::class)
class AccessibilityAuditRulesAcceptanceTest {

    @get:Rule
    val rule = createComposeRule()

    private fun audit(preview: String, content: @Composable () -> Unit): List<String> {
        rule.setContent {
            MaterialTheme {
                Box(Modifier.fillMaxSize().background(Color.White).padding(24.dp)) { content() }
            }
        }
        rule.waitForIdle()
        return auditAccessibility(rule, preview)
    }

    @Test
    fun unlabelledIconButtonFailsTheLabelRule() {
        val diagnostics = audit("proofUnlabelledIconButton") {
            IconButton(onClick = {}) { Icon(Icons.Filled.Close, contentDescription = null) }
        }
        assertTrue(
            "Expected a Label diagnostic naming the preview, got $diagnostics",
            diagnostics.any { "Label" in it && "proofUnlabelledIconButton" in it },
        )
    }

    @Test
    fun adjacentSmallClickablesFailTheTargetRule() {
        val diagnostics = audit("proofCrowdedTargets") {
            Row {
                Box(Modifier.size(20.dp).semantics { contentDescription = "first" }.clickable {})
                Box(Modifier.size(20.dp).semantics { contentDescription = "second" }.clickable {})
            }
        }
        assertTrue(
            "Expected a Target diagnostic naming the preview, got $diagnostics",
            diagnostics.any { "Target" in it && "proofCrowdedTargets" in it },
        )
    }

    @Test
    fun faintGreyTextFailsTheContrastRule() {
        // #BBBBBB on white is about 1.9:1.
        val diagnostics = audit("proofFaintText") {
            Text("Faint text", color = Color(0xFFBBBBBB), fontSize = 16.sp)
        }
        assertTrue(
            "Expected a Contrast diagnostic naming the preview, got $diagnostics",
            diagnostics.any { "Contrast" in it && "proofFaintText" in it },
        )
    }

    @Test
    fun midGreyNormalTextFailsBelowFourAndAHalf() {
        // #808080 on white is about 3.95:1: below 4.5 for normal text.
        val diagnostics = audit("proofMidGreyNormal") {
            Text("Mid grey body", color = Color(0xFF808080), fontSize = 14.sp)
        }
        assertTrue(
            "Expected a Contrast diagnostic for normal-size text, got $diagnostics",
            diagnostics.any { "Contrast" in it && "proofMidGreyNormal" in it },
        )
    }

    @Test
    fun midGreyLargeTextPassesAtThreeToOne() {
        // The same #808080 at 24sp is large text, whose threshold is 3:1.
        val diagnostics = audit("controlMidGreyLarge") {
            Text("Mid grey heading", color = Color(0xFF808080), fontSize = 24.sp)
        }
        assertTrue("Large text at ~3.95:1 must pass, got $diagnostics", diagnostics.isEmpty())
    }

    @Test
    fun accessibleContentAndExcludedNodesProduceNoDiagnostics() {
        val diagnostics = audit("controlAccessible") {
            Column(verticalArrangement = Arrangement.spacedBy(24.dp)) {
                Text("Readable text", color = Color.Black, fontSize = 16.sp)
                IconButton(onClick = {}) {
                    Icon(Icons.Filled.Close, contentDescription = "Close", tint = Color.Black)
                }
                // Image-only node with poor contrast: excluded from the Contrast rule.
                Icon(Icons.Filled.Info, contentDescription = "Info", tint = Color(0xFFEEEEEE))
                // Disabled actionable node without a label: skipped.
                IconButton(onClick = {}, enabled = false) {
                    Icon(Icons.Filled.Close, contentDescription = null)
                }
            }
        }
        assertTrue("Accessible content must produce no diagnostics, got $diagnostics", diagnostics.isEmpty())
    }
}
