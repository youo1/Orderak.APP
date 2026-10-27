package app.orderak.seller.a11y

import android.app.Application
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.ScrollState
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.foundation.layout.padding
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.test.junit4.createComposeRule
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.compose.ui.window.Dialog
import androidx.test.ext.junit.runners.AndroidJUnit4
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.annotation.Config
import org.robolectric.annotation.GraphicsMode

/**
 * Locked acceptance checks for the audit's reach into dialog and sheet windows.
 *
 * A Compose `Dialog` is its own window with its own semantics root and its own
 * pixels. The audit has to find it, measure its text against its own pixels and
 * name the preview and the locale in what it reports. The control is a dialog
 * whose text is compliant: it must report nothing, so an audit that fails every
 * dialog cannot satisfy the proof.
 */
@RunWith(AndroidJUnit4::class)
@GraphicsMode(GraphicsMode.Mode.NATIVE)
@Config(sdk = [35], qualifiers = "ar-w411dp-h891dp-xxhdpi", application = Application::class)
class AccessibilityAuditWindowsAcceptanceTest {

    @get:Rule
    val rule = createComposeRule()

    private fun audit(preview: String, content: @Composable () -> Unit): List<String> {
        rule.setContent {
            MaterialTheme {
                Box(Modifier.fillMaxSize().background(Color.White).padding(24.dp)) {
                    Text("Screen text", color = Color.Black, fontSize = 16.sp)
                    content()
                }
            }
        }
        rule.waitForIdle()
        return auditAccessibility(rule, preview)
    }

    @Test
    fun dialogTextWithFailingContrastIsMeasuredAndNamed() {
        // #BBBBBB on white is about 1.9:1.
        val diagnostics = audit("proofDialogFaintText") {
            Dialog(onDismissRequest = {}) {
                Surface(color = Color.White) {
                    Column(Modifier.padding(24.dp)) {
                        Text("Dialog faint text", color = Color(0xFFBBBBBB), fontSize = 16.sp)
                    }
                }
            }
        }
        val finding = diagnostics.firstOrNull {
            "Contrast" in it && "Dialog faint text" in it && "measured" in it
        }
        assertTrue("Expected a measured Contrast finding for the dialog text, got $diagnostics", finding != null)
        assertTrue("The finding must name the preview: $finding", "proofDialogFaintText" in finding!!)
        assertTrue("The finding must name the locale: $finding", "[ar" in finding)
    }

    @Test
    fun dialogTextWithEnoughContrastReportsNothing() {
        val diagnostics = audit("controlDialogReadableText") {
            Dialog(onDismissRequest = {}) {
                Surface(color = Color.White) {
                    Column(Modifier.padding(24.dp)) {
                        Text("Dialog readable text", color = Color.Black, fontSize = 16.sp)
                    }
                }
            }
        }
        assertTrue("A compliant dialog must produce no diagnostics, got $diagnostics", diagnostics.isEmpty())
    }

    @Test
    fun aWindowThatCannotBeCapturedIsNeverPassed() {
        // The same compliant dialog, but the harness cannot read the window's
        // pixels. Non-empty text in an uncaptured window is a finding, not a pass.
        rule.setContent {
            MaterialTheme {
                Box(Modifier.fillMaxSize().background(Color.White)) {
                    Dialog(onDismissRequest = {}) {
                        Surface(color = Color.White) {
                            Text("Dialog readable text", color = Color.Black, fontSize = 16.sp)
                        }
                    }
                }
            }
        }
        rule.waitForIdle()
        // Reached by reflection so this file compiles on a tree that has no
        // capture hook yet and fails by assertion there.
        val entry = Class.forName("app.orderak.seller.a11y.AccessibilityPreviewAuditTestKt")
            .declaredMethods
            .firstOrNull { it.name == "auditAccessibility" && it.parameterCount == 3 }
        assertTrue("auditAccessibility must accept a window-capture function", entry != null)
        val neverCaptured: (Any?) -> Any? = { null }
        @Suppress("UNCHECKED_CAST")
        val diagnostics = entry!!.invoke(null, rule, "proofUncapturedWindow", neverCaptured) as List<String>
        assertTrue(
            "Expected a finding for the uncaptured window, got $diagnostics",
            diagnostics.any { "Contrast" in it && "not captured" in it && "proofUncapturedWindow" in it },
        )
    }

    @Test
    fun faintTextBelowTheFoldIsScrolledIntoViewAndMeasured() {
        val diagnostics = audit("proofBelowTheFold") {
            Column(Modifier.fillMaxSize().verticalScroll(rememberScrollState())) {
                Spacer(Modifier.height(2000.dp))
                Text("Faint text below the fold", color = Color(0xFFBBBBBB), fontSize = 16.sp)
            }
        }
        val finding = diagnostics.firstOrNull { "Faint text below the fold" in it }
        assertTrue("Expected a finding for the text below the fold, got $diagnostics", finding != null)
        assertTrue("The text must be measured, not skipped: $finding", "measured" in finding!!)
    }

    @Test
    fun readableTextBelowTheFoldReportsNothing() {
        val diagnostics = audit("controlBelowTheFold") {
            Column(Modifier.fillMaxSize().verticalScroll(rememberScrollState())) {
                Spacer(Modifier.height(2000.dp))
                Text("Readable text below the fold", color = Color.Black, fontSize = 16.sp)
            }
        }
        assertTrue("Readable text below the fold must pass, got $diagnostics", diagnostics.isEmpty())
    }

    @Test
    fun aRowHalfScrolledUnderAPinnedButtonDoesNotOverlapIt() {
        // The scroll container clips its rows: the bottom row runs 24dp under the
        // pinned button in layout terms, but that part cannot be touched.
        val diagnostics = audit("controlClippedRow") {
            Column(Modifier.fillMaxSize()) {
                Column(Modifier.weight(1f).verticalScroll(rememberScrollState())) {
                    repeat(30) { index ->
                        Box(Modifier.fillMaxWidth().height(48.dp).clickable {}) {
                            Text("Row $index", color = Color.Black, fontSize = 16.sp)
                        }
                    }
                }
                Box(Modifier.fillMaxWidth().height(48.dp).clickable {}) {
                    Text("Pinned", color = Color.Black, fontSize = 16.sp)
                }
            }
        }
        assertTrue("A clipped row must not overlap the pinned button, got $diagnostics", diagnostics.none { "Target" in it })
    }

    @Test
    fun theScrollContainerGoesBackWhereItWasAfterTheAudit() {
        val scroll = ScrollState(0)
        val diagnostics = audit("proofScrollRestored") {
            Column(Modifier.fillMaxSize().verticalScroll(scroll)) {
                Spacer(Modifier.height(2000.dp))
                Text("Readable text far below", color = Color.Black, fontSize = 16.sp)
            }
        }
        assertTrue("Readable text must pass, got $diagnostics", diagnostics.isEmpty())
        assertEquals("The container must be back at the top after the audit", 0, scroll.value)
    }

    @Test
    fun textOnlyPartlyInTheFrameIsMeasuredWhole() {
        // The text starts a few dp above the bottom edge of the scroll area: a sliver
        // of it shows. The audit must scroll it fully into view and measure the
        // whole label, not the sliver.
        val diagnostics = audit("proofPartlyVisible") {
            Column(Modifier.fillMaxSize().verticalScroll(rememberScrollState())) {
                Spacer(Modifier.height(835.dp))
                Text("Faint text half in view", color = Color(0xFFBBBBBB), fontSize = 16.sp)
            }
        }
        val finding = diagnostics.firstOrNull { "Faint text half in view" in it }
        assertTrue("Expected a finding, got $diagnostics", finding != null)
        val box = Regex("""fromLTRB\(([\d.]+), ([\d.]+), ([\d.]+), ([\d.]+)\)""").find(finding!!)
        assertTrue("The finding must carry the bounds it measured: $finding", box != null)
        val height = box!!.groupValues[4].toFloat() - box.groupValues[2].toFloat()
        assertTrue("A 16sp line is at least 48px tall at 3x, but the finding measured $height: $finding", height >= 48f)
    }
}
