package app.orderak.seller.feature.orders

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ExperimentalLayoutApi
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.imePadding
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
import androidx.hilt.navigation.compose.hiltViewModel
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import app.orderak.seller.core.ui.FullScreenLoading
import app.orderak.seller.R
import app.orderak.seller.data.db.ProductEntity
import app.orderak.seller.core.ui.NoticeBanner
import app.orderak.seller.core.ui.SemanticRole
import app.orderak.seller.core.ui.theme.LocalOrderakMotion
import app.orderak.seller.core.ui.theme.LocalOrderakSpacing
import app.orderak.seller.core.money.DEFAULT_CURRENCY
import app.orderak.seller.core.money.formatAmount
import app.orderak.seller.core.money.formatAmountLabel
import app.orderak.seller.core.text.formatCount
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
    val catalogue = products

    NewOrderContent(
        state = state,
        products = products,
        totalMinor = viewModel.totalMinor(),
        selectedCurrency = viewModel.selectedCurrency(),
        actions = NewOrderActions(
            onPhone = viewModel::onPhone,
            onName = viewModel::onName,
            onNote = viewModel::onNote,
            onPayMethod = viewModel::onPayMethod,
            changeQty = viewModel::changeQty,
            save = viewModel::save,
        ),
        onBack = onBack,
        onCreated = onCreated,
    )
}

/** What the new-order form can ask the view model to do, as data. */
data class NewOrderActions(
    val onPhone: (String) -> Unit = {},
    val onName: (String) -> Unit = {},
    val onNote: (String) -> Unit = {},
    val onPayMethod: (PayMethod) -> Unit = {},
    val changeQty: (ProductEntity, Int) -> Unit = { _, _ -> },
    val save: ((Long) -> Unit) -> Unit = {},
)

/**
 * The manual order form, as a function of its state.
 *
 * This screen was already honest about loading — `products` is nullable and it
 * branches on null before deciding the catalogue is empty — so the split here
 * buys renders rather than a fix.
 *
 * [totalMinor] and [selectedCurrency] arrive already computed. The second is
 * nullable on purpose: minor units only add up within one currency, so a basket
 * spanning two has no total to show rather than a wrong one.
 */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun NewOrderContent(
    state: NewOrderUiState,
    products: List<ProductEntity>?,
    totalMinor: Long,
    selectedCurrency: String?,
    actions: NewOrderActions,
    onBack: () -> Unit,
    onCreated: (Long) -> Unit,
) {
    val locale = LocalConfiguration.current.locales[0]
    // The screen's rhythm, from the system. Every padding and gap below was a
    // hand-written dp value — 8, 12 and 24, which happen to be tokens, and were
    // still the reason a change to the spacing scale would not have reached here.
    // The note was one short: the list's own gutter is 16, a fourth literal that a
    // change to the scale could not reach either.
    val spacing = LocalOrderakSpacing.current
    val catalogue = products
    // `selectedCurrency` is null for a mixed selection once anything is picked —
    // see NewOrderViewModel.selectedCurrency. The total already renders "—" in
    // that case, and Save must not stay live beside it: it used to be the live
    // control on a mixed selection, and pressing it crashed the screen.
    val mixedCurrency = state.hasItems && selectedCurrency == null
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
            // `imePadding` so the keyboard lifts the form instead of covering the
            // field being typed into — and the Save button under it. This screen
            // is a form with three text fields and a submit button at the bottom
            // of the scroll, which is the exact shape that needs it.
            modifier = Modifier.fillMaxSize().padding(padding).imePadding(),
            contentPadding = PaddingValues(spacing.space4),
            verticalArrangement = Arrangement.spacedBy(spacing.space3),
        ) {
            item { CompositionLocalProvider(LocalLayoutDirection provides LayoutDirection.Ltr) {
                val phoneInvalid = state.phone.isNotEmpty() && !state.phoneValid
                OutlinedTextField(
                    value = state.phone, onValueChange = actions.onPhone,
                    label = { Text(stringResource(R.string.order_buyer_phone)) },
                    singleLine = true, isError = phoneInvalid,
                    // `isError` on its own is an outline that turns red and
                    // nothing more, on a form whose Save button stays dead until
                    // the number is complete: the reason the order cannot be
                    // recorded travelled as a colour, which is the one signal the
                    // system forbids it to rest on. The stock banner below is this
                    // screen's own argument that red alone leaves the seller
                    // without the reason.
                    supportingText = if (phoneInvalid) {
                        { Text(stringResource(R.string.order_phone_invalid)) }
                    } else {
                        null
                    },
                    keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Phone),
                    modifier = Modifier.fillMaxWidth()
                )
            } }
            item { OutlinedTextField(
                value = state.name, onValueChange = actions.onName,
                label = { Text(stringResource(R.string.order_buyer_name_opt)) },
                singleLine = true, modifier = Modifier.fillMaxWidth()
            ) }

            item { Text(stringResource(R.string.order_items_title), style = MaterialTheme.typography.titleMedium) }
            if (catalogue == null) {
                // Not read yet. Saying "you have no products" here would tell a
                // seller mid-sale that they have nothing to sell.
                item { FullScreenLoading() }
            } else if (catalogue.isEmpty()) {
                // `products_empty` is the store surface's copy, and it sends the
                // seller to a ➕: "tap ➕ and add your first product with a photo".
                // This screen has no ➕ — the only one is on المتجر, one surface
                // away behind the back arrow — so the state told a seller to tap
                // something that is not here, which is a dead end rather than a
                // next step. The tab that does have the button is the next step.
                item {
                    Text(
                        stringResource(R.string.order_no_products_body),
                        style = MaterialTheme.typography.bodyMedium,
                    )
                }
            }
            items(catalogue.orEmpty(), key = { it.id }) { p ->
                val q = state.qty[p.id] ?: 0
                Card {
                    Row(Modifier.fillMaxWidth().padding(spacing.space3), verticalAlignment = Alignment.CenterVertically) {
                        Column(Modifier.weight(1f)) {
                            Text(
                                p.name,
                                style = MaterialTheme.typography.bodyLarge.copy(
                                    textDirection = TextDirection.Content,
                                ),
                            )
                            Text(
                                formatAmountLabel(p.priceMinor, p.currency, locale),
                                style = MaterialTheme.typography.labelMedium,
                                color = MaterialTheme.colorScheme.primary
                            )
                        }
                        // qty stepper — forced LTR (− count +)
                        CompositionLocalProvider(LocalLayoutDirection provides LayoutDirection.Ltr) {
                            Row(verticalAlignment = Alignment.CenterVertically) {
                                val decLabel = stringResource(R.string.order_qty_decrease, p.name)
                                IconButton(onClick = { actions.changeQty(p, -1) }, enabled = q > 0) {
                                    Text("−", style = MaterialTheme.typography.titleLarge,
                                        modifier = Modifier.semantics {
                                            contentDescription = decLabel
                                        })
                                }
                                Text(
                                    formatCount(q, locale),
                                    style = MaterialTheme.typography.titleMedium,
                                )
                                val incLabel = stringResource(R.string.order_qty_increase, p.name)
                                IconButton(onClick = { actions.changeQty(p, +1) }, enabled = q < p.stock) {
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
            item { FlowRow(horizontalArrangement = Arrangement.spacedBy(spacing.space2)) {
                state.payMethods.forEach { m ->
                    FilterChip(
                        selected = state.payMethod == m,
                        onClick = { actions.onPayMethod(m) },
                        label = { Text(payMethodLabel(m)) }
                    )
                }
            } }

            item { OutlinedTextField(
                value = state.note, onValueChange = actions.onNote,
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

            if (mixedCurrency) {
                // The "—" total says something is wrong without saying what. This
                // says what, and what to do about it.
                item {
                    NoticeBanner(
                        role = SemanticRole.Danger,
                        title = stringResource(R.string.order_mixed_currency_title),
                        message = stringResource(R.string.order_mixed_currency_body),
                    )
                }
            }

            if (state.saveFailed) {
                // The write failed and the draft survived, so the honest thing to
                // say is that nothing was lost and the button is still there.
                item {
                    NoticeBanner(
                        role = SemanticRole.Danger,
                        title = stringResource(R.string.order_save_failed_title),
                        message = stringResource(R.string.order_save_failed_body),
                    )
                }
            }

            item { Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
                Text(stringResource(R.string.order_total), style = MaterialTheme.typography.titleMedium)
                Spacer(Modifier.width(spacing.space2))
                Text(
                    // No total across currencies: see NewOrderViewModel.selectedCurrency.
                    selectedCurrency
                        ?.let { formatAmountLabel(totalMinor, it, locale) }
                        ?: "—",
                    style = MaterialTheme.typography.titleLarge,
                    color = MaterialTheme.colorScheme.primary
                )
            } }

            item { Button(
                onClick = { actions.save(onCreated) },
                enabled = state.canSave && !state.saving && !mixedCurrency,
                modifier = Modifier.fillMaxWidth()
            ) { Text(stringResource(R.string.order_save)) } }
            item { Spacer(Modifier.height(spacing.space6)) }
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
