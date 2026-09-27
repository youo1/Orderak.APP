package app.orderak.seller.feature.settings

import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.height
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.Delete
import androidx.compose.material.icons.outlined.Devices
import androidx.compose.material.icons.outlined.Language
import androidx.compose.material.icons.outlined.Logout
import androidx.compose.material.icons.outlined.Subscriptions
import androidx.compose.material3.Surface
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.tooling.preview.Preview
import app.orderak.seller.R
import app.orderak.seller.core.ui.theme.LocalOrderakSpacing
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
                onOpenAppLanguage = {},
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

// ---- a free plan without AI: the lock is stated, not silent -------------
// `aiAvailable = false` used to omit the entry entirely, on the reasoning that
// AI is LockedByPlan on paid tiers and with billing closed there is no plan
// change that opens it, so an upgrade control would point nowhere. The second
// half is right and the first half does not follow from it: the seller was left
// unable to tell "your plan does not include this" from "this product has no AI",
// which is the whole reason `FeatureGate` exists. The notice states the lock, and
// the upgrade control appears only when `purchaseOpen` says there is somewhere for
// it to go — which the fixture below, like production today, does not.
//
// This render is therefore the one that proves the fix. It was previously
// identical to a screen that had simply never had an AI entry.

@PreviewTest
@Preview(name = "Account free plan", locale = "ar")
@Composable
fun accountFreePlan() = account(AccountUiState(planName = "Free", aiAvailable = false))

/** The same lock, with billing open: now the upgrade control has a destination. */
@PreviewTest
@Preview(name = "Account free plan, billing open", locale = "ar")
@Composable
fun accountFreePlanUpgradable() = account(
    AccountUiState(planName = "Free", aiAvailable = false, purchaseOpen = true),
)

// ---- the store link has not been issued yet ----------------------------

@PreviewTest
@Preview(name = "Account link pending", locale = "ar")
@Composable
fun accountLinkPending() =
    account(AccountUiState(planName = "Free", aiAvailable = false, storeUrl = null))

// ---- the groups at the bottom, which no full-screen render can reach ----
// حسابي is a `Column` with `verticalScroll` and the harness captures the viewport,
// so the account-actions group sits below the fold in every render above. Three
// changes landed there — the group gained the header the contract names, its two
// error-coloured `Text` lines became rows at the 48dp floor, and deletion status
// moved into it out of the devices group — and without this render the owner would
// have had nothing to look at.
//
// It composes the same `SettingsSectionHeader` and `SettingsListItem` the surface
// does, in the surface's own order. That order lives in `AccountContent.kt` and
// this mirrors it: a fixture, not a second implementation. If the two drift, the
// screen is right and this render is stale.
@PreviewTest
@Preview(name = "Account groups tail", locale = "ar")
@Composable
fun accountGroupsTail() {
    val spacing = LocalOrderakSpacing.current
    OrderakTheme(darkTheme = false) {
        Surface {
            Column {
                SettingsSectionHeader(stringResource(R.string.settings_devices_group_title))
                SettingsListItem(Icons.Outlined.Devices, stringResource(R.string.devices_title), onClick = {})
                SettingsListItem(Icons.Outlined.Subscriptions, stringResource(R.string.subscription_title), onClick = {})
                Spacer(Modifier.height(spacing.space2))
                SettingsSectionHeader(stringResource(R.string.settings_account_actions))
                SettingsListItem(Icons.Outlined.Delete, stringResource(R.string.deletion_status_title), onClick = {})
                SettingsListItem(Icons.Outlined.Language, stringResource(R.string.settings_app_language), onClick = {})
                SettingsListItem(
                    Icons.Outlined.Delete,
                    stringResource(R.string.settings_delete_account),
                    onClick = {},
                    destructive = true,
                )
                SettingsListItem(
                    Icons.Outlined.Logout,
                    stringResource(R.string.settings_logout),
                    onClick = {},
                    destructive = true,
                )
            }
        }
    }
}
