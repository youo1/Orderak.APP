package app.orderak.seller.a11y

import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.offset
import androidx.compose.material3.Text
import androidx.compose.ui.Modifier
import androidx.compose.ui.test.junit4.createComposeRule
import androidx.compose.ui.unit.dp
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertTrue
import org.junit.Rule
import org.junit.Test

class OutOfImageTextCropTest {
    @get:Rule
    val rule = createComposeRule()

    @Test
    fun nonZeroTextOutsideCapturedImageFailsWithContext() {
        rule.setContent {
            Box(Modifier.fillMaxSize()) {
                Text("offscreen text", Modifier.offset(x = 10000.dp))
            }
        }
        rule.waitForIdle()

        val failure = try {
            val diagnostics = auditAccessibility(rule, "proofOutOfImageText")
            diagnostics.takeIf { it.isNotEmpty() }?.joinToString("\n")
        } catch (error: AssertionError) {
            error.message
        }
        assertNotNull("Expected an out-of-image text crop audit failure", failure)
        assertTrue(failure.orEmpty().contains("proofOutOfImageText"))
        assertTrue(failure.orEmpty().contains("offscreen text"))
    }
}
