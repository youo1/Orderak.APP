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
    val spacing = LocalOrderakSpacing.current
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
                Column(Modifier.padding(spacing.space4)) {
                    Text(localizedJson(a.title_i18n), style = MaterialTheme.typography.titleMedium)
                    Spacer(Modifier.height(spacing.space1))
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
    val spacing = LocalOrderakSpacing.current
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
                    Spacer(Modifier.height(spacing.space2))
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
    val spacing = LocalOrderakSpacing.current
    OperationPage(
        title = stringResource(R.string.catalog_languages_title),
        onBack = onBack,
        busy = busy || items == null,
        error = error,
        onRetry = onRetry,
    ) {
        Row(horizontalArrangement = Arrangement.spacedBy(spacing.space2)) {
            OutlinedButton(onClick = { onLang("ar") }) { Text("العربية") }
            OutlinedButton(onClick = { onLang("en") }) { Text("English") }
        }
        if (items?.isEmpty() == true) {
            FullScreenEmpty(message = stringResource(R.string.common_empty))
        }
        items.orEmpty().forEach { item ->
            Card(onClick = { onEdit(item) }, modifier = Modifier.fillMaxWidth()) {
                Column(Modifier.padding(spacing.space4)) {
                    Text(item.source_name, style = MaterialTheme.typography.titleMedium)
                    Text(item.name ?: stringResource(R.string.translation_missing))
                    Text(item.translation_status, color = MaterialTheme.colorScheme.primary)
                }
            }
        }
    }
}
