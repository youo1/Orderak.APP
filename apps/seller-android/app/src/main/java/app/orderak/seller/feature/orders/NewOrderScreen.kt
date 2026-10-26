package app.orderak.seller.feature.orders

import androidx.activity.compose.BackHandler
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.ModalBottomSheet
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.TextButton
import androidx.compose.material3.rememberModalBottomSheetState
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import app.orderak.seller.core.money.Money
import app.orderak.seller.core.phone.Countries
import app.orderak.seller.core.ui.BottomActionBar
import app.orderak.seller.core.ui.ConfirmSheet
import app.orderak.seller.core.ui.ConfirmSheetState
import app.orderak.seller.core.ui.MoneyText
import app.orderak.seller.core.ui.PhoneField
import app.orderak.seller.core.ui.PickerOption
import app.orderak.seller.core.ui.PickerSheet
import app.orderak.seller.core.ui.PickerSheetMode
import app.orderak.seller.core.ui.SectionHeader
import app.orderak.seller.core.ui.SegmentedChoice
import app.orderak.seller.core.ui.Stepper
import app.orderak.seller.core.ui.TextField
import app.orderak.seller.core.ui.TopBar
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
import app.orderak.seller.R
import app.orderak.seller.data.db.ProductEntity
import app.orderak.seller.core.ui.Banner
import app.orderak.seller.core.ui.BannerState
import app.orderak.seller.core.ui.theme.LocalOrderakMotion
import app.orderak.seller.core.ui.theme.LocalOrderakSpacing
import app.orderak.seller.core.money.DEFAULT_CURRENCY
import app.orderak.seller.core.money.formatAmount
import app.orderak.seller.core.money.formatAmountLabel
import app.orderak.seller.core.text.formatCount
import app.orderak.seller.domain.PayMethod
import app.orderak.seller.core.ui.Skeleton
import app.orderak.seller.core.ui.SkeletonVariant

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
            onCountry = viewModel::onCountry,
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
    val onCountry: (String) -> Unit = {},
    val onName: (String) -> Unit = {},
    val onNote: (String) -> Unit = {},
    val onPayMethod: (PayMethod) -> Unit = {},
    val changeQty: (ProductEntity, Int) -> Unit = { _, _ -> },
    val save: ((Long) -> Unit) -> Unit = {},
)

/**
 * The manual order form, as a function of its state.
 *
 * Top to bottom: the customer (phone with its country, and an optional name), the
 * products chosen so far with a stepper on each and a button that opens the picker,
 * how it is to be paid (only the methods this store accepts), and an optional note
 * behind a button. The bar at the bottom holds the running total and "record the
 * order". Closing a form that has something in it asks first.
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
    val spacing = LocalOrderakSpacing.current
    val catalogue = products
    // `selectedCurrency` is null for a mixed selection once anything is picked —
    // see NewOrderViewModel.selectedCurrency. The total renders "—" in that case, and
    // Save must not stay live beside it: pressing it used to crash the screen.
    val mixedCurrency = state.hasItems && selectedCurrency == null
    var productSheet by rememberSaveable { mutableStateOf(false) }
    var countrySheet by rememberSaveable { mutableStateOf(false) }
    var noteOpen by rememberSaveable { mutableStateOf(false) }
    var countryQuery by rememberSaveable { mutableStateOf("") }
    var discardSheet by rememberSaveable { mutableStateOf(false) }
    val hasDraft = state.phone.isNotEmpty() || state.name.isNotEmpty() || state.note.isNotEmpty() || state.hasItems
    val leave = { if (hasDraft && !state.saving) discardSheet = true else onBack() }
    BackHandler(enabled = hasDraft && !state.saving) { discardSheet = true }
    val country = remember(state.countryIso, locale) { Countries.localized(Countries.byIso(state.countryIso), locale) }
    val locked = state.saving

    Scaffold(
        topBar = {
            TopBar(
                title = stringResource(R.string.order_new_title),
                onBack = leave,
                backDescription = stringResource(R.string.sheet_close),
                closeIcon = true,
            )
        },
        bottomBar = {
            BottomActionBar(
                primaryLabel = stringResource(if (locked) R.string.order_new_saving else R.string.order_save),
                onPrimary = { actions.save(onCreated) },
                primaryEnabled = state.canSave && !locked && !mixedCurrency,
                disabledReason = if (!state.canSave && !locked) stringResource(R.string.order_new_bar_reason) else null,
                summaryLabel = stringResource(R.string.order_total),
                // No total across currencies: see NewOrderViewModel.selectedCurrency.
                summaryValue = selectedCurrency?.let { formatAmountLabel(totalMinor, it, locale) } ?: "\u2014",
            )
        },
    ) { padding ->
        LazyColumn(
            // `imePadding` so the keyboard lifts the form instead of covering the field
            // being typed into.
            modifier = Modifier.fillMaxSize().padding(padding).imePadding(),
            contentPadding = PaddingValues(spacing.space4),
            verticalArrangement = Arrangement.spacedBy(spacing.space3),
        ) {
            if (state.saveFailed) {
                // The write failed and the draft survived, so the honest thing to say is
                // that nothing was lost and the button is still there.
                item {
                    Banner(
                        state = BannerState.Error,
                        title = stringResource(R.string.order_save_failed_title),
                        message = stringResource(R.string.order_save_failed_body),
                    )
                }
            }
            if (mixedCurrency) {
                // The "—" total says something is wrong without saying what. This says
                // what, and what to do about it.
                item {
                    Banner(
                        state = BannerState.Error,
                        title = stringResource(R.string.order_mixed_currency_title),
                        message = stringResource(R.string.order_mixed_currency_body),
                    )
                }
            }

            item { SectionHeader(title = stringResource(R.string.order_new_customer)) }
            item {
                val phoneInvalid = state.phone.isNotEmpty() && !state.phoneValid
                PhoneField(
                    dialCode = "+" + country.dialCode,
                    countryDescription = country.name,
                    number = state.phone,
                    onNumberChange = actions.onPhone,
                    onPickCountry = { countrySheet = true },
                    label = stringResource(R.string.order_buyer_phone),
                    // The reason the order cannot be recorded is said, not only coloured.
                    error = if (phoneInvalid) stringResource(R.string.order_phone_invalid) else null,
                    enabled = !locked,
                )
            }
            item {
                TextField(
                    value = state.name,
                    onValueChange = actions.onName,
                    label = stringResource(R.string.order_buyer_name_opt),
                    enabled = !locked,
                )
            }

            item { SectionHeader(title = stringResource(R.string.order_items_title)) }
            when {
                // Not read yet. Saying "you have no products" here would tell a seller
                // mid-sale that they have nothing to sell.
                catalogue == null -> item { Skeleton(SkeletonVariant.ListRows) }
                // The next step is on المتجر, one surface away, and this says so.
                catalogue.isEmpty() -> item {
                    Text(stringResource(R.string.order_no_products_body), style = MaterialTheme.typography.bodyMedium)
                }
                else -> {
                    val lines = catalogue.filter { (state.qty[it.id] ?: 0) > 0 }
                    items(lines, key = { it.id }) { p ->
                        val q = state.qty[p.id] ?: 0
                        Column {
                            Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
                                Column(Modifier.weight(1f)) {
                                    Text(
                                        p.name,
                                        style = MaterialTheme.typography.bodyLarge.copy(textDirection = TextDirection.Content),
                                    )
                                    MoneyText(
                                        Money(p.priceMinor, p.currency),
                                        style = MaterialTheme.typography.labelMedium.copy(color = MaterialTheme.colorScheme.primary),
                                    )
                                }
                                Stepper(
                                    value = q,
                                    onValueChange = { actions.changeQty(p, it - q) },
                                    decreaseDescription = stringResource(R.string.order_qty_decrease, p.name),
                                    increaseDescription = stringResource(R.string.order_qty_increase, p.name),
                                    max = p.stock,
                                    enabled = !locked,
                                )
                            }
                            // A line over stock says so under that line.
                            if (state.stockError && q > p.stock) {
                                Text(
                                    stringResource(R.string.order_new_stock_left, formatCount(p.stock, locale)),
                                    style = MaterialTheme.typography.bodySmall,
                                    color = MaterialTheme.colorScheme.error,
                                )
                            }
                        }
                    }
                    item {
                        OutlinedButton(
                            onClick = { productSheet = true },
                            enabled = !locked,
                            modifier = Modifier.fillMaxWidth().heightIn(min = spacing.minimumTouchTarget),
                        ) { Text(stringResource(R.string.order_new_add_product)) }
                    }
                }
            }
            if (state.stockError) {
                item {
                    Banner(
                        state = BannerState.Error,
                        title = stringResource(R.string.order_stock_error),
                        message = stringResource(R.string.order_stock_error_body),
                    )
                }
            }

            item { SectionHeader(title = stringResource(R.string.order_pay_method)) }
            item {
                // Only what this store accepts: cash always, the others once their details
                // are saved. The chosen one is filled.
                SegmentedChoice(
                    options = state.payMethods.map { payMethodLabel(it) },
                    selectedIndex = state.payMethods.indexOf(state.payMethod),
                    onSelect = { actions.onPayMethod(state.payMethods[it]) },
                    enabled = !locked,
                )
            }

            item {
                if (noteOpen || state.note.isNotEmpty()) {
                    TextField(
                        value = state.note,
                        onValueChange = actions.onNote,
                        label = stringResource(R.string.order_note_opt),
                        singleLine = false,
                        enabled = !locked,
                    )
                } else {
                    TextButton(onClick = { noteOpen = true }, modifier = Modifier.heightIn(min = spacing.minimumTouchTarget)) {
                        Text(stringResource(R.string.order_new_add_note))
                    }
                }
            }
            item { Spacer(Modifier.height(spacing.space6)) }
        }
    }

    if (productSheet && catalogue != null) {
        ModalBottomSheet(
            onDismissRequest = { productSheet = false },
            sheetState = rememberModalBottomSheetState(skipPartiallyExpanded = true),
            containerColor = MaterialTheme.colorScheme.surface,
        ) {
            NewOrderProductSheet(
                products = catalogue,
                quantities = state.qty,
                onChange = actions.changeQty,
                onDone = { productSheet = false },
            )
        }
    }

    if (countrySheet) {
        ModalBottomSheet(
            onDismissRequest = { countrySheet = false },
            sheetState = rememberModalBottomSheetState(skipPartiallyExpanded = true),
            containerColor = MaterialTheme.colorScheme.surface,
            dragHandle = null,
            shape = RoundedCornerShape(spacing.space0),
        ) {
            PickerSheet(
                mode = PickerSheetMode.SearchableWithManualEntry,
                title = stringResource(R.string.order_new_country_title),
                options = remember(locale) {
                    Countries.curated(locale).map { PickerOption(it.iso, "${it.flag}  ${it.name}  +${it.dialCode}") }
                },
                selectedKey = state.countryIso,
                onSelect = { option -> countrySheet = false; actions.onCountry(option.key) },
                closeLabel = stringResource(R.string.sheet_close),
                onClose = { countrySheet = false },
                query = countryQuery,
                onQueryChange = { countryQuery = it },
                searchPlaceholder = stringResource(R.string.order_new_country_search),
                noResultsLabel = stringResource(R.string.setup_city_no_results),
            )
        }
    }

    if (discardSheet) {
        ModalBottomSheet(
            onDismissRequest = { discardSheet = false },
            sheetState = rememberModalBottomSheetState(skipPartiallyExpanded = true),
            containerColor = MaterialTheme.colorScheme.surface,
            dragHandle = null,
            shape = RoundedCornerShape(spacing.space0),
        ) {
            ConfirmSheet(
                state = ConfirmSheetState.Destructive,
                title = stringResource(R.string.order_new_discard_title),
                message = stringResource(R.string.order_new_discard_body),
                confirmLabel = stringResource(R.string.order_new_discard_confirm),
                cancelLabel = stringResource(R.string.order_new_keep_editing),
                onConfirm = { discardSheet = false; onBack() },
                onCancel = { discardSheet = false },
            )
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
