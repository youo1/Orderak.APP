package app.orderak.seller.feature.settings

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.ContentCopy
import androidx.compose.material.icons.outlined.Delete
import androidx.compose.material.icons.outlined.Edit
import androidx.compose.material.icons.outlined.MoreVert
import androidx.compose.material.icons.outlined.Share
import androidx.compose.material3.Button
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.ModalBottomSheet
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.rememberModalBottomSheetState
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.saveable.Saver
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalConfiguration
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.res.pluralStringResource
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.heading
import androidx.compose.ui.semantics.semantics
import androidx.hilt.navigation.compose.hiltViewModel
import androidx.lifecycle.ViewModel
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.lifecycle.viewModelScope
import app.orderak.seller.R
import app.orderak.seller.core.share.copyLink
import app.orderak.seller.core.share.shareCategoryLink
import app.orderak.seller.core.text.formatCount
import app.orderak.seller.core.ui.Banner
import app.orderak.seller.core.ui.BannerState
import app.orderak.seller.core.ui.BottomActionBar
import app.orderak.seller.core.ui.BottomSheet
import app.orderak.seller.core.ui.ConfirmSheet
import app.orderak.seller.core.ui.ConfirmSheetState
import app.orderak.seller.core.ui.EmptyState
import app.orderak.seller.core.ui.EmptyStateKind
import app.orderak.seller.core.ui.PlanUsageRow
import app.orderak.seller.core.ui.PlanUsageRowItem
import app.orderak.seller.core.ui.PriorityListRow
import app.orderak.seller.core.ui.SheetAction
import app.orderak.seller.core.ui.Skeleton
import app.orderak.seller.core.ui.SkeletonVariant
import app.orderak.seller.core.ui.TextField
import app.orderak.seller.core.ui.TopBar
import app.orderak.seller.core.ui.planUsageRows
import app.orderak.seller.core.ui.theme.LocalOrderakSpacing
import app.orderak.seller.data.billing.EntitlementManager
import app.orderak.seller.data.billing.FeatureKeys
import app.orderak.seller.data.catalog.CategoryCacheWriter
import app.orderak.seller.data.db.OrderakDatabase
import app.orderak.seller.data.remote.BackendApi
import app.orderak.seller.data.remote.CategoryDto
import app.orderak.seller.data.remote.CategoryReq
import app.orderak.seller.data.session.SessionStore
import dagger.hilt.android.lifecycle.HiltViewModel
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.SharingStarted
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.flow.map
import kotlinx.coroutines.flow.stateIn
import kotlinx.coroutines.launch
import javax.inject.Inject

@HiltViewModel
class CategoriesViewModel @Inject constructor(
    private val sessionStore: SessionStore,
    private val api: BackendApi,
    private val db: OrderakDatabase,
    private val categoryCache: CategoryCacheWriter,
    /** Exposed so the screen can ask whether an upgrade can actually be bought. */
    val entitlements: EntitlementManager,
) : ViewModel() {

    private val _categories = MutableStateFlow<List<CategoryDto>>(emptyList())
    val categories: StateFlow<List<CategoryDto>> = _categories.asStateFlow()
    private val _loading = MutableStateFlow(true)
    val loading: StateFlow<Boolean> = _loading.asStateFlow()
    private val _error = MutableStateFlow<String?>(null)
    val error: StateFlow<String?> = _error.asStateFlow()

    /** Distinguishes a plan boundary from a failure, so the UI can explain it. */
    fun clearError() { _error.value = null }
    private val _busy = MutableStateFlow(false)
    val busy: StateFlow<Boolean> = _busy.asStateFlow()

    val publicIdentifier =
        sessionStore.storeIdentifier.stateIn(viewModelScope, SharingStarted.WhileSubscribed(5_000), null)
    val storeUrl = sessionStore.storeUrl.stateIn(viewModelScope, SharingStarted.WhileSubscribed(5_000), null)

    /** The category limit and what the account says is used; the page overrides `used` with what it has read. */
    val meter: StateFlow<PlanUsageRow?> = entitlements.config
        .map { config -> config?.let { planUsageRows(it).firstOrNull { row -> row.key == FeatureKeys.MAX_CATEGORIES } } }
        .stateIn(viewModelScope, SharingStarted.WhileSubscribed(5_000), null)

    init { refresh() }

    fun refresh() = viewModelScope.launch {
        _loading.value = true
        _error.value = null
        val phone = sessionStore.phone.first() ?: run { _loading.value = false; return@launch }
        val secret = sessionStore.currentSecret()
        val res = api.listCategories(phone, secret)
        if (res.ok) {
            _categories.value = res.categories
            // Cache locally so the product editor can offer a category picker
            // without a round trip. Through the writer, so there is one place a
            // category row is written and the boundary guard can say so.
            categoryCache.replaceAll(res.categories)
        } else _error.value = res.error ?: "bad_response"
        _loading.value = false
    }

    fun create(name: String, onResult: (Boolean) -> Unit) = viewModelScope.launch {
        val n = name.trim()
        if (n.isBlank()) { onResult(false); return@launch }
        _busy.value = true
        val phone = sessionStore.phone.first() ?: run { _busy.value = false; onResult(false); return@launch }
        val secret = sessionStore.currentSecret()
        val response = api.createCategory(phone, secret, CategoryReq(name = n))
        _busy.value = false
        if (response.ok) {
            refresh()
        } else {
            // The backend answers 409 PLAN_LIMIT_REACHED when the category limit
            // is hit, and this mapped it to the same "create_failed" as a network
            // fault. A seller on the free plan adding a sixth category was told
            // only that something went wrong — not what, and not what to do.
            _error.value = if (response.error == PLAN_LIMIT_REACHED) {
                LIMIT_REACHED
            } else {
                "create_failed"
            }
        }
        onResult(response.ok)
    }

    fun rename(code: String, name: String) = viewModelScope.launch {
        val n = name.trim()
        if (n.isBlank()) return@launch
        _busy.value = true
        val phone = sessionStore.phone.first() ?: run { _busy.value = false; return@launch }
        val secret = sessionStore.currentSecret()
        // Reports its failure, as create and delete do. It used to swallow one:
        // the dialog closed either way, so a rename that never reached the
        // server looked exactly like one that did until the list refused to
        // change.
        if (api.updateCategory(phone, secret, code, CategoryReq(name = n)).ok) refresh()
        else _error.value = "rename_failed"
        _busy.value = false
    }

    fun delete(code: String) = viewModelScope.launch {
        _busy.value = true
        val phone = sessionStore.phone.first() ?: run { _busy.value = false; return@launch }
        val secret = sessionStore.currentSecret()
        if (api.deleteCategory(phone, secret, code).ok) refresh() else _error.value = "delete_failed"
        _busy.value = false
    }
}

@Composable
fun CategoriesScreen(
    onBack: () -> Unit,
    onLimitReached: (String) -> Unit = {},
    viewModel: CategoriesViewModel = hiltViewModel(),
) {
    val context = LocalContext.current
    val categories by viewModel.categories.collectAsStateWithLifecycle()
    val loading by viewModel.loading.collectAsStateWithLifecycle()
    val error by viewModel.error.collectAsStateWithLifecycle()
    val entitlements: EntitlementManager = viewModel.entitlements
    val busy by viewModel.busy.collectAsStateWithLifecycle()
    val storeUrl by viewModel.storeUrl.collectAsStateWithLifecycle()
    val meter by viewModel.meter.collectAsStateWithLifecycle()

    CategoriesContent(
        // Null until the first read ends: the view model seeds an empty list, which the
        // page cannot tell from "read and empty".
        categories = if (loading && categories.isEmpty()) null else categories,
        loading = loading,
        error = error,
        busy = busy,
        storeUrl = storeUrl,
        purchaseOpen = entitlements.isPurchaseOpen(),
        meter = meter,
        onCreate = { name -> viewModel.create(name) {} },
        onRename = { code, name -> viewModel.rename(code, name) },
        onDelete = { viewModel.delete(it) },
        onLimitReached = { onLimitReached(FeatureKeys.MAX_CATEGORIES) },
        onCopyLink = { code -> storeUrl?.let { copyLink(context, "$it/c/$code") } },
        onShareLink = { c -> storeUrl?.let { shareCategoryLink(context, c.name, it, c.category_code) } },
        onRetry = { viewModel.refresh() },
        onBack = onBack,
    )
}

/** The backend's code for a plan boundary, from plan-limits.ts. */
private const val PLAN_LIMIT_REACHED = "PLAN_LIMIT_REACHED"

/** Internal marker so the screen can render a boundary as a notice, not a fault. */
private const val LIMIT_REACHED = "plan_limit_reached"

/** What a category's name may run to: the same 60 characters the field has always had. */
private const val NAME_MAX = 60

/** The one sheet that may be open on this page; it survives rotation as plain data. */
private sealed interface CategorySheet {
    data object Add : CategorySheet
    data class Rename(val code: String, val name: String) : CategorySheet
    data class More(val code: String) : CategorySheet
    data class Delete(val code: String) : CategorySheet
}

/** A [CategorySheet] as something rememberSaveable can store. */
private val CategorySheetSaver: Saver<CategorySheet?, List<String>> = Saver(
    save = { sheet ->
        when (sheet) {
            null -> emptyList()
            CategorySheet.Add -> listOf("add")
            is CategorySheet.Rename -> listOf("rename", sheet.code, sheet.name)
            is CategorySheet.More -> listOf("more", sheet.code)
            is CategorySheet.Delete -> listOf("delete", sheet.code)
        }
    },
    restore = { parts ->
        when (parts.firstOrNull()) {
            "add" -> CategorySheet.Add
            "rename" -> CategorySheet.Rename(parts[1], parts[2])
            "more" -> CategorySheet.More(parts[1])
            "delete" -> CategorySheet.Delete(parts[1])
            else -> null
        }
    },
)

/**
 * The category list, as a function of its state.
 *
 * Top bar with back, the category meter, a row per category (its name and how many
 * products are filed under it, with an overflow holding rename and delete), and one
 * bar at the bottom: "إضافة تصنيف". Adding and renaming are one sheet with one field;
 * deleting names the category and says how many products lose it.
 *
 * [categories] is nullable so "read and empty" is distinguishable from "not read
 * yet", and the contract's empty state has something to be drawn from.
 *
 * A plan limit is rendered as a notice rather than a fault: it keeps the existing
 * categories on screen and offers the plans page in both purchase states, because
 * what the limit is and what the next plan gives are worth reading whether or not
 * anything is for sale.
 */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun CategoriesContent(
    categories: List<CategoryDto>?,
    loading: Boolean,
    error: String?,
    busy: Boolean,
    storeUrl: String?,
    purchaseOpen: Boolean,
    onCreate: (String) -> Unit,
    onRename: (String, String) -> Unit,
    onDelete: (String) -> Unit,
    onLimitReached: () -> Unit,
    onCopyLink: (String) -> Unit,
    onShareLink: (CategoryDto) -> Unit,
    onBack: () -> Unit,
    modifier: Modifier = Modifier,
    meter: PlanUsageRow? = null,
    onRetry: () -> Unit = {},
) {
    val spacing = LocalOrderakSpacing.current
    val locale = LocalConfiguration.current.locales[0]
    var sheet by rememberSaveable(stateSaver = CategorySheetSaver) { mutableStateOf<CategorySheet?>(null) }
    val atLimit = meter?.limit?.let { categories != null && categories.size >= it } == true

    Scaffold(
        modifier = modifier,
        topBar = {
            TopBar(
                title = stringResource(R.string.categories_title),
                onBack = onBack,
                backDescription = stringResource(R.string.common_back),
            )
        },
        bottomBar = {
            BottomActionBar(
                primaryLabel = stringResource(R.string.categories_add_bar),
                // At the limit the bar still works: it opens the plans page, which says
                // what the limit is. A dead button would only say "no".
                onPrimary = { if (atLimit) onLimitReached() else sheet = CategorySheet.Add },
                primaryEnabled = categories != null && !busy,
            )
        },
    ) { padding ->
        Column(Modifier.fillMaxSize().padding(padding)) {
            when (error) {
                null -> Unit
                // A limit is not a fault. It reads as a notice, keeps the existing
                // categories on screen, and offers the plans page in both purchase
                // states: what the limit is and what the next plan gives are useful
                // whether or not anything is for sale.
                LIMIT_REACHED -> Banner(
                    state = BannerState.LockedByPlan,
                    title = stringResource(R.string.categories_limit_title),
                    message = stringResource(
                        if (purchaseOpen) R.string.categories_limit_body else R.string.categories_limit_body_purchase_closed,
                    ),
                    actionLabel = stringResource(R.string.paywall_view_plans),
                    onAction = onLimitReached,
                    modifier = Modifier.padding(horizontal = spacing.space4, vertical = spacing.space2),
                )
                else -> Banner(
                    state = BannerState.Error,
                    title = stringResource(R.string.categories_error),
                    message = stringResource(R.string.categories_error_body),
                    actionLabel = stringResource(R.string.common_retry),
                    onAction = onRetry,
                    modifier = Modifier.padding(horizontal = spacing.space4, vertical = spacing.space2),
                )
            }
            when {
                categories == null || (loading && categories.isEmpty()) ->
                    Skeleton(SkeletonVariant.ListRows, Modifier.padding(spacing.space4))
                categories.isEmpty() && error == null -> EmptyState(
                    kind = EmptyStateKind.Empty,
                    title = stringResource(R.string.categories_empty_title),
                    message = stringResource(R.string.categories_empty_body),
                    actionLabel = stringResource(R.string.categories_add_bar),
                    onAction = { sheet = CategorySheet.Add },
                )
                else -> LazyColumn(
                    contentPadding = PaddingValues(spacing.space4),
                    verticalArrangement = Arrangement.spacedBy(spacing.space2),
                ) {
                    if (meter != null) {
                        item { PlanUsageRowItem(meter.copy(used = categories.size)) }
                    }
                    items(categories, key = { it.category_code }) { c ->
                        PriorityListRow(
                            title = c.name,
                            subtitle = pluralStringResource(
                                R.plurals.categories_product_count,
                                c.product_count,
                                formatCount(c.product_count, locale),
                            ),
                            trailing = {
                                IconButton(
                                    onClick = { sheet = CategorySheet.More(c.category_code) },
                                    modifier = Modifier.size(spacing.minimumTouchTarget),
                                ) {
                                    Icon(
                                        Icons.Outlined.MoreVert,
                                        contentDescription = stringResource(R.string.categories_row_more, c.name),
                                    )
                                }
                            },
                        )
                    }
                }
            }
        }
    }

    val current = sheet
    if (current != null) {
        ModalBottomSheet(
            onDismissRequest = { sheet = null },
            sheetState = rememberModalBottomSheetState(skipPartiallyExpanded = true),
            containerColor = MaterialTheme.colorScheme.surface,
            dragHandle = null,
            shape = RoundedCornerShape(spacing.space0),
        ) {
            val target = (current as? CategorySheet.More)?.code?.let { code -> categories?.firstOrNull { it.category_code == code } }
                ?: (current as? CategorySheet.Delete)?.code?.let { code -> categories?.firstOrNull { it.category_code == code } }
            when (current) {
                CategorySheet.Add -> CategoryNameSheet(
                    title = stringResource(R.string.categories_sheet_add_title),
                    initial = "",
                    busy = busy,
                    onSave = { onCreate(it); sheet = null },
                    onClose = { sheet = null },
                )
                is CategorySheet.Rename -> CategoryNameSheet(
                    title = stringResource(R.string.categories_sheet_rename_title),
                    initial = current.name,
                    busy = busy,
                    onSave = { onRename(current.code, it); sheet = null },
                    onClose = { sheet = null },
                )
                is CategorySheet.More -> if (target == null) {
                    sheet = null
                } else {
                    val url = storeUrl
                    BottomSheet(
                        title = target.name,
                        actions = buildList {
                            add(SheetAction(stringResource(R.string.category_rename), { sheet = CategorySheet.Rename(target.category_code, target.name) }, Icons.Outlined.Edit))
                            if (!url.isNullOrBlank()) {
                                add(SheetAction(stringResource(R.string.action_copy_url), { onCopyLink(target.category_code); sheet = null }, Icons.Outlined.ContentCopy))
                                add(SheetAction(stringResource(R.string.action_share_link), { onShareLink(target); sheet = null }, Icons.Outlined.Share))
                            }
                            add(SheetAction(stringResource(R.string.common_delete), { sheet = CategorySheet.Delete(target.category_code) }, Icons.Outlined.Delete))
                        },
                        closeLabel = stringResource(R.string.sheet_close),
                        onClose = { sheet = null },
                    )
                }
                is CategorySheet.Delete -> if (target == null) {
                    sheet = null
                } else {
                    ConfirmSheet(
                        state = if (busy) ConfirmSheetState.InProgress else ConfirmSheetState.Destructive,
                        title = stringResource(R.string.categories_delete_title, target.name),
                        message = pluralStringResource(
                            R.plurals.categories_delete_body,
                            target.product_count,
                            formatCount(target.product_count, locale),
                        ),
                        confirmLabel = stringResource(R.string.common_delete),
                        cancelLabel = stringResource(R.string.common_cancel),
                        onConfirm = { onDelete(target.category_code); sheet = null },
                        onCancel = { sheet = null },
                    )
                }
            }
        }
    }
}

/** Adding and renaming: one field and "حفظ". Blank is not a name, so the button waits. */
@Composable
private fun CategoryNameSheet(
    title: String,
    initial: String,
    busy: Boolean,
    onSave: (String) -> Unit,
    onClose: () -> Unit,
) {
    var draft by rememberSaveable(initial) { mutableStateOf(initial) }
    val spacing = LocalOrderakSpacing.current
    Column(
        Modifier.fillMaxWidth().padding(spacing.space4),
        verticalArrangement = Arrangement.spacedBy(spacing.space4),
    ) {
        Text(title, style = MaterialTheme.typography.titleLarge, modifier = Modifier.semantics { heading() })
        TextField(
            value = draft,
            onValueChange = { draft = it.take(NAME_MAX) },
            label = stringResource(R.string.categories_field),
            maxLength = NAME_MAX,
        )
        Button(
            // Neither blank nor the name it already has: both would spend a write to
            // change nothing.
            onClick = { onSave(draft.trim()) },
            enabled = draft.isNotBlank() && draft.trim() != initial && !busy,
            modifier = Modifier.fillMaxWidth().heightIn(min = spacing.minimumTouchTarget),
        ) { Text(stringResource(R.string.product_save_bar)) }
        TextButton(
            onClick = onClose,
            modifier = Modifier.fillMaxWidth().heightIn(min = spacing.minimumTouchTarget),
        ) { Text(stringResource(R.string.common_cancel)) }
    }
}
