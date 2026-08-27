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
import app.orderak.seller.core.locale.AppLocales
import app.orderak.seller.core.ui.FullScreenEmpty
import app.orderak.seller.core.ui.FullScreenError
import app.orderak.seller.core.ui.FullScreenLoading
import app.orderak.seller.data.billing.EntitlementManager
import app.orderak.seller.data.billing.BillingManager
import app.orderak.seller.data.billing.BillingState
import app.orderak.seller.data.auth.PasskeyClient
import app.orderak.seller.data.auth.PasskeyResult
import app.orderak.seller.data.remote.AnnouncementDto
import app.orderak.seller.data.remote.BackendApi
import app.orderak.seller.data.remote.DeletionRequestDto
import app.orderak.seller.data.remote.DeviceDto
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

private data class Credentials(val phone: String, val secret: String)

@HiltViewModel
class OperationsViewModel @Inject constructor(
    private val api: BackendApi,
    private val session: SessionStore,
    val entitlements: EntitlementManager,
    val billingManager: BillingManager,
    private val passkeyClient: PasskeyClient,
) : ViewModel() {
    private val _busy = MutableStateFlow(false)
    val busy = _busy.asStateFlow()
    private val _error = MutableStateFlow<String?>(null)
    val error = _error.asStateFlow()
    private val _tickets = MutableStateFlow<List<SupportTicketDto>>(emptyList())
    val tickets = _tickets.asStateFlow()
    private val _announcements = MutableStateFlow<List<AnnouncementDto>>(emptyList())
    val announcements = _announcements.asStateFlow()
    private val _translations = MutableStateFlow<List<ProductTranslationDto>>(emptyList())
    val translations = _translations.asStateFlow()
    private val _devices = MutableStateFlow<List<DeviceDto>>(emptyList())
    val devices = _devices.asStateFlow()
    private val _passkeys = MutableStateFlow<List<PasskeyDto>>(emptyList())
    val passkeys = _passkeys.asStateFlow()
    private val _deletionStatus = MutableStateFlow<DeletionRequestDto?>(null)
    val deletionStatus = _deletionStatus.asStateFlow()
    private val _chat = MutableStateFlow<List<Pair<Boolean, String>>>(emptyList())
    val chat = _chat.asStateFlow()

    private suspend fun credentials(): Credentials? {
        val phone = session.phone.first().orEmpty()
        return if (phone.isBlank()) null else Credentials(phone, session.getOrCreateSecret())
    }

    fun loadSupport() = launchRequest {
        val c = credentials() ?: return@launchRequest null
        val result = api.listSupportTickets(c.phone, c.secret)
        _tickets.value = result.tickets
        result.error
    }

    fun createTicket(subject: String, message: String) = launchRequest {
        val c = credentials() ?: return@launchRequest null
        val result = api.createSupportTicket(c.phone, c.secret, subject.trim(), message.trim())
        if (result.ok) loadSupport()
        result.error
    }

    fun loadAnnouncements() = launchRequest {
        val c = credentials() ?: return@launchRequest null
        val result = api.listAnnouncements(c.phone, c.secret)
        _announcements.value = result.announcements
        result.error
    }

    fun markAnnouncementRead(id: Long) = viewModelScope.launch {
        val c = credentials() ?: return@launch
        if (api.markAnnouncementRead(c.phone, c.secret, id).ok) {
            _announcements.value = _announcements.value.map { if (it.id == id) it.copy(is_read = true) else it }
        }
    }

    fun loadTranslations(lang: String) = launchRequest {
        val c = credentials() ?: return@launchRequest null
        val result = api.listProductTranslations(c.phone, c.secret, lang)
        _translations.value = result.translations
        result.error
    }

    fun saveTranslation(item: ProductTranslationDto, name: String, description: String) = launchRequest {
        val c = credentials() ?: return@launchRequest null
        val result = api.updateProductTranslation(c.phone, c.secret, item.product_code, item.lang, name.trim(), description.trim())
        if (result.ok) loadTranslations(item.lang)
        result.error
    }

    fun loadDevices() = launchRequest {
        val c = credentials() ?: return@launchRequest null
        val result = api.listDevices(c.phone, c.secret)
        _devices.value = result.devices
        val passkeys = api.listPasskeys(c.phone, c.secret)
        if (passkeys.ok) _passkeys.value = passkeys.passkeys
        result.error ?: passkeys.error
    }

    fun revokeDevice(rowId: Long) = launchRequest {
        val c = credentials() ?: return@launchRequest null
        val result = api.revokeDevice(c.phone, c.secret, rowId)
        if (result.ok) loadDevices()
        result.error
    }

    fun createPasskey(activity: Activity) = launchRequest {
        val c = credentials() ?: return@launchRequest "auth"
        val recent = session.readRecentAuthToken() ?: return@launchRequest "recent_auth_required"
        val options = api.passkeyRegistrationOptions(c.phone, c.secret, recent)
        if (!options.ok || options.options_json.isNullOrBlank() || options.challenge_id.isNullOrBlank()) {
            return@launchRequest options.error ?: "passkey_failed"
        }
        when (val result = passkeyClient.register(activity, options.options_json)) {
            PasskeyResult.Cancelled -> null
            PasskeyResult.Unavailable -> "passkey_unavailable"
            is PasskeyResult.Failed -> "passkey_failed"
            is PasskeyResult.Success -> {
                val completed = api.completePasskeyRegistration(
                    c.phone,
                    c.secret,
                    recent,
                    options.challenge_id,
                    result.responseJson,
                    Build.MODEL?.take(60),
                )
                if (completed.ok) loadDevices()
                completed.error
            }
        }
    }

    fun renamePasskey(id: String, label: String) = launchRequest {
        val c = credentials() ?: return@launchRequest "auth"
        val recent = session.readRecentAuthToken() ?: return@launchRequest "recent_auth_required"
        val result = api.renamePasskey(c.phone, c.secret, recent, id, label.trim())
        if (result.ok) loadDevices()
        result.error
    }

    fun deletePasskey(id: String) = launchRequest {
        val c = credentials() ?: return@launchRequest "auth"
        val recent = session.readRecentAuthToken() ?: return@launchRequest "recent_auth_required"
        val result = api.deletePasskey(c.phone, c.secret, recent, id)
        if (result.ok) loadDevices()
        result.error
    }

    fun loadDeletionStatus() = launchRequest {
        val c = credentials() ?: return@launchRequest null
        val result = api.getDeletionStatus(c.phone, c.secret)
        _deletionStatus.value = result.request
        result.error
    }

    fun sendChat(message: String) = launchRequest {
        val c = credentials() ?: return@launchRequest null
        _chat.value += true to message.trim()
        val result = api.chat(c.phone, c.secret, message.trim())
        result.reply?.let { _chat.value += false to it }
        result.error
    }

    fun resetChat() { _chat.value = emptyList() }

    private fun launchRequest(block: suspend () -> String?) {
        viewModelScope.launch {
            _busy.value = true
            _error.value = null
            _error.value = block()
            _busy.value = false
        }
    }
}

@HiltViewModel
class SupportTicketViewModel @Inject constructor(
    savedStateHandle: SavedStateHandle,
    private val api: BackendApi,
    private val session: SessionStore,
) : ViewModel() {
    val id = savedStateHandle.toRoute<SupportTicketRoute>().id
    private val _ticket = MutableStateFlow<SupportTicketDto?>(null)
    val ticket = _ticket.asStateFlow()
    private val _messages = MutableStateFlow<List<SupportMessageDto>>(emptyList())
    val messages = _messages.asStateFlow()
    init { refresh() }
    fun refresh() = viewModelScope.launch {
        val phone = session.phone.first().orEmpty(); if (phone.isBlank()) return@launch
        val result = api.getSupportTicket(phone, session.getOrCreateSecret(), id)
        _ticket.value = result.ticket; _messages.value = result.messages
    }
    fun reply(message: String) = viewModelScope.launch {
        val phone = session.phone.first().orEmpty(); if (phone.isBlank()) return@launch
        if (api.replySupportTicket(phone, session.getOrCreateSecret(), id, message.trim()).ok) refresh()
    }
}

@HiltViewModel
class RestrictedAccountViewModel @Inject constructor(
    private val sessionLogoutManager: SessionLogoutManager,
) : ViewModel() {
    fun logout(done: () -> Unit) = viewModelScope.launch {
        sessionLogoutManager.logout()
        done()
    }
}

/**
 * Shared operation page shell with loading, error, and content states.
 * Uses only MaterialTheme tokens — zero hardcoded values.
 */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
private fun OperationPage(
    title: String,
    onBack: () -> Unit,
    busy: Boolean = false,
    error: String? = null,
    onRetry: (() -> Unit)? = null,
    empty: @Composable (() -> Unit)? = null,
    isEmpty: Boolean = false,
    content: @Composable () -> Unit,
) {
    Scaffold(
        topBar = {
            TopAppBar(
                title = { Text(title, modifier = Modifier.semantics { heading() }) },
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
        Column(
            Modifier
                .fillMaxSize()
                .padding(padding),
        ) {
            when {
                busy -> Box(Modifier.fillMaxSize(), contentAlignment = Alignment.Center) {
                    FullScreenLoading()
                }
                error != null -> FullScreenError(
                    message = error,
                    onRetry = onRetry,
                )
                isEmpty && empty != null -> {
                    empty()
                }
                else -> Column(
                    Modifier
                        .fillMaxSize()
                        .padding(16.dp)
                        .verticalScroll(rememberScrollState()),
                    verticalArrangement = Arrangement.spacedBy(12.dp),
                ) {
                    content()
                }
            }
        }
    }
}

@Composable
fun SupportScreen(onBack: () -> Unit, onTicket: (Long) -> Unit, vm: OperationsViewModel = hiltViewModel()) {
    val tickets by vm.tickets.collectAsStateWithLifecycle()
    val busy by vm.busy.collectAsStateWithLifecycle()
    val error by vm.error.collectAsStateWithLifecycle()
    var creating by rememberSaveable { mutableStateOf(false) }
    LaunchedEffect(Unit) { vm.loadSupport() }
    OperationPage(
        title = stringResource(R.string.support_title),
        onBack = onBack,
        busy = busy,
        error = error,
        onRetry = vm::loadSupport,
        isEmpty = !busy && tickets.isEmpty(),
        empty = {
            FullScreenEmpty(
                message = stringResource(R.string.common_empty),
                actionLabel = stringResource(R.string.support_new),
                onAction = { creating = true },
            )
        },
    ) {
        Button(onClick = { creating = true }, modifier = Modifier.fillMaxWidth()) {
            Text(stringResource(R.string.support_new))
        }
        tickets.forEach { ticket ->
            Card(
                onClick = { onTicket(ticket.id) },
                modifier = Modifier.fillMaxWidth(),
            ) {
                Column(Modifier.padding(16.dp)) {
                    Text(ticket.subject, style = MaterialTheme.typography.titleMedium)
                    Text("${ticket.status} · ${ticket.priority}", style = MaterialTheme.typography.bodySmall)
                    ticket.last_message?.let {
                        Text(it, style = MaterialTheme.typography.bodyMedium)
                    }
                }
            }
        }
    }
    if (creating) {
        var subject by rememberSaveable { mutableStateOf("") }
        var message by rememberSaveable { mutableStateOf("") }
        AlertDialog(
            onDismissRequest = { creating = false },
            title = { Text(stringResource(R.string.support_new)) },
            text = {
                Column {
                    OutlinedTextField(subject, { subject = it.take(120) }, label = { Text(stringResource(R.string.support_subject)) })
                    Spacer(Modifier.height(8.dp))
                    OutlinedTextField(message, { message = it.take(4000) }, label = { Text(stringResource(R.string.support_message)) })
                }
            },
            confirmButton = {
                TextButton(
                    enabled = subject.isNotBlank() && message.isNotBlank(),
                    onClick = { vm.createTicket(subject, message); creating = false },
                ) { Text(stringResource(R.string.common_send)) }
            },
            dismissButton = { TextButton(onClick = { creating = false }) { Text(stringResource(R.string.common_cancel)) } },
        )
    }
}

@Composable
fun SupportTicketScreen(onBack: () -> Unit, vm: SupportTicketViewModel = hiltViewModel()) {
    val ticket by vm.ticket.collectAsStateWithLifecycle()
    val messages by vm.messages.collectAsStateWithLifecycle()
    var reply by rememberSaveable { mutableStateOf("") }
    OperationPage(
        title = ticket?.subject ?: stringResource(R.string.support_title),
        onBack = onBack,
    ) {
        messages.forEach { m ->
            Card(Modifier.fillMaxWidth()) {
                Column(Modifier.padding(16.dp)) {
                    Text(m.sender, style = MaterialTheme.typography.labelMedium)
                    Text(m.body, style = MaterialTheme.typography.bodyMedium)
                    m.created_at?.let {
                        Text(it, style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
                    }
                }
            }
        }
        if (ticket?.status != "closed") {
            OutlinedTextField(
                reply,
                { reply = it.take(4000) },
                label = { Text(stringResource(R.string.support_message)) },
                modifier = Modifier.fillMaxWidth(),
            )
            Button(
                enabled = reply.isNotBlank(),
                onClick = { vm.reply(reply); reply = "" },
                modifier = Modifier.fillMaxWidth(),
            ) { Text(stringResource(R.string.common_send)) }
        }
    }
}

private fun localizedJson(raw: String): String = runCatching {
    val obj = Json.parseToJsonElement(raw).jsonObject
    val wanted = if (AppLocales.currentTag().startsWith("ar")) "ar" else "en"
    obj[wanted]?.jsonPrimitive?.content ?: obj["en"]?.jsonPrimitive?.content ?: obj.values.first().jsonPrimitive.content
}.getOrDefault(raw)

@Composable
fun AnnouncementsScreen(onBack: () -> Unit, vm: OperationsViewModel = hiltViewModel()) {
    val items by vm.announcements.collectAsStateWithLifecycle()
    val busy by vm.busy.collectAsStateWithLifecycle()
    val error by vm.error.collectAsStateWithLifecycle()
    LaunchedEffect(Unit) { vm.loadAnnouncements() }
    OperationPage(
        title = stringResource(R.string.announcements_title),
        onBack = onBack,
        busy = busy,
        error = error,
        onRetry = vm::loadAnnouncements,
        isEmpty = !busy && items.isEmpty(),
        empty = {
            FullScreenEmpty(message = stringResource(R.string.common_empty))
        },
    ) {
        items.forEach { a ->
            Card(
                onClick = { vm.markAnnouncementRead(a.id) },
                modifier = Modifier.fillMaxWidth(),
            ) {
                Column(Modifier.padding(16.dp)) {
                    Text(localizedJson(a.title_i18n), style = MaterialTheme.typography.titleMedium)
                    Spacer(Modifier.height(4.dp))
                    Text(localizedJson(a.body_i18n), style = MaterialTheme.typography.bodyMedium)
                    if (!a.is_read) {
                        Text(
                            stringResource(R.string.announcement_new),
                            color = MaterialTheme.colorScheme.primary,
                            style = MaterialTheme.typography.labelMedium,
                        )
                    }
                }
            }
        }
    }
}

@Composable
fun AnnouncementsDashboardIndicator(
    onOpen: () -> Unit,
    vm: OperationsViewModel = hiltViewModel(),
) {
    val items by vm.announcements.collectAsStateWithLifecycle()
    LaunchedEffect(Unit) { vm.loadAnnouncements() }
    val unread = items.count { !it.is_read }
    OutlinedButton(onClick = onOpen, modifier = Modifier.fillMaxWidth()) {
        Text(
            if (unread > 0) stringResource(R.string.announcements_unread, unread)
            else stringResource(R.string.announcements_title),
        )
    }
}

@Composable
fun CatalogLanguagesScreen(onBack: () -> Unit, vm: OperationsViewModel = hiltViewModel()) {
    var lang by rememberSaveable { mutableStateOf("ar") }
    val items by vm.translations.collectAsStateWithLifecycle()
    val busy by vm.busy.collectAsStateWithLifecycle()
    val error by vm.error.collectAsStateWithLifecycle()
    var editing by remember { mutableStateOf<ProductTranslationDto?>(null) }
    LaunchedEffect(lang) { vm.loadTranslations(lang) }
    OperationPage(
        title = stringResource(R.string.catalog_languages_title),
        onBack = onBack,
        busy = busy,
        error = error,
        onRetry = { vm.loadTranslations(lang) },
    ) {
        Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            OutlinedButton(onClick = { lang = "ar" }) { Text("العربية") }
            OutlinedButton(onClick = { lang = "en" }) { Text("English") }
        }
        items.forEach { item ->
            Card(onClick = { editing = item }, modifier = Modifier.fillMaxWidth()) {
                Column(Modifier.padding(16.dp)) {
                    Text(item.source_name, style = MaterialTheme.typography.titleMedium)
                    Text(item.name ?: stringResource(R.string.translation_missing))
                    Text(item.translation_status, color = MaterialTheme.colorScheme.primary)
                }
            }
        }
    }
    editing?.let { item ->
        var name by rememberSaveable(item.product_code, item.lang) { mutableStateOf(item.name.orEmpty()) }
        var description by rememberSaveable(item.product_code, item.lang) { mutableStateOf(item.description.orEmpty()) }
        AlertDialog(
            onDismissRequest = { editing = null },
            title = { Text(item.source_name) },
            text = {
                Column {
                    OutlinedTextField(name, { name = it.take(120) }, label = { Text(stringResource(R.string.translation_name)) })
                    Spacer(Modifier.height(8.dp))
                    OutlinedTextField(description, { description = it.take(700) }, label = { Text(stringResource(R.string.translation_description)) })
                }
            },
            confirmButton = {
                TextButton(
                    enabled = name.isNotBlank(),
                    onClick = { vm.saveTranslation(item, name, description); editing = null },
                ) { Text(stringResource(R.string.settings_save)) }
            },
            dismissButton = { TextButton(onClick = { editing = null }) { Text(stringResource(R.string.common_cancel)) } },
        )
    }
}

@Composable
fun DevicesScreen(
    onBack: () -> Unit,
    onReauthenticate: () -> Unit,
    vm: OperationsViewModel = hiltViewModel(),
) {
    val items by vm.devices.collectAsStateWithLifecycle()
    val passkeys by vm.passkeys.collectAsStateWithLifecycle()
    val busy by vm.busy.collectAsStateWithLifecycle()
    val error by vm.error.collectAsStateWithLifecycle()
    val activity = LocalContext.current.findActivity()
    var renameTarget by remember { mutableStateOf<PasskeyDto?>(null) }
    var deleteTarget by remember { mutableStateOf<PasskeyDto?>(null) }
    var selectedPasskeyId by rememberSaveable { mutableStateOf<String?>(null) }
    LaunchedEffect(Unit) { vm.loadDevices() }
    LaunchedEffect(passkeys) {
        if (passkeys.none { it.id == selectedPasskeyId }) {
            selectedPasskeyId = passkeys.firstOrNull()?.id
        }
    }
    OperationPage(
        title = stringResource(R.string.devices_title),
        onBack = onBack,
        busy = busy,
        error = error,
        onRetry = if (error == "recent_auth_required") onReauthenticate else vm::loadDevices,
        isEmpty = !busy && items.isEmpty() && passkeys.isEmpty(),
        empty = {
            FullScreenEmpty(message = stringResource(R.string.common_empty))
        },
    ) {
        BoxWithConstraints(Modifier.fillMaxWidth()) {
            val isListDetail = maxWidth >= 720.dp
            if (isListDetail) {
                Row(
                    modifier = Modifier.fillMaxWidth(),
                    horizontalArrangement = Arrangement.spacedBy(16.dp),
                ) {
                    Column(
                        modifier = Modifier.weight(0.42f),
                        verticalArrangement = Arrangement.spacedBy(12.dp),
                    ) {
                        PasskeyHeader(
                            canAdd = Build.VERSION.SDK_INT >= Build.VERSION_CODES.P,
                            onAdd = { activity?.let(vm::createPasskey) },
                        )
                        passkeys.forEach { passkey ->
                            Card(
                                onClick = { selectedPasskeyId = passkey.id },
                                modifier = Modifier.fillMaxWidth(),
                            ) {
                                Column(Modifier.padding(16.dp)) {
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
                        passkeys.firstOrNull { it.id == selectedPasskeyId }?.let { passkey ->
                            PasskeyDetailCard(
                                passkey = passkey,
                                onRename = { renameTarget = passkey },
                                onRevoke = { deleteTarget = passkey },
                            )
                        } ?: Text(
                            stringResource(R.string.common_empty),
                            color = MaterialTheme.colorScheme.onSurfaceVariant,
                        )
                    }
                }
            } else {
                Column(verticalArrangement = Arrangement.spacedBy(12.dp)) {
                    PasskeyHeader(
                        canAdd = Build.VERSION.SDK_INT >= Build.VERSION_CODES.P,
                        onAdd = { activity?.let(vm::createPasskey) },
                    )
                    passkeys.forEach { passkey ->
                        PasskeyDetailCard(
                            passkey = passkey,
                            onRename = { renameTarget = passkey },
                            onRevoke = { deleteTarget = passkey },
                        )
                    }
                }
            }
        }
        Spacer(Modifier.height(12.dp))
        Text(
            stringResource(R.string.authorized_devices_title),
            style = MaterialTheme.typography.titleLarge,
            modifier = Modifier.semantics { heading() },
        )
        items.forEach { d ->
            Card(Modifier.fillMaxWidth()) {
                Column(Modifier.padding(16.dp)) {
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
                        TextButton(onClick = { vm.revokeDevice(d.row_id) }) {
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
    Card(Modifier.fillMaxWidth()) {
        Column(Modifier.padding(16.dp)) {
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

@Composable
fun SubscriptionScreen(onBack: () -> Unit, vm: OperationsViewModel = hiltViewModel()) {
    val config by vm.entitlements.config.collectAsStateWithLifecycle()
    val billingState by vm.billingManager.state.collectAsStateWithLifecycle()
    OperationPage(
        title = stringResource(R.string.subscription_title),
        onBack = onBack,
    ) {
        Text(
            stringResource(R.string.settings_current_plan, config?.plan_name ?: "Free"),
            style = MaterialTheme.typography.titleLarge,
        )
        Text(
            stringResource(R.string.subscription_status, config?.subscription_status ?: "active"),
            style = MaterialTheme.typography.bodyLarge,
        )
        config?.current_period_end?.let {
            Text(stringResource(R.string.subscription_period_end, it))
        }
        config?.pending_effective_at?.let {
            Text(stringResource(R.string.plan_change_pending, it))
        }
        when (billingState) {
            is BillingState.VerificationPending, BillingState.Verifying ->
                Text(stringResource(R.string.subscription_verification_pending))
            is BillingState.Error ->
                Text(stringResource(R.string.subscription_verification_error), color = MaterialTheme.colorScheme.error)
            else -> Unit
        }
        Text(stringResource(R.string.subscription_play_guidance))
        OutlinedButton(
            onClick = vm.billingManager::recoverPurchases,
            enabled = billingState == BillingState.Ready,
            modifier = Modifier.fillMaxWidth(),
        ) { Text(stringResource(R.string.subscription_recover)) }
    }
}

@Composable
fun AiAssistantScreen(onBack: () -> Unit, vm: OperationsViewModel = hiltViewModel()) {
    val messages by vm.chat.collectAsStateWithLifecycle()
    val busy by vm.busy.collectAsStateWithLifecycle()
    val error by vm.error.collectAsStateWithLifecycle()
    val config by vm.entitlements.config.collectAsStateWithLifecycle()
    var input by rememberSaveable { mutableStateOf("") }
    OperationPage(
        title = stringResource(R.string.ai_assistant_title),
        onBack = onBack,
        busy = busy,
        error = error,
        onRetry = vm::resetChat,
    ) {
        Text(stringResource(R.string.ai_disclosure), style = MaterialTheme.typography.bodySmall)
        config?.entitlements?.get("max_ai_requests_per_month")?.let { quota ->
            quota.used?.let { used ->
                Text(
                    stringResource(R.string.usage_ai_requests) + ": " +
                        if (quota.mode == "unlimited") stringResource(R.string.usage_value_unlimited, used)
                        else stringResource(R.string.usage_value, used, quota.value?.jsonPrimitive?.intOrNull ?: 0),
                    style = MaterialTheme.typography.bodySmall,
                )
            }
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
                Column(Modifier.padding(12.dp)) {
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
            onValueChange = { input = it.take(2000) },
            label = { Text(stringResource(R.string.ai_message)) },
            modifier = Modifier.fillMaxWidth(),
        )
        Button(
            enabled = input.isNotBlank() && !busy,
            onClick = { vm.sendChat(input); input = "" },
            modifier = Modifier.fillMaxWidth(),
        ) { Text(stringResource(R.string.common_send)) }
        TextButton(onClick = vm::resetChat) { Text(stringResource(R.string.ai_reset)) }
    }
}

private tailrec fun Context.findActivity(): Activity? = when (this) {
    is Activity -> this
    is ContextWrapper -> baseContext.findActivity()
    else -> null
}

@Composable
fun DeletionStatusScreen(onBack: () -> Unit, vm: OperationsViewModel = hiltViewModel()) {
    val request by vm.deletionStatus.collectAsStateWithLifecycle()
    val busy by vm.busy.collectAsStateWithLifecycle()
    val error by vm.error.collectAsStateWithLifecycle()
    LaunchedEffect(Unit) { vm.loadDeletionStatus() }
    OperationPage(
        title = stringResource(R.string.deletion_status_title),
        onBack = onBack,
        busy = busy,
        error = error,
        onRetry = vm::loadDeletionStatus,
    ) {
        if (request == null) {
            Text(
                stringResource(R.string.deletion_status_none),
                style = MaterialTheme.typography.titleLarge,
            )
        } else {
            Text(
                stringResource(R.string.deletion_status_label, request!!.status),
                style = MaterialTheme.typography.titleLarge,
            )
            request!!.requested_at?.let { Text(stringResource(R.string.deletion_requested_at, it)) }
            request!!.deadline_at?.let { Text(stringResource(R.string.deletion_deadline_at, it)) }
            request!!.verified_at?.let { Text(stringResource(R.string.deletion_verified_at, it)) }
            request!!.completed_at?.let { Text(stringResource(R.string.deletion_completed_at, it)) }
            request!!.notes?.takeIf { it.isNotBlank() }?.let {
                Text(it, style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
            }
        }
        Spacer(Modifier.height(8.dp))
        Text(stringResource(R.string.deletion_status_help), style = MaterialTheme.typography.bodySmall)
    }
}

@Composable
fun RestrictedAccountScreen(
    onCheckAgain: () -> Unit,
    onLogout: () -> Unit,
    vm: RestrictedAccountViewModel = hiltViewModel(),
) {
    val context = LocalContext.current
    OperationPage(
        title = stringResource(R.string.restricted_title),
        onBack = {},
    ) {
        Text(stringResource(R.string.restricted_body), style = MaterialTheme.typography.bodyLarge)
        Button(onClick = onCheckAgain, modifier = Modifier.fillMaxWidth()) {
            Text(stringResource(R.string.common_retry))
        }
        OutlinedButton(
            // runCatching, not a bare start: a device with no mail app resolves
            // nothing for ACTION_SENDTO and throws ActivityNotFoundException,
            // and a restricted account losing the app entirely is worse than
            // the button doing nothing.
            onClick = {
                runCatching {
                    context.startActivity(Intent(Intent.ACTION_SENDTO, Uri.parse("mailto:support@orderak.app")))
                }
            },
            modifier = Modifier.fillMaxWidth(),
        ) { Text(stringResource(R.string.restricted_contact)) }
        OutlinedButton(onClick = { vm.logout(onLogout) }, modifier = Modifier.fillMaxWidth()) {
            Text(stringResource(R.string.settings_logout))
        }
    }
}
