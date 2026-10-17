package app.orderak.seller.a11y

import android.app.Application
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.padding
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.test.junit4.createComposeRule
import androidx.compose.ui.text.LinkAnnotation
import androidx.compose.ui.text.buildAnnotatedString
import androidx.compose.ui.text.withLink
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
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
class InlineLinkTargetNotExemptTest {

    @get:Rule
    val rule = createComposeRule()

    @Test
    fun shortInlineLinkIsStillCheckedByTheTargetRule() {
        rule.setContent {
            MaterialTheme {
                Box(Modifier.fillMaxSize().background(Color.White).padding(24.dp)) {
                    Text(
                        buildAnnotatedString {
                            append("Read the ")
                            withLink(LinkAnnotation.Url("https://example.com/terms")) { append("terms") }
                        },
                        color = Color.Black,
                        fontSize = 14.sp,
                    )
                }
            }
        }
        rule.waitForIdle()
        val diagnostics = auditAccessibility(rule, "proofSmallInlineLink")
        assertTrue(
            "A one-line inline link is an actionable node under 48dp and must get a Target diagnostic, got $diagnostics",
            diagnostics.any { "Target" in it && "proofSmallInlineLink" in it },
        )
    }
}
