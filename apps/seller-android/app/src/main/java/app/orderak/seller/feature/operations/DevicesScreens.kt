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
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import kotlinx.serialization.json.intOrNull
import javax.inject.Inject
import app.orderak.seller.core.ui.theme.LocalOrderakSpacing
import app.orderak.seller.core.ui.theme.LocalOrderakLayout

@Composable
fun DevicesScreen(
    onBack: () -> Unit,
    onReauthenticate: () -> Unit,
    /**
     * A plan limit refused something, named by its entitlement key — the same
     * callback `ProductsScreen` and `CategoriesScreen` already take.
     *
     * Closes §4.5's "**The paywall declares an entry with no path.**"
     * `screen-contracts.mjs` gives `paywall` `entry: [… "devices"]`, and
     * `DevicesScreen` has no route to `PaywallRoute`; the manifest declares the
     * same edge (`{ to: "PaywallRoute", trigger: "add device", condition: "at
     * plan limit" }`). Both described a transition the app did not have: at
     * `max_concurrent_devices` a seller had nowhere to go from the screen that
     * counts the devices. Defaulted, like `CategoriesScreen`'s, so a renderer
     * that is not wired to a graph can still be drawn.
     */
    onLimitReached: (String) -> Unit = {},
    vm: OperationsViewModel = hiltViewModel(),
) {
    val items by vm.devices.collectAsStateWithLifecycle()
    val passkeys by vm.passkeys.collectAsStateWithLifecycle()
    val busy by vm.busy.collectAsStateWithLifecycle()
    val error by vm.error.collectAsStateWithLifecycle()
    val config by vm.entitlements.config.collectAsStateWithLifecycle()
    val activity = LocalContext.current.findActivity()
    var renameTarget by remember { mutableStateOf<PasskeyDto?>(null) }
    var deleteTarget by remember { mutableStateOf<PasskeyDto?>(null) }
    var deviceRevokeTarget by remember { mutableStateOf<Pair<Long, String?>?>(null) }
    var selectedPasskeyId by rememberSaveable { mutableStateOf<String?>(null) }
    // This contract declares "device limit usage" among this screen's own data
    // and its entitlement key is `max_concurrent_devices`, and it drew neither:
    // the count a seller needs at the moment a second phone cannot sign in was on
    // the subscription page and nowhere near the control that revokes a device.
    // The row comes from the shared list, so the same limit reads the same way
    // here as it does on حسابي and on الاشتراك.
    val deviceLimit = config?.let(::planUsageRows)
        ?.firstOrNull { it.key == FeatureKeys.MAX_CONCURRENT_DEVICES }
    LaunchedEffect(Unit) { vm.loadDevices() }
    LaunchedEffect(passkeys) {
        // Only once the list has been read. Running this against null would
        // clear a restored selection before the passkeys arrive.
        passkeys?.let { list ->
            if (list.none { it.id == selectedPasskeyId }) {
                selectedPasskeyId = list.firstOrNull()?.id
            }
        }
    }

    DevicesContent(
        items = items,
        passkeys = passkeys,
        busy = busy,
        error = error,
        selectedPasskeyId = selectedPasskeyId,
        canAddPasskey = Build.VERSION.SDK_INT >= Build.VERSION_CODES.P,
        onBack = onBack,
        onRetry = vm::loadDevices,
        onReauthenticate = onReauthenticate,
        onAddPasskey = { activity?.let(vm::createPasskey) },
        onSelectPasskey = { selectedPasskeyId = it },
        onRename = { renameTarget = it },
        onRevoke = { deleteTarget = it },
        onRevokeDevice = { rowId, label -> deviceRevokeTarget = rowId to label },
        // The allowance, and whether it is spent. Both are read off the same
        // snapshot row, so the notice cannot disagree with the meter above it.
        deviceLimit = deviceLimit,
        // The two facts ProductsScreen's limit dialog is decided by, read here
        // from the same manager: whether anything is for sale right now, and
        // whether a higher plan exists at all.
        purchaseOpen = vm.entitlements.isPurchaseOpen(),
        limitReached = deviceLimit?.limit?.let { deviceLimit.used >= it } == true,
        upgradeAvailable = vm.entitlements.nextUpgradePlanKey() != null,
        // The key is named here, by the screen that carries the limit, so the
        // paywall opens on the limit the seller actually hit.
        onLimitReached = { onLimitReached(FeatureKeys.MAX_CONCURRENT_DEVICES) },
    )

    // Revoking a device ends a session on hardware the seller may not be holding.
    // It was immediate and unlabelled, one row below a passkey revoke that *is*
    // confirmed — the same act, two different levels of care, decided by which
    // list it happened to be drawn in. The name matters here: a seller with three
    // phones is choosing which one to cut off.
    deviceRevokeTarget?.let { (rowId, label) ->
        AlertDialog(
            onDismissRequest = { deviceRevokeTarget = null },
            title = {
                Text(
                    stringResource(
                        R.string.device_revoke_title,
                        label ?: stringResource(R.string.device_unknown),
                    ),
                )
            },
            text = { Text(stringResource(R.string.device_revoke_confirm)) },
            confirmButton = {
                TextButton(
                    onClick = {
                        vm.revokeDevice(rowId)
                        deviceRevokeTarget = null
                    },
                ) {
                    Text(stringResource(R.string.device_revoke), color = MaterialTheme.colorScheme.error)
                }
            },
            dismissButton = {
                TextButton(onClick = { deviceRevokeTarget = null }) {
                    Text(stringResource(R.string.common_cancel))
                }
            },
        )
    }

    renameTarget?.let { passkey ->
        var label by rememberSaveable(passkey.id) { mutableStateOf(passkey.label.orEmpty()) }
        AlertDialog(
            onDismissRequest = { renameTarget = null },
            title = { Text(stringResource(R.string.passkey_rename)) },
            text = {
                OutlinedTextField(
                    value = label,
                    onValueChange = { label = it.take(60) },
                    label = { Text(stringResource(R.string.passkey_label)) },
                    singleLine = true,
                )
            },
            confirmButton = {
                TextButton(
                    enabled = label.trim().isNotEmpty(),
                    onClick = {
                        vm.renamePasskey(passkey.id, label)
                        renameTarget = null
                    },
                ) { Text(stringResource(R.string.settings_save)) }
            },
            dismissButton = {
                TextButton(onClick = { renameTarget = null }) {
                    Text(stringResource(R.string.common_cancel))
                }
            },
        )
    }
    deleteTarget?.let { passkey ->
        AlertDialog(
            onDismissRequest = { deleteTarget = null },
            title = { Text(stringResource(R.string.passkey_revoke)) },
            text = { Text(stringResource(R.string.passkey_revoke_confirm)) },
            confirmButton = {
                TextButton(
                    onClick = {
                        vm.deletePasskey(passkey.id)
                        deleteTarget = null
                    },
                ) {
                    Text(stringResource(R.string.passkey_revoke), color = MaterialTheme.colorScheme.error)
                }
            },
            dismissButton = {
                TextButton(onClick = { deleteTarget = null }) {
                    Text(stringResource(R.string.common_cancel))
                }
            },
        )
    }
}

/**
 * Devices and passkeys, as a function of their state.
 *
 * Two lists, so this page is empty only when BOTH have been read and both came
 * back empty. It used to ask `!busy && items.isEmpty() && passkeys.isEmpty()`,
 * which is true before either request starts.
 *
 * [canAddPasskey] is passed in rather than read from Build here, so the render
 * can show both the offered and the withheld control.
 *
 * [deviceLimit] is the plan's device allowance, which this contract declares as
 * this screen's own data ("devices · passkeys · device limit usage") and which
 * nothing drew. It is a [PlanUsageRow] rather than a pair of numbers so the row
 * is the shared renderer's, including the count-against-a-limit marks that keep
 * it in order in Arabic. Null when the snapshot does not carry the figure — the
 * page then says nothing about a limit rather than drawing an assumed one.
 *
 * [limitReached] is whether that allowance is spent, and it is the state that
 * blocked the edge §4.5 recorded as missing — "**The paywall declares an entry
 * with no path.** `screen-contracts.mjs` gives `paywall` `entry: [… "devices"]`,
 * and `DevicesScreen` has no route to `PaywallRoute`." The path is drawn here,
 * where `max_concurrent_devices` actually bites: the next phone that tries to
 * sign in is refused by this cap, so the seller reading this list is the one who
 * needs the way out. [purchaseOpen] and [upgradeAvailable] are what the way out
 * is allowed to say, exactly as on the store's limit dialog — a higher plan
 * existing is not the same as being able to buy it.
 */

@Composable
fun DevicesContent(
    items: List<DeviceDto>?,
    passkeys: List<PasskeyDto>?,
    busy: Boolean,
    error: String?,
    selectedPasskeyId: String?,
    canAddPasskey: Boolean,
    onBack: () -> Unit,
    onRetry: () -> Unit,
    onReauthenticate: () -> Unit,
    onAddPasskey: () -> Unit,
    onSelectPasskey: (String) -> Unit,
    onRename: (PasskeyDto) -> Unit,
    onRevoke: (PasskeyDto) -> Unit,
    onRevokeDevice: (Long, String?) -> Unit,
    deviceLimit: PlanUsageRow? = null,
    purchaseOpen: Boolean = false,
    limitReached: Boolean = false,
    upgradeAvailable: Boolean = false,
    onLimitReached: () -> Unit = {},
) {
    val layout = LocalOrderakLayout.current
    val spacing = LocalOrderakSpacing.current
    val locale = LocalConfiguration.current.locales[0]
    OperationPage(
        title = stringResource(R.string.devices_title),
        onBack = onBack,
        // Two lists, and this page is empty only when BOTH have been read and
        // both came back empty. `!busy && items.isEmpty() && passkeys.isEmpty()`
        // was true before either request started.
        busy = busy || items == null || passkeys == null,
        error = error,
        onRetry = if (error == "recent_auth_required") onReauthenticate else onRetry,
        isEmpty = items?.isEmpty() == true && passkeys?.isEmpty() == true,
        empty = {
            FullScreenEmpty(message = stringResource(R.string.common_empty))
        },
    ) {
        BoxWithConstraints(Modifier.fillMaxWidth()) {
            val isListDetail = maxWidth >= layout.wideLayoutMinWidth
            if (isListDetail) {
                Row(
                    modifier = Modifier.fillMaxWidth(),
                    horizontalArrangement = Arrangement.spacedBy(spacing.space4),
                ) {
                    Column(
                        modifier = Modifier.weight(0.42f),
                        verticalArrangement = Arrangement.spacedBy(spacing.space3),
                    ) {
                        PasskeyHeader(
                            canAdd = canAddPasskey,
                            onAdd = onAddPasskey,
                        )
                        passkeys.orEmpty().forEach { passkey ->
                            Card(
                                onClick = { onSelectPasskey(passkey.id) },
                                modifier = Modifier.fillMaxWidth(),
                            ) {
                                Column(Modifier.padding(spacing.space4)) {
                                    Text(
                                        passkey.label ?: stringResource(R.string.passkey_unnamed),
                                        style = MaterialTheme.typography.titleMedium,
                                    )
                                    Text(
                                        passkeyTypeLabel(passkey),
                                        style = MaterialTheme.typography.bodySmall,
                                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                                    )
                                }
                            }
                        }
                    }
                    Column(Modifier.weight(0.58f)) {
                        passkeys.orEmpty().firstOrNull { it.id == selectedPasskeyId }?.let { passkey ->
                            PasskeyDetailCard(
                                passkey = passkey,
                                onRename = { onRename(passkey) },
                                onRevoke = { onRevoke(passkey) },
                            )
                        } ?: Text(
                            stringResource(R.string.common_empty),
                            color = MaterialTheme.colorScheme.onSurfaceVariant,
                        )
                    }
                }
            } else {
                Column(verticalArrangement = Arrangement.spacedBy(spacing.space3)) {
                    PasskeyHeader(
                        canAdd = canAddPasskey,
                        onAdd = onAddPasskey,
                    )
                    passkeys.orEmpty().forEach { passkey ->
                        PasskeyDetailCard(
                            passkey = passkey,
                            onRename = { onRename(passkey) },
                            onRevoke = { onRevoke(passkey) },
                        )
                    }
                }
            }
        }
        Spacer(Modifier.height(spacing.space3))
        Text(
            stringResource(R.string.authorized_devices_title),
            style = MaterialTheme.typography.titleLarge,
            modifier = Modifier.semantics { heading() },
        )
        // The allowance the devices below are counted against, before the list
        // that spends it. This is where a seller looks when the next phone will
        // not sign in, and until now the only answer was on another screen.
        deviceLimit?.let { row ->
            PlanUsageRowItem(row)
            if (limitReached) {
                // The path this row was missing. A limit is not a fault, so it
                // reads as a notice rather than an error — the role the category
                // limit already uses — and it keeps the list visible underneath,
                // because revoking a device is the other way out and it is drawn
                // right below this.
                Spacer(Modifier.height(spacing.space2))
                NoticeBanner(
                    role = SemanticRole.Commerce,
                    // The paywall's own words for this key, not a second sentence
                    // saying the same thing.
                    title = stringResource(R.string.paywall_limit_devices),
                    message = if (upgradeAvailable) {
                        stringResource(
                            R.string.devices_limit_body,
                            formatCount(row.limit ?: row.used, locale),
                            formatCount(row.used, locale),
                        )
                    } else {
                        stringResource(
                            R.string.devices_limit_body_max_plan,
                            formatCount(row.limit ?: row.used, locale),
                        )
                    },
                    // Same shape as the store's limit dialog: the destination is
                    // the paywall either way, and only the label changes when
                    // purchase is closed, because the acquisition routes answer
                    // 403. With no higher plan there is nothing to offer, so the
                    // banner carries no action rather than a dead one.
                    actionLabel = if (upgradeAvailable) {
                        stringResource(
                            if (purchaseOpen) R.string.upgrade_now else R.string.paywall_view_plans,
                        )
                    } else null,
                    onAction = if (upgradeAvailable) onLimitReached else null,
                )
            }
        }
        items.orEmpty().forEach { d ->
            Card(Modifier.fillMaxWidth()) {
                Column(Modifier.padding(spacing.space4)) {
                    Text(
                        d.device_label ?: stringResource(R.string.device_unknown),
                        style = MaterialTheme.typography.titleMedium,
                    )
                    Text(
                        listOfNotNull(d.platform, d.app_version).joinToString(" · "),
                        style = MaterialTheme.typography.bodySmall,
                    )
                    d.last_used_at?.let {
                        Text(it, style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
                    }
                    if (d.row_id != 0L) {
                        TextButton(onClick = { onRevokeDevice(d.row_id, d.device_label) }) {
                            Text(stringResource(R.string.device_revoke), color = MaterialTheme.colorScheme.error)
                        }
                    } else {
                        Text(
                            stringResource(R.string.device_primary),
                            style = MaterialTheme.typography.labelMedium,
                            color = MaterialTheme.colorScheme.primary,
                        )
                    }
                }
            }
        }
    }
}

@Composable
private fun PasskeyHeader(canAdd: Boolean, onAdd: () -> Unit) {
    Text(
        stringResource(R.string.passkeys_settings_title),
        style = MaterialTheme.typography.titleLarge,
        modifier = Modifier.semantics { heading() },
    )
    Text(
        stringResource(R.string.passkeys_settings_help),
        color = MaterialTheme.colorScheme.onSurfaceVariant,
    )
    Button(
        onClick = onAdd,
        enabled = canAdd,
        modifier = Modifier.fillMaxWidth(),
    ) {
        Text(stringResource(R.string.passkeys_add))
    }
}

@Composable
private fun PasskeyDetailCard(
    passkey: PasskeyDto,
    onRename: () -> Unit,
    onRevoke: () -> Unit,
) {
    val spacing = LocalOrderakSpacing.current
    Card(Modifier.fillMaxWidth()) {
        Column(Modifier.padding(spacing.space4)) {
            Text(
                passkey.label ?: stringResource(R.string.passkey_unnamed),
                style = MaterialTheme.typography.titleMedium,
            )
            Text(passkeyTypeLabel(passkey), style = MaterialTheme.typography.bodySmall)
            passkey.last_used_at?.let {
                Text(
                    stringResource(R.string.passkey_last_used, it),
                    style = MaterialTheme.typography.bodySmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                )
            }
            Row {
                TextButton(onClick = onRename) {
                    Text(stringResource(R.string.passkey_rename))
                }
                TextButton(onClick = onRevoke) {
                    Text(
                        stringResource(R.string.passkey_revoke),
                        color = MaterialTheme.colorScheme.error,
                    )
                }
            }
        }
    }
}

@Composable
private fun passkeyTypeLabel(passkey: PasskeyDto): String =
    if (passkey.backed_up) {
        stringResource(R.string.passkey_synced)
    } else {
        stringResource(R.string.passkey_device_bound)
    }
