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
import app.orderak.seller.data.billing.EntitlementManager
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
    /*
     * null until the request answers, on every one of these. NOT emptyList().
     *
     * Each of these screens computed `isEmpty = !busy && items.isEmpty()`, and
     * `_busy` seeds false, so between the first composition and the
     * LaunchedEffect that starts the load both halves were true: the empty
     * state — "no tickets yet, create one" — rendered at a seller who has
     * tickets, every time they opened the page.
     *
     * `_busy` cannot simply seed true instead: it is shared by six screens and
     * AiAssistantScreen does not load on entry, so it would spin there forever.
     * The list knowing whether it has been read is the fix that works for all
     * of them.
     */
    private val _tickets = MutableStateFlow<List<SupportTicketDto>?>(null)
    val tickets = _tickets.asStateFlow()
    private val _announcements = MutableStateFlow<List<AnnouncementDto>?>(null)
    val announcements = _announcements.asStateFlow()
    private val _translations = MutableStateFlow<List<ProductTranslationDto>?>(null)
    val translations = _translations.asStateFlow()
    private val _devices = MutableStateFlow<List<DeviceDto>?>(null)
    val devices = _devices.asStateFlow()
    private val _passkeys = MutableStateFlow<List<PasskeyDto>?>(null)
    val passkeys = _passkeys.asStateFlow()
    private val _deletionStatus = MutableStateFlow<DeletionRequestDto?>(null)
    val deletionStatus = _deletionStatus.asStateFlow()

    /**
     * Whether [loadDeletionStatus] has answered.
     *
     * A separate flag because null is a real answer here — "you have no deletion
     * request" — and it is also the seed. Without this the screen told a seller
     * with a pending request that they had none, until the call returned.
     */
    private val _deletionLoaded = MutableStateFlow(false)
    val deletionLoaded = _deletionLoaded.asStateFlow()
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
            // ?. rather than orEmpty(): marking read before the list has been
            // read at all would replace "not loaded" with "loaded and empty".
            _announcements.value = _announcements.value?.map { if (it.id == id) it.copy(is_read = true) else it }
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
        _deletionLoaded.value = true
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

    /**
     * null until the thread has been read.
     *
     * This screen's contract declares loading and error and it had neither: the
     * page passed no busy and no error to OperationPage at all, and `refresh`
     * discarded `result.error` without looking at it. A seller opening a ticket
     * saw an empty thread with a reply box under it while the request ran, and
     * saw exactly the same thing when the request failed.
     */
    private val _messages = MutableStateFlow<List<SupportMessageDto>?>(null)
    val messages = _messages.asStateFlow()
    private val _busy = MutableStateFlow(false)
    val busy = _busy.asStateFlow()
    private val _error = MutableStateFlow<String?>(null)
    val error = _error.asStateFlow()

    init { refresh() }

    fun refresh() = viewModelScope.launch {
        _busy.value = true
        _error.value = null
        val phone = session.phone.first().orEmpty()
        if (phone.isBlank()) {
            // Not silence: no session is a reason the thread cannot load, and
            // the page has to be able to say so.
            _error.value = "no_session"
            _busy.value = false
            return@launch
        }
        val result = api.getSupportTicket(phone, session.getOrCreateSecret(), id)
        _ticket.value = result.ticket
        _messages.value = result.messages
        _error.value = result.error
        _busy.value = false
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
    /**
     * null draws no back arrow.
     *
     * RestrictedAccountScreen passed `{}`, so a locked-out seller got a back
     * arrow that did nothing — on the one screen where they are hunting for a
     * way out, and where the three real ways out are right below it. It is a
     * root destination reached with navigateAsRoot, so there is genuinely
     * nowhere behind it; the honest answer is no arrow, not a silent one.
     */
    onBack: (() -> Unit)?,
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
                    if (onBack != null) {
                        IconButton(onClick = onBack) {
                            Icon(
                                Icons.AutoMirrored.Filled.ArrowBack,
                                contentDescription = stringResource(R.string.common_back),
                            )
                        }
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

    SupportContent(
        tickets = tickets,
        busy = busy,
        error = error,
        onBack = onBack,
        onRetry = vm::loadSupport,
        onTicket = onTicket,
        onNew = { creating = true },
    )

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

/**
 * The support ticket list, as a function of its state.
 *
 * `tickets` is nullable and that is the whole point of the split: `busy` seeds
 * false and the list used to seed `emptyList()`, so "no tickets yet, open one"
 * greeted a seller with tickets on every visit, for as long as the request took.
 */
@Composable
fun SupportContent(
    tickets: List<SupportTicketDto>?,
    busy: Boolean,
    error: String?,
    onBack: () -> Unit,
    onRetry: () -> Unit,
    onTicket: (Long) -> Unit,
    onNew: () -> Unit,
) {
    OperationPage(
        title = stringResource(R.string.support_title),
        onBack = onBack,
        // Loading until the list has been read, not just while a request is in
        // flight. The two are different and only one of them was checked.
        busy = busy || tickets == null,
        error = error,
        onRetry = onRetry,
        isEmpty = tickets?.isEmpty() == true,
        empty = {
            FullScreenEmpty(
                message = stringResource(R.string.common_empty),
                actionLabel = stringResource(R.string.support_new),
                onAction = onNew,
            )
        },
    ) {
        Button(onClick = onNew, modifier = Modifier.fillMaxWidth()) {
            Text(stringResource(R.string.support_new))
        }
        tickets.orEmpty().forEach { ticket ->
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
}

@Composable
fun SupportTicketScreen(onBack: () -> Unit, vm: SupportTicketViewModel = hiltViewModel()) {
    val ticket by vm.ticket.collectAsStateWithLifecycle()
    val messages by vm.messages.collectAsStateWithLifecycle()
    val busy by vm.busy.collectAsStateWithLifecycle()
    val error by vm.error.collectAsStateWithLifecycle()
    var reply by rememberSaveable { mutableStateOf("") }

    SupportTicketContent(
        ticket = ticket,
        messages = messages,
        busy = busy,
        error = error,
        reply = reply,
        onReplyChange = { reply = it },
        onBack = onBack,
        onRetry = vm::refresh,
        onSend = { vm.reply(reply); reply = "" },
    )
}

/**
 * One support thread, as a function of its state.
 *
 * The reply box is hidden on a closed ticket, and also while the thread has not
 * been read — offering a reply before the status is known is offering one that
 * may not be accepted.
 */
@Composable
fun SupportTicketContent(
    ticket: SupportTicketDto?,
    messages: List<SupportMessageDto>?,
    busy: Boolean,
    error: String?,
    reply: String,
    onReplyChange: (String) -> Unit,
    onBack: () -> Unit,
    onRetry: () -> Unit,
    onSend: () -> Unit,
) {
    OperationPage(
        title = ticket?.subject ?: stringResource(R.string.support_title),
        onBack = onBack,
        busy = busy || messages == null,
        error = error,
        onRetry = onRetry,
    ) {
        messages.orEmpty().forEach { m ->
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
        if (ticket != null && ticket.status != "closed") {
            OutlinedTextField(
                reply,
                { onReplyChange(it.take(4000)) },
                label = { Text(stringResource(R.string.support_message)) },
                modifier = Modifier.fillMaxWidth(),
            )
            Button(
                enabled = reply.isNotBlank(),
                onClick = onSend,
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
    AnnouncementsContent(
        items = items,
        busy = busy,
        error = error,
        onBack = onBack,
        onRetry = vm::loadAnnouncements,
        onRead = vm::markAnnouncementRead,
    )
}

/** The announcements list, as a function of its state. */
@Composable
fun AnnouncementsContent(
    items: List<AnnouncementDto>?,
    busy: Boolean,
    error: String?,
    onBack: () -> Unit,
    onRetry: () -> Unit,
    onRead: (Long) -> Unit,
) {
    OperationPage(
        title = stringResource(R.string.announcements_title),
        onBack = onBack,
        busy = busy || items == null,
        error = error,
        onRetry = onRetry,
        isEmpty = items?.isEmpty() == true,
        empty = {
            FullScreenEmpty(message = stringResource(R.string.common_empty))
        },
    ) {
        items.orEmpty().forEach { a ->
            Card(
                onClick = { onRead(a.id) },
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
    // null means the list has not been read, so there is nothing to claim:
    // 0 renders the plain title rather than "0 unread".
    val unread = items?.count { !it.is_read } ?: 0
    val locale = LocalConfiguration.current.locales[0]
    OutlinedButton(onClick = onOpen, modifier = Modifier.fillMaxWidth()) {
        Text(
            if (unread > 0) stringResource(R.string.announcements_unread, formatCount(unread, locale))
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

    CatalogLanguagesContent(
        items = items,
        lang = lang,
        busy = busy,
        error = error,
        onBack = onBack,
        onRetry = { vm.loadTranslations(lang) },
        onLang = { lang = it },
        onEdit = { editing = it },
    )

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

/**
 * The per-language catalogue list, as a function of its state.
 *
 * This screen's contract declares an empty state and the screen had none: with
 * no products to translate, `OperationPage` fell through to content and drew two
 * language buttons over blank space. It says so now — and the language switcher
 * stays visible in that state, because "nothing in Arabic" is a reason to try
 * English, not a dead end.
 */
@Composable
fun CatalogLanguagesContent(
    items: List<ProductTranslationDto>?,
    lang: String,
    busy: Boolean,
    error: String?,
    onBack: () -> Unit,
    onRetry: () -> Unit,
    onLang: (String) -> Unit,
    onEdit: (ProductTranslationDto) -> Unit,
) {
    OperationPage(
        title = stringResource(R.string.catalog_languages_title),
        onBack = onBack,
        busy = busy || items == null,
        error = error,
        onRetry = onRetry,
    ) {
        Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            OutlinedButton(onClick = { onLang("ar") }) { Text("العربية") }
            OutlinedButton(onClick = { onLang("en") }) { Text("English") }
        }
        if (items?.isEmpty() == true) {
            FullScreenEmpty(message = stringResource(R.string.common_empty))
        }
        items.orEmpty().forEach { item ->
            Card(onClick = { onEdit(item) }, modifier = Modifier.fillMaxWidth()) {
                Column(Modifier.padding(16.dp)) {
                    Text(item.source_name, style = MaterialTheme.typography.titleMedium)
                    Text(item.name ?: stringResource(R.string.translation_missing))
                    Text(item.translation_status, color = MaterialTheme.colorScheme.primary)
                }
            }
        }
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
        onRevokeDevice = vm::revokeDevice,
    )

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
    onRevokeDevice: (Long) -> Unit,
) {
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
                            canAdd = canAddPasskey,
                            onAdd = onAddPasskey,
                        )
                        passkeys.orEmpty().forEach { passkey ->
                            Card(
                                onClick = { onSelectPasskey(passkey.id) },
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
                Column(verticalArrangement = Arrangement.spacedBy(12.dp)) {
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
        Spacer(Modifier.height(12.dp))
        Text(
            stringResource(R.string.authorized_devices_title),
            style = MaterialTheme.typography.titleLarge,
            modifier = Modifier.semantics { heading() },
        )
        items.orEmpty().forEach { d ->
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
                        TextButton(onClick = { onRevokeDevice(d.row_id) }) {
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
fun SubscriptionScreen(
    onBack: () -> Unit,
    onViewPlans: () -> Unit = {},
    vm: OperationsViewModel = hiltViewModel(),
) {
    val config by vm.entitlements.config.collectAsStateWithLifecycle()
    val billingState by vm.billingManager.state.collectAsStateWithLifecycle()
    SubscriptionContent(
        planName = config?.plan_name,
        subscriptionStatus = config?.subscription_status,
        currentPeriodEnd = config?.current_period_end,
        pendingEffectiveAt = config?.pending_effective_at,
        usage = config?.let(::planUsageRows).orEmpty(),
        billingState = billingState,
        purchaseOpen = vm.entitlements.isPurchaseOpen(),
        onBack = onBack,
        onViewPlans = onViewPlans,
        onRecoverPurchases = vm.billingManager::recoverPurchases,
    )
}

/**
 * The subscription page, as a function of its state.
 *
 * [planName] is nullable and NOT defaulted to "Free" here. The screen read
 * `config?.plan_name ?: "Free"` with no loading state at all, so every paying
 * seller opening it was told they were on the free plan until entitlements
 * arrived — the same defect حسابي had, on the one page whose entire subject is
 * what the seller is paying for.
 */
@Composable
fun SubscriptionContent(
    planName: String?,
    subscriptionStatus: String?,
    currentPeriodEnd: String?,
    pendingEffectiveAt: String?,
    usage: List<PlanUsageRow>,
    billingState: BillingState,
    purchaseOpen: Boolean,
    onBack: () -> Unit,
    onViewPlans: () -> Unit,
    onRecoverPurchases: () -> Unit,
) {
    OperationPage(
        title = stringResource(R.string.subscription_title),
        onBack = onBack,
        // Loading until entitlements answer. There is nothing on this page that
        // can be said truthfully without them.
        busy = planName == null,
    ) {
        Text(
            // Not null here: the page is busy until it is.
            stringResource(R.string.settings_current_plan, planName.orEmpty()),
            style = MaterialTheme.typography.titleLarge,
        )
        Text(
            // A missing status is a display gap, not a claim about money, so it
            // keeps the old fallback where plan_name deliberately does not.
            stringResource(R.string.subscription_status, subscriptionStatus ?: "active"),
            style = MaterialTheme.typography.bodyLarge,
        )
        currentPeriodEnd?.let {
            Text(stringResource(R.string.subscription_period_end, it))
        }
        pendingEffectiveAt?.let {
            Text(stringResource(R.string.plan_change_pending, it))
        }
        when (billingState) {
            is BillingState.VerificationPending, BillingState.Verifying ->
                Text(stringResource(R.string.subscription_verification_pending))
            is BillingState.Error ->
                NoticeBanner(
                    role = SemanticRole.Danger,
                    title = stringResource(R.string.subscription_verification_error),
                    message = stringResource(R.string.subscription_verification_error_body),
                )
            else -> Unit
        }

        // What the seller actually came here to see. The screen showed a plan
        // name, a status string and a recovery button, and never once said how
        // much of the plan was used — so "am I close to a limit?" could only be
        // answered by hitting one.
        //
        // The rows come from core/ui/PlanUsage.kt, shared with the dashboard
        // card. This screen used to build its own and drop every unlimited
        // entitlement — `if (limit == null) null` — while the dashboard drew it
        // as a count, so a seller on a plan with an unlimited allowance saw it in
        // one place and not the other.
        // usage rows are passed in, already resolved from the config

        if (usage.isNotEmpty()) {
            Text(
                stringResource(R.string.plan_usage_title),
                style = MaterialTheme.typography.titleMedium,
            )
            usage.forEach { row -> PlanUsageRowItem(row) }
        }

        // Say the true thing, and then stop offering the thing. The banner used
        // to sit ABOVE a Play guidance line and a recover-purchases button that
        // both rendered unconditionally, so the screen told a seller purchasing
        // was closed and then showed them two ways to try it — advisory, not a
        // gate. One decision now governs the banner and the controls together,
        // and it is the same one the account surface reads (I-5).
        if (purchaseOpen) {
            Text(stringResource(R.string.subscription_play_guidance))
            OutlinedButton(
                onClick = onRecoverPurchases,
                enabled = billingState == BillingState.Ready,
                modifier = Modifier.fillMaxWidth(),
            ) { Text(stringResource(R.string.subscription_recover)) }
        } else {
            NoticeBanner(
                role = SemanticRole.Commerce,
                title = stringResource(R.string.subscription_purchase_closed_title),
                message = stringResource(R.string.subscription_purchase_closed_body),
                // The banner said purchasing was closed and offered nothing,
                // while PlansScreen exists precisely to be READ while it is —
                // "للعرض طول ما الشراء مقفول". This screen declared PlansRoute as
                // an exit and had no control that reached it, so the one useful
                // thing a seller could still do here was unreachable from here.
                actionLabel = stringResource(R.string.paywall_view_plans),
                onAction = onViewPlans,
            )
        }

        // Offered in both purchase states, for the reason the categories banner
        // already gives: what the next plan includes is worth reading whether or
        // not anything is for sale. Above it when purchase is open, the recover
        // button is the primary action; here it is the only one.
        if (purchaseOpen) {
            TextButton(onClick = onViewPlans, modifier = Modifier.fillMaxWidth()) {
                Text(stringResource(R.string.paywall_view_plans))
            }
        }
    }
}

@Composable
fun AiAssistantScreen(onBack: () -> Unit, vm: OperationsViewModel = hiltViewModel()) {
    val messages by vm.chat.collectAsStateWithLifecycle()
    val busy by vm.busy.collectAsStateWithLifecycle()
    val error by vm.error.collectAsStateWithLifecycle()
    val config by vm.entitlements.config.collectAsStateWithLifecycle()
    var input by rememberSaveable { mutableStateOf("") }

    AiAssistantContent(
        messages = messages,
        entitlements = config?.entitlements,
        busy = busy,
        error = error,
        input = input,
        onInputChange = { input = it },
        onBack = onBack,
        onSend = { vm.sendChat(input); input = "" },
        onReset = vm::resetChat,
    )
}

/**
 * The assistant, as a function of its state.
 *
 * Unlike the other pages in this file, an empty list here is the truth on
 * arrival: nothing loads on entry, so a chat with no messages is a chat nobody
 * has started. That is why this screen is the reason `_busy` could not simply
 * seed true for all six — it would have spun here forever.
 *
 * Its contract declares an empty state and it had none, drawing the disclosure
 * over blank space. It now says what the box is for.
 */
@Composable
fun AiAssistantContent(
    messages: List<Pair<Boolean, String>>,
    entitlements: Map<String, EntitlementDto>?,
    busy: Boolean,
    error: String?,
    input: String,
    onInputChange: (String) -> Unit,
    onBack: () -> Unit,
    onSend: () -> Unit,
    onReset: () -> Unit,
) {
    val locale = LocalConfiguration.current.locales[0]
    OperationPage(
        title = stringResource(R.string.ai_assistant_title),
        onBack = onBack,
        busy = busy,
        error = error,
        onRetry = onReset,
    ) {
        Text(stringResource(R.string.ai_disclosure), style = MaterialTheme.typography.bodySmall)
        entitlements?.get("max_ai_requests_per_month")?.let { quota ->
            quota.used?.let { used ->
                Text(
                    stringResource(R.string.usage_ai_requests) + ": " +
                        if (quota.mode == "unlimited") {
                            stringResource(R.string.usage_value_unlimited, formatCount(used, locale))
                        } else {
                            stringResource(
                                R.string.usage_value,
                                formatCount(used, locale),
                                formatCount(quota.value?.jsonPrimitive?.intOrNull ?: 0, locale),
                            )
                        },
                    style = MaterialTheme.typography.bodySmall,
                )
            }
        }
        if (messages.isEmpty()) {
            // The declared empty state, which this screen did not have: it drew
            // the disclosure and the quota over blank space. The input box stays
            // — a chat with nothing in it is waiting, not broken — so this is a
            // line rather than a FullScreenEmpty.
            Text(
                stringResource(R.string.ai_empty_hint),
                style = MaterialTheme.typography.bodyMedium,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
            )
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
            onValueChange = { onInputChange(it.take(2000)) },
            label = { Text(stringResource(R.string.ai_message)) },
            modifier = Modifier.fillMaxWidth(),
        )
        Button(
            enabled = input.isNotBlank() && !busy,
            onClick = { onSend() },
            modifier = Modifier.fillMaxWidth(),
        ) { Text(stringResource(R.string.common_send)) }
        TextButton(onClick = onReset) { Text(stringResource(R.string.ai_reset)) }
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
    val loaded by vm.deletionLoaded.collectAsStateWithLifecycle()
    val busy by vm.busy.collectAsStateWithLifecycle()
    val error by vm.error.collectAsStateWithLifecycle()
    LaunchedEffect(Unit) { vm.loadDeletionStatus() }
    DeletionStatusContent(
        request = request,
        loaded = loaded,
        busy = busy,
        error = error,
        onBack = onBack,
        onRetry = vm::loadDeletionStatus,
    )
}

/**
 * The account-deletion status, as a function of its state.
 *
 * [loaded] is separate from [request] because null is a real answer here — "you
 * have no deletion request" — and it is also the seed. Without the flag this
 * page told a seller with a pending request that they had none, for as long as
 * the call took, which on this particular page is the worst thing it could say.
 */
@Composable
fun DeletionStatusContent(
    request: DeletionRequestDto?,
    loaded: Boolean,
    busy: Boolean,
    error: String?,
    onBack: () -> Unit,
    onRetry: () -> Unit,
) {
    OperationPage(
        title = stringResource(R.string.deletion_status_title),
        onBack = onBack,
        busy = busy || !loaded,
        error = error,
        onRetry = onRetry,
    ) {
        if (request == null) {
            Text(
                stringResource(R.string.deletion_status_none),
                style = MaterialTheme.typography.titleLarge,
            )
        } else {
            Text(
                stringResource(R.string.deletion_status_label, request.status),
                style = MaterialTheme.typography.titleLarge,
            )
            request.requested_at?.let { Text(stringResource(R.string.deletion_requested_at, it)) }
            request.deadline_at?.let { Text(stringResource(R.string.deletion_deadline_at, it)) }
            request.verified_at?.let { Text(stringResource(R.string.deletion_verified_at, it)) }
            request.completed_at?.let { Text(stringResource(R.string.deletion_completed_at, it)) }
            request.notes?.takeIf { it.isNotBlank() }?.let {
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
    RestrictedAccountContent(
        onCheckAgain = onCheckAgain,
        // runCatching, not a bare start: a device with no mail app resolves
        // nothing for ACTION_SENDTO and throws ActivityNotFoundException,
        // and a restricted account losing the app entirely is worse than
        // the button doing nothing.
        onContactSupport = {
            runCatching {
                context.startActivity(Intent(Intent.ACTION_SENDTO, Uri.parse("mailto:support@orderak.app")))
            }
        },
        onLogout = { vm.logout(onLogout) },
    )
}

/**
 * The restricted-account page, with nothing in it that needs a graph.
 *
 * Split from [RestrictedAccountScreen] only so it can be rendered: the screen
 * used the view model for exactly one thing, logout, and the Intent for one
 * more, and those two are the whole reason a seller locked out of their account
 * could not be shown this page in a screenshot.
 *
 * This is the page a suspended seller stares at, so it is worth looking at.
 */
@Composable
fun RestrictedAccountContent(
    onCheckAgain: () -> Unit,
    onContactSupport: () -> Unit,
    onLogout: () -> Unit,
) {
    OperationPage(
        title = stringResource(R.string.restricted_title),
        onBack = null,
    ) {
        Text(stringResource(R.string.restricted_body), style = MaterialTheme.typography.bodyLarge)
        Button(onClick = onCheckAgain, modifier = Modifier.fillMaxWidth()) {
            Text(stringResource(R.string.common_retry))
        }
        OutlinedButton(
            onClick = onContactSupport,
            modifier = Modifier.fillMaxWidth(),
        ) { Text(stringResource(R.string.restricted_contact)) }
        OutlinedButton(onClick = onLogout, modifier = Modifier.fillMaxWidth()) {
            Text(stringResource(R.string.settings_logout))
        }
    }
}
