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

internal data class Credentials(val phone: String, val secret: String)

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
        return if (phone.isBlank()) null else Credentials(phone, session.currentSecret())
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

    /**
     * Ask the last question again after its reply failed.
     *
     * The error card's retry used to be [resetChat], so the one control on the
     * screen labelled "try again" was the one that destroyed the conversation:
     * a seller who hit a failure and pressed Retry lost every question they had
     * asked. Retrying asks the same question again; clearing is a different
     * intention and now has its own control and its own confirmation.
     */
    fun retryChat() = launchRequest {
        val c = credentials() ?: return@launchRequest null
        val question = _chat.value.lastOrNull { it.first }?.second ?: return@launchRequest null
        val result = api.chat(c.phone, c.secret, question)
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

@OptIn(ExperimentalMaterial3Api::class)
@Composable
internal fun OperationPage(
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
    val spacing = LocalOrderakSpacing.current
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
                        .padding(spacing.space4)
                        .verticalScroll(rememberScrollState()),
                    verticalArrangement = Arrangement.spacedBy(spacing.space3),
                ) {
                    content()
                }
            }
        }
    }
}
