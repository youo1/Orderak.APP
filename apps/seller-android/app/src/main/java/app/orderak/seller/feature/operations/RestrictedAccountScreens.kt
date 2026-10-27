package app.orderak.seller.feature.operations
import android.app.Activity
import android.content.Context
import android.content.ContextWrapper
import android.content.Intent
import android.net.Uri
import android.os.Build
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.BoxWithConstraints
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.sizeIn
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material.icons.outlined.Inbox
import androidx.compose.material.icons.outlined.Lock
import androidx.compose.material.icons.outlined.Schedule
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Button
import app.orderak.seller.core.ui.theme.LocalOrderakSpacing
import app.orderak.seller.core.ui.colors
import app.orderak.seller.core.ui.ConfirmSheetState
import app.orderak.seller.core.ui.ConfirmSheet
import androidx.compose.ui.draw.clip
import androidx.compose.material3.rememberModalBottomSheetState
import androidx.compose.material3.Surface
import androidx.compose.material3.ModalBottomSheet
import androidx.compose.material3.FilledTonalButton
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.padding
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
import app.orderak.seller.core.ui.PlanUsageRow
import app.orderak.seller.core.ui.PlanUsageRowItem
import app.orderak.seller.core.ui.planUsageRows
import app.orderak.seller.core.ui.SemanticRole
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

@HiltViewModel
class RestrictedAccountViewModel @Inject constructor(
    private val sessionLogoutManager: SessionLogoutManager,
) : ViewModel() {
    fun logout(done: () -> Unit) = viewModelScope.launch {
        sessionLogoutManager.logout()
        done()
    }
}

/** The server's word for a permanent closure; anything else is read as a suspension, which can end. */
internal const val STATUS_BANNED = "banned"

@Composable
fun RestrictedAccountScreen(
    status: String,
    onCheckAgain: () -> Unit,
    onLogout: () -> Unit,
    vm: RestrictedAccountViewModel = hiltViewModel(),
) {
    val context = LocalContext.current
    val suspendedSubject = stringResource(R.string.restricted_mail_suspended)
    val bannedSubject = stringResource(R.string.restricted_mail_banned)
    val deleteSubject = stringResource(R.string.restricted_mail_delete)
    // runCatching, not a bare start: a device with no mail app resolves
    // nothing for ACTION_SENDTO and throws ActivityNotFoundException,
    // and a restricted account losing the app entirely is worse than
    // the button doing nothing.
    fun mail(subject: String) {
        runCatching {
            val uri = Uri.parse("mailto:support@orderak.app?subject=" + Uri.encode(subject))
            context.startActivity(Intent(Intent.ACTION_SENDTO, uri))
        }
    }
    RestrictedAccountContent(
        status = status,
        onCheckAgain = onCheckAgain,
        onContactSupport = { mail(if (status == STATUS_BANNED) bannedSubject else suspendedSubject) },
        onRequestDeletion = { mail(deleteSubject) },
        onLogout = { vm.logout(onLogout) },
    )
}

/**
 * The restricted-account page, with nothing in it that needs a graph.
 *
 * Two things can have happened and they get two pages, because what helps is not
 * the same. A suspension ends: the page is in warning colours, says what it means
 * for the store, offers support first and a way to check the status, which is the
 * one thing that can change. A ban does not: the page is in error colours, names
 * the reason class, offers a review of the decision and the deletion of the
 * seller's own data, and has no "check the status", because checking will not
 * change anything.
 *
 * There is no navigation bar and no way back: it is a root destination.
 *
 * Closes §4.5's "**Restricted-account logout states no consequence and asks for
 * no confirmation**, while the same action on the account surface is confirmed
 * with 'Log out and remove local business data from this device?'." That is the
 * confirmation drawn here, in the account surface's own words: the same title,
 * the same sentence, an error-coloured confirm and a cancel. [onLogout] is
 * unchanged and still the one protected sequence; this only puts a question in
 * front of it (auth contract v8, guarantee 10, and `:app:verifyAuthPhase1Contract`).
 */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun RestrictedAccountContent(
    status: String,
    onCheckAgain: () -> Unit,
    onContactSupport: () -> Unit,
    onRequestDeletion: () -> Unit,
    onLogout: () -> Unit,
) {
    val spacing = LocalOrderakSpacing.current
    val banned = status == STATUS_BANNED
    val role = if (banned) SemanticRole.Danger else SemanticRole.Warning
    val colors = role.colors()
    // `rememberSaveable`, like the account surface's own flag: a rotation must
    // not dismiss a question the seller has not answered.
    var confirmLogout by rememberSaveable { mutableStateOf(false) }
    Surface(Modifier.fillMaxSize(), color = MaterialTheme.colorScheme.background) {
        Column(
            modifier = Modifier
                .fillMaxSize()
                .verticalScroll(rememberScrollState())
                .padding(spacing.space8),
            verticalArrangement = Arrangement.spacedBy(spacing.space3, Alignment.CenterVertically),
            horizontalAlignment = Alignment.CenterHorizontally,
        ) {
            Box(
                contentAlignment = Alignment.Center,
                modifier = Modifier
                    .size(spacing.space16)
                    .clip(CircleShape)
                    .background(colors.container),
            ) {
                // The glyph differs, not only the colour: a clock for what ends, a lock for what does not.
                Icon(
                    imageVector = if (banned) Icons.Outlined.Lock else Icons.Outlined.Schedule,
                    contentDescription = null,
                    tint = colors.onContainer,
                    modifier = Modifier.size(spacing.iconMedium),
                )
            }
            Text(
                text = stringResource(if (banned) R.string.restricted_banned_title else R.string.restricted_suspended_title),
                style = MaterialTheme.typography.headlineSmall,
                textAlign = TextAlign.Center,
                modifier = Modifier.semantics { heading() },
            )
            Text(
                text = stringResource(if (banned) R.string.restricted_banned_body else R.string.restricted_suspended_body),
                style = MaterialTheme.typography.bodyLarge,
                textAlign = TextAlign.Center,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
            )
            Spacer(Modifier.height(spacing.space3))
            Button(
                onClick = onContactSupport,
                modifier = Modifier.fillMaxWidth().heightIn(min = spacing.minimumTouchTarget),
            ) {
                Text(stringResource(if (banned) R.string.restricted_request_review else R.string.restricted_contact))
            }
            if (banned) {
                TextButton(
                    onClick = onRequestDeletion,
                    modifier = Modifier.fillMaxWidth().heightIn(min = spacing.minimumTouchTarget),
                ) { Text(stringResource(R.string.restricted_delete_data), color = MaterialTheme.colorScheme.error) }
            } else {
                FilledTonalButton(
                    onClick = onCheckAgain,
                    modifier = Modifier.fillMaxWidth().heightIn(min = spacing.minimumTouchTarget),
                ) { Text(stringResource(R.string.restricted_check_status)) }
            }
            TextButton(
                onClick = { confirmLogout = true },
                modifier = Modifier.fillMaxWidth().heightIn(min = spacing.minimumTouchTarget),
            ) { Text(stringResource(R.string.settings_logout)) }
        }
    }
    if (confirmLogout) {
        ModalBottomSheet(
            onDismissRequest = { confirmLogout = false },
            sheetState = rememberModalBottomSheetState(skipPartiallyExpanded = true),
            containerColor = MaterialTheme.colorScheme.surface,
            // The kit's sheet draws its own top corners, handle and padding.
            dragHandle = null,
            shape = RoundedCornerShape(spacing.space0),
        ) {
            ConfirmSheet(
                state = ConfirmSheetState.Destructive,
                title = stringResource(R.string.settings_logout),
                // The consequence the control did not state: this clears the local
                // business data on the phone, not just the session.
                message = stringResource(R.string.settings_logout_confirm),
                confirmLabel = stringResource(R.string.settings_logout),
                cancelLabel = stringResource(R.string.common_cancel),
                onConfirm = { confirmLogout = false; onLogout() },
                onCancel = { confirmLogout = false },
            )
        }
    }
}
