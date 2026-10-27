package app.orderak.seller.core.ui

import android.app.Application
import androidx.compose.material3.MaterialTheme
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.ui.ExperimentalComposeUiApi
import androidx.compose.ui.autofill.AutofillTree
import androidx.compose.ui.autofill.AutofillType
import androidx.compose.ui.platform.LocalAutofillTree
import androidx.compose.ui.test.assertCountEquals
import androidx.compose.ui.test.hasContentDescription
import androidx.compose.ui.test.junit4.createComposeRule
import androidx.compose.ui.test.onAllNodesWithContentDescription
import androidx.compose.ui.test.onAllNodesWithText
import androidx.compose.ui.text.AnnotatedString
import androidx.compose.ui.text.input.OffsetMapping
import androidx.compose.ui.text.input.TransformedText
import androidx.compose.ui.text.input.VisualTransformation
import androidx.test.ext.junit.runners.AndroidJUnit4
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.annotation.Config
import org.robolectric.annotation.GraphicsMode

/**
 * What sign-in needed from the phone and code fields before it could move onto them: the
 * country's flag, the digits grouped the way the country writes them, the mark for a complete
 * number, and the code that SMS Autofill fills in all at once.
 */
@OptIn(ExperimentalComposeUiApi::class)
@RunWith(AndroidJUnit4::class)
@GraphicsMode(GraphicsMode.Mode.NATIVE)
@Config(sdk = [35], qualifiers = "ar-w411dp-h891dp-xxhdpi", application = Application::class)
class SignInFieldFeaturesTest {
    @get:Rule
    val rule = createComposeRule()

    /** Groups as 3-3-rest, only to prove the field draws what the transformation says. */
    private val grouped = VisualTransformation { text ->
        val d = text.text
        val out = buildString {
            d.forEachIndexed { i, c -> if (i == 3 || i == 6) append(' '); append(c) }
        }
        val toTransformed = IntArray(d.length + 1) { o -> o + (if (o > 6) 2 else if (o > 3) 1 else 0) }
        TransformedText(
            AnnotatedString(out),
            object : OffsetMapping {
                override fun originalToTransformed(offset: Int) = toTransformed[offset.coerceIn(0, d.length)]
                override fun transformedToOriginal(offset: Int) =
                    out.take(offset.coerceIn(0, out.length)).count(Char::isDigit)
            },
        )
    }

    @Test
    fun thePhoneButtonShowsTheFlagBeforeTheDiallingCode() {
        rule.setContent {
            MaterialTheme {
                PhoneField(
                    dialCode = "+20", countryDescription = "مصر", number = "", onNumberChange = {},
                    onPickCountry = {}, label = "رقم الهاتف", flag = "🇪🇬",
                )
            }
        }
        assertTrue(rule.onAllNodesWithText("🇪🇬", substring = true, useUnmergedTree = true).fetchSemanticsNodes().isNotEmpty())
    }

    @Test
    fun theDigitsAreDrawnGroupedAndStayDigitsInWhatIsStored() {
        var stored = ""
        rule.setContent {
            MaterialTheme {
                PhoneField(
                    dialCode = "+20", countryDescription = "مصر", number = "1001234567",
                    onNumberChange = { stored = it }, onPickCountry = {}, label = "رقم الهاتف",
                    visualTransformation = grouped,
                )
            }
        }
        assertTrue(rule.onAllNodesWithText("100 123 4567", substring = true).fetchSemanticsNodes().isNotEmpty())
        assertEquals("", stored)
    }

    @Test
    fun aCompleteNumberGetsAMarkThatIsNamed() {
        rule.setContent {
            MaterialTheme {
                PhoneField(
                    dialCode = "+20", countryDescription = "مصر", number = "1001234567",
                    onNumberChange = {}, onPickCountry = {}, label = "رقم الهاتف",
                    validDescription = "رقم صحيح",
                )
            }
        }
        rule.onAllNodesWithContentDescription("رقم صحيح", useUnmergedTree = true).assertCountEquals(1)
    }

    @Test
    fun theMarkGivesWayToAnError() {
        rule.setContent {
            MaterialTheme {
                PhoneField(
                    dialCode = "+20", countryDescription = "مصر", number = "1001234567",
                    onNumberChange = {}, onPickCountry = {}, label = "رقم الهاتف",
                    validDescription = "رقم صحيح", error = "الرقم غير صحيح",
                )
            }
        }
        rule.onAllNodesWithContentDescription("رقم صحيح", useUnmergedTree = true).assertCountEquals(0)
    }

    @Test
    fun noMarkWithoutADescription() {
        rule.setContent {
            MaterialTheme {
                PhoneField(
                    dialCode = "+20", countryDescription = "مصر", number = "100", onNumberChange = {},
                    onPickCountry = {}, label = "رقم الهاتف",
                )
            }
        }
        rule.onAllNodesWithContentDescription("رقم صحيح", useUnmergedTree = true).assertCountEquals(0)
    }

    @Test
    fun smsAutofillRegistersTheCodeFieldAndFillsAllSixDigits() {
        val tree = AutofillTree()
        var code = ""
        rule.setContent {
            CompositionLocalProvider(LocalAutofillTree provides tree) {
                MaterialTheme { OtpField(value = code, onValueChange = { code = it }, label = "رمز التحقق") }
            }
        }
        rule.waitForIdle()
        val node = tree.children.values.single()
        assertEquals(listOf(AutofillType.SmsOtpCode), node.autofillTypes)
        node.onFill?.invoke("٤٥٦٧٨٩")
        assertEquals("the system's fill reaches the field as Latin digits", "456789", code)
    }

    @Test
    fun smsAutofillIsIgnoredWhileTheCodeIsBeingVerified() {
        val tree = AutofillTree()
        var code = ""
        rule.setContent {
            CompositionLocalProvider(LocalAutofillTree provides tree) {
                MaterialTheme {
                    OtpField(value = code, onValueChange = { code = it }, label = "رمز التحقق", enabled = false)
                }
            }
        }
        rule.waitForIdle()
        tree.children.values.single().onFill?.invoke("123456")
        assertEquals("", code)
        rule.onAllNodes(hasContentDescription("رمز التحقق")).assertCountEquals(1)
    }
}
