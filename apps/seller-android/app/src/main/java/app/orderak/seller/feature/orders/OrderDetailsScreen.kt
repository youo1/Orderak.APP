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
import app.orderak.seller.R
import app.orderak.seller.core.ui.FeatureAvailability
import app.orderak.seller.data.db.OrderWithItems
import app.orderak.seller.core.money.formatAmountLabel
import app.orderak.seller.core.text.formatCount
import app.orderak.seller.core.ui.FeatureGate
import app.orderak.seller.core.ui.FullScreenEmpty
import app.orderak.seller.core.ui.theme.LocalOrderakSpacing
import app.orderak.seller.data.billing.FeatureKeys.OCR_RECEIPT_ASSISTANCE
import app.orderak.seller.data.db.PaymentEntity
import app.orderak.seller.domain.OrderStatus
import app.orderak.seller.domain.PayMethod
import java.text.SimpleDateFormat
import java.util.Date

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
                TopAppBar(
                    title = {
                        Text(
                            stringResource(R.string.order_details_missing_title),
                            modifier = Modifier.semantics { heading() },
                        )
                    },
                    navigationIcon = {
                        IconButton(onClick = onBack) {
                            Icon(
                                Icons.AutoMirrored.Filled.ArrowBack,
                                contentDescription = stringResource(R.string.common_back),
                            )
                        }
                    },
                )
            },
        ) { padding ->
            Box(Modifier.fillMaxSize().padding(padding)) {
                FullScreenEmpty(message = stringResource(R.string.order_details_missing_body))
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

    Scaffold(
        snackbarHost = { SnackbarHost(snackbarHostState) },
        topBar = {
            TopAppBar(
                title = { Text(stringResource(R.string.order_details_title, order.id), modifier = Modifier.semantics { heading() }) },
                navigationIcon = {
                    IconButton(onClick = onBack) {
                        Icon(Icons.AutoMirrored.Filled.ArrowBack, contentDescription = stringResource(R.string.common_back))
                    }
                },
                actions = {
                    IconButton(onClick = {
                        val digits = try {
                            val util = com.google.i18n.phonenumbers.PhoneNumberUtil.getInstance()
                            val parsed = util.parse(order.buyerPhone, "EG")
                            util.format(parsed, com.google.i18n.phonenumbers.PhoneNumberUtil.PhoneNumberFormat.E164)
                                .removePrefix("+")
                        } catch (_: Exception) {
                            order.buyerPhone.filter(Char::isDigit)
                        }
                        val intent = Intent(Intent.ACTION_VIEW, Uri.parse("https://wa.me/$digits"))
                        onOpenIntent(intent)
                    }) {
                        Icon(Icons.AutoMirrored.Filled.Chat, contentDescription = stringResource(R.string.order_whatsapp))
                    }
                }
            )
        }
    ) { padding ->
        Column(
            Modifier.fillMaxSize().padding(padding).padding(spacing.space4).verticalScroll(rememberScrollState()),
            verticalArrangement = Arrangement.spacedBy(spacing.space3)
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

            Card {
                Column(Modifier.fillMaxWidth().padding(spacing.space3)) {
                    Row(verticalAlignment = Alignment.CenterVertically) {
                        Column(Modifier.weight(1f)) {
                            Text(order.buyerName ?: order.buyerPhone, style = MaterialTheme.typography.titleMedium)
                            Text(order.buyerPhone, style = MaterialTheme.typography.bodySmall)
                        }
                        // The contract has always declared CustomerRoute as an
                        // exit from here and there was no way to reach it: from
                        // an order you could not get to the person who placed it,
                        // or to the rest of what they have bought.
                        //
                        // The key is derived exactly as the refresher derives it
                        // (CustomerPhone.keyFor), because a key built any other
                        // way addresses a row that does not exist.
                        IconButton(onClick = {
                            onOpenCustomer(CustomerPhone.keyFor(order.buyerPhone, countryIso))
                        }) {
                            Icon(
                                Icons.Outlined.Person,
                                contentDescription = stringResource(R.string.customer_open),
                            )
                        }
                        StatusChip(status)
                    }
                    order.note?.let {
                        Spacer(Modifier.height(spacing.space2))
                        Text(it, style = MaterialTheme.typography.bodyMedium)
                    }
                }
            }

            Card {
                Column(Modifier.fillMaxWidth().padding(spacing.space3)) {
                    data.items.forEach { item ->
                        Row(Modifier.fillMaxWidth().padding(vertical = spacing.space1)) {
                            Text(
                                "${formatCount(item.qty, locale)}×",
                                style = MaterialTheme.typography.bodyMedium,
                            )
                            Spacer(Modifier.width(spacing.space2))
                            Text(item.productName, Modifier.weight(1f), style = MaterialTheme.typography.bodyMedium)
                            Text(formatAmountLabel(item.qty * item.priceMinor, order.currency, locale),
                                style = MaterialTheme.typography.bodyMedium)
                        }
                    }
                    HorizontalDivider(Modifier.padding(vertical = spacing.space2))
                    Row(Modifier.fillMaxWidth()) {
                        Text(stringResource(R.string.order_total), Modifier.weight(1f),
                            style = MaterialTheme.typography.titleMedium)
                        Text(formatAmountLabel(order.totalMinor, order.currency, locale),
                            style = MaterialTheme.typography.titleMedium,
                            color = MaterialTheme.colorScheme.primary)
                    }
                }
            }

            // Payment section (S6a) — only until Paid
            if (status == OrderStatus.NEW || status == OrderStatus.CONFIRMED) {
                Card {
                    Column(Modifier.fillMaxWidth().padding(spacing.space3), verticalArrangement = Arrangement.spacedBy(spacing.space2)) {
                        Text(stringResource(R.string.payment_section_title), style = MaterialTheme.typography.titleMedium)
                        Text(payMethodLabel(runCatching { PayMethod.valueOf(order.payMethod) }.getOrDefault(PayMethod.COD)), style = MaterialTheme.typography.bodyMedium)
                        if (proof is ProofUiState.Running) {
                            // The system names this size: `iconMedium` is "a
                            // standalone icon: a leading slot, a control, an inline
                            // progress spinner", and the app's other four inline
                            // spinners read it. This one carried a bare 24.dp, the
                            // size the system gives a navigation glyph.
                            Row(verticalAlignment = Alignment.CenterVertically) {
                                CircularProgressIndicator(
                                    Modifier.size(spacing.iconMedium),
                                    strokeWidth = 2.dp,
                                )
                                Spacer(Modifier.width(spacing.space3))
                                Text(stringResource(R.string.payment_checking))
                            }
                        } else {
                            FeatureGate(
                                availability = ocrAvailability,
                                onUpgrade = null,
                            ) {
                                Button(
                                    onClick = {
                                        onPickProof()
                                    },
                                    modifier = Modifier.fillMaxWidth()
                                ) { Text(stringResource(R.string.payment_verify)) }
                            }
                            OutlinedButton(onClick = actions.markPaidManually, modifier = Modifier.fillMaxWidth()) {
                                Text(stringResource(R.string.payment_manual))
                            }
                        }
                    }
                }
            }

            // Payment history
            //
            // Three states, not two. `isNullOrEmpty()` drew one branch for an
            // unread list and for a read list with nothing in it, so the
            // nullability the doc comment above asks for had no rendering
            // consequence at all: a seller could not tell "no transfer has been
            // recorded" from "nothing has been read yet" — the two answers this
            // page exists to give. Null says nothing, because it knows nothing;
            // empty says so.
            if (payments != null && payments.isEmpty()) {
                Card {
                    Column(Modifier.fillMaxWidth().padding(spacing.space3), verticalArrangement = Arrangement.spacedBy(spacing.space2)) {
                        Text(stringResource(R.string.payment_history_title), style = MaterialTheme.typography.titleMedium)
                        Text(
                            stringResource(R.string.payment_history_none),
                            style = MaterialTheme.typography.bodyMedium,
                            color = MaterialTheme.colorScheme.onSurfaceVariant,
                        )
                    }
                }
            }
            if (!payments.isNullOrEmpty()) {
                Card {
                    Column(Modifier.fillMaxWidth().padding(spacing.space3), verticalArrangement = Arrangement.spacedBy(spacing.space1)) {
                        Text(stringResource(R.string.payment_history_title), style = MaterialTheme.typography.titleMedium)
                        val dateFormat = remember(locale) {
                            SimpleDateFormat("yyyy-MM-dd HH:mm", locale)
                        }
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
                                            color = if (payment.verified) MaterialTheme.colorScheme.primary else MaterialTheme.colorScheme.error
                                        )
                                    }
                                    Text(formatAmountLabel(payment.amountMinor, payment.currency, locale),
                                        style = MaterialTheme.typography.bodySmall,
                                        color = MaterialTheme.colorScheme.onSurfaceVariant)
                                    Text(dateFormat.format(Date(payment.createdAt)),
                                        style = MaterialTheme.typography.bodySmall,
                                        color = MaterialTheme.colorScheme.onSurfaceVariant)
                                }
                                if (!payment.proofPath.isNullOrBlank()) {
                                    // "📎" stood here. Emoji are copy, not
                                    // iconography, and this is not copy: it is the
                                    // one mark that a receipt from
                                    // `payments_finance.receipt_image_attachment`
                                    // exists, drawn as an unlabelled glyph a screen
                                    // reader cannot describe and a locale cannot
                                    // translate. It is a row icon, so `iconSmall`.
                                    Icon(
                                        imageVector = Icons.Outlined.AttachFile,
                                        contentDescription = stringResource(R.string.payment_proof_attached),
                                        modifier = Modifier.size(spacing.iconSmall),
                                        tint = MaterialTheme.colorScheme.onSurfaceVariant,
                                    )
                                }
                            }
                            if (payment != payments.last()) {
                                HorizontalDivider(Modifier.padding(vertical = spacing.space1))
                            }
                        }
                    }
                }
            }

            // Status actions.
            //
            // Disabled until the server has acknowledged the order (BR-305a). A
            // transition applied here alone would be a pipeline that exists on
            // one phone: the server would hold the order at NEW, a reinstall
            // would replay work already done, and a local-only cancellation
            // would restore stock here while the server kept it consumed.
            // Offering a control that cannot do what it says is worse than
            // greying it out and saying why, which the banner above does.
            val acknowledged = !order.livesOnlyOnThisPhone
            status.next?.let { next ->
                Button(
                    onClick = actions.advance,
                    enabled = acknowledged,
                    modifier = Modifier.fillMaxWidth(),
                ) {
                    Text(stringResource(R.string.order_advance_to, statusLabel(next)))
                }
            }
            if (status.canCancel) {
                OutlinedButton(
                    onClick = { onConfirmCancel(true) },
                    enabled = acknowledged,
                    modifier = Modifier.fillMaxWidth(),
                ) {
                    Text(stringResource(R.string.order_cancel), color = MaterialTheme.colorScheme.error)
                }
            }
            Spacer(Modifier.height(spacing.space6))
        }
    }

    if (confirmDiscard) {
        AlertDialog(
            onDismissRequest = { onConfirmDiscard(false) },
            title = { Text(stringResource(R.string.order_refused_discard)) },
            text = { Text(stringResource(R.string.order_refused_discard_confirm)) },
            confirmButton = {
                TextButton(onClick = {
                    onConfirmDiscard(false)
                    actions.discardRefused(onBack)
                }) {
                    Text(
                        stringResource(R.string.order_refused_discard),
                        color = MaterialTheme.colorScheme.error,
                    )
                }
            },
            dismissButton = {
                TextButton(onClick = { onConfirmDiscard(false) }) {
                    Text(stringResource(R.string.common_cancel))
                }
            },
        )
    }

    if (confirmCancel) {
        AlertDialog(
            onDismissRequest = { onConfirmCancel(false) },
            title = { Text(stringResource(R.string.order_cancel)) },
            text = { Text(stringResource(R.string.order_cancel_confirm)) },
            confirmButton = {
                TextButton(onClick = { onConfirmCancel(false); actions.cancel(onBack) }) {
                    Text(stringResource(R.string.order_cancel), color = MaterialTheme.colorScheme.error)
                }
            },
            dismissButton = { TextButton(onClick = { onConfirmCancel(false) }) { Text(stringResource(R.string.common_cancel)) } },
        )
    }
}
