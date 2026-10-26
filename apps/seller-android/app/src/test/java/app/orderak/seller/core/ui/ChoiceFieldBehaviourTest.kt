package app.orderak.seller.core.ui

import android.app.Application
import androidx.compose.material3.MaterialTheme
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.semantics.SemanticsProperties
import androidx.compose.ui.semantics.getOrNull
import androidx.compose.ui.test.assertCountEquals
import androidx.compose.ui.test.assertIsEnabled
import androidx.compose.ui.test.assertIsNotEnabled
import androidx.compose.ui.test.junit4.createComposeRule
import androidx.compose.ui.test.onAllNodesWithTag
import androidx.compose.ui.test.onAllNodesWithText
import androidx.compose.ui.test.onNodeWithTag
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.performClick
import androidx.test.ext.junit.runners.AndroidJUnit4
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.annotation.Config
import org.robolectric.annotation.GraphicsMode

/**
 * What the choice controls do when a seller uses them, in Arabic.
 */
@RunWith(AndroidJUnit4::class)
@GraphicsMode(GraphicsMode.Mode.NATIVE)
@Config(sdk = [35], qualifiers = "ar-w411dp-h891dp-xxhdpi", application = Application::class)
class ChoiceFieldBehaviourTest {
    @get:Rule
    val rule = createComposeRule()

    @Test
    fun theStepperStopsAtItsBoundsAndDisablesTheButtonThereBeforeItIsTapped() {
        var value by mutableIntStateOf(1)
        rule.setContent {
            MaterialTheme {
                Stepper(
                    value = value,
                    onValueChange = { value = it },
                    decreaseDescription = "إنقاص",
                    increaseDescription = "زيادة",
                    max = 2,
                )
            }
        }
        rule.onNodeWithTag("orderak.stepper.plus").performClick()
        assertEquals(2, value)
        rule.onNodeWithTag("orderak.stepper.plus").assertIsNotEnabled()
        rule.onNodeWithTag("orderak.stepper.minus").assertIsEnabled().performClick().performClick()
        assertEquals(0, value)
        rule.onNodeWithTag("orderak.stepper.minus").assertIsNotEnabled()
    }

    @Test
    fun theStepperDrawsItsValueInArabicIndicDigitsAndEachButtonIsA48dpTarget() {
        rule.setContent {
            MaterialTheme {
                Stepper(
                    value = 12,
                    onValueChange = {},
                    decreaseDescription = "إنقاص",
                    increaseDescription = "زيادة",
                )
            }
        }
        assertTrue(rule.onAllNodesWithText("١٢", substring = true).fetchSemanticsNodes().isNotEmpty())
        val density = rule.density.density
        for (tag in listOf("orderak.stepper.minus", "orderak.stepper.plus")) {
            val bounds = rule.onNodeWithTag(tag).fetchSemanticsNode().touchBoundsInRoot
            assertTrue("$tag is ${bounds.width / density}x${bounds.height / density}dp", bounds.width >= 48f * density - 0.5f && bounds.height >= 48f * density - 0.5f)
        }
    }

    @Test
    fun aSelectFieldIsOneTargetThatNamesTheLabelAndTheValue() {
        var clicks = 0
        rule.setContent {
            MaterialTheme { SelectField(label = "المدينة", value = "طنطا", onClick = { clicks++ }) }
        }
        rule.onNodeWithTag("orderak.select").performClick()
        assertEquals(1, clicks)
        val description = rule.onNodeWithTag("orderak.select").fetchSemanticsNode()
            .config.getOrNull(SemanticsProperties.ContentDescription)
        assertEquals(listOf("المدينة طنطا"), description)
    }

    @Test
    fun aDisabledSelectFieldCannotBeOpened() {
        var clicks = 0
        rule.setContent {
            MaterialTheme { SelectField(label = "المدينة", value = "", onClick = { clicks++ }, enabled = false) }
        }
        rule.onNodeWithTag("orderak.select").assertIsNotEnabled()
    }

    @Test
    fun aSwitchRowTogglesFromAnywhereInTheRow() {
        var on by mutableStateOf(false)
        rule.setContent {
            MaterialTheme {
                SwitchRow(
                    label = "إظهار في المتجر",
                    checked = on,
                    onCheckedChange = { on = it },
                    helper = "يستطيع العملاء رؤيته",
                )
            }
        }
        rule.onNodeWithText("إظهار في المتجر").performClick()
        assertTrue(on)
        rule.onNodeWithText("يستطيع العملاء رؤيته").performClick()
        assertTrue(!on)
    }

    @Test
    fun aSegmentedChoiceSelectsTheTappedSegment() {
        var selected by mutableIntStateOf(0)
        rule.setContent {
            MaterialTheme {
                SegmentedChoice(
                    options = listOf("نقدًا", "إنستاباي", "محفظة إلكترونية"),
                    selectedIndex = selected,
                    onSelect = { selected = it },
                )
            }
        }
        rule.onNodeWithText("إنستاباي").performClick()
        assertEquals(1, selected)
        val selectedNode = rule.onNodeWithText("إنستاباي").fetchSemanticsNode()
        assertTrue(
            "the chosen segment is exposed as selected",
            selectedNode.config.getOrNull(SemanticsProperties.Selected) == true ||
                selectedNode.parent?.config?.getOrNull(SemanticsProperties.Selected) == true,
        )
    }

    @Test
    fun aCheckboxRowTogglesAndShowsItsErrorAsTheSemanticError() {
        var checked by mutableStateOf(false)
        rule.setContent {
            MaterialTheme {
                CheckboxRow(
                    label = "أؤكد أن عمري 18 عامًا",
                    checked = checked,
                    onCheckedChange = { checked = it },
                    error = "أكّد للمتابعة",
                    modifier = Modifier.testTag("age"),
                )
            }
        }
        rule.onAllNodesWithText("أكّد للمتابعة").assertCountEquals(1)
        rule.onNodeWithText("أؤكد أن عمري 18 عامًا").performClick()
        assertTrue(checked)
    }

    @Test
    fun theFilterChipRowSelectsAChipAndOpensTheSheetFromTheLastOne() {
        var selected by mutableIntStateOf(0)
        var more = 0
        rule.setContent {
            MaterialTheme {
                FilterChipRow(
                    options = listOf("الكل", "جديدة", "غير مدفوعة"),
                    selectedIndex = selected,
                    onSelect = { selected = it },
                    moreLabel = "المزيد",
                    onMore = { more++ },
                )
            }
        }
        rule.onNodeWithText("جديدة").performClick()
        assertEquals(1, selected)
        rule.onNodeWithTag("orderak.chips.more").performClick()
        assertEquals(1, more)
    }

    @Test
    fun anImagePickerOffersRetryOnlyWhenTheUploadFailed() {
        var retries = 0
        var state by mutableStateOf(ImagePickerState.Uploading)
        rule.setContent {
            MaterialTheme {
                ImagePickerTile(
                    state = state,
                    label = "صورة المنتج",
                    addLabel = "إضافة صورة",
                    onPick = {},
                    progress = 0.5f,
                    uploadingLabel = "جارٍ الرفع",
                    failedLabel = "تعذّر رفع الصورة",
                    retryLabel = "إعادة المحاولة",
                    onRetry = { retries++ },
                )
            }
        }
        rule.onAllNodesWithTag("orderak.image.retry").assertCountEquals(0)
        rule.onAllNodesWithTag("orderak.image.progress").assertCountEquals(1)
        rule.onNodeWithTag("orderak.image.tile").assertIsNotEnabled()
        state = ImagePickerState.FailedWithRetry
        rule.waitForIdle()
        rule.onNodeWithTag("orderak.image.retry").performClick()
        assertEquals(1, retries)
        rule.onAllNodesWithTag("orderak.image.progress").assertCountEquals(0)
    }
}
