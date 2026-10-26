package app.orderak.seller.feature.orders

import android.content.Intent
import android.net.Uri
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.PickVisualMediaRequest
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.outlined.AttachFile
import androidx.compose.material.icons.outlined.Person
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material.icons.automirrored.filled.Chat
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Button
import androidx.compose.material3.Card
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.Scaffold
import androidx.compose.material3.SnackbarHost
import androidx.compose.material3.SnackbarHostState
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
import androidx.compose.ui.platform.LocalConfiguration
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.heading
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.unit.dp
import androidx.hilt.navigation.compose.hiltViewModel
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import app.orderak.seller.core.phone.CustomerPhone
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.automirrored.outlined.KeyboardArrowRight
import androidx.compose.material3.ModalBottomSheet
import androidx.compose.material3.rememberModalBottomSheetState
import androidx.compose.ui.semantics.Role
import app.orderak.seller.core.money.Money
import app.orderak.seller.core.text.formatNumber
import app.orderak.seller.core.ui.Avatar
import app.orderak.seller.core.ui.BottomActionBar
import app.orderak.seller.core.ui.ConfirmSheet
import app.orderak.seller.core.ui.ConfirmSheetState
import app.orderak.seller.core.ui.KeyValueRow
import app.orderak.seller.core.ui.MoneyText
import app.orderak.seller.core.ui.SectionHeader
import app.orderak.seller.core.ui.StatusStepper
import app.orderak.seller.core.ui.TopBar
import app.orderak.seller.core.ui.TopBarAction
import app.orderak.seller.core.ui.isolated
import java.text.DateFormat
import app.orderak.seller.R
import app.orderak.seller.core.ui.FeatureAvailability
import app.orderak.seller.data.db.OrderWithItems
import app.orderak.seller.core.money.formatAmountLabel
import app.orderak.seller.core.text.formatCount
import app.orderak.seller.core.ui.FeatureGate
import app.orderak.seller.core.ui.theme.LocalOrderakSpacing
import app.orderak.seller.data.billing.FeatureKeys.OCR_RECEIPT_ASSISTANCE
import app.orderak.seller.data.db.PaymentEntity
import app.orderak.seller.domain.OrderStatus
import app.orderak.seller.domain.PayMethod
import java.text.SimpleDateFormat
import java.util.Date
import app.orderak.seller.core.ui.EmptyState
import app.orderak.seller.core.ui.EmptyStateKind

/** S6 — order details + status stepper + S6a payment-proof verification. */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun OrderDetailsScreen(
    onBack: () -> Unit,
    onOpenCustomer: (String) -> Unit = {},
    viewModel: OrderDetailsViewModel = hiltViewModel()
) {
    // LocalConfiguration, not LocalContext.resources.configuration: the latter is
    // not read observably, so formatted dates and amounts would not recompose on
    // a language change (LocalContextConfigurationRead lint). Declared once for
    // the screen so money and dates cannot end up on different numeral systems.
    val locale = LocalConfiguration.current.locales[0]
    val orderWithItems by viewModel.order.collectAsStateWithLifecycle()
    val answered by viewModel.answered.collectAsStateWithLifecycle()
    val payments by viewModel.payments.collectAsStateWithLifecycle()
    val countryIso by viewModel.countryIso.collectAsStateWithLifecycle()
    val proof by viewModel.proof.collectAsStateWithLifecycle()
    val context = LocalContext.current
    val entitlementManager = viewModel.entitlementManager
    var confirmCancel by rememberSaveable { mutableStateOf(false) }
    var confirmDiscard by rememberSaveable { mutableStateOf(false) }
    val refusalCode by viewModel.refusalCode.collectAsStateWithLifecycle()
    val snackbarHostState = remember { SnackbarHostState() }
    val statusFailedMessage = stringResource(R.string.order_status_update_failed)

    LaunchedEffect(viewModel, statusFailedMessage) {
        viewModel.actionFailed.collect { snackbarHostState.showSnackbar(statusFailedMessage) }
    }

    val picker = rememberLauncherForActivityResult(ActivityResultContracts.PickVisualMedia()) { uri ->
        uri?.let(viewModel::verifyProof)
    }

    OrderDetailsContent(
        orderWithItems = orderWithItems,
        answered = answered,
        payments = payments,
        countryIso = countryIso,
        proof = proof,
        refusalCode = refusalCode,
        ocrAvailability = viewModel.featureAvailability.decide(OCR_RECEIPT_ASSISTANCE).availability,
        confirmCancel = confirmCancel,
        confirmDiscard = confirmDiscard,
        actions = OrderDetailsActions(
            advance = viewModel::advance,
            markPaidManually = viewModel::markPaidManually,
            dismissProofResult = viewModel::dismissProofResult,
            cancel = { viewModel.cancel(onDone = it) },
            discardRefused = { viewModel.discardRefused(onDone = it) },
        ),
        onPickProof = {
            picker.launch(PickVisualMediaRequest(ActivityResultContracts.PickVisualMedia.ImageOnly))
        },
        onConfirmCancel = { confirmCancel = it },
        onConfirmDiscard = { confirmDiscard = it },
        onOpenIntent = { intent -> runCatching { context.startActivity(intent) } },
        onBack = onBack,
        onOpenCustomer = onOpenCustomer,
        snackbarHostState = snackbarHostState,
    )
}

/** What the order page can ask the view model to do, as data. */
data class OrderDetailsActions(
    val advance: () -> Unit = {},
    val markPaidManually: () -> Unit = {},
    val dismissProofResult: () -> Unit = {},
    val cancel: (() -> Unit) -> Unit = {},
    val discardRefused: (() -> Unit) -> Unit = {},
)

/**
 * One order, as a function of its state.
 *
 * [payments] is nullable for the same reason the lists elsewhere are: it seeded
 * `emptyList()`, so the page said "no payment recorded" about an order whose
 * payment may well be recorded — on the screen a seller opens precisely to check
 * whether a transfer landed.
 */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun OrderDetailsContent(
    orderWithItems: OrderWithItems?,
    /**
     * True once the query has answered. Without it a missing order is
     * indistinguishable from an unread one. See `OrderDetailsViewModel.answered`.
     */
    answered: Boolean,
    payments: List<PaymentEntity>?,
    countryIso: String?,
    proof: ProofUiState,
    refusalCode: String?,
    /**
     * The OCR gate's decision, already resolved.
     *
     * Not the resolver: it needs an EntitlementManager and therefore a Hilt
     * graph, so this screen could not be rendered in any of its three gate
     * states.
     */
    ocrAvailability: FeatureAvailability,
    confirmCancel: Boolean,
    confirmDiscard: Boolean,
    actions: OrderDetailsActions,
    onPickProof: () -> Unit,
    onConfirmCancel: (Boolean) -> Unit,
    onConfirmDiscard: (Boolean) -> Unit,
    onOpenIntent: (android.content.Intent) -> Unit,
    onBack: () -> Unit,
    onOpenCustomer: (String) -> Unit,
    snackbarHostState: SnackbarHostState = remember { SnackbarHostState() },
) {
    val locale = LocalConfiguration.current.locales[0]
    // The screen's rhythm, from the system. Two of the values here were off the
    // 4dp scale - a 6dp gap and a 2dp divider inset - and are the reason this
    // screen's baselines move; 6 and 2 are not on the scale and never were.
    val spacing = LocalOrderakSpacing.current
    val data = orderWithItems
    if (data == null) {
        if (!answered) {
            Box(Modifier.fillMaxSize(), contentAlignment = Alignment.Center) { CircularProgressIndicator() }
            return
        }
        // The query answered and there is no such order. This used to be the same
        // branch as "not read yet", so the page waited for ever on a row that was
        // never coming — and there was no top bar to escape with either, because
        // the Scaffold below is drawn after the null check. The back control is
        // not decoration here: without it the screen is a trap.
        Scaffold(
            topBar = {
                TopBar(
                    title = stringResource(R.string.order_details_missing_title),
                    onBack = onBack,
                    backDescription = stringResource(R.string.common_back),
                )
            },
        ) { padding ->
            Box(Modifier.fillMaxSize().padding(padding)) {
                EmptyState(kind = EmptyStateKind.Empty, title = stringResource(R.string.order_details_missing_body))
            }
        }
        return
    }
    val order = data.order
    val status = runCatching { OrderStatus.valueOf(order.status) }.getOrDefault(OrderStatus.NEW) // Fix(#5)

    // S6a result dialog
    (proof as? ProofUiState.Result)?.let { r ->
        AlertDialog(
            onDismissRequest = actions.dismissProofResult,
            confirmButton = {
                TextButton(onClick = actions.dismissProofResult) { Text(stringResource(R.string.common_ok)) }
            },
            title = {
                Text(
                    if (r.result.verified) stringResource(R.string.payment_verified_ok)
                    else stringResource(R.string.payment_flagged_title)
                )
            },
            text = {
                Column {
                    if (!r.result.verified) {
                        if (!r.result.amountMatched) Text(stringResource(R.string.payment_flag_amount))
                        if (r.result.ref == null) Text(stringResource(R.string.payment_flag_ref))
                        if (r.result.duplicateRef) Text(stringResource(R.string.payment_flag_dup))
                    }
                    // The payment is recorded locally even when the order could not
                    // be moved to PAID, so "auto-confirmed" above would otherwise
                    // overstate what happened.
                    if (r.result.verified && !r.statusApplied) {
                        Text(
                            stringResource(R.string.order_status_update_failed),
                            color = MaterialTheme.colorScheme.error
                        )
                    }
                    Spacer(Modifier.height(spacing.space2))
                    Text(stringResource(R.string.payment_disclaimer),
                        style = MaterialTheme.typography.bodySmall,
                        color = MaterialTheme.colorScheme.onSurfaceVariant)
                }
            }
        )
    }

    // The order's name: the server's number when it has one, this phone's own otherwise,
    // written without grouping and isolated so its digits never reorder inside Arabic.
    val number = isolated("#" + formatNumber(order.remoteId ?: order.id, locale))
    val timeFormat = remember(locale) { DateFormat.getDateTimeInstance(DateFormat.SHORT, DateFormat.SHORT, locale) }
    // Disabled until the server has acknowledged the order (BR-305a). A transition
    // applied here alone would be a pipeline that exists on one phone: the server
    // would hold the order at NEW, a reinstall would replay work already done, and a
    // local-only cancellation would restore stock here while the server kept it
    // consumed. The banner at the top says why.
    val acknowledged = !order.livesOnlyOnThisPhone
    val next = status.next
    val whatsApp = stringResource(R.string.order_whatsapp)
    Scaffold(
        snackbarHost = { SnackbarHost(snackbarHostState) },
        topBar = {
            TopBar(
                title = stringResource(R.string.order_heading, number),
                subtitle = timeFormat.format(Date(order.createdAt)),
                onBack = onBack,
                backDescription = stringResource(R.string.common_back),
                actions = listOf(
                    TopBarAction(
                        icon = Icons.AutoMirrored.Filled.Chat,
                        description = whatsApp,
                        onClick = {
                            val digits = try {
                                val util = com.google.i18n.phonenumbers.PhoneNumberUtil.getInstance()
                                val parsed = util.parse(order.buyerPhone, "EG")
                                util.format(parsed, com.google.i18n.phonenumbers.PhoneNumberUtil.PhoneNumberFormat.E164)
                                    .removePrefix("+")
                            } catch (_: Exception) {
                                order.buyerPhone.filter(Char::isDigit)
                            }
                            onOpenIntent(Intent(Intent.ACTION_VIEW, Uri.parse("https://wa.me/$digits")))
                        },
                    ),
                ),
            )
        },
        bottomBar = {
            // The next step, named for what happens, and cancelling in the secondary
            // slot while it is allowed. A finished or cancelled order has neither.
            if (next != null || status.canCancel) {
                BottomActionBar(
                    primaryLabel = next?.let { nextStepLabel(it) } ?: stringResource(R.string.order_cancel),
                    onPrimary = if (next != null) actions.advance else { { onConfirmCancel(true) } },
                    primaryEnabled = acknowledged,
                    disabledReason = if (!acknowledged) stringResource(R.string.order_bar_unsent_reason) else null,
                    secondaryLabel = if (next != null && status.canCancel) stringResource(R.string.order_cancel) else null,
                    onSecondary = if (next != null && status.canCancel && acknowledged) { { onConfirmCancel(true) } } else null,
                )
            }
        },
    ) { padding ->
        Column(
            Modifier.fillMaxSize().padding(padding).padding(spacing.space4).verticalScroll(rememberScrollState()),
            verticalArrangement = Arrangement.spacedBy(spacing.space4),
        ) {
            // Above the order, not below it. A seller who opens this screen to
            // check whether the order is safe should not have to scroll to find
            // out that it is not.
            if (order.livesOnlyOnThisPhone) {
                LocalOnlyOrderBanner(
                    refusalCode = refusalCode,
                    onDiscard = refusalCode?.let { { onConfirmDiscard(true) } },
                )
            }

            // Where the order stands: the chip, then the steps it moves through.
            Column(verticalArrangement = Arrangement.spacedBy(spacing.space3)) {
                StatusChip(status)
                val steps = listOf(OrderStatus.NEW, OrderStatus.CONFIRMED, OrderStatus.PAID, OrderStatus.SHIPPED, OrderStatus.DONE)
                StatusStepper(
                    steps = steps.map { statusLabel(it) },
                    currentIndex = steps.indexOf(status).coerceAtLeast(0),
                    cancelledLabel = if (status == OrderStatus.CANCELLED) statusLabel(OrderStatus.CANCELLED) else null,
                )
            }

            // The customer, as a row that opens their page. The contract has always
            // declared CustomerRoute as an exit from here. The key is derived exactly as
            // the refresher derives it (CustomerPhone.keyFor), because a key built any
            // other way addresses a row that does not exist.
            val buyer = order.buyerName ?: order.buyerPhone
            val openCustomer = stringResource(R.string.customer_open)
            Row(
                modifier = Modifier
                    .fillMaxWidth()
                    .heightIn(min = spacing.minimumTouchTarget)
                    .clickable(role = Role.Button, onClickLabel = openCustomer) {
                        onOpenCustomer(CustomerPhone.keyFor(order.buyerPhone, countryIso))
                    },
                verticalAlignment = Alignment.CenterVertically,
                horizontalArrangement = Arrangement.spacedBy(spacing.space3),
            ) {
                Avatar(name = buyer)
                Column(Modifier.weight(1f)) {
                    Text(buyer, style = MaterialTheme.typography.titleMedium)
                    Text(
                        isolated(order.buyerPhone),
                        style = MaterialTheme.typography.bodySmall,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                    )
                }
                Icon(
                    Icons.AutoMirrored.Outlined.KeyboardArrowRight,
                    contentDescription = null,
                    tint = MaterialTheme.colorScheme.onSurfaceVariant,
                )
            }

            // The products, each with its line total, then the total as the largest figure.
            Column {
                SectionHeader(title = stringResource(R.string.order_items_title))
                data.items.forEach { item ->
                    Row(Modifier.fillMaxWidth().padding(vertical = spacing.space1), verticalAlignment = Alignment.CenterVertically) {
                        Text(
                            isolated(formatCount(item.qty, locale)) + " ×",
                            style = MaterialTheme.typography.bodyMedium,
                        )
                        Spacer(Modifier.width(spacing.space2))
                        Text(item.productName, Modifier.weight(1f), style = MaterialTheme.typography.bodyMedium)
                        MoneyText(Money(item.qty * item.priceMinor, order.currency), style = MaterialTheme.typography.bodyMedium)
                    }
                }
                HorizontalDivider(Modifier.padding(vertical = spacing.space2))
                Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
                    Text(stringResource(R.string.order_total), Modifier.weight(1f), style = MaterialTheme.typography.titleMedium)
                    MoneyText(
                        Money(order.totalMinor, order.currency),
                        style = MaterialTheme.typography.headlineMedium.copy(color = MaterialTheme.colorScheme.primary),
                    )
                }
            }

            // The payment: how it is to be paid, the way to record it by hand while the
            // status allows, the receipt check behind its gate, and what has been recorded.
            Column(verticalArrangement = Arrangement.spacedBy(spacing.space2)) {
                SectionHeader(title = stringResource(R.string.payment_section_title))
                KeyValueRow(
                    label = stringResource(R.string.order_paid_with),
                    value = payMethodLabel(runCatching { PayMethod.valueOf(order.payMethod) }.getOrDefault(PayMethod.COD)),
                )
                // Only until Paid.
                if (status == OrderStatus.NEW || status == OrderStatus.CONFIRMED) {
                    if (proof is ProofUiState.Running) {
                        Row(verticalAlignment = Alignment.CenterVertically) {
                            CircularProgressIndicator(Modifier.size(spacing.iconMedium), strokeWidth = spacing.space1 / 2)
                            Spacer(Modifier.width(spacing.space3))
                            Text(stringResource(R.string.payment_checking))
                        }
                    } else {
                        FeatureGate(availability = ocrAvailability, onUpgrade = null) {
                            Button(
                                onClick = onPickProof,
                                modifier = Modifier.fillMaxWidth().heightIn(min = spacing.minimumTouchTarget),
                            ) { Text(stringResource(R.string.payment_verify)) }
                        }
                        OutlinedButton(
                            onClick = actions.markPaidManually,
                            modifier = Modifier.fillMaxWidth().heightIn(min = spacing.minimumTouchTarget),
                        ) { Text(stringResource(R.string.payment_manual)) }
                    }
                }
                // Three states, not two: null says nothing, because it knows nothing; empty
                // says no payment has been recorded. A seller opens this page precisely to
                // check whether a transfer landed.
                if (payments != null && payments.isEmpty()) {
                    Text(
                        stringResource(R.string.payment_history_none),
                        style = MaterialTheme.typography.bodyMedium,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                    )
                }
                if (!payments.isNullOrEmpty()) {
                    val dateFormat = remember(locale) { SimpleDateFormat("yyyy-MM-dd HH:mm", locale) }
                    Text(stringResource(R.string.payment_history_title), style = MaterialTheme.typography.titleSmall)
                    payments.forEach { payment ->
                        Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween) {
                            Column(Modifier.weight(1f)) {
                                Row(verticalAlignment = Alignment.CenterVertically) {
                                    Text(stringResource(R.string.payment_ref_label, payment.ref), style = MaterialTheme.typography.bodyMedium)
                                    Spacer(Modifier.width(spacing.space1))
                                    Text(
                                        if (payment.verified) stringResource(R.string.payment_verified_badge)
                                        else stringResource(R.string.payment_flagged_badge),
                                        style = MaterialTheme.typography.labelSmall,
                                        color = if (payment.verified) MaterialTheme.colorScheme.primary else MaterialTheme.colorScheme.error,
                                    )
                                }
                                Text(
                                    formatAmountLabel(payment.amountMinor, payment.currency, locale),
                                    style = MaterialTheme.typography.bodySmall,
                                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                                )
                                Text(
                                    dateFormat.format(Date(payment.createdAt)),
                                    style = MaterialTheme.typography.bodySmall,
                                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                                )
                            }
                            if (!payment.proofPath.isNullOrBlank()) {
                                // The one mark that a receipt exists, drawn as an icon a screen
                                // reader can describe and a locale can translate (not an emoji).
                                Icon(
                                    imageVector = Icons.Outlined.AttachFile,
                                    contentDescription = stringResource(R.string.payment_proof_attached),
                                    modifier = Modifier.size(spacing.iconSmall),
                                    tint = MaterialTheme.colorScheme.onSurfaceVariant,
                                )
                            }
                        }
                        if (payment != payments.last()) HorizontalDivider(Modifier.padding(vertical = spacing.space1))
                    }
                }
            }

            order.note?.let {
                Column {
                    SectionHeader(title = stringResource(R.string.order_note_title))
                    Text(it, style = MaterialTheme.typography.bodyMedium)
                }
            }
            Spacer(Modifier.height(spacing.space6))
        }
    }

    if (confirmDiscard) {
        ModalBottomSheet(
            onDismissRequest = { onConfirmDiscard(false) },
            sheetState = rememberModalBottomSheetState(skipPartiallyExpanded = true),
            containerColor = MaterialTheme.colorScheme.surface,
            dragHandle = null,
            shape = RoundedCornerShape(spacing.space0),
        ) {
            ConfirmSheet(
                state = ConfirmSheetState.Destructive,
                title = stringResource(R.string.order_refused_discard),
                message = stringResource(R.string.order_refused_discard_confirm),
                confirmLabel = stringResource(R.string.order_refused_discard),
                cancelLabel = stringResource(R.string.common_cancel),
                onConfirm = { onConfirmDiscard(false); actions.discardRefused(onBack) },
                onCancel = { onConfirmDiscard(false) },
            )
        }
    }

    if (confirmCancel) {
        ModalBottomSheet(
            onDismissRequest = { onConfirmCancel(false) },
            sheetState = rememberModalBottomSheetState(skipPartiallyExpanded = true),
            containerColor = MaterialTheme.colorScheme.surface,
            dragHandle = null,
            shape = RoundedCornerShape(spacing.space0),
        ) {
            // The consequence in one sentence, and the verb on the button, in the error
            // colour: what cannot be undone says so.
            ConfirmSheet(
                state = ConfirmSheetState.Destructive,
                title = stringResource(R.string.order_cancel_sheet_title, number),
                message = stringResource(R.string.order_cancel_sheet_body),
                confirmLabel = stringResource(R.string.order_cancel),
                cancelLabel = stringResource(R.string.common_back),
                onConfirm = { onConfirmCancel(false); actions.cancel(onBack) },
                onCancel = { onConfirmCancel(false) },
            )
        }
    }
}

/** What moving the order on to [status] is called: the step named for what happens. */
@Composable
private fun nextStepLabel(status: OrderStatus): String = stringResource(
    when (status) {
        OrderStatus.CONFIRMED -> R.string.order_next_confirm
        OrderStatus.PAID -> R.string.order_next_paid
        OrderStatus.SHIPPED -> R.string.order_next_shipped
        OrderStatus.DONE -> R.string.order_next_done
        // Nothing moves an order to NEW or CANCELLED; the name is only a fallback.
        else -> R.string.order_advance_to_fallback
    },
)
