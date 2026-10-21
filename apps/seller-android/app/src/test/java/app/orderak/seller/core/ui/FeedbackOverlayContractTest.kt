package app.orderak.seller.core.ui

import android.app.Application
import androidx.compose.foundation.layout.padding
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.test.junit4.createComposeRule
import androidx.compose.ui.unit.sp
import androidx.compose.ui.window.Dialog
import androidx.test.ext.junit.runners.AndroidJUnit4
import app.orderak.seller.a11y.auditAccessibility
import org.junit.Assert.assertTrue
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.annotation.Config
import org.robolectric.annotation.GraphicsMode

/**
 * Locked acceptance checks for R1a's first deliverable: the B4 accessibility
 * audit must discover and measure real pixels inside a dialog/sheet WINDOW, not
 * just the activity root behind it. `AccessibilityPreviewAuditTest.kt` already
 * carries ten excused 'CD' (dialog window not captured) findings for
 * ProductEditScreenshotTestKt's confirm-delete and stock-conflict dialogs —
 * evidence that today's capture of dialog-window text is broken rather than
 * merely unexercised. These two proofs call the same public `auditAccessibility`
 * entry point directly against a plain Dialog, independent of any new R1a
 * component's (not yet fixed) API.
 */
@RunWith(AndroidJUnit4::class)
@GraphicsMode(GraphicsMode.Mode.NATIVE)
@Config(sdk = [35], qualifiers = "ar-w411dp-h891dp-xxhdpi", application = Application::class)
class FeedbackOverlayContractTest {

    @get:Rule
    val rule = createComposeRule()

    private val measuredContrast = Regex("""Contrast: .*measured \d+\.\d{2}:1, below \d+\.\d{2}:1""")

    @Test
    fun lowContrastDialogTextProducesAMeasuredContrastFinding() {
        rule.setContent {
            MaterialTheme {
                Dialog(onDismissRequest = {}) {
                    Surface(color = Color.White) {
                        Text(
                            "Faint dialog text",
                            color = Color(0xFFBBBBBB),
                            fontSize = 16.sp,
                            modifier = Modifier.padding(24.dp),
                        )
                    }
                }
            }
        }
        rule.waitForIdle()
        val diagnostics = auditAccessibility(rule, "proofDialogLowContrast")
        assertTrue(
            "Expected a measured Contrast finding for text inside a Dialog window, got $diagnostics",
            diagnostics.any { "proofDialogLowContrast" in it && measuredContrast.containsMatchIn(it) },
        )
    }

    @Test
    fun compliantDialogTextProducesNoFinding() {
        rule.setContent {
            MaterialTheme {
                Dialog(onDismissRequest = {}) {
                    Surface(color = Color.White) {
                        Text(
                            "Readable dialog text",
                            color = Color.Black,
                            fontSize = 16.sp,
                            modifier = Modifier.padding(24.dp),
                        )
                    }
                }
            }
        }
        rule.waitForIdle()
        val diagnostics = auditAccessibility(rule, "controlDialogContrast")
        assertTrue(
            "Compliant dialog text must produce no diagnostics, got $diagnostics",
            diagnostics.none { "controlDialogContrast" in it },
        )
    }
}
