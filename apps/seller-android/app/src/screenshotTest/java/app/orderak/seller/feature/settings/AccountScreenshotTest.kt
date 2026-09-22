package app.orderak.seller.feature.settings

import androidx.compose.material3.Surface
import androidx.compose.runtime.Composable
import androidx.compose.ui.tooling.preview.Preview
import app.orderak.seller.core.ui.theme.OrderakTheme
import com.android.tools.screenshot.PreviewTest

/**
 * حسابي, in both states its contract declares — rendered through the screen.
 *
 * The loading render is the one this file was written for. `planName` seeded
 * "Free" and `aiAvailable` seeded `false`, so before entitlements arrived this
 * surface told a paying seller they were on the free plan and hid the AI entry,
 * then corrected both a beat later. Neither was a placeholder; both were claims.
 * Putting the two renders side by side is how that stops being invisible.
 *
 * `billingPlans` is empty in every render, which is not a simplification:
 * BILLING_ENABLED is false, so the Play catalogue comes back empty and
 * `purchaseOpen` is false. This is the state a seller is actually in.
 *
 * All Arabic: `ar` is the primary direction, so the render is what a seller sees.
 */

@Composable
private fun account(state: AccountUiState, dark: Boolean = false) {
    OrderakTheme(darkTheme = dark) {
        Surface {
            AccountContent(
                state = state,
                slug = "mona-boutique",
                onSlugChange = {},
                instapay = "mona@instapay",
                onInstapayChange = {},
                vfcash = "01000000001",
                onVfcashChange = {},
                onSavePayout = {},
                onPurchase = {},
                onOpenStoreInfo = {},
                onOpenCategories = {},
                onOpenCatalogLanguages = {},
                onOpenSellerProfile = {},
                onOpenSupport = {},
                onOpenAnnouncements = {},
                onOpenAiAssistant = {},
                onOpenDevices = {},
                onOpenSubscription = {},
                onOpenDeletionStatus = {},
                onRequestDeletion = {},
                onRequestLogout = {},
            )
        }
    }
}

// ---- loading: nothing about the plan is claimed ------------------------

@PreviewTest
@Preview(name = "Account loading light", locale = "ar")
@Composable
fun accountLoadingLight() = account(AccountUiState(planName = null, aiAvailable = null))

@PreviewTest
@Preview(name = "Account loading dark", locale = "ar")
@Composable
fun accountLoadingDark() = account(AccountUiState(planName = null, aiAvailable = null), dark = true)

// ---- content: a paid plan, AI available --------------------------------
// Deliberately not the free plan. The defect this replaces was a free-plan
// claim shown to paying sellers, and a fixture that says "Free" would render
// identically whether the bug was fixed or not.

@PreviewTest
@Preview(name = "Account content light", locale = "ar")
@Composable
fun accountContentLight() = account(
    AccountUiState(planName = "Pro", aiAvailable = true, storeUrl = "orderak.app/mona-boutique"),
)

@PreviewTest
@Preview(name = "Account content dark", locale = "ar")
@Composable
fun accountContentDark() = account(
    AccountUiState(planName = "Pro", aiAvailable = true, storeUrl = "orderak.app/mona-boutique"),
    dark = true,
)

// ---- a free plan without AI, and no upgrade affordance -----------------
// aiAvailable = false omits the entry entirely rather than showing it locked.
// AI is LockedByPlan on paid tiers, but with billing closed there is no plan
// change that opens it, so an upgrade control here would point nowhere.

@PreviewTest
@Preview(name = "Account free plan", locale = "ar")
@Composable
fun accountFreePlan() = account(AccountUiState(planName = "Free", aiAvailable = false))

// ---- the store link has not been issued yet ----------------------------

@PreviewTest
@Preview(name = "Account link pending", locale = "ar")
@Composable
fun accountLinkPending() =
    account(AccountUiState(planName = "Free", aiAvailable = false, storeUrl = null))
