package app.orderak.seller.feature.operations
import androidx.compose.material3.FilledTonalButton
import androidx.compose.foundation.layout.heightIn
import app.orderak.seller.core.ui.SemanticRole
import app.orderak.seller.core.ui.colors
import app.orderak.seller.data.billing.EntitlementFreshness
import java.text.DateFormat
import java.util.Date
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.ModalBottomSheet
import androidx.compose.material3.Surface
import androidx.compose.material3.rememberModalBottomSheetState
import app.orderak.seller.core.ui.ChatBubble
import app.orderak.seller.core.ui.Composer
import app.orderak.seller.core.ui.ConfirmSheet
import app.orderak.seller.core.ui.ConfirmSheetState
import app.orderak.seller.core.ui.EmptyState
import app.orderak.seller.core.ui.EmptyStateKind
import app.orderak.seller.core.ui.SectionHeader
import app.orderak.seller.core.ui.StepItem
import app.orderak.seller.core.ui.StepList
import android.app.Activity
import android.content.Context
import android.content.ContextWrapper
import android.content.Intent
import android.net.Uri
import android.os.Build
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.BoxWithConstraints
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.sizeIn
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material.icons.outlined.Inbox
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Button
import androidx.compose.material3.Card
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.LinearProgressIndicator
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.TopAppBar
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.platform.LocalConfiguration
import androidx.compose.ui.semantics.heading
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.hilt.navigation.compose.hiltViewModel
import androidx.lifecycle.SavedStateHandle
import androidx.lifecycle.ViewModel
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.lifecycle.viewModelScope
import androidx.navigation.toRoute
import app.orderak.seller.R
import app.orderak.seller.core.ui.Banner
import app.orderak.seller.core.ui.BannerState
import app.orderak.seller.core.ui.PlanUsageRow
import app.orderak.seller.core.ui.PlanUsageRowItem
import app.orderak.seller.core.ui.SkeletonVariant
import app.orderak.seller.core.ui.planUsageRows
import app.orderak.seller.core.locale.AppLocales
import app.orderak.seller.core.text.formatCount
import app.orderak.seller.core.text.formatCountOfLimit
import app.orderak.seller.core.ui.backendErrorResource
import app.orderak.seller.data.billing.EntitlementManager
import app.orderak.seller.data.billing.FeatureKeys
import app.orderak.seller.data.billing.BillingManager
import app.orderak.seller.data.billing.BillingState
import app.orderak.seller.data.auth.PasskeyClient
import app.orderak.seller.data.auth.PasskeyResult
import app.orderak.seller.data.remote.AnnouncementDto
import app.orderak.seller.data.remote.BackendApi
import app.orderak.seller.data.remote.DeletionRequestDto
import app.orderak.seller.data.remote.DeviceDto
import app.orderak.seller.data.remote.EntitlementDto
import app.orderak.seller.data.remote.PasskeyDto
import app.orderak.seller.data.remote.ProductTranslationDto
import app.orderak.seller.data.remote.SupportMessageDto
import app.orderak.seller.data.remote.SupportTicketDto
import app.orderak.seller.data.session.SessionStore
import app.orderak.seller.data.session.SessionLogoutManager
import app.orderak.seller.app.navigation.SupportTicketRoute
import dagger.hilt.android.lifecycle.HiltViewModel
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.launch
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import kotlinx.serialization.json.intOrNull
import javax.inject.Inject
import app.orderak.seller.core.ui.theme.LocalOrderakSpacing

@Composable
fun SubscriptionScreen(
    onBack: () -> Unit,
    onViewPlans: () -> Unit = {},
    vm: OperationsViewModel = hiltViewModel(),
) {
    val config by vm.entitlements.config.collectAsStateWithLifecycle()
    val billingState by vm.billingManager.state.collectAsStateWithLifecycle()
    val sync by vm.planSync.collectAsStateWithLifecycle()
    SubscriptionContent(
        planName = config?.plan_name,
        planKey = config?.plan_id,
        subscriptionStatus = config?.subscription_status,
        currentPeriodEnd = config?.current_period_end,
        pendingEffectiveAt = config?.pending_effective_at,
        usage = config?.let(::planUsageRows).orEmpty(),
        billingState = billingState,
        purchaseOpen = vm.entitlements.isPurchaseOpen(),
        onBack = onBack,
        onViewPlans = onViewPlans,
        onRecoverPurchases = vm.billingManager::recoverPurchases,
        planError = sync.error,
        offline = sync.freshness == EntitlementFreshness.OFFLINE,
        figuresAt = sync.lastUpdatedEpochMs,
        onRetryPlan = vm::retryPlan,
    )
}

/**
 * The subscription page, as a function of its state.
 *
 * Which plan the seller is on and how much of it they use, including while nothing can be
 * bought: a plan card in commerce colours (name, status, renewal or the pending change), all
 * five meters, a notice while purchase is closed, «مقارنة الخطط» as a tonal button and
 * «استعادة المشتريات» as a text button. When the plan refresh failed, a banner with
 * «إعادة المحاولة» sits over the last saved figures, dated; offline, the page says when the
 * figures are from.
 *
 * [planName] is nullable and NOT defaulted to "Free": the page read `plan_name ?: "Free"` with no
 * loading state, so every paying seller opening it was told they were on the free plan until
 * entitlements arrived, on the one page whose subject is what the seller is paying for.
 */
@Composable
fun SubscriptionContent(
    planName: String?,
    subscriptionStatus: String?,
    currentPeriodEnd: String?,
    pendingEffectiveAt: String?,
    usage: List<PlanUsageRow>,
    billingState: BillingState,
    purchaseOpen: Boolean,
    onBack: () -> Unit,
    onViewPlans: () -> Unit,
    onRecoverPurchases: () -> Unit,
    /** The catalogue key of the plan; with it the name is the app's own, without it the backend's. */
    planKey: String? = null,
    /** The plan refresh failed: the message, shown over the last saved figures. */
    planError: String? = null,
    offline: Boolean = false,
    /** When the figures on screen were read, if known. */
    figuresAt: Long? = null,
    onRetryPlan: () -> Unit = {},
) {
    val spacing = LocalOrderakSpacing.current
    val locale = LocalConfiguration.current.locales[0]
    val colors = SemanticRole.Commerce.colors()
    val figuresDate = figuresAt?.let { DateFormat.getDateTimeInstance(DateFormat.MEDIUM, DateFormat.SHORT, locale).format(Date(it)) }
    OperationPage(
        title = stringResource(R.string.subscription_title),
        onBack = onBack,
        // Loading until entitlements answer. There is nothing on this page that can be said
        // truthfully without them.
        busy = planName == null,
        loading = SkeletonVariant.DetailBlock,
    ) {
        if (planError != null) {
            Banner(
                state = BannerState.Error,
                title = stringResource(R.string.subscription_refresh_failed),
                message = figuresDate?.let { stringResource(R.string.subscription_figures_from, it) } ?: planError,
                actionLabel = stringResource(R.string.common_retry),
                onAction = onRetryPlan,
            )
        } else if (offline) {
            Banner(
                state = BannerState.Information,
                title = stringResource(R.string.plan_using_offline_settings),
                message = figuresDate?.let { stringResource(R.string.subscription_figures_from, it) },
            )
        }

        Surface(
            shape = MaterialTheme.shapes.large,
            color = colors.container,
            contentColor = colors.onContainer,
            modifier = Modifier.fillMaxWidth(),
        ) {
            Column(Modifier.padding(spacing.space4), verticalArrangement = Arrangement.spacedBy(spacing.space1)) {
                // Not null here: the page is busy until it is.
                Text(
                    stringResource(R.string.settings_current_plan, localizedPlanName(planKey, planName.orEmpty())),
                    style = MaterialTheme.typography.titleLarge,
                )
                // A missing status is a display gap, not a claim about money, so it keeps the old
                // fallback where plan_name deliberately does not.
                Text(
                    stringResource(R.string.subscription_status, localizedSubscriptionStatus(subscriptionStatus ?: "active")),
                    style = MaterialTheme.typography.bodyMedium,
                )
                currentPeriodEnd?.let { Text(stringResource(R.string.subscription_period_end, it), style = MaterialTheme.typography.bodyMedium) }
                pendingEffectiveAt?.let { Text(stringResource(R.string.plan_change_pending, it), style = MaterialTheme.typography.bodyMedium) }
            }
        }
        when (billingState) {
            is BillingState.VerificationPending, BillingState.Verifying ->
                Banner(state = BannerState.SyncInProgress, title = stringResource(R.string.subscription_verification_pending))
            is BillingState.Error ->
                Banner(
                    state = BannerState.Error,
                    title = stringResource(R.string.subscription_verification_error),
                    message = stringResource(R.string.subscription_verification_error_body),
                )
            else -> Unit
        }

        // What the seller actually came here to see: how much of the plan is used. The rows come
        // from core/ui/PlanUsage.kt, shared with the account card.
        if (usage.isNotEmpty()) {
            SectionHeader(title = stringResource(R.string.plan_usage_title))
            usage.forEach { row -> PlanUsageRowItem(row) }
        }

        // Say the true thing, and then stop offering the thing: the same decision every other
        // buying affordance in the app reads (I-5).
        if (!purchaseOpen) {
            Banner(
                state = BannerState.LockedByPlan,
                title = stringResource(R.string.subscription_purchase_closed_title),
                message = stringResource(R.string.subscription_purchase_closed_body),
            )
        }

        FilledTonalButton(
            onClick = onViewPlans,
            modifier = Modifier.fillMaxWidth().heightIn(min = spacing.minimumTouchTarget),
        ) { Text(stringResource(R.string.subscription_compare)) }

        // Recovery is NOT gated by `purchaseOpen`: that answers "may this seller buy?", and
        // recovering a purchase already made is not buying. It re-queries Play and re-verifies
        // through a route that is served while the launch flag is off, so a paying seller who
        // reinstalled can always get their plan back.
        Text(
            stringResource(R.string.subscription_play_guidance),
            style = MaterialTheme.typography.bodySmall,
            color = MaterialTheme.colorScheme.onSurfaceVariant,
        )
        TextButton(
            onClick = onRecoverPurchases,
            enabled = billingState == BillingState.Ready,
            modifier = Modifier.fillMaxWidth().heightIn(min = spacing.minimumTouchTarget),
        ) { Text(stringResource(R.string.subscription_recover)) }
    }
}

@Composable
fun AiAssistantScreen(onBack: () -> Unit, vm: OperationsViewModel = hiltViewModel()) {
    val messages by vm.chat.collectAsStateWithLifecycle()
    val busy by vm.busy.collectAsStateWithLifecycle()
    val error by vm.error.collectAsStateWithLifecycle()
    val config by vm.entitlements.config.collectAsStateWithLifecycle()
    var input by rememberSaveable { mutableStateOf("") }

    AiAssistantContent(
        messages = messages,
        entitlements = config?.entitlements,
        busy = busy,
        error = error,
        input = input,
        onInputChange = { input = it },
        onBack = onBack,
        onSend = { vm.sendChat(input); input = "" },
        onRetry = vm::retryChat,
        // Clearing the conversation is irreversible and local, so it is confirmed in a sheet the
        // page raises; this runs after the confirmation.
        onReset = vm::resetChat,
    )
}

/**
 * The assistant, as a function of its state.
 *
 * A top bar whose overflow holds "بدء محادثة جديدة" (which asks first), an information banner
 * saying answers are generated and can be wrong, the quota meter, the conversation as bubbles
 * and the composer at the bottom. While an answer is being written a typing bubble stands in the
 * conversation; the chat stays on screen and the send button waits.
 *
 * Unlike the other pages here, an empty list is the truth on arrival: nothing loads on entry, so
 * a chat with no messages is a chat nobody has started, and the page says what the box is for.
 */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun AiAssistantContent(
    messages: List<Pair<Boolean, String>>,
    entitlements: Map<String, EntitlementDto>?,
    busy: Boolean,
    error: String?,
    input: String,
    onInputChange: (String) -> Unit,
    onBack: () -> Unit,
    onSend: () -> Unit,
    onRetry: () -> Unit,
    onReset: () -> Unit,
) {
    val spacing = LocalOrderakSpacing.current
    val locale = LocalConfiguration.current.locales[0]
    var confirmingReset by rememberSaveable { mutableStateOf(false) }
    OperationPage(
        title = stringResource(R.string.ai_assistant_title),
        onBack = onBack,
        // `busy` is not passed: it would replace the whole conversation with a loading placeholder.
        error = error,
        onRetry = onRetry,
        onOverflow = { confirmingReset = true },
        overflowDescription = stringResource(R.string.ai_reset),
        bottomBar = {
            Composer(
                value = input,
                onValueChange = { onInputChange(it.take(2000)) },
                onSend = { if (input.isNotBlank() && !busy) onSend() },
                placeholder = stringResource(R.string.ai_message),
                sendDescription = stringResource(R.string.common_send),
            )
        },
    ) {
        Banner(state = BannerState.Information, title = stringResource(R.string.ai_disclosure))
        // The quota as a count against a limit, drawn the one way this app draws one:
        // `formatCountOfLimit` keeps an Arabic-Indic count and its ceiling from reordering. A mode
        // "unlimited", or a value the snapshot does not carry, is a count without a ceiling.
        entitlements?.get(FeatureKeys.MAX_AI_REQUESTS_PER_MONTH)?.let { quota ->
            quota.used?.let { used ->
                val limit = if (quota.mode == "unlimited") null else (quota.value as? JsonPrimitive)?.intOrNull
                Text(
                    stringResource(R.string.usage_ai_requests) + ": " +
                        if (limit == null) {
                            stringResource(R.string.usage_value_unlimited, formatCount(used, locale))
                        } else {
                            formatCountOfLimit(used, limit, locale)
                        },
                    style = MaterialTheme.typography.bodySmall,
                )
            }
        }
        if (messages.isEmpty()) {
            Text(
                stringResource(R.string.ai_empty_hint),
                style = MaterialTheme.typography.bodyMedium,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
            )
        }
        messages.forEach { (seller, text) -> ChatBubble(text = text, mine = seller) }
        if (busy) {
            ChatBubble(text = stringResource(R.string.ai_typing), mine = false)
        }
    }

    if (confirmingReset) {
        ModalBottomSheet(
            onDismissRequest = { confirmingReset = false },
            sheetState = rememberModalBottomSheetState(skipPartiallyExpanded = true),
            containerColor = MaterialTheme.colorScheme.surface,
            dragHandle = null,
            shape = RoundedCornerShape(spacing.space0),
        ) {
            ConfirmSheet(
                // Not while a question is sending: the reply would land in a cleared chat as an
                // answer with no question before it.
                state = if (busy) ConfirmSheetState.InProgress else ConfirmSheetState.Destructive,
                title = stringResource(R.string.ai_reset_title),
                message = stringResource(R.string.ai_reset_body),
                confirmLabel = stringResource(R.string.ai_reset),
                cancelLabel = stringResource(R.string.common_cancel),
                onConfirm = { confirmingReset = false; onReset() },
                onCancel = { confirmingReset = false },
            )
        }
    }
}

internal tailrec fun Context.findActivity(): Activity? = when (this) {
    is Activity -> this
    is ContextWrapper -> baseContext.findActivity()
    else -> null
}

@Composable
fun DeletionStatusScreen(onBack: () -> Unit, vm: OperationsViewModel = hiltViewModel()) {
    val request by vm.deletionStatus.collectAsStateWithLifecycle()
    val loaded by vm.deletionLoaded.collectAsStateWithLifecycle()
    val busy by vm.busy.collectAsStateWithLifecycle()
    val error by vm.error.collectAsStateWithLifecycle()
    LaunchedEffect(Unit) { vm.loadDeletionStatus() }
    DeletionStatusContent(
        request = request,
        loaded = loaded,
        busy = busy,
        error = error,
        onBack = onBack,
        onRetry = vm::loadDeletionStatus,
    )
}

/**
 * The account-deletion status, as a function of its state.
 *
 * Read-only: it makes the right to deletion visible, with dates attached. A card with a
 * three-step timeline (submitted, verified, completes by the deadline), then what is deleted and
 * what the law may keep, in plain words. Requesting and cancelling are not here; the request
 * lives in حسابي, and with none this page says so and points there.
 *
 * [loaded] is separate from [request] because null is a real answer here ("you have no deletion
 * request") and it is also the seed. Without the flag this page told a seller with a pending
 * request that they had none for as long as the call took, which on this page is the worst thing
 * it could say.
 */
@Composable
fun DeletionStatusContent(
    request: DeletionRequestDto?,
    loaded: Boolean,
    busy: Boolean,
    error: String?,
    onBack: () -> Unit,
    onRetry: () -> Unit,
) {
    val spacing = LocalOrderakSpacing.current
    val locale = LocalConfiguration.current.locales[0]
    OperationPage(
        title = stringResource(R.string.deletion_status_title),
        onBack = onBack,
        busy = busy || !loaded,
        error = error,
        onRetry = onRetry,
        loading = SkeletonVariant.DetailBlock,
    ) {
        if (request == null) {
            EmptyState(
                kind = EmptyStateKind.Empty,
                title = stringResource(R.string.deletion_status_none),
                message = stringResource(R.string.deletion_none_pointer),
                icon = Icons.Outlined.Inbox,
            )
        } else {
            val pending = stringResource(R.string.deletion_step_pending)
            Surface(
                shape = MaterialTheme.shapes.large,
                color = MaterialTheme.colorScheme.surfaceContainerLowest,
                modifier = Modifier.fillMaxWidth(),
            ) {
                StepList(
                    steps = listOf(
                        StepItem(
                            stringResource(R.string.deletion_step_submitted),
                            formatServerDate(request.requested_at, locale) ?: pending,
                            done = request.requested_at != null,
                        ),
                        StepItem(
                            stringResource(R.string.deletion_step_verified),
                            formatServerDate(request.verified_at, locale) ?: pending,
                            done = request.verified_at != null,
                        ),
                        StepItem(
                            stringResource(R.string.deletion_step_completes),
                            formatServerDate(request.completed_at, locale)
                                ?: formatServerDate(request.deadline_at, locale)?.let { stringResource(R.string.deletion_step_by, it) }
                                ?: pending,
                            done = request.completed_at != null,
                        ),
                    ),
                    modifier = Modifier.padding(spacing.space4),
                )
            }
            request.notes?.takeIf { it.isNotBlank() }?.let {
                Text(it, style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
            }
        }
        SectionHeader(title = stringResource(R.string.deletion_deleted_title))
        Text(stringResource(R.string.deletion_deleted_body), style = MaterialTheme.typography.bodyMedium)
        SectionHeader(title = stringResource(R.string.deletion_kept_title))
        Text(stringResource(R.string.deletion_kept_body), style = MaterialTheme.typography.bodyMedium)
    }
}

/**
 * The plan's name in the seller's language. A plan the app has no name for keeps the name the
 * backend sent, because an unknown plan is the backend's to name, not ours to guess.
 */
@Composable
private fun localizedPlanName(planKey: String?, backendName: String): String = when (planKey) {
    "free" -> stringResource(R.string.plan_free)
    "paid1" -> stringResource(R.string.plan_paid1)
    "paid2" -> stringResource(R.string.plan_paid2)
    "paid3" -> stringResource(R.string.plan_paid3)
    else -> backendName
}

/** The subscription state in words; a state the app does not know is shown as sent. */
@Composable
private fun localizedSubscriptionStatus(status: String): String = when (status) {
    "active" -> stringResource(R.string.subscription_status_active)
    "grace" -> stringResource(R.string.subscription_status_grace)
    "canceled" -> stringResource(R.string.subscription_status_canceled)
    else -> status
}
