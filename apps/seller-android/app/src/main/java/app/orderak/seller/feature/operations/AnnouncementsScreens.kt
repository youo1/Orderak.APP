package app.orderak.seller.feature.operations
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.ui.draw.clip
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.text.style.TextOverflow
import android.app.Activity
import android.content.Context
import android.content.ContextWrapper
import android.content.Intent
import android.net.Uri
import android.os.Build
import androidx.compose.foundation.clickable
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.layout.heightIn
import androidx.compose.material3.ModalBottomSheet
import androidx.compose.material3.Surface
import androidx.compose.material3.rememberModalBottomSheetState
import androidx.compose.ui.text.style.TextDirection
import app.orderak.seller.core.ui.Banner
import app.orderak.seller.core.ui.BannerState
import app.orderak.seller.core.ui.SegmentedChoice
import app.orderak.seller.core.ui.SemanticChip
import app.orderak.seller.core.ui.Skeleton
import app.orderak.seller.core.ui.SkeletonVariant
import app.orderak.seller.core.ui.TextField
import app.orderak.seller.core.ui.TopBar
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
import androidx.compose.material3.FilterChip
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
import app.orderak.seller.core.ui.theme.LocalOrderakSpacing
import app.orderak.seller.core.ui.EmptyState
import app.orderak.seller.core.ui.EmptyStateKind

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

/**
 * The announcements list, as a function of its state.
 *
 * Platform news without an inbox to manage: unread items first, each with a dot, a title, two
 * lines of the text and the date. Tapping an item opens it in place and marks it read.
 */
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
    val locale = LocalConfiguration.current.locales[0]
    // Opened in place; remembered through rotation as plain ids.
    var opened by rememberSaveable { mutableStateOf(listOf<Long>()) }
    OperationPage(
        title = stringResource(R.string.announcements_title),
        onBack = onBack,
        busy = busy || items == null,
        error = error,
        onRetry = onRetry,
        isEmpty = items?.isEmpty() == true,
        empty = {
            EmptyState(kind = EmptyStateKind.Empty, title = stringResource(R.string.announcements_empty))
        },
    ) {
        // Unread first; the sort is stable, so the server's order holds inside each group.
        items.orEmpty().sortedBy { it.is_read }.forEach { a ->
            val open = a.id in opened
            val newLabel = stringResource(R.string.announcement_new)
            Surface(
                onClick = {
                    opened = if (open) opened - a.id else opened + a.id
                    if (!a.is_read) onRead(a.id)
                },
                shape = MaterialTheme.shapes.large,
                color = MaterialTheme.colorScheme.surfaceContainerLowest,
                modifier = Modifier.fillMaxWidth(),
            ) {
                Row(
                    Modifier.padding(spacing.space3),
                    horizontalArrangement = Arrangement.spacedBy(spacing.space3),
                ) {
                    // The dot says "new" in words as well as in colour.
                    Box(
                        Modifier
                            .padding(top = spacing.space2)
                            .size(spacing.space2)
                            .then(
                                if (a.is_read) {
                                    Modifier
                                } else {
                                    Modifier
                                        .clip(CircleShape)
                                        .background(MaterialTheme.colorScheme.primary)
                                        .semantics { contentDescription = newLabel }
                                },
                            ),
                    )
                    Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(spacing.space1)) {
                        Text(
                            localizedJson(a.title_i18n),
                            style = MaterialTheme.typography.titleSmall.copy(textDirection = TextDirection.Content),
                        )
                        Text(
                            localizedJson(a.body_i18n),
                            style = MaterialTheme.typography.bodyMedium.copy(textDirection = TextDirection.Content),
                            maxLines = if (open) Int.MAX_VALUE else 2,
                            overflow = TextOverflow.Ellipsis,
                        )
                        formatServerDate(a.starts_at, locale)?.let {
                            Text(
                                it,
                                style = MaterialTheme.typography.bodySmall,
                                color = MaterialTheme.colorScheme.onSurfaceVariant,
                            )
                        }
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
    LaunchedEffect(lang) { vm.loadTranslations(lang) }

    CatalogLanguagesContent(
        items = items,
        lang = lang,
        busy = busy,
        error = error,
        onBack = onBack,
        onRetry = { vm.loadTranslations(lang) },
        onLang = { lang = it },
        onSave = { item, name, description -> vm.saveTranslation(item, name, description) },
    )
}

/**
 * The languages the catalogue carries product text for.
 *
 * Arabic and English, not the app's three: French is an Android-interface
 * language only and is not an advertised catalogue language until the Worker
 * dictionaries and the translation pipeline are extended for it
 * (docs/architecture/localization-architecture.md, "Cached product translations").
 */
private val CATALOGUE_LANGUAGES = listOf("ar", "en")

/**
 * The per-language catalogue list, as a function of its state.
 *
 * A switch for the target language, a summary of how much of the catalogue is
 * approved in it, and a row per product: its name in the shop's language, the
 * translation under it, and a chip for where that translation stands. A row opens
 * the editor sheet, whose one button saves and approves. With no products there is
 * nothing to translate, and the switch stays: "nothing in Arabic" is a reason to
 * try English, not a dead end.
 */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun CatalogLanguagesContent(
    items: List<ProductTranslationDto>?,
    lang: String,
    busy: Boolean,
    error: String?,
    onBack: () -> Unit,
    onRetry: () -> Unit,
    onLang: (String) -> Unit,
    onSave: (ProductTranslationDto, String, String) -> Unit,
) {
    val spacing = LocalOrderakSpacing.current
    val locale = LocalConfiguration.current.locales[0]
    // The row being edited, by its identity: the list refreshes under the sheet after a save.
    var editingKey by rememberSaveable { mutableStateOf<String?>(null) }
    val editing = items?.firstOrNull { "${it.product_code}|${it.lang}" == editingKey }
    val languages = AppLocales.supported.filter { it.tag in CATALOGUE_LANGUAGES }
    Scaffold(
        topBar = {
            TopBar(
                title = stringResource(R.string.catalog_languages_title),
                onBack = onBack,
                backDescription = stringResource(R.string.common_back),
            )
        },
    ) { padding ->
        Column(Modifier.fillMaxSize().padding(padding)) {
            // Named from AppLocales, the app's one list of language names, each in its own
            // script, and one is always chosen: a switch that cannot say which side is on is
            // not a switch.
            SegmentedChoice(
                options = languages.map { it.nativeName },
                selectedIndex = languages.indexOfFirst { it.tag == lang },
                onSelect = { onLang(languages[it].tag) },
                modifier = Modifier.padding(horizontal = spacing.space4, vertical = spacing.space2),
            )
            if (error != null) {
                Banner(
                    state = BannerState.Error,
                    title = stringResource(R.string.catalog_languages_error),
                    message = stringResource(backendErrorResource(error)),
                    actionLabel = stringResource(R.string.common_retry),
                    onAction = onRetry,
                    modifier = Modifier.padding(horizontal = spacing.space4, vertical = spacing.space2),
                )
            }
            when {
                items == null -> Skeleton(SkeletonVariant.ListRows, Modifier.padding(spacing.space4))
                items.isEmpty() -> EmptyState(
                    kind = EmptyStateKind.Empty,
                    title = stringResource(R.string.catalog_languages_empty),
                )
                else -> LazyColumn(
                    contentPadding = PaddingValues(spacing.space4),
                    verticalArrangement = Arrangement.spacedBy(spacing.space2),
                ) {
                    item {
                        Text(
                            stringResource(
                                R.string.catalog_languages_summary,
                                formatCount(items.count { it.translation_status == STATUS_REVIEWED }, locale),
                                formatCount(items.size, locale),
                            ),
                            style = MaterialTheme.typography.bodyMedium,
                            color = MaterialTheme.colorScheme.onSurfaceVariant,
                        )
                    }
                    items(items, key = { "${it.product_code}|${it.lang}" }) { item ->
                        Surface(
                            onClick = { editingKey = "${item.product_code}|${item.lang}" },
                            shape = MaterialTheme.shapes.large,
                            color = MaterialTheme.colorScheme.surfaceContainerLowest,
                            modifier = Modifier.fillMaxWidth(),
                        ) {
                            Row(
                                Modifier.padding(spacing.space3),
                                verticalAlignment = Alignment.CenterVertically,
                                horizontalArrangement = Arrangement.spacedBy(spacing.space3),
                            ) {
                                Column(Modifier.weight(1f)) {
                                    Text(
                                        item.source_name,
                                        style = MaterialTheme.typography.titleMedium.copy(textDirection = TextDirection.Content),
                                    )
                                    Text(
                                        item.name ?: stringResource(R.string.translation_missing),
                                        style = MaterialTheme.typography.bodyMedium.copy(textDirection = TextDirection.Content),
                                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                                    )
                                }
                                TranslationStatusChip(item.translation_status)
                            }
                        }
                    }
                }
            }
        }
    }

    if (editing != null) {
        ModalBottomSheet(
            onDismissRequest = { editingKey = null },
            sheetState = rememberModalBottomSheetState(skipPartiallyExpanded = true),
            containerColor = MaterialTheme.colorScheme.surface,
            dragHandle = null,
            shape = RoundedCornerShape(spacing.space0),
        ) {
            TranslationEditor(
                item = editing,
                busy = busy,
                onSave = { name, description -> onSave(editing, name, description); editingKey = null },
                onClose = { editingKey = null },
            )
        }
    }
}

/** What the server calls a translation that a person has approved. */
private const val STATUS_REVIEWED = "reviewed"

@Composable
private fun TranslationStatusChip(status: String) {
    when (status) {
        STATUS_REVIEWED -> SemanticChip(SemanticRole.Success, stringResource(R.string.translation_status_reviewed))
        "machine" -> SemanticChip(SemanticRole.Info, stringResource(R.string.translation_status_machine))
        else -> SemanticChip(SemanticRole.Warning, stringResource(R.string.translation_status_missing))
    }
}

/**
 * The editor: the source above, the target below. Saving an edit approves it, as it always has.
 * The target fields read left to right when the target is a Latin-script language.
 */
@Composable
private fun TranslationEditor(
    item: ProductTranslationDto,
    busy: Boolean,
    onSave: (String, String) -> Unit,
    onClose: () -> Unit,
) {
    val spacing = LocalOrderakSpacing.current
    var name by rememberSaveable(item.product_code, item.lang) { mutableStateOf(item.name.orEmpty()) }
    var description by rememberSaveable(item.product_code, item.lang) { mutableStateOf(item.description.orEmpty()) }
    Column(
        Modifier.fillMaxWidth().padding(spacing.space4),
        verticalArrangement = Arrangement.spacedBy(spacing.space3),
    ) {
        Text(
            item.source_name,
            style = MaterialTheme.typography.titleLarge.copy(textDirection = TextDirection.Content),
            modifier = Modifier.semantics { heading() },
        )
        item.source_description?.takeIf { it.isNotBlank() }?.let {
            Text(
                it,
                style = MaterialTheme.typography.bodyMedium.copy(textDirection = TextDirection.Content),
                color = MaterialTheme.colorScheme.onSurfaceVariant,
            )
        }
        TextField(
            value = name,
            onValueChange = { name = it.take(120) },
            label = stringResource(R.string.translation_name),
            required = true,
        )
        TextField(
            value = description,
            onValueChange = { description = it.take(700) },
            label = stringResource(R.string.translation_description),
            singleLine = false,
        )
        Button(
            onClick = { onSave(name, description) },
            enabled = name.isNotBlank() && !busy,
            modifier = Modifier.fillMaxWidth().heightIn(min = spacing.minimumTouchTarget),
        ) { Text(stringResource(R.string.translation_save_approve)) }
        TextButton(
            onClick = onClose,
            modifier = Modifier.fillMaxWidth().heightIn(min = spacing.minimumTouchTarget),
        ) { Text(stringResource(R.string.common_cancel)) }
    }
}
