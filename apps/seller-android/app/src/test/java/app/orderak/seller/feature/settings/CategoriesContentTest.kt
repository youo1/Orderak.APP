package app.orderak.seller.feature.settings

import android.app.Application
import androidx.compose.material3.MaterialTheme
import androidx.compose.ui.test.assertCountEquals
import androidx.compose.ui.test.assertIsNotEnabled
import androidx.compose.ui.test.junit4.createComposeRule
import androidx.compose.ui.test.onAllNodesWithText
import androidx.compose.ui.test.onNodeWithContentDescription
import androidx.compose.ui.test.onNodeWithTag
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.performClick
import androidx.compose.ui.test.performTextInput
import androidx.test.core.app.ApplicationProvider
import androidx.test.ext.junit.runners.AndroidJUnit4
import app.orderak.seller.R
import app.orderak.seller.core.ui.PlanUsageRow
import app.orderak.seller.data.billing.FeatureKeys
import app.orderak.seller.data.remote.CategoryDto
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.annotation.Config
import org.robolectric.annotation.GraphicsMode

/** التصنيفات, in Arabic: a list, one bar to add, and sheets for the rest. */
@RunWith(AndroidJUnit4::class)
@GraphicsMode(GraphicsMode.Mode.NATIVE)
@Config(sdk = [35], qualifiers = "ar-w411dp-h891dp-xxhdpi", application = Application::class)
class CategoriesContentTest {
    @get:Rule
    val rule = createComposeRule()

    private val application: Application get() = ApplicationProvider.getApplicationContext()
    private fun string(id: Int, vararg args: Any) = application.getString(id, *args)

    private val list = listOf(
        CategoryDto(category_code = "c-1", name = "إكسسوارات", product_count = 6),
        CategoryDto(category_code = "c-2", name = "عبايات", product_count = 0),
    )
    private val created = mutableListOf<String>()
    private val renamed = mutableListOf<Pair<String, String>>()
    private val deleted = mutableListOf<String>()
    private var limit = 0
    private var retries = 0

    private fun show(
        categories: List<CategoryDto>?,
        error: String? = null,
        meter: PlanUsageRow? = null,
        loading: Boolean = false,
    ) {
        rule.setContent {
            MaterialTheme {
                CategoriesContent(
                    categories = categories,
                    loading = loading,
                    error = error,
                    busy = false,
                    storeUrl = "https://orderak.app/EG-shop",
                    purchaseOpen = false,
                    meter = meter,
                    onCreate = { created += it },
                    onRename = { c, n -> renamed += c to n },
                    onDelete = { deleted += it },
                    onLimitReached = { limit++ },
                    onCopyLink = {},
                    onShareLink = {},
                    onRetry = { retries++ },
                    onBack = {},
                )
            }
        }
    }

    @Test
    fun eachRowSaysHowManyProductsAreFiledUnderIt() {
        show(list)
        assertTrue(rule.onAllNodesWithText("٦ منتجات", substring = true).fetchSemanticsNodes().isNotEmpty())
        assertTrue(rule.onAllNodesWithText(string(R.string.categories_title)).fetchSemanticsNodes().isNotEmpty())
    }

    @Test
    fun theBarOpensTheAddSheetAndSavingReportsTheTrimmedName() {
        show(list)
        rule.onNodeWithText(string(R.string.categories_add_bar)).performClick()
        rule.waitForIdle()
        rule.onNodeWithText(string(R.string.categories_field), substring = true).performTextInput("  حقائب ")
        rule.onNodeWithText(string(R.string.product_save_bar)).performClick()
        rule.waitForIdle()
        assertEquals(listOf("حقائب"), created)
    }

    @Test
    fun saveWaitsForAName() {
        show(list)
        rule.onNodeWithText(string(R.string.categories_add_bar)).performClick()
        rule.waitForIdle()
        rule.onNodeWithText(string(R.string.product_save_bar)).assertIsNotEnabled()
    }

    @Test
    fun theRowOverflowOffersRenameAndDeleteAndRenameSeedsTheName() {
        show(list)
        rule.onNodeWithContentDescription(string(R.string.categories_row_more, "إكسسوارات")).performClick()
        rule.waitForIdle()
        rule.onNodeWithText(string(R.string.category_rename)).performClick()
        rule.waitForIdle()
        assertTrue(rule.onAllNodesWithText("إكسسوارات", substring = true).fetchSemanticsNodes().isNotEmpty())
        rule.onNodeWithText(string(R.string.product_save_bar)).assertIsNotEnabled() // unchanged name
    }

    @Test
    fun deletingNamesTheCategoryAndHowManyProductsLoseIt() {
        show(list)
        rule.onNodeWithContentDescription(string(R.string.categories_row_more, "إكسسوارات")).performClick()
        rule.waitForIdle()
        rule.onNodeWithText(string(R.string.common_delete)).performClick()
        rule.waitForIdle()
        assertTrue(rule.onAllNodesWithText("«إكسسوارات»", substring = true).fetchSemanticsNodes().isNotEmpty())
        assertTrue(rule.onAllNodesWithText("ستصبح ٦ منتجات بلا تصنيف", substring = true).fetchSemanticsNodes().isNotEmpty())
        rule.onNodeWithTag("orderak.sheet.confirm").performClick()
        rule.waitForIdle()
        assertEquals(listOf("c-1"), deleted)
    }

    @Test
    fun noCategoriesSaysProductsCanBeSoldWithoutOne() {
        show(emptyList())
        rule.onAllNodesWithText(string(R.string.categories_empty_title)).assertCountEquals(1)
        rule.onAllNodesWithText(string(R.string.categories_empty_body)).assertCountEquals(1)
    }

    @Test
    fun atTheLimitTheBarOpensThePlansInsteadOfTheSheet() {
        show(list, meter = PlanUsageRow(FeatureKeys.MAX_CATEGORIES, R.string.usage_categories, used = 2, limit = 2))
        rule.onNodeWithText(string(R.string.categories_add_bar)).performClick()
        assertEquals(1, limit)
        assertEquals(0, rule.onAllNodesWithText(string(R.string.categories_sheet_add_title)).fetchSemanticsNodes().size)
    }

    @Test
    fun aFailedReadKeepsTheListAndOffersARetry() {
        show(list, error = "network_unavailable")
        rule.onNodeWithText(string(R.string.common_retry)).performClick()
        assertEquals(1, retries)
        assertTrue(rule.onAllNodesWithText("إكسسوارات").fetchSemanticsNodes().isNotEmpty())
    }
}
