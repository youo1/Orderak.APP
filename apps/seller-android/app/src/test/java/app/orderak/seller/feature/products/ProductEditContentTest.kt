package app.orderak.seller.feature.products

import android.app.Application
import androidx.compose.material3.MaterialTheme
import androidx.compose.ui.test.assertCountEquals
import androidx.compose.ui.test.assertIsEnabled
import androidx.compose.ui.test.assertIsNotEnabled
import androidx.compose.ui.test.junit4.createComposeRule
import androidx.compose.ui.test.onAllNodesWithText
import androidx.compose.ui.test.onNodeWithContentDescription
import androidx.compose.ui.test.onNodeWithTag
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.performClick
import androidx.test.core.app.ApplicationProvider
import androidx.test.ext.junit.runners.AndroidJUnit4
import app.orderak.seller.R
import app.orderak.seller.data.db.CategoryEntity
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.annotation.Config
import org.robolectric.annotation.GraphicsMode

/** The product form, in Arabic: image first, one bar to save, and questions asked in sheets. */
@RunWith(AndroidJUnit4::class)
@GraphicsMode(GraphicsMode.Mode.NATIVE)
@Config(sdk = [35], qualifiers = "ar-w411dp-h891dp-xxhdpi", application = Application::class)
class ProductEditContentTest {
    @get:Rule
    val rule = createComposeRule()

    private val application: Application get() = ApplicationProvider.getApplicationContext()
    private fun string(id: Int) = application.getString(id)

    private val categories = listOf(CategoryEntity(id = 1, name = "إكسسوارات", categoryCode = "c-AAAAAA"))
    private val filled = ProductEditUiState(
        id = 7, loaded = true, name = "تيشيرت أطفال قطني", priceText = "120", stockText = "12", currency = "EGP",
    )

    private var saved = 0
    private var deleted = 0
    private var left = 0
    private var shopStock = 0
    private var myStock = 0
    private var confirming = false
    private val stocks = mutableListOf<String>()
    private val picked = mutableListOf<String?>()
    private var limitFeature: String? = null

    private fun show(state: ProductEditUiState, confirmDelete: Boolean = false, cats: List<CategoryEntity> = categories) {
        rule.setContent {
            MaterialTheme {
                ProductEditContent(
                    state = state,
                    categories = cats,
                    confirmDelete = confirmDelete,
                    actions = ProductEditActions(
                        onStock = { stocks += it },
                        onCategory = { picked += it },
                        save = { saved++ },
                        delete = { deleted++ },
                        acceptShopStock = { shopStock++ },
                        reapplyMyStock = { myStock++ },
                    ),
                    onPickImage = {},
                    onConfirmDelete = { confirming = it },
                    onBack = { left++ },
                    onLimitReached = { limitFeature = it },
                )
            }
        }
    }

    @Test
    fun anExistingProductIsEditedAndANewOneIsNamedNew() {
        show(filled)
        rule.onAllNodesWithText(string(R.string.product_edit_heading)).assertCountEquals(1)
    }

    @Test
    fun aNewProductHasNoOverflowAndAnExistingOneHasDelete() {
        show(ProductEditUiState(loaded = true))
        rule.onAllNodesWithText(string(R.string.product_new_heading)).assertCountEquals(1)
        assertTrue(rule.onAllNodesWithText(string(R.string.product_delete)).fetchSemanticsNodes().isEmpty())
    }

    @Test
    fun theOverflowAsksToDeleteInASheetThatStatesTheConsequence() {
        show(filled)
        rule.onNodeWithContentDescription(string(R.string.product_delete)).performClick()
        assertTrue(confirming)
    }

    @Test
    fun confirmingTheDeleteSheetDeletes() {
        show(filled, confirmDelete = true)
        rule.waitForIdle()
        assertTrue(rule.onAllNodesWithText(string(R.string.product_delete_body)).fetchSemanticsNodes().isNotEmpty())
        rule.onNodeWithTag("orderak.sheet.confirm").performClick()
        rule.waitForIdle()
        assertEquals(1, deleted)
    }

    @Test
    fun theBarSavesAFormThatCanBeSaved() {
        show(filled)
        rule.onNodeWithText(string(R.string.product_save_bar)).assertIsEnabled().performClick()
        assertEquals(1, saved)
    }

    @Test
    fun aFormThatCannotBeSavedSaysWhy() {
        show(ProductEditUiState(loaded = true))
        rule.onNodeWithText(string(R.string.product_save_bar)).assertIsNotEnabled()
        rule.onAllNodesWithText(string(R.string.product_save_reason)).assertCountEquals(1)
    }

    @Test
    fun stockIsAStepperThatReportsTheNewNumber() {
        show(filled)
        rule.onNodeWithTag("orderak.stepper.minus").performClick()
        assertEquals(listOf("11"), stocks)
    }

    @Test
    fun theDescriptionIsBehindMoreDetailsUnlessThereIsOne() {
        show(filled)
        rule.onAllNodesWithText(string(R.string.product_description_label), substring = true).assertCountEquals(0)
        rule.onNodeWithText(string(R.string.product_more_details)).performClick()
        rule.waitForIdle()
        assertTrue(rule.onAllNodesWithText(string(R.string.product_description_label), substring = true).fetchSemanticsNodes().isNotEmpty())
    }

    @Test
    fun theCategoryIsChosenInASheetAndCanBeNone() {
        show(filled)
        rule.onNodeWithContentDescription(string(R.string.product_category_field), substring = true).performClick()
        rule.waitForIdle()
        rule.onAllNodesWithText("إكسسوارات").assertCountEquals(1)
        rule.onNodeWithText("إكسسوارات").performClick()
        rule.waitForIdle()
        assertEquals(listOf<String?>("c-AAAAAA"), picked)
    }

    @Test
    fun noCategoriesMeansNoCategoryField() {
        show(filled, cats = emptyList())
        rule.onAllNodesWithText(string(R.string.product_category_field), substring = true).assertCountEquals(0)
    }

    @Test
    fun aStockConflictShowsBothNumbersAndChoosesNothingForTheSeller() {
        show(filled.copy(stockConflict = StockConflict(yours = 5, shop = 3, shopVersion = 9)))
        rule.waitForIdle()
        assertTrue(rule.onAllNodesWithText("أدخلتَ ٥", substring = true).fetchSemanticsNodes().isNotEmpty())
        rule.onNodeWithTag("orderak.sheet.confirm").performClick()
        rule.waitForIdle()
        assertEquals(1, shopStock)
        assertEquals(0, myStock)
    }

    @Test
    fun aRefusedWriteKeepsTheFormAndExplains() {
        show(filled.copy(writeError = ProductWriteError.OFFLINE))
        assertTrue(rule.onAllNodesWithText(string(R.string.product_save_failed_title)).fetchSemanticsNodes().isNotEmpty())
        rule.onNodeWithText(string(R.string.product_save_bar)).assertIsEnabled()
    }

    @Test
    fun thePlanLimitOffersThePlansPage() {
        show(filled.copy(quotaExceeded = true))
        rule.onNodeWithText(string(R.string.paywall_view_plans)).performClick()
        assertEquals("max_products", limitFeature)
    }

    @Test
    fun closingLeaves() {
        show(filled)
        rule.onNodeWithContentDescription(string(R.string.sheet_close)).performClick()
        assertEquals(1, left)
    }
}
