package app.orderak.seller.feature.billing

import androidx.compose.material3.Surface
import androidx.compose.runtime.Composable
import androidx.compose.ui.tooling.preview.Preview
import app.orderak.seller.core.ui.theme.OrderakTheme
import app.orderak.seller.data.remote.PlanComparisonRowDto
import app.orderak.seller.data.remote.PlanSummaryDto
import com.android.tools.screenshot.PreviewTest

/**
 * The two pages a seller meets when a plan gets in the way.
 *
 * Neither had a defect to fix — `PlansUiState` seeds `loading = true`, so the
 * plan list never claimed to be empty before it was fetched, and the paywall
 * reads a snapshot its caller already had. They were simply unrenderable,
 * because both read a Hilt view model.
 *
 * They matter more than their size suggests: billing is closed today, so the
 * plans page exists precisely to be READ while nothing is for sale, and what it
 * says in that state is the whole of its job.
 *
 * All Arabic: `ar` is the primary direction, so the render is what a seller sees.
 */

private val PLANS = listOf(
    PlanSummaryDto(plan_key = "free", name = "مجاني", sort_order = 0),
    PlanSummaryDto(plan_key = "paid1", name = "بيزنس", description = "للمتاجر اللي بتكبر", sort_order = 1),
    PlanSummaryDto(plan_key = "paid2", name = "برو", description = "بدون حدود", sort_order = 2),
)

private val COMPARISON = listOf(
    PlanComparisonRowDto(
        entitlement_key = "max_products",
        category = "catalogue",
        name = "المنتجات",
        value_type = "number",
        values = mapOf("free" to "٢٠", "paid1" to "٢٠٠", "paid2" to "غير محدود"),
    ),
    PlanComparisonRowDto(
        entitlement_key = "max_orders_per_month",
        category = "orders",
        name = "الأوردرات في الشهر",
        value_type = "number",
        values = mapOf("free" to "١٠٠", "paid1" to "١٠٠٠", "paid2" to "غير محدود"),
    ),
    PlanComparisonRowDto(
        entitlement_key = "ai_assistant",
        category = "tools",
        name = "المساعد الذكي",
        value_type = "boolean",
        values = mapOf("free" to "false", "paid1" to "true", "paid2" to "true"),
    ),
)

// ================= plans =================

@Composable
private fun plans(state: PlansUiState, dark: Boolean = false) {
    OrderakTheme(darkTheme = dark) {
        Surface { PlansContent(state = state, onBack = {}, onRetry = {}) }
    }
}

@PreviewTest
@Preview(name = "Plans loading light", locale = "ar")
@Composable
fun plansLoadingLight() = plans(PlansUiState(loading = true))

@PreviewTest
@Preview(name = "Plans loading dark", locale = "ar")
@Composable
fun plansLoadingDark() = plans(PlansUiState(loading = true), dark = true)

/**
 * Purchasing closed, which is the real state today.
 *
 * The notice is said once at the top rather than as a disabled button beside
 * every plan: while there is nothing to buy, the honest thing is to say so
 * rather than imply it three times.
 */
@PreviewTest
@Preview(name = "Plans content light", locale = "ar")
@Composable
fun plansContentLight() = plans(
    PlansUiState(
        loading = false,
        plans = PLANS,
        comparison = COMPARISON,
        currentPlanKey = "free",
        purchaseOpen = false,
    ),
)

@PreviewTest
@Preview(name = "Plans content dark", locale = "ar")
@Composable
fun plansContentDark() = plans(
    PlansUiState(
        loading = false,
        plans = PLANS,
        comparison = COMPARISON,
        currentPlanKey = "free",
        purchaseOpen = false,
    ),
    dark = true,
)

/** The same page with buying open — the notice goes, the plans stay. */
@PreviewTest
@Preview(name = "Plans purchase open", locale = "ar")
@Composable
fun plansPurchaseOpen() = plans(
    PlansUiState(
        loading = false,
        plans = PLANS,
        comparison = COMPARISON,
        currentPlanKey = "paid1",
        purchaseOpen = true,
    ),
)

/**
 * Loaded, and the catalogue returned nothing.
 *
 * Not an error — the request succeeded — so it says the plans are unavailable
 * rather than offering a retry that would fetch the same nothing.
 */
@PreviewTest
@Preview(name = "Plans unavailable", locale = "ar")
@Composable
fun plansUnavailable() = plans(PlansUiState(loading = false, plans = emptyList()))

@PreviewTest
@Preview(name = "Plans error light", locale = "ar")
@Composable
fun plansErrorLight() = plans(PlansUiState(loading = false, error = "network_unavailable"))

@PreviewTest
@Preview(name = "Plans error dark", locale = "ar")
@Composable
fun plansErrorDark() =
    plans(PlansUiState(loading = false, error = "network_unavailable"), dark = true)

// ================= paywall =================

@Composable
private fun paywall(state: PaywallUiState, dark: Boolean = false) {
    OrderakTheme(darkTheme = dark) {
        Surface { PaywallContent(state = state, onBack = {}, onViewPlans = {}) }
    }
}

/**
 * The product limit, reached.
 *
 * Its contract declares `content` and nothing else, which is right: everything
 * on it comes from the snapshot the caller already held when it decided to show
 * this page at all.
 */
@PreviewTest
@Preview(name = "Paywall light", locale = "ar")
@Composable
fun paywallLight() = paywall(
    PaywallUiState(
        limitKey = "max_products",
        limit = 20,
        used = 20,
        nextPlanValue = "٢٠٠",
        nextPlanName = "بيزنس",
        purchaseOpen = false,
    ),
)

@PreviewTest
@Preview(name = "Paywall dark", locale = "ar")
@Composable
fun paywallDark() = paywall(
    PaywallUiState(
        limitKey = "max_products",
        limit = 20,
        used = 20,
        nextPlanValue = "٢٠٠",
        nextPlanName = "بيزنس",
        purchaseOpen = false,
    ),
    dark = true,
)

/**
 * The snapshot has no ceiling for this key, and no next plan to name.
 *
 * The page still has to say something useful — a paywall that cannot name what
 * would lift the limit is a wall with no door, and this render is how that gets
 * noticed rather than assumed away.
 */
@PreviewTest
@Preview(name = "Paywall unknown limit", locale = "ar")
@Composable
fun paywallUnknownLimit() = paywall(PaywallUiState(limitKey = "max_products"))

/** Buying open: the call to action can actually complete. */
@PreviewTest
@Preview(name = "Paywall purchase open", locale = "ar")
@Composable
fun paywallPurchaseOpen() = paywall(
    PaywallUiState(
        limitKey = "max_categories",
        limit = 5,
        used = 5,
        nextPlanValue = "٢٥",
        nextPlanName = "بيزنس",
        purchaseOpen = true,
    ),
)
