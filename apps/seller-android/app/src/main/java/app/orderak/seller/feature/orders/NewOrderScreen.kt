package app.orderak.seller.feature.orders

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ExperimentalLayoutApi
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material3.Button
import androidx.compose.material3.Card
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.FilterChip
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Text
import androidx.compose.material3.TopAppBar
import androidx.compose.runtime.Composable
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.runtime.getValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalConfiguration
import androidx.compose.ui.platform.LocalLayoutDirection
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.style.TextDirection
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.heading
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.unit.LayoutDirection
import androidx.compose.ui.unit.dp
import androidx.hilt.navigation.compose.hiltViewModel
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import app.orderak.seller.R
import app.orderak.seller.core.ui.NoticeBanner
import app.orderak.seller.core.ui.SemanticRole
import app.orderak.seller.core.money.DEFAULT_CURRENCY
import app.orderak.seller.core.money.formatAmount
import app.orderak.seller.domain.PayMethod

/** S7 — convert a chat into a structured order in <30s (quick form + qty steppers). */
@OptIn(ExperimentalMaterial3Api::class, ExperimentalLayoutApi::class)
@Composable
fun NewOrderScreen(
    onBack: () -> Unit,
    onCreated: (Long) -> Unit,
    viewModel: NewOrderViewModel = hiltViewModel()
) {
    val locale = LocalConfiguration.current.locales[0]
    val state by viewModel.state.collectAsStateWithLifecycle()
    val products by viewModel.products.collectAsStateWithLifecycle()

    Scaffold(
        topBar = {
            TopAppBar(
                title = { Text(stringResource(R.string.order_new_title), modifier = Modifier.semantics { heading() }) },
                navigationIcon = {
                    IconButton(onClick = onBack) {
                        Icon(Icons.AutoMirrored.Filled.ArrowBack, contentDescription = stringResource(R.string.common_back))
                    }
                }
            )
        }
    ) { padding ->
        LazyColumn(
            modifier = Modifier.fillMaxSize().padding(padding),
            contentPadding = PaddingValues(16.dp),
            verticalArrangement = Arrangement.spacedBy(12.dp),
        ) {
            item { CompositionLocalProvider(LocalLayoutDirection provides LayoutDirection.Ltr) {
                OutlinedTextField(
                    value = state.phone, onValueChange = viewModel::onPhone,
                    label = { Text(stringResource(R.string.order_buyer_phone)) },
                    singleLine = true, isError = state.phone.isNotEmpty() && !state.phoneValid,
                    keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Phone),
                    modifier = Modifier.fillMaxWidth()
                )
            } }
            item { OutlinedTextField(
                value = state.name, onValueChange = viewModel::onName,
                label = { Text(stringResource(R.string.order_buyer_name_opt)) },
                singleLine = true, modifier = Modifier.fillMaxWidth()
            ) }

            item { Text(stringResource(R.string.order_items_title), style = MaterialTheme.typography.titleMedium) }
            if (products.isEmpty()) {
                item { Text(stringResource(R.string.products_empty), style = MaterialTheme.typography.bodyMedium) }
            }
            items(products, key = { it.id }) { p ->
                val q = state.qty[p.id] ?: 0
                Card {
                    Row(Modifier.fillMaxWidth().padding(12.dp), verticalAlignment = Alignment.CenterVertically) {
                        Column(Modifier.weight(1f)) {
                            Text(
                                p.name,
                                style = MaterialTheme.typography.bodyLarge.copy(
                                    textDirection = TextDirection.Content,
                                ),
                            )
                            Text(
                                stringResource(R.string.currency_egp, formatAmount(p.priceMinor, p.currency, locale)),
                                style = MaterialTheme.typography.labelMedium,
                                color = MaterialTheme.colorScheme.primary
                            )
                        }
                        // qty stepper — forced LTR (− count +)
                        CompositionLocalProvider(LocalLayoutDirection provides LayoutDirection.Ltr) {
                            Row(verticalAlignment = Alignment.CenterVertically) {
                                val decLabel = stringResource(R.string.order_qty_decrease, p.name)
                                IconButton(onClick = { viewModel.changeQty(p, -1) }, enabled = q > 0) {
                                    Text("−", style = MaterialTheme.typography.titleLarge,
                                        modifier = Modifier.semantics {
                                            contentDescription = decLabel
                                        })
                                }
                                Text("$q", style = MaterialTheme.typography.titleMedium)
                                val incLabel = stringResource(R.string.order_qty_increase, p.name)
                                IconButton(onClick = { viewModel.changeQty(p, +1) }, enabled = q < p.stock) {
                                    Text("+", style = MaterialTheme.typography.titleLarge,
                                        modifier = Modifier.semantics {
                                            contentDescription = incLabel
                                        })
                                }
                            }
                        }
                    }
                }
            }

            item { Text(stringResource(R.string.order_pay_method), style = MaterialTheme.typography.titleMedium) }
            item { FlowRow(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                PayMethod.entries.forEach { m ->
                    FilterChip(
                        selected = state.payMethod == m,
                        onClick = { viewModel.onPayMethod(m) },
                        label = { Text(payMethodLabel(m)) }
                    )
                }
            } }

            item { OutlinedTextField(
                value = state.note, onValueChange = viewModel::onNote,
                label = { Text(stringResource(R.string.order_note_opt)) },
                modifier = Modifier.fillMaxWidth()
            ) }

            if (state.stockError) {
                // Red text alone. A seller who cannot distinguish it from the
                // label above never learns the order was blocked on stock.
                item {
                    NoticeBanner(
                        role = SemanticRole.Danger,
                        title = stringResource(R.string.order_stock_error),
                        message = stringResource(R.string.order_stock_error_body),
                    )
                }
            }

            item { Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
                Text(stringResource(R.string.order_total), style = MaterialTheme.typography.titleMedium)
                Spacer(Modifier.width(8.dp))
                Text(
                    stringResource(R.string.currency_egp, formatAmount(viewModel.totalMinor(), DEFAULT_CURRENCY, locale)),
                    style = MaterialTheme.typography.titleLarge,
                    color = MaterialTheme.colorScheme.primary
                )
            } }

            item { Button(
                onClick = { viewModel.save(onCreated) },
                enabled = state.canSave && !state.saving,
                modifier = Modifier.fillMaxWidth()
            ) { Text(stringResource(R.string.order_save)) } }
            item { Spacer(Modifier.height(24.dp)) }
        }
    }
}

@Composable
fun payMethodLabel(m: PayMethod): String = stringResource(
    when (m) {
        PayMethod.VF_CASH -> R.string.pay_vfcash
        PayMethod.INSTAPAY -> R.string.pay_instapay
        PayMethod.FAWRY -> R.string.pay_fawry
        PayMethod.COD -> R.string.pay_cod
    }
)
