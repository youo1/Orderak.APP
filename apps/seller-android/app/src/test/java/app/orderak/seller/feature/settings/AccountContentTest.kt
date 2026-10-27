package app.orderak.seller.feature.settings

import android.app.Application
import androidx.compose.material3.MaterialTheme
import androidx.compose.ui.test.assertCountEquals
import androidx.compose.ui.test.junit4.createComposeRule
import androidx.compose.ui.test.onAllNodesWithText
import androidx.compose.ui.test.onNodeWithTag
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.performClick
import androidx.compose.ui.test.performScrollTo
import androidx.test.core.app.ApplicationProvider
import androidx.test.ext.junit.runners.AndroidJUnit4
import app.orderak.seller.R
import app.orderak.seller.core.ui.PlanUsageRow
import app.orderak.seller.data.billing.FeatureKeys
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.annotation.Config
import org.robolectric.annotation.GraphicsMode

/** حسابي, in Arabic: the plan first, rows grouped by what the seller is doing, sheets for the rest. */
@RunWith(AndroidJUnit4::class)
@GraphicsMode(GraphicsMode.Mode.NATIVE)
@Config(sdk = [35], qualifiers = "ar-w411dp-h891dp-xxhdpi", application = Application::class)
class AccountContentTest {
    @get:Rule
    val rule = createComposeRule()

    private val application: Application get() = ApplicationProvider.getApplicationContext()
    private fun string(id: Int, vararg args: Any) = application.getString(id, *args)

    private var deleted = 0
    private var loggedOut = 0
    private var copied: String? = null
    private var details = 0
    private var savedPayout = 0
    private var instapay = "mona@instapay"

    private fun show(
        state: AccountUiState = AccountUiState(planName = "Pro", aiAvailable = true, storeUrl = "orderak.app/EG-mona-K7"),
        vfcash: String = "",
    ) {
        rule.setContent {
            MaterialTheme {
                AccountContent(
                    state = state,
                    instapay = instapay,
                    onInstapayChange = { instapay = it },
                    vfcash = vfcash,
                    onVfcashChange = {},
                    onSavePayout = { savedPayout++ },
                    onPurchase = {},
                    onOpenStoreInfo = {},
                    onOpenCategories = {},
                    onOpenCatalogLanguages = {},
                    onOpenSellerProfile = {},
                    onOpenSupport = {},
                    onOpenAnnouncements = {},
                    onOpenAiAssistant = {},
                    onOpenDevices = {},
                    onOpenSubscription = { details++ },
                    onOpenDeletionStatus = {},
                    onRequestDeletion = { deleted++ },
                    onRequestLogout = { loggedOut++ },
                    onOpenAppLanguage = {},
                    onCopyLink = { copied = it },
                )
            }
        }
    }

    @Test
    fun thePlanLeadsAndOpensTheSubscriptionPage() {
        show()
        assertTrue(rule.onAllNodesWithText(string(R.string.settings_current_plan, "Pro")).fetchSemanticsNodes().isNotEmpty())
        rule.onNodeWithText(string(R.string.account_plan_details)).performClick()
        assertEquals(1, details)
    }

    @Test
    fun theCardShowsOnlyTheTwoMetersClosestToTheirLimit() {
        show(
            AccountUiState(
                planName = "Free",
                usage = listOf(
                    PlanUsageRow(FeatureKeys.MAX_PRODUCTS, R.string.usage_products, used = 18, limit = 20),
                    PlanUsageRow(FeatureKeys.MAX_CATEGORIES, R.string.usage_categories, used = 1, limit = 5),
                    PlanUsageRow(FeatureKeys.MAX_ORDERS_PER_MONTH, R.string.usage_orders_month, used = 40, limit = 50),
                ),
            ),
        )
        assertTrue(rule.onAllNodesWithText(string(R.string.usage_products), substring = true).fetchSemanticsNodes().isNotEmpty())
        assertTrue(rule.onAllNodesWithText(string(R.string.usage_orders_month), substring = true).fetchSemanticsNodes().isNotEmpty())
        rule.onAllNodesWithText(string(R.string.usage_categories), substring = true).assertCountEquals(0)
    }

    @Test
    fun beforeEntitlementsAnswerThePlanIsNeverGuessedAsFree() {
        show(AccountUiState(planName = null, aiAvailable = null))
        rule.onAllNodesWithText(string(R.string.settings_current_plan, "Free")).assertCountEquals(0)
    }

    @Test
    fun theGroupsAreNamedByWhatTheSellerIsDoing() {
        show()
        for (id in listOf(R.string.account_group_store, R.string.account_group_payments, R.string.account_group_help, R.string.account_group_you, R.string.account_group_account)) {
            assertTrue(string(id), rule.onAllNodesWithText(string(id)).fetchSemanticsNodes().isNotEmpty())
        }
    }

    @Test
    fun theStoreLinkIsTheRealOneAndATapCopiesIt() {
        show()
        rule.onNodeWithText("orderak.app/EG-mona-K7").performScrollTo().performClick()
        assertEquals("orderak.app/EG-mona-K7", copied)
    }

    @Test
    fun thePaymentsRowShowsWhichMethodsAreOn() {
        show(vfcash = "01000000001")
        assertTrue(rule.onAllNodesWithText("نقدًا", substring = true).fetchSemanticsNodes().isNotEmpty())
        assertTrue(rule.onAllNodesWithText("إنستاباي", substring = true).fetchSemanticsNodes().isNotEmpty())
        assertTrue(rule.onAllNodesWithText("محفظة إلكترونية", substring = true).fetchSemanticsNodes().isNotEmpty())
    }

    @Test
    fun thePaymentSheetSaves() {
        show()
        rule.onNodeWithText(string(R.string.account_payments_row)).performScrollTo().performClick()
        rule.waitForIdle()
        assertTrue(rule.onAllNodesWithText(string(R.string.account_payment_help)).fetchSemanticsNodes().isNotEmpty())
        rule.onNodeWithText(string(R.string.product_save_bar)).performClick()
        rule.waitForIdle()
        assertEquals(1, savedPayout)
    }

    @Test
    fun upgradeIsOfferedOnlyWhilePurchaseIsOpen() {
        show()
        rule.onAllNodesWithText(string(R.string.account_upgrade)).assertCountEquals(0)
    }

    @Test
    fun signingOutAsksFirstAndStatesTheConsequence() {
        show()
        rule.onNodeWithText(string(R.string.account_logout)).performScrollTo().performClick()
        rule.waitForIdle()
        assertEquals(0, loggedOut)
        assertTrue(rule.onAllNodesWithText(string(R.string.account_logout_body)).fetchSemanticsNodes().isNotEmpty())
        rule.onNodeWithTag("orderak.sheet.confirm").performClick()
        rule.waitForIdle()
        assertEquals(1, loggedOut)
    }

    @Test
    fun deletingTheAccountAsksFirst() {
        show()
        rule.onNodeWithText(string(R.string.account_delete)).performScrollTo().performClick()
        rule.waitForIdle()
        assertEquals(0, deleted)
        rule.onNodeWithTag("orderak.sheet.confirm").performClick()
        rule.waitForIdle()
        assertEquals(1, deleted)
    }

    @Test
    fun aPlanWithoutTheAssistantSaysSoInsteadOfHidingIt() {
        show(AccountUiState(planName = "Free", aiAvailable = false))
        rule.onAllNodesWithText(string(R.string.ai_assistant_title)).assertCountEquals(0)
    }
}
