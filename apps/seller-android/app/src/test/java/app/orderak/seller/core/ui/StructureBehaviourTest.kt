package app.orderak.seller.core.ui

import android.app.Application
import androidx.compose.foundation.layout.Column
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Home
import androidx.compose.material.icons.outlined.Add
import androidx.compose.material.icons.outlined.Home
import androidx.compose.material.icons.outlined.Notifications
import androidx.compose.material.icons.outlined.Search
import androidx.compose.material.icons.outlined.Share
import androidx.compose.material3.MaterialTheme
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import androidx.compose.ui.semantics.SemanticsProperties
import androidx.compose.ui.semantics.getOrNull
import androidx.compose.ui.test.assertCountEquals
import androidx.compose.ui.test.assertIsEnabled
import androidx.compose.ui.test.assertIsNotEnabled
import androidx.compose.ui.test.junit4.createComposeRule
import androidx.compose.ui.test.onAllNodesWithContentDescription
import androidx.compose.ui.test.onAllNodesWithTag
import androidx.compose.ui.test.onAllNodesWithText
import androidx.compose.ui.test.onNodeWithContentDescription
import androidx.compose.ui.test.onNodeWithTag
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.performClick
import androidx.compose.ui.test.performTextInput
import androidx.test.ext.junit.runners.AndroidJUnit4
import app.orderak.seller.core.money.Money
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.annotation.Config
import org.robolectric.annotation.GraphicsMode

/** What the structure and data components do when a seller uses them, in Arabic. */
@RunWith(AndroidJUnit4::class)
@GraphicsMode(GraphicsMode.Mode.NATIVE)
@Config(sdk = [35], qualifiers = "ar-w411dp-h891dp-xxhdpi", application = Application::class)
class StructureBehaviourTest {
    @get:Rule
    val rule = createComposeRule()

    private fun assertTarget48(description: String) {
        val density = rule.density.density
        val bounds = rule.onNodeWithContentDescription(description).fetchSemanticsNode().touchBoundsInRoot
        assertTrue(
            "$description is ${bounds.width / density}x${bounds.height / density}dp",
            bounds.width >= 48f * density - 0.5f && bounds.height >= 48f * density - 0.5f,
        )
    }

    @Test
    fun theTopBarKeepsAtMostTwoActionsAndEveryIconIsA48dpLabelledTarget() {
        var back = 0
        rule.setContent {
            MaterialTheme {
                TopBar(
                    title = "الطلبات",
                    onBack = { back++ },
                    backDescription = "رجوع",
                    actions = listOf(
                        TopBarAction(Icons.Outlined.Search, "بحث", {}),
                        TopBarAction(Icons.Outlined.Share, "مشاركة", {}),
                        TopBarAction(Icons.Outlined.Notifications, "ثالث", {}),
                    ),
                )
            }
        }
        rule.onNodeWithContentDescription("رجوع").performClick()
        assertEquals(1, back)
        rule.onAllNodesWithContentDescription("ثالث").assertCountEquals(0)
        for (description in listOf("رجوع", "بحث", "مشاركة")) assertTarget48(description)
    }

    @Test
    fun aTitleIsAHeading() {
        rule.setContent { MaterialTheme { TopBar(title = "الطلبات", large = true) } }
        val node = rule.onNodeWithText("الطلبات").fetchSemanticsNode()
        assertTrue(node.config.getOrNull(SemanticsProperties.Heading) != null)
    }

    @Test
    fun theBottomNavShowsEveryLabelMarksTheChosenItemAndCountsInArabicDigits() {
        var selected by mutableStateOf(0)
        rule.setContent {
            MaterialTheme {
                BottomNav(
                    items = listOf(
                        NavItem("اليوم", Icons.Outlined.Home, Icons.Filled.Home),
                        NavItem("الطلبات", Icons.Outlined.Home, Icons.Filled.Home, badge = 3),
                    ),
                    selectedIndex = selected,
                    onSelect = { selected = it },
                )
            }
        }
        rule.onAllNodesWithText("اليوم").assertCountEquals(1)
        rule.onAllNodesWithText("الطلبات").assertCountEquals(1)
        assertTrue(rule.onAllNodesWithText("٣", useUnmergedTree = true).fetchSemanticsNodes().isNotEmpty())
        rule.onNodeWithText("الطلبات").performClick()
        assertEquals(1, selected)
    }

    @Test
    fun aDisabledActionBarSaysWhyOnScreen() {
        var clicks = 0
        rule.setContent {
            MaterialTheme {
                BottomActionBar(
                    primaryLabel = "تسجيل الطلب",
                    onPrimary = { clicks++ },
                    primaryEnabled = false,
                    disabledReason = "أضف منتجًا واحدًا",
                )
            }
        }
        rule.onNodeWithText("تسجيل الطلب").assertIsNotEnabled()
        rule.onAllNodesWithText("أضف منتجًا واحدًا").assertCountEquals(1)
    }

    @Test
    fun anEnabledActionBarCommitsAndShowsItsSummary() {
        var clicks = 0
        rule.setContent {
            MaterialTheme {
                BottomActionBar(
                    primaryLabel = "تسجيل الطلب",
                    onPrimary = { clicks++ },
                    summaryLabel = "الإجمالي",
                    summaryValue = "١٢٥٠",
                    disabledReason = "لن يظهر",
                )
            }
        }
        rule.onNodeWithText("تسجيل الطلب").assertIsEnabled().performClick()
        assertEquals(1, clicks)
        rule.onAllNodesWithText("لن يظهر").assertCountEquals(0)
        rule.onAllNodesWithText("١٢٥٠").assertCountEquals(1)
    }

    @Test
    fun aSectionHeaderIsAHeadingWithACountInArabicDigitsAndA48dpAction() {
        rule.setContent {
            MaterialTheme {
                SectionHeader(title = "آخر الطلبات", count = 12, actionLabel = "عرض الكل", onAction = {})
            }
        }
        assertTrue(rule.onAllNodesWithText("١٢", substring = true).fetchSemanticsNodes().isNotEmpty())
        val node = rule.onNodeWithText("آخر الطلبات", substring = true).fetchSemanticsNode()
        assertTrue(node.config.getOrNull(SemanticsProperties.Heading) != null)
        val density = rule.density.density
        val action = rule.onNodeWithText("عرض الكل").fetchSemanticsNode().touchBoundsInRoot
        assertTrue(action.height >= 48f * density - 0.5f)
    }

    @Test
    fun aMetricTileThatIsNotReadYetIsNotZero() {
        rule.setContent {
            MaterialTheme {
                MetricTile(
                    label = "جديدة",
                    value = null,
                    role = SemanticRole.Info,
                    onClick = {},
                    notReadDescription = "لم تُقرأ بعد",
                )
            }
        }
        rule.onNodeWithContentDescription("جديدة لم تُقرأ بعد").assertIsEnabled()
        rule.onAllNodesWithText("٠").assertCountEquals(0)
        rule.onAllNodesWithText("0").assertCountEquals(0)
    }

    @Test
    fun aMetricTileSpeaksItsCountInArabicDigitsAndOpensWhatItCounts() {
        var opened = 0
        rule.setContent {
            MaterialTheme {
                MetricTile(label = "جديدة", value = 12, role = SemanticRole.Info, onClick = { opened++ })
            }
        }
        rule.onNodeWithContentDescription("جديدة ١٢").performClick()
        assertEquals(1, opened)
    }

    @Test
    fun aCancelledStatusReplacesTheStepper() {
        rule.setContent {
            MaterialTheme {
                Column {
                    StatusStepper(steps = listOf("جديد", "مؤكَّد"), currentIndex = 0, cancelledLabel = "أُلغي هذا الطلب")
                }
            }
        }
        rule.onAllNodesWithText("أُلغي هذا الطلب").assertCountEquals(1)
        rule.onAllNodesWithText("جديد").assertCountEquals(0)
    }

    @Test
    fun theStepperDrawsEveryStep() {
        rule.setContent {
            MaterialTheme { StatusStepper(steps = listOf("جديد", "مؤكَّد", "مدفوع"), currentIndex = 1) }
        }
        for (step in listOf("جديد", "مؤكَّد", "مدفوع")) rule.onAllNodesWithText(step).assertCountEquals(1)
    }

    @Test
    fun aStepListDrawsTitlesAndDetails() {
        rule.setContent {
            MaterialTheme {
                StepList(
                    steps = listOf(
                        StepItem("تم إنشاء المتجر", "رابطك جاهز", done = true),
                        StepItem("أضف أول منتج", "يحتاج العملاء", done = false),
                    ),
                )
            }
        }
        for (text in listOf("تم إنشاء المتجر", "رابطك جاهز", "أضف أول منتج", "يحتاج العملاء")) {
            rule.onAllNodesWithText(text).assertCountEquals(1)
        }
    }

    @Test
    fun moneyAndCountsAreWrittenInArabicIndicDigits() {
        rule.setContent {
            MaterialTheme {
                Column {
                    MoneyText(Money(155000, "EGP"))
                    CountText(value = 1250)
                }
            }
        }
        assertTrue(rule.onAllNodesWithText("١٬٥٥٠", substring = true).fetchSemanticsNodes().isNotEmpty())
        assertTrue(rule.onAllNodesWithText("١٬٢٥٠", substring = true).fetchSemanticsNodes().isNotEmpty())
    }

    @Test
    fun initialsAreTheFirstLettersOfTheFirstTwoWords() {
        assertEquals("NS", initialsOf("Nour Shop"))
        assertEquals("من", initialsOf("متجر نور"))
        assertEquals("A", initialsOf("  Ahmed  "))
        assertEquals("", initialsOf(""))
        assertEquals("AB", initialsOf("Ali Bin Zayed"))
    }

    @Test
    fun theComposerSendsOnlyWhatWasWrittenAndAClosedOneHasNoField() {
        var text by mutableStateOf("")
        var sent = 0
        rule.setContent {
            MaterialTheme {
                Composer(
                    value = text,
                    onValueChange = { text = it },
                    onSend = { sent++ },
                    placeholder = "اكتب رسالة",
                    sendDescription = "إرسال",
                )
            }
        }
        rule.onNodeWithTag("orderak.composer.send").assertIsNotEnabled()
        rule.onNodeWithTag("orderak.composer.input").performTextInput("مرحبًا")
        rule.waitForIdle()
        rule.onNodeWithTag("orderak.composer.send").assertIsEnabled().performClick()
        assertEquals(1, sent)
    }

    @Test
    fun aClosedComposerSaysWhyInsteadOfDrawingAField() {
        rule.setContent {
            MaterialTheme {
                Composer(
                    value = "", onValueChange = {}, onSend = {},
                    placeholder = "اكتب رسالة", sendDescription = "إرسال", closedLabel = "هذه التذكرة مغلقة",
                )
            }
        }
        rule.onAllNodesWithText("هذه التذكرة مغلقة").assertCountEquals(1)
        rule.onAllNodesWithTag("orderak.composer.input").assertCountEquals(0)
    }

    @Test
    fun theSellersBubbleIsAtTheEndOfTheLineWhichIsTheLeftInArabic() {
        rule.setContent {
            MaterialTheme {
                Column {
                    ChatBubble(text = "مرحبًا", mine = false)
                    ChatBubble(text = "لم يصل طلبي", mine = true)
                }
            }
        }
        val theirs = rule.onNodeWithText("مرحبًا").fetchSemanticsNode().boundsInRoot
        val mine = rule.onNodeWithText("لم يصل طلبي").fetchSemanticsNode().boundsInRoot
        assertTrue("mine=$mine theirs=$theirs", mine.center.x < theirs.center.x)
    }

    @Test
    fun aFabCanBeClickedAndNamesItsAction() {
        var clicks = 0
        rule.setContent { MaterialTheme { Fab(label = "طلب جديد", icon = Icons.Outlined.Add, onClick = { clicks++ }) } }
        rule.onNodeWithText("طلب جديد").performClick()
        assertEquals(1, clicks)
    }
}
