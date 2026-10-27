package app.orderak.seller.feature.shopsetup

import android.app.Application
import androidx.compose.material3.MaterialTheme
import androidx.compose.ui.test.assertCountEquals
import androidx.compose.ui.test.assertIsEnabled
import androidx.compose.ui.test.assertIsNotEnabled
import androidx.compose.ui.test.junit4.createComposeRule
import androidx.compose.ui.test.onAllNodesWithText
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.performClick
import androidx.test.core.app.ApplicationProvider
import androidx.test.ext.junit.runners.AndroidJUnit4
import app.orderak.seller.R
import app.orderak.seller.core.phone.Country
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.annotation.Config
import org.robolectric.annotation.GraphicsMode

/** إنشاء المتجر, in Arabic: one step, then a ready screen. */
@RunWith(AndroidJUnit4::class)
@GraphicsMode(GraphicsMode.Mode.NATIVE)
@Config(sdk = [35], qualifiers = "ar-w411dp-h891dp-xxhdpi", application = Application::class)
class ShopSetupContentTest {
    @get:Rule
    val rule = createComposeRule()

    private val application: Application get() = ApplicationProvider.getApplicationContext()
    private fun string(id: Int, vararg args: Any) = application.getString(id, *args)
    private fun has(text: String, substring: Boolean = false) =
        rule.onAllNodesWithText(text, substring = substring).fetchSemanticsNodes().isNotEmpty()

    private val egypt = Country(iso = "EG", flag = "🇪🇬", dialCode = "20", name = "مصر")
    private val filled = ShopSetupUiState(fullName = "منى عبد الله", ageConfirmed = true, name = "بوتيك منى", country = egypt)

    private var created = 0
    private var shared: String? = null
    private var copied: String? = null
    private var addedFirst = 0
    private var later = 0
    private var confirmed: Boolean? = null

    private fun show(state: ShopSetupUiState) {
        rule.setContent {
            MaterialTheme {
                ShopSetupContent(
                    state = state,
                    actions = ShopSetupActions(
                        onAgeConfirmedChanged = { confirmed = it },
                        create = { created++ },
                        share = { shared = it },
                        copy = { copied = it },
                        addFirstProduct = { addedFirst++ },
                        later = { later++ },
                    ),
                    onExit = {},
                )
            }
        }
    }

    @Test
    fun theHeadlineSaysTheRestCanWaitAndTheLinkShowsItsPermanentCode() {
        show(filled)
        assertTrue(has(string(R.string.setup_headline)))
        assertTrue(has(string(R.string.setup_subline)))
        assertTrue(has("orderak.app/EG-", substring = true))
    }

    @Test
    fun theAgeStatementIsTheCanonicalWording() {
        show(filled)
        assertTrue(has("عمري ١٨ عامًا أو أكثر"))
    }

    @Test
    fun theCountryIsALineOfTextFromThePhone() {
        show(filled)
        assertTrue(has("مصر"))
    }

    @Test
    fun theBarCreatesWhenEverythingIsGiven() {
        show(filled)
        rule.onNodeWithText(string(R.string.setup_create_store)).assertIsEnabled().performClick()
        assertEquals(1, created)
    }

    @Test
    fun withoutTheAgeConfirmationTheBarWaitsAndSaysWhy() {
        show(filled.copy(ageConfirmed = false))
        rule.onNodeWithText(string(R.string.setup_create_store)).assertIsNotEnabled()
        assertTrue(has(string(R.string.setup_bar_reason)))
    }

    @Test
    fun tickingTheConfirmationReportsIt() {
        show(filled.copy(ageConfirmed = false))
        rule.onNodeWithText("عمري ١٨ عامًا أو أكثر").performClick()
        assertEquals(true, confirmed)
    }

    @Test
    fun creatingCoversTheScreenAndSaysSo() {
        show(filled.copy(saving = true))
        assertTrue(has(string(R.string.setup_creating)))
    }

    @Test
    fun aFailedCreationKeepsEverythingAndOffersARetry() {
        show(filled.copy(error = "network"))
        assertTrue(has(string(R.string.setup_create_failed)))
        rule.onNodeWithText(string(R.string.common_retry)).performClick()
        assertEquals(1, created)
        assertTrue(has("بوتيك منى"))
    }

    @Test
    fun theReadyScreenShowsTheLinkAndTheChecklistWithOnlyTheFirstDone() {
        show(filled.copy(completed = true, storeUrl = "https://orderak.app/EG-mona-K7M2"))
        assertTrue(has(string(R.string.setup_ready_title)))
        assertTrue(has("https://orderak.app/EG-mona-K7M2"))
        assertTrue(has("أكمل متجرك · ١ من ٤"))
        assertTrue(has(string(R.string.struct_setup_product)))
    }

    @Test
    fun readyOffersShareCopyAddFirstProductAndLater() {
        show(filled.copy(completed = true, storeUrl = "https://orderak.app/EG-mona-K7M2"))
        rule.onNodeWithText(string(R.string.setup_share)).performClick()
        rule.onNodeWithText(string(R.string.setup_copy)).performClick()
        rule.onNodeWithText(string(R.string.setup_add_first_product)).performClick()
        rule.onNodeWithText(string(R.string.setup_later)).performClick()
        assertEquals("https://orderak.app/EG-mona-K7M2", shared)
        assertEquals("https://orderak.app/EG-mona-K7M2", copied)
        assertEquals(1, addedFirst)
        assertEquals(1, later)
    }

    @Test
    fun noBirthYearIsAskedFor() {
        show(filled)
        rule.onAllNodesWithText("سنة الميلاد", substring = true).assertCountEquals(0)
    }
}
