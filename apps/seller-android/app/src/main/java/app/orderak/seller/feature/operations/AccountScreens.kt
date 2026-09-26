package app.orderak.seller.feature.operations
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
import app.orderak.seller.core.ui.NoticeBanner
import app.orderak.seller.core.ui.PlanUsageRow
import app.orderak.seller.core.ui.PlanUsageRowItem
import app.orderak.seller.core.ui.planUsageRows
import app.orderak.seller.core.ui.SemanticRole
import app.orderak.seller.core.locale.AppLocales
import app.orderak.seller.core.text.formatCount
import app.orderak.seller.core.ui.FullScreenEmpty
import app.orderak.seller.core.ui.FullScreenError
import app.orderak.seller.core.ui.FullScreenLoading
import app.orderak.seller.core.ui.backendErrorResource
import app.orderak.seller.data.billing.EntitlementManager
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
    SubscriptionContent(
        planName = config?.plan_name,
        subscriptionStatus = config?.subscription_status,
        currentPeriodEnd = config?.current_period_end,
        pendingEffectiveAt = config?.pending_effective_at,
        usage = config?.let(::planUsageRows).orEmpty(),
        billingState = billingState,
        purchaseOpen = vm.entitlements.isPurchaseOpen(),
        onBack = onBack,
        onViewPlans = onViewPlans,
        onRecoverPurchases = vm.billingManager::recoverPurchases,
    )
}

/**
 * The subscription page, as a function of its state.
 *
 * [planName] is nullable and NOT defaulted to "Free" here. The screen read
 * `config?.plan_name ?: "Free"` with no loading state at all, so every paying
 * seller opening it was told they were on the free plan until entitlements
 * arrived — the same defect حسابي had, on the one page whose entire subject is
 * what the seller is paying for.
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
) {
    OperationPage(
        title = stringResource(R.string.subscription_title),
        onBack = onBack,
        // Loading until entitlements answer. There is nothing on this page that
        // can be said truthfully without them.
        busy = planName == null,
    ) {
        Text(
            // Not null here: the page is busy until it is.
            stringResource(R.string.settings_current_plan, planName.orEmpty()),
            style = MaterialTheme.typography.titleLarge,
        )
        Text(
            // A missing status is a display gap, not a claim about money, so it
            // keeps the old fallback where plan_name deliberately does not.
            stringResource(R.string.subscription_status, subscriptionStatus ?: "active"),
            style = MaterialTheme.typography.bodyLarge,
        )
        currentPeriodEnd?.let {
            Text(stringResource(R.string.subscription_period_end, it))
        }
        pendingEffectiveAt?.let {
            Text(stringResource(R.string.plan_change_pending, it))
        }
        when (billingState) {
            is BillingState.VerificationPending, BillingState.Verifying ->
                Text(stringResource(R.string.subscription_verification_pending))
            is BillingState.Error ->
                NoticeBanner(
                    role = SemanticRole.Danger,
                    title = stringResource(R.string.subscription_verification_error),
                    message = stringResource(R.string.subscription_verification_error_body),
                )
            else -> Unit
        }

        // What the seller actually came here to see. The screen showed a plan
        // name, a status string and a recovery button, and never once said how
        // much of the plan was used — so "am I close to a limit?" could only be
        // answered by hitting one.
        //
        // The rows come from core/ui/PlanUsage.kt, shared with the dashboard
        // card. This screen used to build its own and drop every unlimited
        // entitlement — `if (limit == null) null` — while the dashboard drew it
        // as a count, so a seller on a plan with an unlimited allowance saw it in
        // one place and not the other.
        // usage rows are passed in, already resolved from the config

        if (usage.isNotEmpty()) {
            Text(
                stringResource(R.string.plan_usage_title),
                style = MaterialTheme.typography.titleMedium,
            )
            usage.forEach { row -> PlanUsageRowItem(row) }
        }

        // Say the true thing, and then stop offering the thing. The banner used
        // to sit ABOVE a Play guidance line and a recover-purchases button that
        // both rendered unconditionally, so the screen told a seller purchasing
        // was closed and then showed them two ways to try it — advisory, not a
        // gate. The *banner* is gated now, and it is the same decision every other
        // buying affordance in the app reads (I-5).
        if (!purchaseOpen) {
            NoticeBanner(
                role = SemanticRole.Commerce,
                title = stringResource(R.string.subscription_purchase_closed_title),
                message = stringResource(R.string.subscription_purchase_closed_body),
                // The banner said purchasing was closed and offered nothing,
                // while PlansScreen exists precisely to be READ while it is —
                // "للعرض طول ما الشراء مقفول". This screen declared PlansRoute as
                // an exit and had no control that reached it, so the one useful
                // thing a seller could still do here was unreachable from here.
                actionLabel = stringResource(R.string.paywall_view_plans),
                onAction = onViewPlans,
            )
        }

        // Recovery is NOT gated by `purchaseOpen`, and that is the point.
        //
        // `purchaseOpen` answers "may this seller buy?" — it is the backend's
        // `BILLING_ENABLED` launch gate. Recovering a purchase the seller has
        // already made is not buying: it re-queries Play and re-verifies through
        // `/api/v1/billing/google/verify`, which is absent from
        // `BILLING_ACQUISITION_ROUTES` and therefore served while that flag is off.
        // Play itself connects on `GOOGLE_PLAY_LIFECYCLE_ENABLED`, a separate flag,
        // so the machinery can be running while purchase is closed.
        //
        // Hiding it was indefensible on this screen's own copy: the closed banner
        // promises "Nothing you have changes", and the guidance line below tells
        // the seller to "Use purchase recovery after reinstalling or changing
        // devices". They read both and had no control to press, so a paying seller
        // who reinstalled while the launch flag was off could not get their plan
        // back — the exact case `recoverPurchases` exists for.
        Text(stringResource(R.string.subscription_play_guidance))
        OutlinedButton(
            onClick = onRecoverPurchases,
            enabled = billingState == BillingState.Ready,
            modifier = Modifier.fillMaxWidth(),
        ) { Text(stringResource(R.string.subscription_recover)) }

        // Offered in both purchase states, for the reason the categories banner
        // already gives: what the next plan includes is worth reading whether or
        // not anything is for sale. With purchase closed the banner above is
        // already the way there, so this button only exists to be the way there
        // when it is open.
        if (purchaseOpen) {
            TextButton(onClick = onViewPlans, modifier = Modifier.fillMaxWidth()) {
                Text(stringResource(R.string.paywall_view_plans))
            }
        }
    }
}

@Composable
fun AiAssistantScreen(onBack: () -> Unit, vm: OperationsViewModel = hiltViewModel()) {
    val messages by vm.chat.collectAsStateWithLifecycle()
    val busy by vm.busy.collectAsStateWithLifecycle()
    val error by vm.error.collectAsStateWithLifecycle()
    val config by vm.entitlements.config.collectAsStateWithLifecycle()
    var input by rememberSaveable { mutableStateOf("") }
    var confirmingReset by remember { mutableStateOf(false) }

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
        onReset = { confirmingReset = true },
    )

    // Clearing the conversation is irreversible and local, so it is confirmed
    // rather than immediate. It used to happen on the first tap, on a control
    // that sat next to the question box.
    if (confirmingReset) {
        AlertDialog(
            onDismissRequest = { confirmingReset = false },
            title = { Text(stringResource(R.string.ai_reset)) },
            text = { Text(stringResource(R.string.ai_reset_confirm)) },
            confirmButton = {
                TextButton(
                    onClick = {
                        vm.resetChat()
                        confirmingReset = false
                    },
                ) {
                    Text(stringResource(R.string.ai_reset), color = MaterialTheme.colorScheme.error)
                }
            },
            dismissButton = {
                TextButton(onClick = { confirmingReset = false }) {
                    Text(stringResource(R.string.common_cancel))
                }
            },
        )
    }
}

/**
 * The assistant, as a function of its state.
 *
 * Unlike the other pages in this file, an empty list here is the truth on
 * arrival: nothing loads on entry, so a chat with no messages is a chat nobody
 * has started. That is why this screen is the reason `_busy` could not simply
 * seed true for all six — it would have spun here forever.
 *
 * Its contract declares an empty state and it had none, drawing the disclosure
 * over blank space. It now says what the box is for.
 */

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
    OperationPage(
        title = stringResource(R.string.ai_assistant_title),
        onBack = onBack,
        busy = busy,
        error = error,
        onRetry = onRetry,
    ) {
        Text(stringResource(R.string.ai_disclosure), style = MaterialTheme.typography.bodySmall)
        entitlements?.get("max_ai_requests_per_month")?.let { quota ->
            quota.used?.let { used ->
                Text(
                    stringResource(R.string.usage_ai_requests) + ": " +
                        if (quota.mode == "unlimited") {
                            stringResource(R.string.usage_value_unlimited, formatCount(used, locale))
                        } else {
                            stringResource(
                                R.string.usage_value,
                                formatCount(used, locale),
                                formatCount(quota.value?.jsonPrimitive?.intOrNull ?: 0, locale),
                            )
                        },
                    style = MaterialTheme.typography.bodySmall,
                )
            }
        }
        if (messages.isEmpty()) {
            // The declared empty state, which this screen did not have: it drew
            // the disclosure and the quota over blank space. The input box stays
            // — a chat with nothing in it is waiting, not broken — so this is a
            // line rather than a FullScreenEmpty.
            Text(
                stringResource(R.string.ai_empty_hint),
                style = MaterialTheme.typography.bodyMedium,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
            )
        }
        messages.forEach { (seller, text) ->
            val isSeller = seller
            Card(
                modifier = Modifier.fillMaxWidth(),
                colors = if (isSeller) {
                    androidx.compose.material3.CardDefaults.cardColors(
                        containerColor = MaterialTheme.colorScheme.primaryContainer,
                    )
                } else {
                    androidx.compose.material3.CardDefaults.cardColors()
                },
            ) {
                Column(Modifier.padding(spacing.space3)) {
                    Text(
                        if (isSeller) stringResource(R.string.ai_you) else stringResource(R.string.ai_assistant_title),
                        style = MaterialTheme.typography.labelMedium,
                    )
                    Text(text, style = MaterialTheme.typography.bodyMedium)
                }
            }
        }
        OutlinedTextField(
            value = input,
            onValueChange = { onInputChange(it.take(2000)) },
            label = { Text(stringResource(R.string.ai_message)) },
            modifier = Modifier.fillMaxWidth(),
        )
        Button(
            enabled = input.isNotBlank() && !busy,
            onClick = { onSend() },
            modifier = Modifier.fillMaxWidth(),
        ) { Text(stringResource(R.string.common_send)) }
        TextButton(onClick = onReset) { Text(stringResource(R.string.ai_reset)) }
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
 * [loaded] is separate from [request] because null is a real answer here — "you
 * have no deletion request" — and it is also the seed. Without the flag this
 * page told a seller with a pending request that they had none, for as long as
 * the call took, which on this particular page is the worst thing it could say.
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
    OperationPage(
        title = stringResource(R.string.deletion_status_title),
        onBack = onBack,
        busy = busy || !loaded,
        error = error,
        onRetry = onRetry,
    ) {
        if (request == null) {
            Text(
                stringResource(R.string.deletion_status_none),
                style = MaterialTheme.typography.titleLarge,
            )
        } else {
            Text(
                stringResource(R.string.deletion_status_label, request.status),
                style = MaterialTheme.typography.titleLarge,
            )
            request.requested_at?.let { Text(stringResource(R.string.deletion_requested_at, it)) }
            request.deadline_at?.let { Text(stringResource(R.string.deletion_deadline_at, it)) }
            request.verified_at?.let { Text(stringResource(R.string.deletion_verified_at, it)) }
            request.completed_at?.let { Text(stringResource(R.string.deletion_completed_at, it)) }
            request.notes?.takeIf { it.isNotBlank() }?.let {
                Text(it, style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
            }
        }
        Spacer(Modifier.height(spacing.space2))
        Text(stringResource(R.string.deletion_status_help), style = MaterialTheme.typography.bodySmall)
    }
}
