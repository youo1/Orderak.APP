package app.orderak.seller.feature.products

import android.app.Application
import androidx.compose.material3.MaterialTheme
import androidx.compose.ui.test.assertCountEquals
import androidx.compose.ui.test.junit4.createComposeRule
import androidx.compose.ui.test.onAllNodesWithContentDescription
import androidx.compose.ui.test.onAllNodesWithText
import androidx.compose.ui.test.onNodeWithContentDescription
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

/** المتجر, in Arabic: the three pages of the store, the meter, the rows and the honest states. */
@RunWith(AndroidJUnit4::class)
@GraphicsMode(GraphicsMode.Mode.NATIVE)
@Config(sdk = [35], qualifiers = "ar-w411dp-h891dp-xxhdpi", application = Application::class)
class StoreContentTest {
    @get:Rule
    val rule = createComposeRule()

    private val application: Application get() = ApplicationProvider.getApplicationContext()
    private fun string(id: Int) = application.getString(id)

    private fun product(id: Long, name: String, stock: Int, available: Boolean = true) =
        ProductEntity(id = id, name = name, priceMinor = 12_000, currency = "EGP", stock = stock, available = available)

    private val catalogue = listOf(
        product(1, "تيشيرت أطفال قطني", 12),
        product(2, "جوارب قطنية", 0),
        product(3, "كوفية صوف", 5, available = false),
    )

    private var added = 0
    private var limit = 0
    private var edited: Long? = null
    private var info = 0
    private var categories = 0
    private var languages = 0
    private var retries = 0
    private var shared = 0
    private var query = ""

    private fun show(state: StoreUiState, q: String = "") {
        query = q
        rule.setContent {
            MaterialTheme {
                StoreContent(
                    state = state,
                    query = query,
                    onQueryChange = { query = it },
                    onAdd = { added++ },
                    onLimitReached = { limit++ },
                    onEdit = { edited = it },
                    onShare = { shared++ },
                    onShowStuck = {},
                    onRetry = { retries++ },
                    onOpenStoreInfo = { info++ },
                    onOpenCategories = { categories++ },
                    onOpenLanguages = { languages++ },
                )
            }
        }
    }

    @Test
    fun theThreePagesOfTheStoreAreOneTapAway() {
        show(StoreUiState(products = catalogue))
        rule.onNodeWithText(string(R.string.store_info_title)).performClick()
        rule.onNodeWithText(string(R.string.store_manage_categories)).performClick()
        rule.onNodeWithText(string(R.string.store_manage_languages)).performClick()
        assertEquals(listOf(1, 1, 1), listOf(info, categories, languages))
    }

    @Test
    fun theManageRowIsThereEvenWithNoProducts() {
        show(StoreUiState(products = emptyList()))
        rule.onAllNodesWithText(string(R.string.store_manage_categories)).assertCountEquals(1)
    }

    @Test
    fun aRowSaysThePriceAndWhatIsLeftAndOpensTheProduct() {
        show(StoreUiState(products = catalogue))
        assertTrue(rule.onAllNodesWithText("المتبقي ١٢", substring = true).fetchSemanticsNodes().isNotEmpty())
        rule.onNodeWithText("تيشيرت أطفال قطني").performClick()
        assertEquals(1L, edited)
    }

    @Test
    fun aChipAppearsOnlyWhenItMattersSoldOutOrHidden() {
        show(StoreUiState(products = catalogue))
        // The chip names itself through its description, not through text nodes.
        rule.onAllNodesWithContentDescription(string(R.string.store_row_out)).assertCountEquals(1)
        rule.onAllNodesWithContentDescription(string(R.string.store_row_hidden)).assertCountEquals(1)
    }

    @Test
    fun anEmptyStoreInvitesTheFirstProductAndHasNoFab() {
        show(StoreUiState(products = emptyList()))
        rule.onAllNodesWithText(string(R.string.store_empty_title)).assertCountEquals(1)
        rule.onAllNodesWithText(string(R.string.store_add_product)).assertCountEquals(0)
        rule.onNodeWithText(string(R.string.store_empty_action)).performClick()
        assertEquals(1, added)
    }

    @Test
    fun theFabAddsAProductAndAtTheLimitOpensTheLimitInstead() {
        show(StoreUiState(products = catalogue))
        rule.onNodeWithText(string(R.string.store_add_product)).performClick()
        assertEquals(1, added)
        assertEquals(0, limit)
    }

    @Test
    fun atTheLimitTheFabSaysSoAndOpensTheLimit() {
        show(StoreUiState(products = catalogue, quota = ProductQuotaUiState(used = 20, limit = 20, canAdd = false)))
        rule.onNodeWithText(string(R.string.product_add_locked_short)).performClick()
        assertEquals(1, limit)
        assertEquals(0, added)
    }

    @Test
    fun whileReadingThereIsNoEmptyStateAndAFailedReadOffersARetry() {
        show(StoreUiState(products = null))
        rule.onAllNodesWithText(string(R.string.store_empty_title)).assertCountEquals(0)
    }

    @Test
    fun aFailedReadOffersARetry() {
        show(StoreUiState(products = null, loadError = true))
        rule.onNodeWithText(string(R.string.common_retry)).performClick()
        assertEquals(1, retries)
    }

    @Test
    fun aSearchWithNoMatchNamesTheQueryAndOffersToClearIt() {
        show(StoreUiState(products = catalogue), q = "فستان")
        assertTrue(rule.onAllNodesWithText("فستان", substring = true).fetchSemanticsNodes().isNotEmpty())
        rule.onNodeWithText(string(R.string.search_clear_action)).performClick()
        assertEquals("", query)
    }

    @Test
    fun theShareActionIsInTheBarOnlyWhenThereIsACatalogue() {
        show(StoreUiState(products = catalogue))
        rule.onNodeWithContentDescription(string(R.string.dash_share_catalog)).performClick()
        assertEquals(1, shared)
    }

    @Test
    fun productsSavedOnlyOnThePhoneGetAWarningAboveTheMeter() {
        show(StoreUiState(products = catalogue, stuckCount = 3))
        rule.onAllNodesWithText(string(R.string.products_stuck_title)).assertCountEquals(1)
    }
}
