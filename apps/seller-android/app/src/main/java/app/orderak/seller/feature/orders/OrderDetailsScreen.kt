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
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
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
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.TopAppBar
import androidx.compose.runtime.Composable
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
import app.orderak.seller.R
import app.orderak.seller.core.money.formatEgp
import app.orderak.seller.core.ui.FeatureGate
import app.orderak.seller.data.billing.Feature
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
    viewModel: OrderDetailsViewModel = hiltViewModel()
) {
    val orderWithItems by viewModel.order.collectAsStateWithLifecycle()
    val payments by viewModel.payments.collectAsStateWithLifecycle()
    val proof by viewModel.proof.collectAsStateWithLifecycle()
    val context = LocalContext.current
    val entitlementManager = viewModel.entitlementManager
    var confirmCancel by rememberSaveable { mutableStateOf(false) }

    val picker = rememberLauncherForActivityResult(ActivityResultContracts.PickVisualMedia()) { uri ->
        uri?.let(viewModel::verifyProof)
    }

    val data = orderWithItems
    if (data == null) {
        Box(Modifier.fillMaxSize(), contentAlignment = Alignment.Center) { CircularProgressIndicator() }
        return
    }
    val order = data.order
    val status = runCatching { OrderStatus.valueOf(order.status) }.getOrDefault(OrderStatus.NEW) // Fix(#5)

    // S6a result dialog
    (proof as? ProofUiState.Result)?.let { r ->
        AlertDialog(
            onDismissRequest = viewModel::dismissProofResult,
            confirmButton = {
                TextButton(onClick = viewModel::dismissProofResult) { Text(stringResource(R.string.common_ok)) }
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
                    Spacer(Modifier.height(8.dp))
                    Text(stringResource(R.string.payment_disclaimer),
                        style = MaterialTheme.typography.bodySmall,
                        color = MaterialTheme.colorScheme.onSurfaceVariant)
                }
            }
        )
    }

    Scaffold(
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
                        runCatching { context.startActivity(intent) }
                    }) {
                        Icon(Icons.AutoMirrored.Filled.Chat, contentDescription = stringResource(R.string.order_whatsapp))
                    }
                }
            )
        }
    ) { padding ->
        Column(
            Modifier.fillMaxSize().padding(padding).padding(16.dp).verticalScroll(rememberScrollState()),
            verticalArrangement = Arrangement.spacedBy(12.dp)
        ) {
            Card {
                Column(Modifier.fillMaxWidth().padding(12.dp)) {
                    Row(verticalAlignment = Alignment.CenterVertically) {
                        Column(Modifier.weight(1f)) {
                            Text(order.buyerName ?: order.buyerPhone, style = MaterialTheme.typography.titleMedium)
                            Text(order.buyerPhone, style = MaterialTheme.typography.bodySmall)
                        }
                        StatusChip(status)
                    }
                    order.note?.let {
                        Spacer(Modifier.height(8.dp))
                        Text(it, style = MaterialTheme.typography.bodyMedium)
                    }
                }
            }

            Card {
                Column(Modifier.fillMaxWidth().padding(12.dp)) {
                    data.items.forEach { item ->
                        Row(Modifier.fillMaxWidth().padding(vertical = 4.dp)) {
                            Text("${item.qty}×", style = MaterialTheme.typography.bodyMedium)
                            Spacer(Modifier.width(8.dp))
                            Text(item.productName, Modifier.weight(1f), style = MaterialTheme.typography.bodyMedium)
                            Text(stringResource(R.string.currency_egp, formatEgp(item.qty * item.pricePiasters)),
                                style = MaterialTheme.typography.bodyMedium)
                        }
                    }
                    HorizontalDivider(Modifier.padding(vertical = 8.dp))
                    Row(Modifier.fillMaxWidth()) {
                        Text(stringResource(R.string.order_total), Modifier.weight(1f),
                            style = MaterialTheme.typography.titleMedium)
                        Text(stringResource(R.string.currency_egp, formatEgp(order.totalPiasters)),
                            style = MaterialTheme.typography.titleMedium,
                            color = MaterialTheme.colorScheme.primary)
                    }
                }
            }

            // Payment section (S6a) — only until Paid
            if (status == OrderStatus.NEW || status == OrderStatus.CONFIRMED) {
                Card {
                    Column(Modifier.fillMaxWidth().padding(12.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                        Text(stringResource(R.string.payment_section_title), style = MaterialTheme.typography.titleMedium)
                        Text(payMethodLabel(runCatching { PayMethod.valueOf(order.payMethod) }.getOrDefault(PayMethod.COD)), style = MaterialTheme.typography.bodyMedium)
                        if (proof is ProofUiState.Running) {
                            Row(verticalAlignment = Alignment.CenterVertically) {
                                CircularProgressIndicator(Modifier.width(24.dp).height(24.dp))
                                Spacer(Modifier.width(12.dp))
                                Text(stringResource(R.string.payment_checking))
                            }
                        } else {
                            FeatureGate(entitlementManager, Feature.OCR_PAYMENT_VERIFICATION) {
                                Button(
                                    onClick = {
                                        picker.launch(PickVisualMediaRequest(ActivityResultContracts.PickVisualMedia.ImageOnly))
                                    },
                                    modifier = Modifier.fillMaxWidth()
                                ) { Text(stringResource(R.string.payment_verify)) }
                            }
                            OutlinedButton(onClick = viewModel::markPaidManually, modifier = Modifier.fillMaxWidth()) {
                                Text(stringResource(R.string.payment_manual))
                            }
                        }
                    }
                }
            }

            // Payment history
            if (payments.isNotEmpty()) {
                Card {
                    Column(Modifier.fillMaxWidth().padding(12.dp), verticalArrangement = Arrangement.spacedBy(6.dp)) {
                        Text(stringResource(R.string.payment_history_title), style = MaterialTheme.typography.titleMedium)
                        // LocalConfiguration, not LocalContext.resources.configuration: the
                        // latter is not read observably, so the formatted dates would not
                        // recompose on a language change (LocalContextConfigurationRead lint).
                        val locale = LocalConfiguration.current.locales[0]
                        val dateFormat = remember(locale) {
                            SimpleDateFormat("yyyy-MM-dd HH:mm", locale)
                        }
                        payments.forEach { payment ->
                            Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween) {
                                Column(Modifier.weight(1f)) {
                                    Row(verticalAlignment = Alignment.CenterVertically) {
                                        Text(stringResource(R.string.payment_ref_label, payment.ref), style = MaterialTheme.typography.bodyMedium)
                                        Spacer(Modifier.width(6.dp))
                                        Text(
                                            if (payment.verified) stringResource(R.string.payment_verified_badge)
                                            else stringResource(R.string.payment_flagged_badge),
                                            style = MaterialTheme.typography.labelSmall,
                                            color = if (payment.verified) MaterialTheme.colorScheme.primary else MaterialTheme.colorScheme.error
                                        )
                                    }
                                    Text(stringResource(R.string.currency_egp, formatEgp(payment.amountPiasters)),
                                        style = MaterialTheme.typography.bodySmall,
                                        color = MaterialTheme.colorScheme.onSurfaceVariant)
                                    Text(dateFormat.format(Date(payment.createdAt)),
                                        style = MaterialTheme.typography.bodySmall,
                                        color = MaterialTheme.colorScheme.onSurfaceVariant)
                                }
                                if (!payment.proofPath.isNullOrBlank()) {
                                    Text("📎", style = MaterialTheme.typography.titleMedium)
                                }
                            }
                            if (payment != payments.last()) {
                                HorizontalDivider(Modifier.padding(vertical = 2.dp))
                            }
                        }
                    }
                }
            }

            // Status actions
            status.next?.let { next ->
                Button(onClick = viewModel::advance, modifier = Modifier.fillMaxWidth()) {
                    Text(stringResource(R.string.order_advance_to, statusLabel(next)))
                }
            }
            if (status.canCancel) {
                OutlinedButton(onClick = { confirmCancel = true }, modifier = Modifier.fillMaxWidth()) {
                    Text(stringResource(R.string.order_cancel), color = MaterialTheme.colorScheme.error)
                }
            }
            Spacer(Modifier.height(24.dp))
        }
    }

    if (confirmCancel) {
        AlertDialog(
            onDismissRequest = { confirmCancel = false },
            title = { Text(stringResource(R.string.order_cancel)) },
            text = { Text(stringResource(R.string.order_cancel_confirm)) },
            confirmButton = {
                TextButton(onClick = { confirmCancel = false; viewModel.cancel(onDone = onBack) }) {
                    Text(stringResource(R.string.order_cancel), color = MaterialTheme.colorScheme.error)
                }
            },
            dismissButton = { TextButton(onClick = { confirmCancel = false }) { Text(stringResource(R.string.common_cancel)) } },
        )
    }
}
