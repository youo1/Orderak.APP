package app.orderak.seller.feature.operations
import android.app.Activity
import android.content.Context
import android.content.ContextWrapper
import android.content.Intent
import android.net.Uri
import android.os.Build
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.ModalBottomSheet
import androidx.compose.material3.Surface
import androidx.compose.material3.rememberModalBottomSheetState
import androidx.compose.ui.Alignment
import androidx.compose.ui.platform.LocalConfiguration
import androidx.compose.ui.text.style.TextDirection
import app.orderak.seller.core.text.formatAgo
import app.orderak.seller.core.text.formatNumber
import app.orderak.seller.core.ui.BottomActionBar
import app.orderak.seller.core.ui.ChatBubble
import app.orderak.seller.core.ui.Composer
import app.orderak.seller.core.ui.SemanticChip
import app.orderak.seller.core.ui.SemanticRole
import app.orderak.seller.core.ui.TextField
import app.orderak.seller.core.ui.isolated
import java.time.Instant
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
import app.orderak.seller.core.ui.Banner
import app.orderak.seller.core.ui.BannerState
import app.orderak.seller.core.ui.PlanUsageRow
import app.orderak.seller.core.ui.PlanUsageRowItem
import app.orderak.seller.core.ui.planUsageRows
import app.orderak.seller.core.locale.AppLocales
import app.orderak.seller.core.text.formatCount
import app.orderak.seller.core.ui.backendErrorResource
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
import app.orderak.seller.core.ui.theme.LocalOrderakSpacing
import app.orderak.seller.core.ui.EmptyState
import app.orderak.seller.core.ui.EmptyStateKind

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

    /**
     * The server's reason for refusing the last reply, kept apart from [error].
     *
     * [error] replaces the whole page with a full-screen failure. A reply the
     * server would not accept must not take the thread off screen — the seller is
     * reading it, and the message they are answering is in it.
     */
    private val _replyError = MutableStateFlow<String?>(null)
    val replyError = _replyError.asStateFlow()

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
        val result = api.getSupportTicket(phone, session.currentSecret(), id)
        _ticket.value = result.ticket
        _messages.value = result.messages
        _error.value = result.error
        _busy.value = false
    }
    fun reply(message: String, onSent: () -> Unit) = viewModelScope.launch {
        _replyError.value = null
        val phone = session.phone.first().orEmpty()
        if (phone.isBlank()) {
            // The same reason `refresh` gives rather than silence: a reply cannot
            // be sent without a session, and the seller has to be told.
            _replyError.value = "no_session"
            return@launch
        }
        val result = api.replySupportTicket(phone, session.currentSecret(), id, message.trim())
        if (result.ok) {
            // Only now. The caller clears the field, and clearing it on a send
            // that never left the phone destroys what the seller wrote about a
            // complaint they are in the middle of making.
            onSent()
            refresh()
        } else {
            // Was `if (ok) refresh()` and nothing else: a refused reply changed
            // nothing on screen, so the seller watched their message disappear
            // from the box with no way to tell whether anyone had received it.
            _replyError.value = result.error ?: "network"
        }
    }
}

@Composable
fun SupportScreen(onBack: () -> Unit, onTicket: (Long) -> Unit, vm: OperationsViewModel = hiltViewModel()) {
    val tickets by vm.tickets.collectAsStateWithLifecycle()
    val busy by vm.busy.collectAsStateWithLifecycle()
    val error by vm.error.collectAsStateWithLifecycle()
    LaunchedEffect(Unit) { vm.loadSupport() }

    SupportContent(
        tickets = tickets,
        busy = busy,
        error = error,
        onBack = onBack,
        onRetry = vm::loadSupport,
        onTicket = onTicket,
        onCreate = { subject, message -> vm.createTicket(subject, message) },
    )
}

/**
 * The support ticket list, as a function of its state.
 *
 * Ticket rows (subject, "#number", the last activity, and a chip for open or closed) and one
 * bar, "تذكرة جديدة", which opens a sheet: "كيف يمكننا مساعدتك؟", a subject, the details and
 * "إرسال". `tickets` is nullable: `busy` seeds false and the list used to seed `emptyList()`, so
 * "no tickets yet" greeted a seller with tickets on every visit, for as long as the request took.
 */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun SupportContent(
    tickets: List<SupportTicketDto>?,
    busy: Boolean,
    error: String?,
    onBack: () -> Unit,
    onRetry: () -> Unit,
    onTicket: (Long) -> Unit,
    onCreate: (String, String) -> Unit,
) {
    val spacing = LocalOrderakSpacing.current
    val locale = LocalConfiguration.current.locales[0]
    var creating by rememberSaveable { mutableStateOf(false) }
    OperationPage(
        title = stringResource(R.string.support_title),
        onBack = onBack,
        // Loading until the list has been read, not just while a request is in flight.
        busy = busy || tickets == null,
        error = error,
        onRetry = onRetry,
        isEmpty = tickets?.isEmpty() == true,
        empty = {
            EmptyState(
                kind = EmptyStateKind.Empty,
                title = stringResource(R.string.support_empty),
                actionLabel = stringResource(R.string.support_new_ticket),
                onAction = { creating = true },
            )
        },
        bottomBar = {
            if (tickets?.isNotEmpty() == true) {
                BottomActionBar(
                    primaryLabel = stringResource(R.string.support_new_ticket),
                    onPrimary = { creating = true },
                )
            }
        },
    ) {
        tickets.orEmpty().forEach { ticket ->
            Surface(
                onClick = { onTicket(ticket.id) },
                shape = MaterialTheme.shapes.large,
                color = MaterialTheme.colorScheme.surfaceContainerLowest,
                modifier = Modifier.fillMaxWidth(),
            ) {
                Row(
                    Modifier.padding(spacing.space3),
                    verticalAlignment = Alignment.CenterVertically,
                    horizontalArrangement = Arrangement.spacedBy(spacing.space3),
                ) {
                    Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(spacing.space1)) {
                        Text(
                            ticket.subject,
                            style = MaterialTheme.typography.titleSmall.copy(textDirection = TextDirection.Content),
                        )
                        val number = isolated("#" + formatNumber(ticket.id, locale))
                        val last = ticket.updated_at?.let { serverMillis(it) }
                            ?.let { formatAgo(it, System.currentTimeMillis(), locale) }
                        Text(
                            listOfNotNull(number, last).joinToString(" · "),
                            style = MaterialTheme.typography.bodySmall,
                            color = MaterialTheme.colorScheme.onSurfaceVariant,
                        )
                    }
                    if (ticket.status == "closed") {
                        SemanticChip(SemanticRole.Neutral, stringResource(R.string.support_status_closed))
                    } else {
                        SemanticChip(SemanticRole.Info, stringResource(R.string.support_status_open))
                    }
                }
            }
        }
    }

    if (creating) {
        ModalBottomSheet(
            onDismissRequest = { creating = false },
            sheetState = rememberModalBottomSheetState(skipPartiallyExpanded = true),
            containerColor = MaterialTheme.colorScheme.surface,
            dragHandle = null,
            shape = RoundedCornerShape(spacing.space0),
        ) {
            var subject by rememberSaveable { mutableStateOf("") }
            var message by rememberSaveable { mutableStateOf("") }
            Column(
                Modifier.fillMaxWidth().verticalScroll(rememberScrollState()).padding(spacing.space4),
                verticalArrangement = Arrangement.spacedBy(spacing.space3),
            ) {
                Text(
                    stringResource(R.string.support_sheet_title),
                    style = MaterialTheme.typography.titleLarge,
                    modifier = Modifier.semantics { heading() },
                )
                TextField(
                    value = subject,
                    onValueChange = { subject = it.take(120) },
                    label = stringResource(R.string.support_subject),
                    required = true,
                )
                TextField(
                    value = message,
                    onValueChange = { message = it.take(4000) },
                    label = stringResource(R.string.support_message),
                    required = true,
                    singleLine = false,
                )
                Button(
                    enabled = subject.isNotBlank() && message.isNotBlank(),
                    onClick = { onCreate(subject, message); creating = false },
                    modifier = Modifier.fillMaxWidth().heightIn(min = spacing.minimumTouchTarget),
                ) { Text(stringResource(R.string.common_send)) }
                TextButton(
                    onClick = { creating = false },
                    modifier = Modifier.fillMaxWidth().heightIn(min = spacing.minimumTouchTarget),
                ) { Text(stringResource(R.string.common_cancel)) }
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
    val replyError by vm.replyError.collectAsStateWithLifecycle()
    var reply by rememberSaveable { mutableStateOf("") }

    SupportTicketContent(
        ticket = ticket,
        messages = messages,
        busy = busy,
        error = error,
        replyError = replyError,
        reply = reply,
        onReplyChange = { reply = it },
        onBack = onBack,
        onRetry = vm::refresh,
        // Cleared only once the server has the reply. See `reply`.
        onSend = { vm.reply(reply) { reply = "" } },
    )
}

/**
 * One support thread, as a function of its state.
 *
 * A top bar with the subject and the status under it; the conversation as bubbles, the seller's
 * at the end and support's at the start, each with its time; and the composer at the bottom. On
 * a closed ticket the composer is replaced by the sentence that says so. The composer is also
 * withheld while the thread has not been read: offering a reply before the status is known is
 * offering one that may not be accepted.
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
    /** A stable backend code for the last refused reply, or null. */
    replyError: String? = null,
) {
    val spacing = LocalOrderakSpacing.current
    val locale = LocalConfiguration.current.locales[0]
    OperationPage(
        title = ticket?.subject ?: stringResource(R.string.support_title),
        // The number first, then the state: "#238 · open" is how the design names a ticket.
        subtitle = ticket?.let {
            stringResource(
                R.string.support_ticket_subtitle,
                formatNumber(it.id, locale),
                stringResource(if (it.status == "closed") R.string.support_status_closed else R.string.support_status_open),
            )
        },
        onBack = onBack,
        busy = busy || messages == null,
        error = error,
        onRetry = onRetry,
        bottomBar = {
            if (ticket != null) {
                Column {
                    if (replyError != null && ticket.status != "closed") {
                        // Above the field, not instead of the thread: the seller is answering
                        // something they can still read, and their reply is still in the field.
                        Banner(
                            state = BannerState.Error,
                            title = stringResource(R.string.support_reply_failed),
                            message = stringResource(backendErrorResource(replyError)),
                            modifier = Modifier.padding(horizontal = spacing.space4, vertical = spacing.space2),
                        )
                    }
                    Composer(
                        value = reply,
                        onValueChange = { onReplyChange(it.take(4000)) },
                        onSend = { if (reply.isNotBlank()) onSend() },
                        placeholder = stringResource(R.string.support_message),
                        sendDescription = stringResource(R.string.common_send),
                        closedLabel = if (ticket.status == "closed") stringResource(R.string.support_closed_notice) else null,
                    )
                }
            }
        },
    ) {
        messages.orEmpty().forEach { m ->
            ChatBubble(
                text = m.body,
                mine = m.sender == "seller",
                time = m.created_at?.let { serverMillis(it) }
                    ?.let { formatAgo(it, System.currentTimeMillis(), locale) },
            )
        }
    }
}

internal fun localizedJson(raw: String): String = runCatching {
    val obj = Json.parseToJsonElement(raw).jsonObject
    val wanted = if (AppLocales.currentTag().startsWith("ar")) "ar" else "en"
    obj[wanted]?.jsonPrimitive?.content ?: obj["en"]?.jsonPrimitive?.content ?: obj.values.first().jsonPrimitive.content
}.getOrDefault(raw)
