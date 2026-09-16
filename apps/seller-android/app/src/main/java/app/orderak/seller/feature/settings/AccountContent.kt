package app.orderak.seller.feature.settings

import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.Campaign
import androidx.compose.material.icons.outlined.Category
import androidx.compose.material.icons.outlined.Delete
import androidx.compose.material.icons.outlined.Devices
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
    slug: String,
    onSlugChange: (String) -> Unit,
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

        // ── Store section ──
        SettingsSectionHeader(stringResource(R.string.store_info_title))
        SettingsListItem(Icons.Outlined.Store, stringResource(R.string.store_info_title), onOpenStoreInfo)
        SettingsListItem(Icons.Outlined.Category, stringResource(R.string.categories_title), onOpenCategories)
        SettingsListItem(Icons.Outlined.Translate, stringResource(R.string.catalog_languages_title), onOpenCatalogLanguages)
        SettingsListItem(Icons.Outlined.Person, stringResource(R.string.seller_profile_title), onOpenSellerProfile)
        Spacer(Modifier.height(spacing.space2))

        // ── Tools section ──
        SettingsSectionHeader(stringResource(R.string.support_title))
        SettingsListItem(Icons.Outlined.SupportAgent, stringResource(R.string.support_title), onOpenSupport)
        SettingsListItem(Icons.Outlined.Campaign, stringResource(R.string.announcements_title), onOpenAnnouncements)
        // Withheld while unknown, rather than hidden-as-decided. `true` shows
        // it, `false` omits it, and `null` means entitlements have not answered
        // — three cases, where the seeded boolean could only express two.
        when (state.aiAvailable) {
            true -> SettingsListItem(
                Icons.Outlined.SmartToy,
                stringResource(R.string.ai_assistant_title),
                onOpenAiAssistant,
            )
            null -> EntrySkeleton()
            false -> Unit
        }
        Spacer(Modifier.height(spacing.space2))

        // ── Account section ──
        SettingsSectionHeader(stringResource(R.string.devices_title))
        SettingsListItem(Icons.Outlined.Devices, stringResource(R.string.devices_title), onOpenDevices)
        SettingsListItem(Icons.Outlined.Subscriptions, stringResource(R.string.subscription_title), onOpenSubscription)
        SettingsListItem(Icons.Outlined.Delete, stringResource(R.string.deletion_status_title), onOpenDeletionStatus)
        Spacer(Modifier.height(spacing.space2))

        // ── Payout section ──
        SettingsSectionHeader(stringResource(R.string.settings_payout_title))
        Text(
            stringResource(R.string.settings_link_title),
            style = MaterialTheme.typography.titleMedium,
            modifier = Modifier.padding(horizontal = spacing.space4, vertical = spacing.space1),
        )
        OutlinedTextField(
            value = slug,
            onValueChange = { v ->
                onSlugChange(v.lowercase(Locale.ROOT).filter { it.isLetterOrDigit() || it == '-' }.take(30))
            },
            label = { Text(stringResource(R.string.settings_slug_label)) },
            singleLine = true,
            modifier = Modifier.fillMaxWidth().padding(horizontal = spacing.space4),
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

        // ── Danger zone ──
        Text(
            stringResource(R.string.settings_delete_account),
            style = MaterialTheme.typography.bodyMedium,
            color = MaterialTheme.colorScheme.error,
            modifier = Modifier.fillMaxWidth()
                .clickable(enabled = true) { onRequestDeletion() }
                .padding(horizontal = spacing.space4, vertical = spacing.space3),
        )
        Text(
            stringResource(R.string.settings_logout),
            style = MaterialTheme.typography.bodyMedium,
            color = MaterialTheme.colorScheme.error,
            modifier = Modifier.fillMaxWidth()
                .clickable(enabled = true) { onRequestLogout() }
                .padding(horizontal = spacing.space4, vertical = spacing.space3),
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
            .clip(RoundedCornerShape(4.dp)),
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
            .clip(RoundedCornerShape(4.dp)),
    ) {}
}
