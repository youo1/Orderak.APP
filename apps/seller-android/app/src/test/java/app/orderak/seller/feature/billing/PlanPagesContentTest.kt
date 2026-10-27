package app.orderak.seller.feature.billing

import android.app.Application
import androidx.compose.material3.MaterialTheme
import androidx.compose.ui.test.assertCountEquals
import androidx.compose.ui.test.junit4.createComposeRule
import androidx.compose.ui.test.onAllNodesWithText
import androidx.compose.ui.test.onNodeWithContentDescription
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.performClick
import androidx.test.core.app.ApplicationProvider
import androidx.test.ext.junit.runners.AndroidJUnit4
import app.orderak.seller.R
import app.orderak.seller.core.ui.PlanUsageRow
import app.orderak.seller.data.billing.BillingState
import app.orderak.seller.data.billing.FeatureKeys
import app.orderak.seller.data.remote.PlanComparisonRowDto
import app.orderak.seller.data.remote.PlanSummaryDto
import app.orderak.seller.feature.operations.SubscriptionContent
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.annotation.Config
import org.robolectric.annotation.GraphicsMode

/** The three plan pages, in Arabic, none of which sells while purchase is closed. */
@RunWith(AndroidJUnit4::class)
@GraphicsMode(GraphicsMode.Mode.NATIVE)
@Config(sdk = [35], qualifiers = "ar-w411dp-h891dp-xxhdpi", application = Application::class)
class PlanPagesContentTest {
    @get:Rule
    val rule = createComposeRule()

    private val application: Application get() = ApplicationProvider.getApplicationContext()
    private fun string(id: Int, vararg args: Any) = application.getString(id, *args)
    private fun has(text: String, substring: Boolean = false) =
        rule.onAllNodesWithText(text, substring = substring).fetchSemanticsNodes().isNotEmpty()

    // ---- subscription ---------------------------------------------------------------------

    private val usage = listOf(
        PlanUsageRow(FeatureKeys.MAX_PRODUCTS, R.string.usage_products, used = 18, limit = 20),
        PlanUsageRow(FeatureKeys.MAX_CATEGORIES, R.string.usage_categories, used = 1, limit = 5),
    )
    private var compared = 0
    private var recovered = 0
    private var retried = 0

    private fun subscription(
        plan: String? = "Pro",
        purchaseOpen: Boolean = false,
        planError: String? = null,
        offline: Boolean = false,
        figuresAt: Long? = null,
    ) {
        rule.setContent {
            MaterialTheme {
                SubscriptionContent(
                    planName = plan, subscriptionStatus = "active", currentPeriodEnd = "2026-11-01", pendingEffectiveAt = null,
                    usage = usage, billingState = BillingState.Ready, purchaseOpen = purchaseOpen,
                    onBack = {}, onViewPlans = { compared++ }, onRecoverPurchases = { recovered++ },
                    planError = planError, offline = offline, figuresAt = figuresAt, onRetryPlan = { retried++ },
                )
            }
        }
    }

    @Test
    fun theCardNamesThePlanAndAllItsMetersAreShown() {
        subscription()
        assertTrue(has(string(R.string.settings_current_plan, "Pro")))
        assertTrue(has(string(R.string.usage_products), substring = true))
        assertTrue(has(string(R.string.usage_categories), substring = true))
    }

    @Test
    fun beforeEntitlementsAnswerNothingIsClaimedAboutThePlan() {
        subscription(plan = null)
        rule.onAllNodesWithText(string(R.string.settings_current_plan, "Free")).assertCountEquals(0)
    }

    @Test
    fun whilePurchaseIsClosedANoticeSaysSoAndCompareAndRecoverStayAvailable() {
        subscription(purchaseOpen = false)
        assertTrue(has(string(R.string.subscription_purchase_closed_title)))
        rule.onNodeWithText(string(R.string.subscription_compare)).performClick()
        rule.onNodeWithText(string(R.string.subscription_recover)).performClick()
        assertEquals(1, compared)
        assertEquals(1, recovered)
    }

    @Test
    fun aFailedPlanRefreshIsBannerWithRetryOverTheDatedFigures() {
        subscription(planError = "network", figuresAt = 1_761_000_000_000)
        assertTrue(has(string(R.string.subscription_refresh_failed)))
        rule.onNodeWithText(string(R.string.common_retry)).performClick()
        assertEquals(1, retried)
        assertTrue(has(string(R.string.settings_current_plan, "Pro")))
    }

    @Test
    fun offlineTheFiguresSayWhenTheyAreFrom() {
        subscription(offline = true, figuresAt = 1_761_000_000_000)
        assertTrue(has(string(R.string.plan_using_offline_settings)))
    }

    // ---- plans --------------------------------------------------------------------------------

    private val plans = listOf(PlanSummaryDto("free", "Free"), PlanSummaryDto("paid1", "Paid 1"))
    private val comparison = listOf(
        PlanComparisonRowDto("max_products", "limits", "المنتجات", "number", mapOf("free" to "20", "paid1" to "200")),
        PlanComparisonRowDto("ai", "features", "المساعد", "boolean", mapOf("free" to "false", "paid1" to "true")),
    )

    private fun plansPage(open: Boolean = false) {
        rule.setContent {
            MaterialTheme {
                PlansContent(
                    PlansUiState(loading = false, plans = plans, comparison = comparison, currentPlanKey = "free", purchaseOpen = open),
                    onBack = {}, onRetry = {},
                )
            }
        }
    }

    @Test
    fun theCurrentPlanIsMarkedAndTheOthersShowTheirDifference() {
        plansPage()
        assertTrue(has(string(R.string.plans_current_plan_marked, "Free")))
        rule.onNodeWithText("Paid 1").performClick()
        rule.waitForIdle()
        assertTrue(has("200", substring = true))
        assertTrue(has("+١٨٠", substring = true))
    }

    @Test
    fun aFeatureAppearsOnlyOnThePlansThatIncludeIt() {
        plansPage()
        rule.onAllNodesWithText("المساعد").assertCountEquals(0)
        rule.onNodeWithText("Paid 1").performClick()
        rule.waitForIdle()
        assertTrue(has("المساعد"))
    }

    @Test
    fun whilePurchaseIsClosedTheComparisonSaysSo() {
        plansPage(open = false)
        assertTrue(has(string(R.string.plans_purchase_closed)))
    }

    // ---- the paywall -------------------------------------------------------------------------------

    private fun paywall(open: Boolean = false, onBack: () -> Unit = {}, onPlans: () -> Unit = {}) {
        rule.setContent {
            MaterialTheme {
                PaywallContent(
                    PaywallUiState(FeatureKeys.MAX_PRODUCTS, limit = 20, used = 20, nextPlanValue = "200", nextPlanName = "Paid 1", purchaseOpen = open),
                    onBack = onBack, onViewPlans = onPlans,
                )
            }
        }
    }

    @Test
    fun thePaywallNamesTheLimitShowsTheMeterAndWhatTheNextPlanGives() {
        paywall()
        assertTrue(has(string(R.string.paywall_limit_products)))
        assertTrue(has(string(R.string.paywall_next_plan, "Paid 1", "200")))
    }

    @Test
    fun whilePurchaseIsClosedTheNoteSaysSoAndThereIsNoBuyControl() {
        paywall(open = false)
        assertTrue(has(string(R.string.paywall_purchase_closed)))
    }

    @Test
    fun viewPlansAndBackAreTheOnlyExits() {
        var plansOpened = 0
        var back = 0
        paywall(onBack = { back++ }, onPlans = { plansOpened++ })
        rule.onNodeWithText(string(R.string.paywall_view_plans)).performClick()
        rule.onNodeWithText(string(R.string.paywall_dismiss)).performClick()
        rule.onNodeWithContentDescription(string(R.string.sheet_close)).performClick()
        assertEquals(1, plansOpened)
        assertEquals(2, back)
    }
}
