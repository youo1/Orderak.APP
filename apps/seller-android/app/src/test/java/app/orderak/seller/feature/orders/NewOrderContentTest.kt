package app.orderak.seller.feature.orders

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
import app.orderak.seller.data.db.ProductEntity
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.annotation.Config
import org.robolectric.annotation.GraphicsMode

/** The manual order form, in Arabic: who, what, how it is paid, and one clear way to record it. */
@RunWith(AndroidJUnit4::class)
@GraphicsMode(GraphicsMode.Mode.NATIVE)
@Config(sdk = [35], qualifiers = "ar-w411dp-h891dp-xxhdpi", application = Application::class)
class NewOrderContentTest {
    @get:Rule
    val rule = createComposeRule()

    private val application: Application get() = ApplicationProvider.getApplicationContext()
    private fun string(id: Int) = application.getString(id)

    private val abaya = ProductEntity(id = 1, name = "عباية كلوش", priceMinor = 45_000, currency = "EGP", stock = 12)
    private val scarf = ProductEntity(id = 2, name = "طرحة شيفون", priceMinor = 8_500, currency = "EGP", stock = 2)
    private val catalogue = listOf(abaya, scarf)

    private var saved = 0
    private var left = 0
    private val countries = mutableListOf<String>()
    private val changes = mutableListOf<Pair<Long, Int>>()

    private fun show(
        state: NewOrderUiState,
        products: List<ProductEntity>? = catalogue,
        total: Long = 0,
        currency: String? = null,
    ) {
        rule.setContent {
            MaterialTheme {
                NewOrderContent(
                    state = state,
                    products = products,
                    totalMinor = total,
                    selectedCurrency = currency,
                    actions = NewOrderActions(
                        onCountry = { countries += it },
                        changeQty = { p, d -> changes += p.id to d },
                        save = { saved++ },
                    ),
                    onBack = { left++ },
                    onCreated = {},
                )
            }
        }
    }

    private val ready = NewOrderUiState(phone = "01000000001", qty = mapOf(1L to 2))

    @Test
    fun anEmptyFormCannotBeRecordedAndSaysWhy() {
        show(NewOrderUiState())
        rule.onNodeWithText(string(R.string.order_save)).assertIsNotEnabled()
        rule.onAllNodesWithText(string(R.string.order_new_bar_reason)).assertCountEquals(1)
    }

    @Test
    fun aCompleteFormCanBeRecorded() {
        show(ready, total = 90_000, currency = "EGP")
        rule.onNodeWithText(string(R.string.order_save)).assertIsEnabled().performClick()
        assertEquals(1, saved)
    }

    @Test
    fun anInvalidPhoneIsSaidNotOnlyColoured() {
        show(NewOrderUiState(phone = "0100", qty = mapOf(1L to 1)))
        rule.onAllNodesWithText(string(R.string.order_phone_invalid)).assertCountEquals(1)
    }

    @Test
    fun onlyTheChosenProductsAreListedAndEachShowsItsQuantity() {
        show(ready)
        rule.onAllNodesWithText("عباية كلوش").assertCountEquals(1)
        rule.onAllNodesWithText("طرحة شيفون").assertCountEquals(0)
    }

    @Test
    fun theProductPickerOpensListsEveryProductWithItsStockAndCloses() {
        show(ready)
        rule.onNodeWithText(string(R.string.order_new_add_product)).performClick()
        rule.waitForIdle()
        assertTrue(rule.onAllNodesWithText("طرحة شيفون").fetchSemanticsNodes().isNotEmpty())
        assertTrue(rule.onAllNodesWithText("المتاح: ٢", substring = true).fetchSemanticsNodes().isNotEmpty())
        rule.onNodeWithText(string(R.string.order_new_picker_done)).performClick()
        rule.waitForIdle()
        rule.onAllNodesWithText(string(R.string.order_new_picker_done)).assertCountEquals(0)
    }

    @Test
    fun aLineOverStockSaysHowManyAreAvailable() {
        show(NewOrderUiState(phone = "01000000001", qty = mapOf(2L to 5), stockError = true))
        assertTrue(rule.onAllNodesWithText("المتاح ٢ فقط").fetchSemanticsNodes().isNotEmpty())
    }

    @Test
    fun anEmptyCatalogueSaysWhereToGoInsteadOfOfferingAPicker() {
        show(NewOrderUiState(), products = emptyList())
        rule.onAllNodesWithText(string(R.string.order_no_products_body)).assertCountEquals(1)
        rule.onAllNodesWithText(string(R.string.order_new_add_product)).assertCountEquals(0)
    }

    @Test
    fun theNoteIsBehindAButton() {
        show(NewOrderUiState())
        rule.onAllNodesWithText(string(R.string.order_note_opt)).assertCountEquals(0)
        rule.onNodeWithText(string(R.string.order_new_add_note)).performClick()
        rule.waitForIdle()
        assertTrue(rule.onAllNodesWithText(string(R.string.order_note_opt), substring = true).fetchSemanticsNodes().isNotEmpty())
    }

    @Test
    fun closingAnEmptyFormLeavesAtOnce() {
        show(NewOrderUiState())
        rule.onNodeWithContentDescription(string(R.string.sheet_close)).performClick()
        assertEquals(1, left)
    }

    @Test
    fun closingAFormWithSomethingInItAsksFirstAndKeepEditingStays() {
        show(ready)
        rule.onNodeWithContentDescription(string(R.string.sheet_close)).performClick()
        rule.waitForIdle()
        assertEquals(0, left)
        assertTrue(rule.onAllNodesWithText(string(R.string.order_new_discard_title)).fetchSemanticsNodes().isNotEmpty())
        rule.onNodeWithTag("orderak.sheet.confirm").performClick()
        rule.waitForIdle()
        assertEquals(1, left)
    }

    @Test
    fun aBasketSpanningTwoCurrenciesHasNoTotalAndCannotBeRecorded() {
        show(ready, currency = null)
        rule.onNodeWithText(string(R.string.order_save)).assertIsNotEnabled()
        assertTrue(rule.onAllNodesWithText(string(R.string.order_mixed_currency_title)).fetchSemanticsNodes().isNotEmpty())
    }

    @Test
    fun aFailedSaveKeepsTheDraftAndOffersTheButtonAgain() {
        show(ready.copy(saveFailed = true), total = 90_000, currency = "EGP")
        assertTrue(rule.onAllNodesWithText(string(R.string.order_save_failed_title)).fetchSemanticsNodes().isNotEmpty())
        rule.onNodeWithText(string(R.string.order_save)).assertIsEnabled()
    }

    @Test
    fun whileSavingTheButtonSaysSoAndIsLocked() {
        show(ready.copy(saving = true), total = 90_000, currency = "EGP")
        rule.onNodeWithText(string(R.string.order_new_saving)).assertIsNotEnabled()
    }

    @Test
    fun onlyTheMethodsTheStoreAcceptsAreOffered() {
        show(ready)
        assertTrue(rule.onAllNodesWithText(string(R.string.pay_cod)).fetchSemanticsNodes().isNotEmpty())
        rule.onAllNodesWithText(string(R.string.pay_instapay)).assertCountEquals(0)
    }

    @Test
    fun theCountryPickerOpensAndChoosingOneReportsIt() {
        show(ready)
        rule.onNodeWithText("+20", substring = true).performClick()
        rule.waitForIdle()
        assertTrue(rule.onAllNodesWithText(string(R.string.order_new_country_title)).fetchSemanticsNodes().isNotEmpty())
    }
}
