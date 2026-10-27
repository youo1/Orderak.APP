package app.orderak.seller.feature.customers

import android.content.ActivityNotFoundException
import android.content.Context
import android.content.Intent
import android.net.Uri
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Surface
import androidx.compose.material3.TextButton
import androidx.compose.material3.ModalBottomSheet
import androidx.compose.material3.rememberModalBottomSheetState
import androidx.compose.ui.platform.LocalConfiguration
import androidx.compose.ui.text.style.TextDirection
import app.orderak.seller.core.money.formatAmountLabel
import app.orderak.seller.core.text.formatAgo
import app.orderak.seller.core.text.formatCount
import app.orderak.seller.core.ui.Avatar
import app.orderak.seller.core.ui.Banner
import app.orderak.seller.core.ui.BannerState
import app.orderak.seller.core.ui.EmptyState
import app.orderak.seller.core.ui.EmptyStateKind
import app.orderak.seller.core.ui.KeyValueRow
import app.orderak.seller.core.ui.SectionHeader
import app.orderak.seller.core.ui.Skeleton
import app.orderak.seller.core.ui.SkeletonVariant
import app.orderak.seller.core.ui.TextField
import app.orderak.seller.core.ui.TopBar
import app.orderak.seller.core.ui.isolated
import java.util.Locale
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.sizeIn
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material.icons.outlined.Chat
import androidx.compose.material.icons.outlined.Inbox
import androidx.compose.material.icons.outlined.Info
import androidx.compose.material.icons.outlined.Lock
import androidx.compose.material3.Button
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Scaffold
import androidx.compose.material3.SnackbarHost
import androidx.compose.material3.SnackbarHostState
import androidx.compose.material3.SnackbarResult
import androidx.compose.material3.Text
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
import app.orderak.seller.app.navigation.CustomerRoute
import app.orderak.seller.core.ui.FeatureAvailability
import app.orderak.seller.core.ui.theme.LocalOrderakSpacing
import app.orderak.seller.data.billing.FeatureAvailabilityResolver
import app.orderak.seller.data.billing.FeatureKeys.EDITABLE_CUSTOMER_PROFILES
import app.orderak.seller.data.db.CustomerEntity
import app.orderak.seller.data.db.OrderEntity
import app.orderak.seller.data.customers.CustomerWriteRepository
import app.orderak.seller.data.customers.CustomerWriteResult
import app.orderak.seller.data.orders.OrderRepository
import app.orderak.seller.feature.orders.OrderCard
import dagger.hilt.android.lifecycle.HiltViewModel
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.SharingStarted
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.filterNotNull
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.flow.flatMapLatest
import kotlinx.coroutines.flow.flowOf
import kotlinx.coroutines.flow.stateIn
import kotlinx.coroutines.launch
import javax.inject.Inject

@HiltViewModel
class CustomerDetailsViewModel @Inject constructor(
    private val repo: OrderRepository,
    private val customerWrites: CustomerWriteRepository,
    featureAvailability: FeatureAvailabilityResolver,
    savedStateHandle: SavedStateHandle
) : ViewModel() {
    val customerKey: String = savedStateHandle.toRoute<CustomerRoute>().customerKey

    val customer: StateFlow<CustomerEntity?> =
        repo.customer(customerKey).stateIn(viewModelScope, SharingStarted.WhileSubscribed(5_000), null)

    /**
     * Orders are looked up by the raw phone the customer's row carries, not by
     * the key. `orders.buyerPhone` holds what the buyer typed and nothing
     * rewrites it, so the key would match nothing whenever the two differ.
     */
    @OptIn(kotlinx.coroutines.ExperimentalCoroutinesApi::class)
    /**
     * null until Room answers. NOT emptyList().
     *
     * A customer row exists BECAUSE an order arrived, so "this customer has no
     * orders" is a sentence this screen can never truthfully say on arrival —
     * and the seed made it say exactly that, every time, until the query
     * returned.
     */
    val orders: StateFlow<List<OrderEntity>?> =
        customer.filterNotNull()
            .flatMapLatest { c -> repo.ordersOf(c.phone) }
            .stateIn(viewModelScope, SharingStarted.WhileSubscribed(5_000), null)

    /**
     * Whether the plan opens the editor.
     *
     * Fails closed: with no snapshot the resolver returns NotBuilt, which draws
     * the fields read-only rather than editable. The server is the authority on
     * whether an edit is accepted; this only decides whether to offer one.
     */
    val editAvailability: FeatureAvailability =
        featureAvailability.decide(EDITABLE_CUSTOMER_PROFILES).availability

    private val _saved = MutableStateFlow(false)
    val saved: StateFlow<Boolean> = _saved.asStateFlow()

    private val _saveFailed = MutableStateFlow(false)
    val saveFailed: StateFlow<Boolean> = _saveFailed.asStateFlow()

    /**
     * Save the edit to the server, and only then report success.
     *
     * A customer edit is Class A: if it does not reach the server it does not
     * happen, and nothing is written locally or queued. Reporting "saved" on a
     * write that never left the device is the failure this replaces — the seller
     * closed the screen believing their correction was kept.
     */
    fun save(name: String, altContact: String, note: String) {
        viewModelScope.launch {
            when (customerWrites.edit(customerKey, name, altContact, note)) {
                is CustomerWriteResult.Saved -> _saved.value = true
                else -> _saveFailed.value = true
            }
        }
    }

    fun savedShown() { _saved.value = false }

    fun saveFailureShown() { _saveFailed.value = false }
}

/** S12 — a customer's details, their order history, and the edit that persists. */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun CustomerDetailsScreen(
    onBack: () -> Unit,
    onOpenOrder: (Long) -> Unit,
    viewModel: CustomerDetailsViewModel = hiltViewModel()
) {
    val orders by viewModel.orders.collectAsStateWithLifecycle()
    val customer by viewModel.customer.collectAsStateWithLifecycle()
    val saved by viewModel.saved.collectAsStateWithLifecycle()
    val saveFailed by viewModel.saveFailed.collectAsStateWithLifecycle()
    val context = LocalContext.current
    val snackbarHostState = remember { SnackbarHostState() }

    val editable = viewModel.editAvailability == FeatureAvailability.Available

    // The last edit sent, so "retry" in the failure snackbar repeats exactly it.
    var lastEdit by rememberSaveable { mutableStateOf<List<String>?>(null) }

    val savedMessage = stringResource(R.string.customer_saved)
    LaunchedEffect(saved) {
        if (saved) {
            snackbarHostState.showSnackbar(savedMessage)
            viewModel.savedShown()
        }
    }

    // The other half of the same conversation, and it was missing.
    //
    // `save` has always reported a refusal through `saveFailed`, and
    // `saveFailureShown` existed to clear it — with no caller. Nothing collected
    // the flag, so a refused edit produced no snackbar, no message and no change
    // on screen: the seller tapped Save, watched nothing happen, and closed the
    // screen believing the correction was kept. The class comment on `save` says
    // a customer edit is Class A and that reporting success on a write that never
    // left the device is the failure it replaced — and the failure path still did
    // exactly that, by saying nothing at all.
    //
    // The action is the remedy, not decoration: the values are still in the
    // fields, so retrying is the same call with the same arguments.
    val saveFailedMessage = stringResource(R.string.customer_save_failed)
    val retryLabel = stringResource(R.string.common_retry)
    LaunchedEffect(saveFailed) {
        if (saveFailed) {
            val result = snackbarHostState.showSnackbar(
                message = saveFailedMessage,
                actionLabel = retryLabel,
            )
            // Cleared before the retry, not after: a retry that fails again sets
            // the flag straight back to true, and clearing it afterwards would
            // swallow that second failure.
            viewModel.saveFailureShown()
            if (result == SnackbarResult.ActionPerformed) {
                lastEdit?.let { viewModel.save(it[0], it[1], it[2]) }
            }
        }
    }

    CustomerDetailsContent(
        customer = customer,
        orders = orders,
        customerKey = viewModel.customerKey,
        editable = editable,
        onSave = { n, a, note -> lastEdit = listOf(n, a, note); viewModel.save(n, a, note) },
        onContact = { customer?.let { contactCustomer(context, it) } },
        onBack = onBack,
        onOpenOrder = onOpenOrder,
        snackbarHostState = snackbarHostState,
    )
}

/**
 * One customer, as a function of their state.
 *
 * Top bar with back and the name; a header with a large avatar, the name, the number (always
 * left to right) and "تواصل"; three figures (orders, total spent, last order); "عن العميل"
 * holding the other contact and the note with "تعديل"; then their orders, newest first.
 *
 * [orders] is nullable and that is the point: a customer row exists BECAUSE an order arrived, so
 * "no orders yet" is a sentence this screen can never truthfully say on arrival.
 *
 * Editing is one sheet (name, other contact, note, and a line saying the number is the
 * customer's identity), seeded from the row each time it opens. Where the plan does not open
 * it, the card is read-only and a notice that names the plan stands where "تعديل" would be.
 */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun CustomerDetailsContent(
    customer: CustomerEntity?,
    orders: List<OrderEntity>?,
    customerKey: String,
    editable: Boolean,
    onSave: (String, String, String) -> Unit,
    onContact: () -> Unit,
    onBack: () -> Unit,
    onOpenOrder: (Long) -> Unit,
    snackbarHostState: SnackbarHostState = remember { SnackbarHostState() },
) {
    val spacing = LocalOrderakSpacing.current
    val locale = LocalConfiguration.current.locales[0]
    var editing by rememberSaveable { mutableStateOf(false) }
    val title = customer?.name?.takeIf { it.isNotBlank() }
        ?: orders?.firstOrNull()?.buyerName
        ?: customer?.phone
        ?: customerKey
    Scaffold(
        snackbarHost = { SnackbarHost(snackbarHostState) },
        topBar = {
            TopBar(
                title = title,
                onBack = onBack,
                backDescription = stringResource(R.string.common_back),
            )
        },
    ) { padding ->
        LazyColumn(
            Modifier.fillMaxSize().padding(padding),
            contentPadding = PaddingValues(spacing.space4),
            verticalArrangement = Arrangement.spacedBy(spacing.space3),
        ) {
            item {
                Column(
                    Modifier.fillMaxWidth(),
                    horizontalAlignment = Alignment.CenterHorizontally,
                    verticalArrangement = Arrangement.spacedBy(spacing.space2),
                ) {
                    Avatar(name = title, size = spacing.space16)
                    Text(
                        title,
                        style = MaterialTheme.typography.titleLarge.copy(textDirection = TextDirection.Content),
                    )
                    customer?.let { Text(isolated(it.phone), style = MaterialTheme.typography.bodyMedium) }
                    Button(
                        onClick = onContact,
                        enabled = customer != null,
                        modifier = Modifier.heightIn(min = spacing.minimumTouchTarget),
                    ) {
                        Icon(Icons.Outlined.Chat, contentDescription = null)
                        Text(stringResource(R.string.customer_contact), Modifier.padding(start = spacing.space2))
                    }
                }
            }
            if (customer != null && customer.phoneStatus != "valid") {
                // A number that could not be resolved is usable but unmergeable, and the
                // seller is the only one who can say what it should have been.
                item {
                    Banner(
                        state = BannerState.Information,
                        title = stringResource(R.string.customer_phone_unresolved),
                        message = null,
                    )
                }
            }
            if (orders != null) {
                item { CustomerFigures(orders, locale) }
            }
            item {
                SectionHeader(
                    title = stringResource(R.string.customer_about),
                    actionLabel = if (editable && customer != null) stringResource(R.string.customer_edit) else null,
                    onAction = { editing = true },
                )
            }
            item {
                Surface(
                    shape = MaterialTheme.shapes.large,
                    color = MaterialTheme.colorScheme.surfaceContainerLowest,
                    modifier = Modifier.fillMaxWidth(),
                ) {
                    Column(Modifier.padding(spacing.space3), verticalArrangement = Arrangement.spacedBy(spacing.space2)) {
                        KeyValueRow(
                            label = stringResource(R.string.customer_alt_contact),
                            value = customer?.altContact?.takeIf { it.isNotBlank() } ?: stringResource(R.string.customer_none),
                        )
                        KeyValueRow(
                            label = stringResource(R.string.customer_note),
                            value = customer?.note?.takeIf { it.isNotBlank() } ?: stringResource(R.string.customer_none),
                        )
                    }
                }
            }
            if (!editable) {
                // Locked rather than absent: the card is visible and read-only, so the seller
                // can see what the feature is before deciding to pay for it.
                item {
                    Banner(
                        state = BannerState.LockedByPlan,
                        title = stringResource(R.string.customer_edit_locked),
                        message = null,
                    )
                }
            }

            item { SectionHeader(title = stringResource(R.string.customer_orders_heading)) }
            when {
                orders == null -> item { Skeleton(SkeletonVariant.ListRows) }
                orders.isEmpty() -> item {
                    EmptyState(kind = EmptyStateKind.Empty, title = stringResource(R.string.orders_empty))
                }
                else -> items(orders, key = { it.id }) { o -> OrderCard(o, onClick = { onOpenOrder(o.id) }) }
            }
        }
    }

    if (editing && customer != null) {
        ModalBottomSheet(
            onDismissRequest = { editing = false },
            sheetState = rememberModalBottomSheetState(skipPartiallyExpanded = true),
            containerColor = MaterialTheme.colorScheme.surface,
            dragHandle = null,
            shape = RoundedCornerShape(spacing.space0),
        ) {
            CustomerProfileSheet(
                customer = customer,
                onSave = { n, a, note -> onSave(n, a, note); editing = false },
                onClose = { editing = false },
            )
        }
    }
}

/** Orders, total spent and last order. Spent exists only within one currency; mixed says so. */
@Composable
private fun CustomerFigures(orders: List<OrderEntity>, locale: Locale) {
    val spacing = LocalOrderakSpacing.current
    val currencies = orders.map { it.currency }.distinct()
    val spent = when (currencies.size) {
        0 -> "—"
        1 -> formatAmountLabel(orders.sumOf { it.totalMinor }, currencies.first(), locale)
        else -> stringResource(R.string.customers_mixed_currencies)
    }
    val last = orders.maxOfOrNull { it.createdAt }?.let { formatAgo(it, System.currentTimeMillis(), locale) } ?: "—"
    Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(spacing.space2)) {
        Figure(stringResource(R.string.customer_figure_orders), formatCount(orders.size, locale), Modifier.weight(1f))
        Figure(stringResource(R.string.customer_figure_spent), spent, Modifier.weight(1f))
        Figure(stringResource(R.string.customer_figure_last), last, Modifier.weight(1f))
    }
}

@Composable
private fun Figure(label: String, value: String, modifier: Modifier) {
    val spacing = LocalOrderakSpacing.current
    Surface(
        shape = MaterialTheme.shapes.large,
        color = MaterialTheme.colorScheme.surfaceContainerLowest,
        modifier = modifier,
    ) {
        Column(Modifier.padding(spacing.space3), verticalArrangement = Arrangement.spacedBy(spacing.space1)) {
            Text(value, style = MaterialTheme.typography.titleMedium)
            Text(label, style = MaterialTheme.typography.labelMedium, color = MaterialTheme.colorScheme.onSurfaceVariant)
        }
    }
}

/**
 * The profile editor: name, other contact, note. The number is shown with a line saying it is the
 * customer's identity and does not change, because an edit that changed it would silently be a
 * different customer and take the order history with it.
 */
@Composable
private fun CustomerProfileSheet(
    customer: CustomerEntity,
    onSave: (String, String, String) -> Unit,
    onClose: () -> Unit,
) {
    val spacing = LocalOrderakSpacing.current
    var name by rememberSaveable(customer.customerKey) { mutableStateOf(customer.name.orEmpty()) }
    var alt by rememberSaveable(customer.customerKey) { mutableStateOf(customer.altContact.orEmpty()) }
    var note by rememberSaveable(customer.customerKey) { mutableStateOf(customer.note.orEmpty()) }
    Column(
        Modifier.fillMaxWidth().verticalScroll(rememberScrollState()).padding(spacing.space4),
        verticalArrangement = Arrangement.spacedBy(spacing.space3),
    ) {
        Text(
            stringResource(R.string.customer_edit_title),
            style = MaterialTheme.typography.titleLarge,
            modifier = Modifier.semantics { heading() },
        )
        TextField(
            value = name,
            onValueChange = { name = it.take(120) },
            label = stringResource(R.string.customer_name),
        )
        TextField(
            value = alt,
            onValueChange = { alt = it.take(120) },
            label = stringResource(R.string.customer_alt_contact),
        )
        TextField(
            value = note,
            onValueChange = { note = it.take(2000) },
            label = stringResource(R.string.customer_note),
            singleLine = false,
        )
        Text(
            stringResource(R.string.customer_phone_is_identity_sheet, isolated(customer.phone)),
            style = MaterialTheme.typography.bodySmall,
            color = MaterialTheme.colorScheme.onSurfaceVariant,
        )
        Button(
            onClick = { onSave(name, alt, note) },
            modifier = Modifier.fillMaxWidth().heightIn(min = spacing.minimumTouchTarget),
        ) { Text(stringResource(R.string.customer_save)) }
        TextButton(
            onClick = onClose,
            modifier = Modifier.fillMaxWidth().heightIn(min = spacing.minimumTouchTarget),
        ) { Text(stringResource(R.string.common_cancel)) }
    }
}

/**
 * Open a conversation with the customer.
 *
 * WhatsApp first because that is where these sales actually happen, falling back
 * to the dialer. Neither is guaranteed to be installed, and a missing app is not
 * an error worth interrupting the seller for — the number is on screen either
 * way.
 */
private fun contactCustomer(context: Context, customer: CustomerEntity) {
    val e164 = customer.phoneE164
    if (e164 != null) {
        val wa = Intent(
            Intent.ACTION_VIEW,
            Uri.parse("https://wa.me/${e164.removePrefix("+")}"),
        )
        try {
            context.startActivity(wa)
            return
        } catch (_: ActivityNotFoundException) {
            // Fall through to the dialer.
        }
    }
    try {
        context.startActivity(Intent(Intent.ACTION_DIAL, Uri.parse("tel:${customer.phone}")))
    } catch (_: ActivityNotFoundException) {
        // No dialer either. Nothing to do: the number is displayed above.
    }
}
