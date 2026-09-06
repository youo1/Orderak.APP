package app.orderak.seller.feature.customers

import android.content.ActivityNotFoundException
import android.content.Context
import android.content.Intent
import android.net.Uri
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
import app.orderak.seller.data.billing.FeatureAvailabilityResolver
import app.orderak.seller.data.billing.FeatureKeys.EDITABLE_CUSTOMER_PROFILES
import app.orderak.seller.data.db.CustomerEntity
import app.orderak.seller.data.db.OrderEntity
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
    val orders: StateFlow<List<OrderEntity>> =
        customer.filterNotNull()
            .flatMapLatest { c -> repo.ordersOf(c.phone) }
            .stateIn(viewModelScope, SharingStarted.WhileSubscribed(5_000), emptyList())

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

    fun save(name: String, altContact: String, note: String) {
        viewModelScope.launch {
            repo.editCustomer(customerKey, name, altContact, note)
            _saved.value = true
        }
    }

    fun savedShown() { _saved.value = false }
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
    val context = LocalContext.current
    val snackbarHostState = remember { SnackbarHostState() }

    val editable = viewModel.editAvailability == FeatureAvailability.Available

    // Seeded from the row once it arrives, then owned by the field. Re-seeding on
    // every emission would overwrite what the seller is currently typing each
    // time a sync touched the row.
    var name by rememberSaveable { mutableStateOf<String?>(null) }
    var altContact by rememberSaveable { mutableStateOf<String?>(null) }
    var note by rememberSaveable { mutableStateOf<String?>(null) }
    LaunchedEffect(customer?.customerKey) {
        customer?.let {
            if (name == null) name = it.name.orEmpty()
            if (altContact == null) altContact = it.altContact.orEmpty()
            if (note == null) note = it.note.orEmpty()
        }
    }

    val savedMessage = stringResource(R.string.customer_saved)
    LaunchedEffect(saved) {
        if (saved) {
            snackbarHostState.showSnackbar(savedMessage)
            viewModel.savedShown()
        }
    }

    Scaffold(
        snackbarHost = { SnackbarHost(snackbarHostState) },
        topBar = {
            TopAppBar(
                title = {
                    Text(
                        customer?.name?.takeIf { it.isNotBlank() }
                            ?: orders.firstOrNull()?.buyerName
                            ?: customer?.phone
                            ?: viewModel.customerKey,
                        modifier = Modifier.semantics { heading() },
                    )
                },
                navigationIcon = {
                    IconButton(onClick = onBack) {
                        Icon(Icons.AutoMirrored.Filled.ArrowBack, contentDescription = stringResource(R.string.common_back))
                    }
                }
            )
        }
    ) { padding ->
        LazyColumn(
            Modifier.fillMaxSize(),
            contentPadding = PaddingValues(
                start = 16.dp, end = 16.dp, bottom = 16.dp,
                top = padding.calculateTopPadding() + 8.dp,
            ),
            verticalArrangement = Arrangement.spacedBy(8.dp)
        ) {
            item {
                CustomerProfileSection(
                    customer = customer,
                    name = name.orEmpty(),
                    altContact = altContact.orEmpty(),
                    note = note.orEmpty(),
                    editable = editable,
                    onName = { name = it.take(120) },
                    onAltContact = { altContact = it.take(120) },
                    onNote = { note = it.take(2000) },
                    onSave = { viewModel.save(name.orEmpty(), altContact.orEmpty(), note.orEmpty()) },
                    onContact = { customer?.let { contactCustomer(context, it) } },
                )
            }

            item {
                Text(
                    stringResource(R.string.customer_orders_heading),
                    style = MaterialTheme.typography.titleMedium,
                    modifier = Modifier.padding(top = 16.dp).semantics { heading() },
                )
            }

            if (orders.isEmpty()) {
                item {
                    Box(
                        modifier = Modifier.fillMaxWidth().padding(32.dp),
                        contentAlignment = Alignment.Center,
                    ) {
                        Column(horizontalAlignment = Alignment.CenterHorizontally) {
                            Icon(
                                imageVector = Icons.Outlined.Inbox,
                                contentDescription = null,
                                modifier = Modifier.sizeIn(minWidth = 48.dp, minHeight = 48.dp),
                                tint = MaterialTheme.colorScheme.onSurfaceVariant,
                            )
                            Spacer(Modifier.height(16.dp))
                            Text(
                                stringResource(R.string.orders_empty),
                                style = MaterialTheme.typography.bodyLarge,
                                textAlign = TextAlign.Center,
                            )
                        }
                    }
                }
            } else {
                items(orders, key = { it.id }) { o -> OrderCard(o, onClick = { onOpenOrder(o.id) }) }
            }
        }
    }
}

@Composable
private fun CustomerProfileSection(
    customer: CustomerEntity?,
    name: String,
    altContact: String,
    note: String,
    editable: Boolean,
    onName: (String) -> Unit,
    onAltContact: (String) -> Unit,
    onNote: (String) -> Unit,
    onSave: () -> Unit,
    onContact: () -> Unit,
) {
    Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
        // The phone is shown, never edited. It is the customer's identity: an
        // edit that changed it would silently be a different customer and would
        // take the order history with it. The server refuses one for the same
        // reason.
        OutlinedTextField(
            value = customer?.phone.orEmpty(),
            onValueChange = {},
            readOnly = true,
            label = { Text(stringResource(R.string.customer_phone)) },
            supportingText = { Text(stringResource(R.string.customer_phone_is_identity)) },
            singleLine = true,
            modifier = Modifier.fillMaxWidth(),
        )

        // A number that could not be resolved is usable but unmergeable, and the
        // seller is the only one who can say what it should have been.
        if (customer != null && customer.phoneStatus != "valid") {
            Row(
                verticalAlignment = Alignment.CenterVertically,
                horizontalArrangement = Arrangement.spacedBy(8.dp),
            ) {
                Icon(
                    Icons.Outlined.Info,
                    contentDescription = null,
                    tint = MaterialTheme.colorScheme.onSurfaceVariant,
                )
                Text(
                    stringResource(R.string.customer_phone_unresolved),
                    style = MaterialTheme.typography.bodySmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                )
            }
        }

        OutlinedTextField(
            value = name,
            onValueChange = onName,
            readOnly = !editable,
            label = { Text(stringResource(R.string.customer_name)) },
            singleLine = true,
            modifier = Modifier.fillMaxWidth(),
        )
        OutlinedTextField(
            value = altContact,
            onValueChange = onAltContact,
            readOnly = !editable,
            label = { Text(stringResource(R.string.customer_alt_contact)) },
            singleLine = true,
            modifier = Modifier.fillMaxWidth(),
        )
        OutlinedTextField(
            value = note,
            onValueChange = onNote,
            readOnly = !editable,
            label = { Text(stringResource(R.string.customer_note)) },
            minLines = 3,
            modifier = Modifier.fillMaxWidth(),
        )

        Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            OutlinedButton(onClick = onContact, enabled = customer != null) {
                Icon(Icons.Outlined.Chat, contentDescription = null)
                Spacer(Modifier.height(0.dp))
                Text(
                    stringResource(R.string.customer_contact),
                    modifier = Modifier.padding(start = 8.dp),
                )
            }
            if (editable) {
                Button(onClick = onSave, enabled = customer != null) {
                    Text(stringResource(R.string.customer_save))
                }
            }
        }

        // Locked rather than absent: the fields are visible and read-only, so
        // the seller can see what the feature is before deciding to pay for it.
        // Icon as well as text — the state must not be carried by colour alone.
        if (!editable) {
            Row(
                verticalAlignment = Alignment.CenterVertically,
                horizontalArrangement = Arrangement.spacedBy(8.dp),
            ) {
                Icon(
                    Icons.Outlined.Lock,
                    contentDescription = null,
                    tint = MaterialTheme.colorScheme.onSurfaceVariant,
                )
                Text(
                    stringResource(R.string.customer_edit_locked),
                    style = MaterialTheme.typography.bodySmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                )
            }
        }
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
