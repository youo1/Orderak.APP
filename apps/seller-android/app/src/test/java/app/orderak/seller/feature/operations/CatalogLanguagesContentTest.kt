package app.orderak.seller.feature.operations

import android.app.Application
import androidx.compose.material3.MaterialTheme
import androidx.compose.ui.test.assertCountEquals
import androidx.compose.ui.test.junit4.createComposeRule
import androidx.compose.ui.test.onAllNodesWithContentDescription
import androidx.compose.ui.test.onAllNodesWithText
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.performClick
import androidx.test.core.app.ApplicationProvider
import androidx.test.ext.junit.runners.AndroidJUnit4
import app.orderak.seller.R
import app.orderak.seller.data.remote.ProductTranslationDto
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.annotation.Config
import org.robolectric.annotation.GraphicsMode

/** لغات الكتالوج, in Arabic: a language switch, a summary, a row per product and one editor. */
@RunWith(AndroidJUnit4::class)
@GraphicsMode(GraphicsMode.Mode.NATIVE)
@Config(sdk = [35], qualifiers = "ar-w411dp-h891dp-xxhdpi", application = Application::class)
class CatalogLanguagesContentTest {
    @get:Rule
    val rule = createComposeRule()

    private val application: Application get() = ApplicationProvider.getApplicationContext()
    private fun string(id: Int) = application.getString(id)

    private val items = listOf(
        ProductTranslationDto(product_code = "AB-01", source_name = "عباية كلوش", lang = "en", name = "Flared abaya", translation_status = "reviewed"),
        ProductTranslationDto(product_code = "TR-04", source_name = "طرحة شيفون", lang = "en", name = null, translation_status = "missing"),
        ProductTranslationDto(product_code = "SC-09", source_name = "كوفية", lang = "en", name = "Scarf", translation_status = "machine"),
    )
    private val langs = mutableListOf<String>()
    private val saves = mutableListOf<Triple<String, String, String>>()
    private var retries = 0

    private fun show(list: List<ProductTranslationDto>?, error: String? = null) {
        rule.setContent {
            MaterialTheme {
                CatalogLanguagesContent(
                    items = list,
                    lang = "en",
                    busy = false,
                    error = error,
                    onBack = {},
                    onRetry = { retries++ },
                    onLang = { langs += it },
                    onSave = { item, n, d -> saves += Triple(item.product_code, n, d) },
                )
            }
        }
    }

    @Test
    fun theSummaryCountsTheApprovedOnes() {
        show(items)
        assertTrue(rule.onAllNodesWithText("المعتمد: ١ من ٣").fetchSemanticsNodes().isNotEmpty())
    }

    @Test
    fun eachRowCarriesTheStateOfItsTranslation() {
        show(items)
        rule.onAllNodesWithContentDescription(string(R.string.translation_status_reviewed)).assertCountEquals(1)
        rule.onAllNodesWithContentDescription(string(R.string.translation_status_machine)).assertCountEquals(1)
        rule.onAllNodesWithContentDescription(string(R.string.translation_status_missing)).assertCountEquals(1)
    }

    @Test
    fun aRowOpensTheEditorAndOneButtonSavesAndApproves() {
        show(items)
        rule.onNodeWithText("طرحة شيفون").performClick()
        rule.waitForIdle()
        rule.onNodeWithText(string(R.string.translation_save_approve)).performClick() // blank name: nothing yet
        assertEquals(0, saves.size)
    }

    @Test
    fun noProductsExplainsWhenTranslationsAppearAndKeepsTheSwitch() {
        show(emptyList())
        rule.onAllNodesWithText(string(R.string.catalog_languages_empty)).assertCountEquals(1)
        assertTrue(rule.onAllNodesWithText("English", substring = true).fetchSemanticsNodes().isNotEmpty())
    }

    @Test
    fun theSwitchChoosesTheTargetLanguage() {
        show(items)
        rule.onNodeWithText("العربية", substring = true).performClick()
        assertEquals(listOf("ar"), langs)
    }

    @Test
    fun aFailedReadOffersARetryAndKeepsTheRows() {
        show(items, error = "network_unavailable")
        rule.onNodeWithText(string(R.string.common_retry)).performClick()
        assertEquals(1, retries)
        assertTrue(rule.onAllNodesWithText("عباية كلوش").fetchSemanticsNodes().isNotEmpty())
    }
}
