package app.orderak.seller.core.ui

import android.app.Application
import androidx.compose.material3.MaterialTheme
import androidx.compose.ui.test.assertCountEquals
import androidx.compose.ui.test.junit4.createComposeRule
import androidx.compose.ui.test.onAllNodesWithText
import androidx.test.ext.junit.runners.AndroidJUnit4
import org.junit.Assert.assertEquals
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.annotation.Config
import org.robolectric.annotation.GraphicsMode

/**
 * The picker finds an Arabic name however the seller spells the alef, the teh
 * marbuta and the vowel marks. If it did not, typing «الاسكندرية» would show no
 * match and offer the manual entry for a city the list already has.
 */
@RunWith(AndroidJUnit4::class)
@GraphicsMode(GraphicsMode.Mode.NATIVE)
@Config(sdk = [35], qualifiers = "ar-w411dp-h891dp-xxhdpi", application = Application::class)
class SheetPickerSearchTest {
    @get:Rule
    val rule = createComposeRule()

    private val cities = listOf(
        PickerOption("1", "الإسكندرية"),
        PickerOption("2", "القاهرة"),
        PickerOption("3", "طنطا"),
    )

    private fun show(query: String) {
        rule.setContent {
            MaterialTheme {
                PickerSheet(
                    mode = PickerSheetMode.SearchableWithManualEntry,
                    title = "t",
                    options = cities,
                    selectedKey = null,
                    onSelect = {},
                    closeLabel = "close",
                    onClose = {},
                    query = query,
                    searchPlaceholder = "search",
                    noResultsLabel = "no match",
                    manualEntryLabel = "use as entered",
                )
            }
        }
        rule.waitForIdle()
    }

    @Test
    fun aBareAlefFindsTheAlefWithHamza() {
        show("الاسكندرية")
        rule.onAllNodesWithText("الإسكندرية").assertCountEquals(1)
        rule.onAllNodesWithText("use as entered").assertCountEquals(0)
        rule.onAllNodesWithText("no match").assertCountEquals(0)
    }

    @Test
    fun aTehMarbutaTypedAsHehStillMatches() {
        show("القاهره")
        rule.onAllNodesWithText("القاهرة").assertCountEquals(1)
        rule.onAllNodesWithText("use as entered").assertCountEquals(0)
    }

    @Test
    fun aNameTheListDoesNotHaveStillOffersTheManualEntry() {
        show("قنا")
        rule.onAllNodesWithText("use as entered").assertCountEquals(1)
        rule.onAllNodesWithText("no match").assertCountEquals(1)
    }

    @Test
    fun theComparisonFormDropsVowelMarksAndTatweel() {
        assertEquals(searchForm("مُحَمَّد"), searchForm("محمد"))
        assertEquals(searchForm("كـتاب"), searchForm("كتاب"))
    }
}
