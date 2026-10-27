package app.orderak.seller.feature.customers

import android.app.Application
import androidx.compose.material3.MaterialTheme
import androidx.compose.ui.test.assertCountEquals
import androidx.compose.ui.test.junit4.createComposeRule
import androidx.compose.ui.test.onAllNodesWithText
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.performClick
import androidx.test.core.app.ApplicationProvider
import androidx.test.ext.junit.runners.AndroidJUnit4
import app.orderak.seller.R
import app.orderak.seller.data.db.CustomerSummary
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.annotation.Config
import org.robolectric.annotation.GraphicsMode

/** العملاء, in Arabic: find a customer by name or number, and recognise a returning one. */
@RunWith(AndroidJUnit4::class)
@GraphicsMode(GraphicsMode.Mode.NATIVE)
@Config(sdk = [35], qualifiers = "ar-w411dp-h891dp-xxhdpi", application = Application::class)
class CustomersContentTest {
    @get:Rule
    val rule = createComposeRule()

    private val application: Application get() = ApplicationProvider.getApplicationContext()
    private fun string(id: Int) = application.getString(id)

    private val list = listOf(
        CustomerSummary("k1", "+201001234567", "منى السيد", 4, 125_000, 1, "EGP"),
        CustomerSummary("k2", "+201112223334", null, 1, 30_000, 1, "EGP"),
        CustomerSummary("k3", "+966501234567", "سارة", 2, 90_000, 2, null),
    )
    private var opened: String? = null
    private var retries = 0
    private var query = ""

    private fun show(state: CustomersUiState, q: String = "") {
        query = q
        rule.setContent {
            MaterialTheme {
                CustomersContent(
                    state = state,
                    query = query,
                    onQueryChange = { query = it },
                    onOpen = { opened = it },
                    onRetry = { retries++ },
                )
            }
        }
    }

    @Test
    fun aRowSaysWhoHowManyOrdersAndWhatTheyHaveSpent() {
        show(CustomersUiState(customers = list))
        assertTrue(rule.onAllNodesWithText("منى السيد").fetchSemanticsNodes().isNotEmpty())
        assertTrue(rule.onAllNodesWithText("٤ طلبات", substring = true).fetchSemanticsNodes().isNotEmpty())
        assertTrue(rule.onAllNodesWithText("١٬٢٥٠", substring = true).fetchSemanticsNodes().isNotEmpty())
    }

    @Test
    fun aCustomerWithoutANameIsKnownByTheirNumber() {
        show(CustomersUiState(customers = list))
        assertTrue(rule.onAllNodesWithText("+201112223334", substring = true).fetchSemanticsNodes().isNotEmpty())
    }

    @Test
    fun ordersInSeveralCurrenciesHaveNoTotal() {
        show(CustomersUiState(customers = list))
        rule.onAllNodesWithText(string(R.string.customers_mixed_currencies)).assertCountEquals(1)
    }

    @Test
    fun aRowOpensTheCustomer() {
        show(CustomersUiState(customers = list))
        rule.onNodeWithText("منى السيد").performClick()
        assertEquals("k1", opened)
    }

    @Test
    fun noCustomersSaysTheyAppearAfterTheFirstOrderAndOffersNoSearch() {
        show(CustomersUiState(customers = emptyList()))
        rule.onAllNodesWithText(string(R.string.customers_empty_title)).assertCountEquals(1)
        rule.onAllNodesWithText(string(R.string.customers_search_hint)).assertCountEquals(0)
    }

    @Test
    fun searchFindsByNumberEvenInArabicDigits() {
        show(CustomersUiState(customers = list), q = "٠١٠٠١٢٣")
        rule.onAllNodesWithText("منى السيد").assertCountEquals(1)
        rule.onAllNodesWithText("سارة").assertCountEquals(0)
    }

    @Test
    fun aSearchWithNoMatchNamesTheQueryAndOffersToClearIt() {
        show(CustomersUiState(customers = list), q = "ZZZ")
        rule.onNodeWithText(string(R.string.search_clear_action)).performClick()
        assertEquals("", query)
    }

    @Test
    fun whileReadingThereIsNoEmptyState() {
        show(CustomersUiState(customers = null))
        rule.onAllNodesWithText(string(R.string.customers_empty_title)).assertCountEquals(0)
    }

    @Test
    fun aFailedReadOffersARetry() {
        show(CustomersUiState(customers = null, loadError = true))
        rule.onNodeWithText(string(R.string.common_retry)).performClick()
        assertEquals(1, retries)
    }
}
