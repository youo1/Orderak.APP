package app.orderak.seller.feature.settings

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.outlined.Link
import androidx.compose.material.icons.outlined.Payments
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.ModalBottomSheet
import androidx.compose.material3.TextButton
import androidx.compose.material3.rememberModalBottomSheetState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.platform.LocalConfiguration
import androidx.compose.ui.semantics.heading
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.style.TextDirection
import app.orderak.seller.core.text.formatCount
import app.orderak.seller.core.ui.Avatar
import app.orderak.seller.core.ui.BottomSheet
import app.orderak.seller.core.ui.ConfirmSheet
import app.orderak.seller.core.ui.ConfirmSheetState
import app.orderak.seller.core.ui.PlanUsageRow
import app.orderak.seller.core.ui.PlanUsageRowItem
import app.orderak.seller.core.ui.SectionHeader
import app.orderak.seller.core.ui.SemanticRole
import app.orderak.seller.core.ui.SettingsRow
import app.orderak.seller.core.ui.SheetAction
import app.orderak.seller.core.ui.Skeleton
import app.orderak.seller.core.ui.SkeletonVariant
import app.orderak.seller.core.ui.TextField
import app.orderak.seller.core.ui.TopBar
import app.orderak.seller.core.ui.colors
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
    /** The person behind the shop; null until the profile has been read. */
    val sellerName: String? = null,
    val shopName: String? = null,
    /** Usage against the plan's limits; null until entitlements answer. */
    val usage: List<PlanUsageRow>? = null,
    val unreadAnnouncements: Int = 0,
)

/**
 * حسابي, as a function of its state.
 *
 * A large title; the person and the shop; the plan card in commerce colours with its two
 * meters closest to the limit; then rows grouped by what the seller is trying to do: متجرك,
 * المدفوعات والأمان, المساعدة, أنت and الحساب. Payment details, the plans to buy, deleting the
 * account and signing out are sheets raised from here, not dialogs.
 *
 * Two fields are nullable on purpose: [AccountUiState.planName] and
 * [AccountUiState.aiAvailable] used to seed with an answer rather than with "not yet", so every
 * paying seller opening this page was told they were on the free plan until the config
 * arrived. They are null until known and this composable withholds rather than guesses.
 *
 * The language sheet and the snackbar stay in `SettingsScreen`: they are conversations, not
 * states of the surface.
 */
@OptIn(ExperimentalMaterial3Api::class)
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
    /** The seller confirmed deleting the account, in the sheet this page raises. */
    onRequestDeletion: () -> Unit,
    /** The seller confirmed signing out, in the sheet this page raises. */
    onRequestLogout: () -> Unit,
    /** The app's own language sheet, which the shell's top bar used to open. */
    onOpenAppLanguage: () -> Unit,
    modifier: Modifier = Modifier,
    onCopyLink: (String) -> Unit = {},
) {
    val spacing = LocalOrderakSpacing.current
    var sheet by rememberSaveable { mutableStateOf<String?>(null) }
    val storeLink = state.storeUrl?.takeIf { it.isNotBlank() }
    val payments = buildList {
        add(stringResource(R.string.pay_cod))
        if (instapay.isNotBlank()) add(stringResource(R.string.pay_instapay))
        if (vfcash.isNotBlank()) add(stringResource(R.string.pay_vfcash))
    }.joinToString(" · ")

    Column(modifier.fillMaxSize().verticalScroll(rememberScrollState())) {
        TopBar(title = stringResource(R.string.nav_account), large = true)

        // The person and the shop.
        Row(
            Modifier.fillMaxWidth().padding(horizontal = spacing.space4, vertical = spacing.space2),
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(spacing.space3),
        ) {
            Avatar(name = state.sellerName ?: state.shopName.orEmpty())
            Column {
                Text(
                    state.sellerName ?: state.shopName ?: "",
                    style = MaterialTheme.typography.titleMedium.copy(textDirection = TextDirection.Content),
                )
                if (state.sellerName != null && state.shopName != null) {
                    Text(
                        state.shopName,
                        style = MaterialTheme.typography.bodyMedium.copy(textDirection = TextDirection.Content),
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                    )
                }
            }
        }

        PlanCard(state, onOpenSubscription)

        SectionHeader(stringResource(R.string.account_group_store), Modifier.padding(horizontal = spacing.space4))
        SettingsRow(stringResource(R.string.store_info_title), onOpenStoreInfo, icon = Icons.Outlined.Store)
        SettingsRow(stringResource(R.string.store_manage_categories), onOpenCategories, icon = Icons.Outlined.Category)
        SettingsRow(stringResource(R.string.catalog_languages_title), onOpenCatalogLanguages, icon = Icons.Outlined.Translate)
        // The real link, read-only; a tap copies it.
        SettingsRow(
            title = stringResource(R.string.account_store_link),
            onClick = { storeLink?.let(onCopyLink) },
            icon = Icons.Outlined.Link,
            value = storeLink ?: stringResource(R.string.settings_link_pending),
        )

        SectionHeader(stringResource(R.string.account_group_payments), Modifier.padding(horizontal = spacing.space4))
        SettingsRow(
            stringResource(R.string.account_payments_row),
            { sheet = SHEET_PAYMENT },
            icon = Icons.Outlined.Payments,
            value = payments,
        )
        SettingsRow(stringResource(R.string.devices_title), onOpenDevices, icon = Icons.Outlined.Devices)
        // Only while the account may buy: the same answer every other upgrade affordance reads.
        if (state.purchaseOpen && state.billingPlans.isNotEmpty()) {
            SettingsRow(stringResource(R.string.account_upgrade), { sheet = SHEET_PLANS }, icon = Icons.Outlined.Subscriptions)
        }

        SectionHeader(stringResource(R.string.account_group_help), Modifier.padding(horizontal = spacing.space4))
        SettingsRow(stringResource(R.string.support_title), onOpenSupport, icon = Icons.Outlined.SupportAgent)
        SettingsRow(
            title = stringResource(R.string.announcements_title),
            onClick = onOpenAnnouncements,
            icon = Icons.Outlined.Campaign,
            value = state.unreadAnnouncements.takeIf { it > 0 }?.let { formatCount(it, LocalConfiguration.current.locales[0]) },
        )
        // Withheld while unknown; shown once the plan includes it; a plan without it says so
        // rather than hiding the row, so "not on your plan" is told apart from "no such thing".
        when (state.aiAvailable) {
            true -> SettingsRow(stringResource(R.string.ai_assistant_title), onOpenAiAssistant, icon = Icons.Outlined.SmartToy)
            null -> Skeleton(SkeletonVariant.ListRows, Modifier.padding(horizontal = spacing.space4))
            false -> FeatureGate(
                availability = FeatureAvailability.LockedByPlan,
                onUpgrade = onOpenSubscription.takeIf { state.purchaseOpen },
                modifier = Modifier.padding(horizontal = spacing.space4, vertical = spacing.space2),
            ) {}
        }

        SectionHeader(stringResource(R.string.account_group_you), Modifier.padding(horizontal = spacing.space4))
        SettingsRow(stringResource(R.string.account_personal), onOpenSellerProfile, icon = Icons.Outlined.Person)
        SettingsRow(stringResource(R.string.account_language), onOpenAppLanguage, icon = Icons.Outlined.Language)

        SectionHeader(stringResource(R.string.account_group_account), Modifier.padding(horizontal = spacing.space4))
        SettingsRow(stringResource(R.string.deletion_status_title), onOpenDeletionStatus, icon = Icons.Outlined.Delete)
        SettingsRow(stringResource(R.string.account_delete), { sheet = SHEET_DELETE }, icon = Icons.Outlined.Delete, danger = true)
        SettingsRow(stringResource(R.string.account_logout), { sheet = SHEET_LOGOUT }, icon = Icons.Outlined.Logout, danger = true)
        Spacer(Modifier.height(spacing.space6))
    }

    val open = sheet
    if (open != null) {
        ModalBottomSheet(
            onDismissRequest = { sheet = null },
            sheetState = rememberModalBottomSheetState(skipPartiallyExpanded = true),
            containerColor = MaterialTheme.colorScheme.surface,
            dragHandle = null,
            shape = RoundedCornerShape(spacing.space0),
        ) {
            when (open) {
                SHEET_PAYMENT -> Column(
                    Modifier.fillMaxWidth().verticalScroll(rememberScrollState()).padding(spacing.space4),
                    verticalArrangement = Arrangement.spacedBy(spacing.space3),
                ) {
                    Text(
                        stringResource(R.string.account_payment_title),
                        style = MaterialTheme.typography.titleLarge,
                        modifier = Modifier.semantics { heading() },
                    )
                    TextField(
                        value = instapay,
                        onValueChange = { onInstapayChange(it.take(60)) },
                        label = stringResource(R.string.account_instapay),
                    )
                    TextField(
                        value = vfcash,
                        onValueChange = { onVfcashChange(it.filter(Char::isDigit).take(11)) },
                        label = stringResource(R.string.account_wallet),
                    )
                    Text(
                        stringResource(R.string.account_payment_help),
                        style = MaterialTheme.typography.bodySmall,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                    )
                    Button(
                        onClick = { onSavePayout(); sheet = null },
                        modifier = Modifier.fillMaxWidth().heightIn(min = spacing.minimumTouchTarget),
                    ) { Text(stringResource(R.string.product_save_bar)) }
                    TextButton(
                        onClick = { sheet = null },
                        modifier = Modifier.fillMaxWidth().heightIn(min = spacing.minimumTouchTarget),
                    ) { Text(stringResource(R.string.common_cancel)) }
                }
                SHEET_PLANS -> BottomSheet(
                    title = stringResource(R.string.account_plans_title),
                    actions = state.billingPlans.map { plan ->
                        SheetAction(
                            label = plan.localizedPrice?.let {
                                stringResource(R.string.settings_choose_plan_priced, plan.product.name, plan.product.base_plan_id, it)
                            } ?: stringResource(R.string.settings_choose_plan, plan.product.name, plan.product.base_plan_id),
                            onClick = { sheet = null; onPurchase(plan) },
                        )
                    },
                    closeLabel = stringResource(R.string.sheet_close),
                    onClose = { sheet = null },
                )
                SHEET_DELETE -> ConfirmSheet(
                    state = ConfirmSheetState.Destructive,
                    title = stringResource(R.string.account_delete_title),
                    message = stringResource(R.string.account_delete_body),
                    confirmLabel = stringResource(R.string.account_delete),
                    cancelLabel = stringResource(R.string.common_cancel),
                    onConfirm = { sheet = null; onRequestDeletion() },
                    onCancel = { sheet = null },
                )
                SHEET_LOGOUT -> ConfirmSheet(
                    state = ConfirmSheetState.Destructive,
                    title = stringResource(R.string.account_logout_title),
                    message = stringResource(R.string.account_logout_body),
                    confirmLabel = stringResource(R.string.account_logout),
                    cancelLabel = stringResource(R.string.common_cancel),
                    onConfirm = { sheet = null; onRequestLogout() },
                    onCancel = { sheet = null },
                )
            }
        }
    }
}

private const val SHEET_PAYMENT = "payment"
private const val SHEET_PLANS = "plans"
private const val SHEET_DELETE = "delete"
private const val SHEET_LOGOUT = "logout"

/**
 * The plan, in commerce colours: its name, the two meters closest to their limits, and
 * "التفاصيل" into the subscription page. Until entitlements answer the card holds placeholders,
 * never "الخطة المجانية" as a guess.
 */
@Composable
private fun PlanCard(state: AccountUiState, onDetails: () -> Unit) {
    val spacing = LocalOrderakSpacing.current
    val colors = SemanticRole.Commerce.colors()
    val name = state.planName
    Surface(
        shape = MaterialTheme.shapes.large,
        color = colors.container,
        contentColor = colors.onContainer,
        modifier = Modifier.fillMaxWidth().padding(horizontal = spacing.space4, vertical = spacing.space2),
    ) {
        Column(Modifier.padding(spacing.space4), verticalArrangement = Arrangement.spacedBy(spacing.space3)) {
            Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
                if (name == null) {
                    Skeleton(SkeletonVariant.ListRows, Modifier.weight(1f))
                } else {
                    Text(
                        stringResource(R.string.settings_current_plan, name),
                        style = MaterialTheme.typography.titleMedium,
                        modifier = Modifier.weight(1f),
                    )
                }
                TextButton(onClick = onDetails, modifier = Modifier.heightIn(min = spacing.minimumTouchTarget)) {
                    Text(stringResource(R.string.account_plan_details))
                }
            }
            // The two closest to their limit: those are the ones a seller will meet next.
            state.usage.orEmpty()
                .filter { it.limit != null && it.limit > 0 }
                .sortedByDescending { it.used.toFloat() / it.limit!! }
                .take(2)
                .forEach { PlanUsageRowItem(it) }
        }
    }
}
