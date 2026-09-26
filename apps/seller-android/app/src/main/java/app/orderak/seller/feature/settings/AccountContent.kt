package app.orderak.seller.feature.settings

import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.Campaign
import androidx.compose.material.icons.outlined.Category
import androidx.compose.material.icons.outlined.Delete
import androidx.compose.material.icons.outlined.Devices
import androidx.compose.material.icons.outlined.Language
import androidx.compose.material.icons.outlined.Logout
import androidx.compose.material.icons.outlined.Person
import androidx.compose.material.icons.outlined.SmartToy
import androidx.compose.material.icons.outlined.Store
import androidx.compose.material.icons.outlined.Subscriptions
import androidx.compose.material.icons.outlined.SupportAgent
import androidx.compose.material.icons.outlined.Translate
import androidx.compose.material3.Button
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.unit.dp
import app.orderak.seller.R
import app.orderak.seller.core.ui.FeatureGate
import app.orderak.seller.core.ui.FeatureAvailability
import app.orderak.seller.core.ui.theme.LocalOrderakSpacing
import java.util.Locale

/**
 * حسابي, as a function of its state.
 *
 * WHY THE TWO NULLABLE FIELDS ARE THE POINT
 *   This surface reads entitlements, and both values it reads used to seed with
 *   an answer rather than with "not yet":
 *
 *     planName    seeded "Free", so every paying seller opening حسابي was told
 *                 they were on the free plan until the config arrived. A claim
 *                 about their money, made before anything was known.
 *     aiAvailable seeded false, so the AI entry was hidden and then appeared a
 *                 beat later, which reads as a glitch rather than a decision.
 *
 *   Both are null until known now, and this composable withholds rather than
 *   guesses. That is the loading state the contract has declared all along and
 *   the screen never had — the same defect as اليوم's counters and المتجر's
 *   catalogue, in the third place it was written.
 *
 * The dialogs, the language sheet and the snackbar stay in `SettingsScreen`:
 * they are conversations, not states of the surface.
 */
data class AccountUiState(
    /** null until entitlements answer. Never "Free" as a placeholder. */
    val planName: String? = null,
    /** null until entitlements answer. Never false as a placeholder. */
    val aiAvailable: Boolean? = null,
    /** Empty unless the account may actually buy — see `purchaseOpen`. */
    val billingPlans: List<BillingPlanUi> = emptyList(),
    /**
     * Whether this account may buy anything right now. The one authoritative
     * answer, shared with every other surface that offers an upgrade.
     */
    val purchaseOpen: Boolean = false,
    /** The published store link, or null while it is still being issued. */
    val storeUrl: String? = null,
)

@Composable
fun AccountContent(
    state: AccountUiState,
    instapay: String,
    onInstapayChange: (String) -> Unit,
    vfcash: String,
    onVfcashChange: (String) -> Unit,
    onSavePayout: () -> Unit,
    onPurchase: (BillingPlanUi) -> Unit,
    onOpenStoreInfo: () -> Unit,
    onOpenCategories: () -> Unit,
    onOpenCatalogLanguages: () -> Unit,
    onOpenSellerProfile: () -> Unit,
    onOpenSupport: () -> Unit,
    onOpenAnnouncements: () -> Unit,
    onOpenAiAssistant: () -> Unit,
    onOpenDevices: () -> Unit,
    onOpenSubscription: () -> Unit,
    onOpenDeletionStatus: () -> Unit,
    onRequestDeletion: () -> Unit,
    onRequestLogout: () -> Unit,
    /** The app's own language sheet, which the shell's top bar used to open. */
    onOpenAppLanguage: () -> Unit,
    modifier: Modifier = Modifier,
) {
    val spacing = LocalOrderakSpacing.current
    Column(modifier.fillMaxSize().verticalScroll(rememberScrollState())) {
        // ── Plan section ──
        val plan = state.planName
        if (plan == null) {
            PlanSkeleton()
        } else {
            Text(
                stringResource(R.string.settings_current_plan, plan),
                style = MaterialTheme.typography.titleMedium,
                modifier = Modifier.padding(horizontal = spacing.space4, vertical = spacing.space3),
            )
        }
        // A plan list is not permission to sell one. `purchaseOpen` is the
        // same decision the subscription screen and the limit notices read,
        // so the account surface can no longer disagree with them (I-5).
        if (state.purchaseOpen && state.billingPlans.isNotEmpty()) {
            state.billingPlans.forEach { plan ->
                OutlinedButton(
                    onClick = { onPurchase(plan) },
                    modifier = Modifier.fillMaxWidth().padding(horizontal = spacing.space4),
                ) {
                    Text(
                        plan.localizedPrice?.let {
                            stringResource(
                                R.string.settings_choose_plan_priced,
                                plan.product.name,
                                plan.product.base_plan_id,
                                it,
                            )
                        } ?: stringResource(
                            R.string.settings_choose_plan,
                            plan.product.name,
                            plan.product.base_plan_id,
                        )
                    )
                }
                Spacer(Modifier.height(spacing.space2))
            }
        }
        Spacer(Modifier.height(spacing.space2))

        // ── Store and identity ──
        //
        // Named for the group, not for its first row. The header used to be
        // `store_info_title`, which is also the label of the row directly beneath
        // it, so the group announced itself and then immediately repeated itself.
        // "Store and identity" is the contract's own name for this group
        // ("المتجر والهوية"), and it is the one that covers the seller profile too.
        SettingsSectionHeader(stringResource(R.string.settings_store_group_title))
        SettingsListItem(Icons.Outlined.Store, stringResource(R.string.store_info_title), onOpenStoreInfo)
        SettingsListItem(Icons.Outlined.Category, stringResource(R.string.categories_title), onOpenCategories)
        SettingsListItem(Icons.Outlined.Translate, stringResource(R.string.catalog_languages_title), onOpenCatalogLanguages)
        SettingsListItem(Icons.Outlined.Person, stringResource(R.string.seller_profile_title), onOpenSellerProfile)
        Spacer(Modifier.height(spacing.space2))

        // ── Support ──
        SettingsSectionHeader(stringResource(R.string.support_title))
        SettingsListItem(Icons.Outlined.SupportAgent, stringResource(R.string.support_title), onOpenSupport)
        SettingsListItem(Icons.Outlined.Campaign, stringResource(R.string.announcements_title), onOpenAnnouncements)
        // Withheld while unknown, rather than hidden-as-decided. `true` shows
        // it, `false` explains it, and `null` means entitlements have not
        // answered — three cases, where the seeded boolean could only express two.
        //
        // `false` used to omit the row entirely. That is what `FeatureGate` exists
        // to prevent: a plan without AI saw nothing at all, so the seller could not
        // tell "your plan does not include this" from "this product has no AI".
        //
        // The upgrade control is offered only when there is somewhere for it to go.
        // `purchaseOpen` is the same answer every other upgrade affordance in the
        // app reads, and with billing closed it is false — so the notice states the
        // lock and offers nothing to press, rather than sending the seller to a plan
        // comparison that cannot change their plan. This is what the screenshot
        // fixture was already asserting when it said the entry was omitted "rather
        // than showing it locked"; the omission was the part that was wrong.
        when (state.aiAvailable) {
            true -> SettingsListItem(
                Icons.Outlined.SmartToy,
                stringResource(R.string.ai_assistant_title),
                onOpenAiAssistant,
            )
            null -> EntrySkeleton()
            false -> FeatureGate(
                availability = FeatureAvailability.LockedByPlan,
                onUpgrade = onOpenSubscription.takeIf { state.purchaseOpen },
                modifier = Modifier.padding(horizontal = spacing.space4, vertical = spacing.space2),
            ) {}
        }
        Spacer(Modifier.height(spacing.space2))

        // ── Devices and subscription ──
        //
        // The header used to be `devices_title`, so a group of three named one of
        // them. The contract names this group "الأجهزة والاشتراك" — devices and
        // subscription — and deletion status has moved out of it, to the group
        // whose action it is the status of. That leaves the header true of every
        // row beneath it.
        SettingsSectionHeader(stringResource(R.string.settings_devices_group_title))
        SettingsListItem(Icons.Outlined.Devices, stringResource(R.string.devices_title), onOpenDevices)
        SettingsListItem(Icons.Outlined.Subscriptions, stringResource(R.string.subscription_title), onOpenSubscription)
        Spacer(Modifier.height(spacing.space2))

        // ── Payout section ──
        SettingsSectionHeader(stringResource(R.string.settings_payout_title))
        // The catalogue link is shown, not edited here.
        //
        // This group used to carry a second `slug` field, and it was the one
        // without the server check. `StoreInfoScreen` — the store surface — owns
        // the slug properly: it queries `/api/v1/slug/check`, tells the seller
        // whether the name is available, taken or reserved, and keeps Save
        // disabled until it is free. This one wrote: the value went to local
        // storage, `savePayout` triggered a refresh, and `SellerRefresher` pushed
        // it through `api.register`. A taken name therefore made the whole
        // registration fail, which stops the sync — every pull and push behind it
        // — while the snackbar said "Payout details saved". The seller's feedback
        // and the truth came from different places.
        //
        // `products_catalog.custom_catalog_slug` is a store FIELD in
        // `docs/ux/feature-surface-map.md` too, so the map and the working
        // implementation agree against this copy. The link stays visible because
        // knowing your public URL is the account's business; changing it is the
        // store's.
        Text(
            stringResource(R.string.settings_link_title),
            style = MaterialTheme.typography.titleMedium,
            modifier = Modifier.padding(horizontal = spacing.space4, vertical = spacing.space1),
        )
        val saved = state.storeUrl?.takeIf { it.isNotBlank() }
        Text(
            text = saved ?: stringResource(R.string.settings_link_pending),
            style = MaterialTheme.typography.bodySmall,
            color = if (saved != null) {
                MaterialTheme.colorScheme.primary
            } else {
                MaterialTheme.colorScheme.onSurfaceVariant
            },
            modifier = Modifier.padding(horizontal = spacing.space4),
        )
        Spacer(Modifier.height(spacing.space2))
        OutlinedTextField(
            value = instapay,
            onValueChange = { onInstapayChange(it.take(60)) },
            label = { Text(stringResource(R.string.settings_instapay)) },
            singleLine = true,
            modifier = Modifier.fillMaxWidth().padding(horizontal = spacing.space4),
        )
        OutlinedTextField(
            value = vfcash,
            onValueChange = { onVfcashChange(it.filter(Char::isDigit).take(11)) },
            label = { Text(stringResource(R.string.settings_vfcash)) },
            singleLine = true,
            modifier = Modifier.fillMaxWidth().padding(horizontal = spacing.space4),
        )
        Button(
            onClick = onSavePayout,
            modifier = Modifier.fillMaxWidth().padding(horizontal = spacing.space4, vertical = spacing.space2),
        ) { Text(stringResource(R.string.settings_save)) }
        Spacer(Modifier.height(spacing.space4))

        // ── Account actions ──
        //
        // The contract declares six groups and this is the sixth, which until now
        // had no header at all: two error-coloured lines at the end of a long
        // scroll read as leftovers rather than as the group they are.
        //
        // They were also `Text` with a clickable modifier and 12dp of padding, which
        // is 24dp around a 20dp line — under this product's own 48dp floor, on the
        // two rows where a mis-tap is most expensive. As list rows they meet it.
        SettingsSectionHeader(stringResource(R.string.settings_account_actions))
        // The status of a deletion request, beside the control that makes one.
        // It sat under the devices header, where it named neither the group nor
        // itself, and where a seller looking for "did my deletion go through?"
        // would not think to look.
        SettingsListItem(
            Icons.Outlined.Delete,
            stringResource(R.string.deletion_status_title),
            onOpenDeletionStatus,
        )
        // The app's own language, which the shell's top bar used to hold as an icon.
        // The contract's six groups have no home for a preference, so it sits with
        // the other things that are about the account rather than about the shop;
        // §4.4 of the Android audit records that the contract does not name it.
        SettingsListItem(
            Icons.Outlined.Language,
            stringResource(R.string.settings_app_language),
            onOpenAppLanguage,
        )
        SettingsListItem(
            Icons.Outlined.Delete,
            stringResource(R.string.settings_delete_account),
            onRequestDeletion,
            destructive = true,
        )
        SettingsListItem(
            Icons.Outlined.Logout,
            stringResource(R.string.settings_logout),
            onRequestLogout,
            destructive = true,
        )
        Spacer(Modifier.height(spacing.space6))
    }
}

/**
 * A shape where the plan name will be, not a guess at what it says.
 *
 * Same treatment as اليوم's counters: the row keeps its height so nothing
 * jumps when the real value lands.
 */
@Composable
private fun PlanSkeleton() {
    val spacing = LocalOrderakSpacing.current
    Surface(
        color = MaterialTheme.colorScheme.surfaceVariant,
        modifier = Modifier
            .padding(horizontal = spacing.space4, vertical = spacing.space3)
            .height(20.dp)
            .fillMaxWidth(0.55f)
            .clip(MaterialTheme.shapes.extraSmall),
    ) {}
}

/** The same, for an entry whose presence is not yet decided. */
@Composable
private fun EntrySkeleton() {
    val spacing = LocalOrderakSpacing.current
    Surface(
        color = MaterialTheme.colorScheme.surfaceVariant,
        modifier = Modifier
            .padding(horizontal = spacing.space4, vertical = spacing.space3)
            .height(24.dp)
            .fillMaxWidth(0.4f)
            .clip(MaterialTheme.shapes.extraSmall),
    ) {}
}
