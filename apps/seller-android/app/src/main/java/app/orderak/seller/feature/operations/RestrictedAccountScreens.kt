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
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
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
