package app.orderak.seller.core.ui

import android.app.Application
import androidx.compose.foundation.layout.Column
import androidx.compose.material3.MaterialTheme
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.semantics.SemanticsProperties
import androidx.compose.ui.semantics.getOrNull
import androidx.compose.ui.test.assertCountEquals
import androidx.compose.ui.test.assertIsEnabled
import androidx.compose.ui.test.assertIsNotEnabled
import androidx.compose.ui.test.hasContentDescription
import androidx.compose.ui.test.junit4.createComposeRule
import androidx.compose.ui.test.onAllNodesWithTag
import androidx.compose.ui.test.onAllNodesWithText
import androidx.compose.ui.test.onNodeWithTag
import androidx.compose.ui.test.performClick
import androidx.compose.ui.test.performTextInput
import androidx.test.ext.junit.runners.AndroidJUnit4
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.annotation.Config
import org.robolectric.annotation.GraphicsMode

/**
 * What the fields do when a seller uses them, in Arabic: the language they are
 * built for, and the one where digits and direction go wrong.
 */
@RunWith(AndroidJUnit4::class)
@GraphicsMode(GraphicsMode.Mode.NATIVE)
@Config(sdk = [35], qualifiers = "ar-w411dp-h891dp-xxhdpi", application = Application::class)
class InputFieldBehaviourTest {
    @get:Rule
    val rule = createComposeRule()

    @Test
    fun aRequiredFieldMarksItsLabel() {
        rule.setContent {
            MaterialTheme { TextField(value = "", onValueChange = {}, label = "الاسم", required = true) }
        }
        assertTrue(rule.onAllNodesWithText("الاسم *", substring = true).fetchSemanticsNodes().isNotEmpty())
    }

    @Test
    fun anErrorReplacesTheHelperAndIsTheFieldsSemanticError() {
        rule.setContent {
            MaterialTheme {
                TextField(
                    value = "",
                    onValueChange = {},
                    label = "الاسم",
                    helper = "يراه عملاؤك",
                    error = "أدخل الاسم",
                    modifier = Modifier.testTag("field"),
                )
            }
        }
        rule.onAllNodesWithText("يراه عملاؤك").assertCountEquals(0)
        rule.onAllNodesWithText("أدخل الاسم").assertCountEquals(1)
        val node = rule.onNodeWithTag("field").fetchSemanticsNode()
        assertEquals("أدخل الاسم", node.config.getOrNull(SemanticsProperties.Error))
    }

    @Test
    fun theCounterUsesTheLocalesDigitsAndTheFieldStopsAtTheLimit() {
        var text by mutableStateOf("")
        rule.setContent {
            MaterialTheme {
                TextField(
                    value = text,
                    onValueChange = { text = it },
                    label = "الاسم",
                    maxLength = 5,
                    modifier = Modifier.testTag("field"),
                )
            }
        }
        rule.onNodeWithTag("field").performTextInput("abcdefgh")
        rule.waitForIdle()
        assertTrue("typing past the limit must not grow the text: $text", text.length <= 5)
        assertTrue(
            "the counter is written in Arabic-Indic digits",
            rule.onAllNodesWithText("/٥", substring = true).fetchSemanticsNodes().isNotEmpty(),
        )
    }

    @Test
    fun aDisabledFieldCannotBeEdited() {
        rule.setContent {
            MaterialTheme {
                TextField(
                    value = "x",
                    onValueChange = {},
                    label = "الاسم",
                    enabled = false,
                    modifier = Modifier.testTag("field"),
                )
            }
        }
        rule.onNodeWithTag("field").assertIsNotEnabled()
    }

    @Test
    fun leavingAFieldCallsOnLeaveOnce() {
        var left = 0
        rule.setContent {
            MaterialTheme {
                Column {
                    TextField(
                        value = "",
                        onValueChange = {},
                        label = "أ",
                        onLeave = { left++ },
                        modifier = Modifier.testTag("a"),
                    )
                    TextField(
                        value = "",
                        onValueChange = {},
                        label = "ب",
                        modifier = Modifier.testTag("b"),
                    )
                }
            }
        }
        rule.onNodeWithTag("a").performClick()
        rule.waitForIdle()
        assertEquals(0, left)
        rule.onNodeWithTag("b").performClick()
        rule.waitForIdle()
        assertEquals(1, left)
    }

    @Test
    fun theMoneyFieldTakesArabicDigitsAndReportsCanonicalText() {
        var value by mutableStateOf("")
        rule.setContent {
            MaterialTheme {
                MoneyField(
                    value = value,
                    onValueChange = { value = it },
                    label = "السعر",
                    currency = "ج.م",
                    fractionDigits = 2,
                    modifier = Modifier.testTag("price"),
                )
            }
        }
        rule.onNodeWithTag("price").performTextInput("١٢٫٥٥٥")
        rule.waitForIdle()
        assertEquals("12.55", value)
    }

    @Test
    fun theMoneyFieldDrawsTheAmountInArabicIndicDigits() {
        rule.setContent {
            MaterialTheme {
                MoneyField(
                    value = "1250.5",
                    onValueChange = {},
                    label = "السعر",
                    currency = "ج.م",
                    fractionDigits = 2,
                )
            }
        }
        assertTrue(
            "the amount must be drawn as ١٢٥٠٫٥",
            rule.onAllNodesWithText("١٢٥٠٫٥", substring = true).fetchSemanticsNodes().isNotEmpty(),
        )
        assertTrue(rule.onAllNodesWithText("ج.م", substring = true).fetchSemanticsNodes().isNotEmpty())
    }

    @Test
    fun thePhoneFieldTakesLatinDigitsOnlyAndItsCountryButtonIsATarget() {
        var number by mutableStateOf("")
        var picked = 0
        rule.setContent {
            MaterialTheme {
                PhoneField(
                    dialCode = "+20",
                    countryDescription = "مصر",
                    number = number,
                    onNumberChange = { number = it },
                    onPickCountry = { picked++ },
                    label = "رقم الهاتف",
                )
            }
        }
        rule.onNodeWithTag("orderak.phone.number").performTextInput("١٠١ 234")
        rule.waitForIdle()
        assertEquals("101234", number)
        rule.onNodeWithTag("orderak.phone.country").assertIsEnabled().performClick()
        assertEquals(1, picked)
        val bounds = rule.onNodeWithTag("orderak.phone.country").fetchSemanticsNode().boundsInRoot
        val density = rule.density.density
        assertTrue(
            "the country button is at least 48dp tall: ${bounds.height / density}dp",
            bounds.height >= 48f * density,
        )
    }

    @Test
    fun thePhoneFieldPutsTheCountryButtonBeforeTheNumberOnTheLeft() {
        rule.setContent {
            MaterialTheme {
                PhoneField(
                    dialCode = "+20",
                    countryDescription = "مصر",
                    number = "1012345678",
                    onNumberChange = {},
                    onPickCountry = {},
                    label = "رقم الهاتف",
                )
            }
        }
        val country = rule.onNodeWithTag("orderak.phone.country").fetchSemanticsNode().boundsInRoot
        val number = rule.onNodeWithTag("orderak.phone.number").fetchSemanticsNode().boundsInRoot
        assertTrue("the whole field is left to right: $country $number", country.left < number.left)
    }

    @Test
    fun theOtpFieldHasSixCellsLeftToRightAndTakesOnlyDigits() {
        var code by mutableStateOf("")
        rule.setContent {
            MaterialTheme { OtpField(value = code, onValueChange = { code = it }, label = "رمز التحقق") }
        }
        val cells = rule.onAllNodesWithTag("orderak.otp.cell", useUnmergedTree = true).fetchSemanticsNodes()
        assertEquals(6, cells.size)
        val lefts = cells.map { it.boundsInRoot.left }
        assertEquals("the cells run left to right even in Arabic", lefts.sorted(), lefts)
        rule.onNode(hasContentDescription("رمز التحقق")).performTextInput("١٢a٣٤٥٦٧٨")
        rule.waitForIdle()
        assertEquals("only digits, at most six", "123456", code)
    }

    @Test
    fun anOtpErrorIsShownAndIsTheFieldsSemanticError() {
        rule.setContent {
            MaterialTheme {
                OtpField(value = "482913", onValueChange = {}, label = "رمز التحقق", error = "الرمز غير صحيح")
            }
        }
        rule.onAllNodesWithText("الرمز غير صحيح").assertCountEquals(1)
        val node = rule.onNode(hasContentDescription("رمز التحقق")).fetchSemanticsNode()
        assertEquals("الرمز غير صحيح", node.config.getOrNull(SemanticsProperties.Error))
    }
}
