package app.orderak.seller.feature.settings

import android.content.Context
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material.icons.outlined.ContentCopy
import androidx.compose.material.icons.outlined.Delete
import androidx.compose.material.icons.outlined.Share
import androidx.compose.material3.Button
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Card
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.TopAppBar
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.res.pluralStringResource
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.heading
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.style.TextDirection
import androidx.compose.ui.unit.dp
import androidx.hilt.navigation.compose.hiltViewModel
import androidx.lifecycle.ViewModel
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.lifecycle.viewModelScope
import app.orderak.seller.R
import app.orderak.seller.core.ui.NoticeBanner
import app.orderak.seller.core.ui.SemanticRole
import app.orderak.seller.data.billing.EntitlementManager
import app.orderak.seller.data.db.CategoryEntity
import app.orderak.seller.data.db.OrderakDatabase
import app.orderak.seller.data.remote.BackendApi
import app.orderak.seller.data.remote.CategoryDto
import app.orderak.seller.data.remote.CategoryReq
import app.orderak.seller.data.session.SessionStore
import app.orderak.seller.feature.products.copyLink
import app.orderak.seller.feature.products.shareCategoryLink
import dagger.hilt.android.lifecycle.HiltViewModel
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.SharingStarted
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.flow.stateIn
import kotlinx.coroutines.launch
import javax.inject.Inject

@HiltViewModel
class CategoriesViewModel @Inject constructor(
    private val sessionStore: SessionStore,
    private val api: BackendApi,
    private val db: OrderakDatabase,
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

    init { refresh() }

    fun refresh() = viewModelScope.launch {
        _loading.value = true
        _error.value = null
        val phone = sessionStore.phone.first() ?: run { _loading.value = false; return@launch }
        val secret = sessionStore.getOrCreateSecret()
        val res = api.listCategories(phone, secret)
        if (res.ok) {
            _categories.value = res.categories
            // Mirror locally so the product editor can offer a category picker.
            db.categoryDao().replaceAll(
                res.categories.map { CategoryEntity(name = it.name, categoryCode = it.category_code, slug = it.slug, sortOrder = it.sort_order) }
            )
        } else _error.value = res.error ?: "bad_response"
        _loading.value = false
    }

    fun create(name: String, onResult: (Boolean) -> Unit) = viewModelScope.launch {
        val n = name.trim()
        if (n.isBlank()) { onResult(false); return@launch }
        _busy.value = true
        val phone = sessionStore.phone.first() ?: run { _busy.value = false; onResult(false); return@launch }
        val secret = sessionStore.getOrCreateSecret()
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
        val phone = sessionStore.phone.first() ?: return@launch
        val secret = sessionStore.getOrCreateSecret()
        if (api.updateCategory(phone, secret, code, CategoryReq(name = n)).ok) refresh()
    }

    fun delete(code: String) = viewModelScope.launch {
        _busy.value = true
        val phone = sessionStore.phone.first() ?: run { _busy.value = false; return@launch }
        val secret = sessionStore.getOrCreateSecret()
        if (api.deleteCategory(phone, secret, code).ok) refresh() else _error.value = "delete_failed"
        _busy.value = false
    }
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun CategoriesScreen(
    onBack: () -> Unit,
    viewModel: CategoriesViewModel = hiltViewModel(),
) {
    val context = LocalContext.current
    val categories by viewModel.categories.collectAsStateWithLifecycle()
    val loading by viewModel.loading.collectAsStateWithLifecycle()
    val error by viewModel.error.collectAsStateWithLifecycle()
    val entitlements: EntitlementManager = viewModel.entitlements
    val busy by viewModel.busy.collectAsStateWithLifecycle()
    val storeUrl by viewModel.storeUrl.collectAsStateWithLifecycle()
    var newName by rememberSaveable { mutableStateOf("") }
    var pendingDelete by rememberSaveable { mutableStateOf<String?>(null) }

    Scaffold(
        topBar = {
            TopAppBar(
                title = { Text(stringResource(R.string.categories_title), modifier = Modifier.semantics { heading() }) },
                navigationIcon = {
                    IconButton(onClick = onBack) {
                        Icon(Icons.AutoMirrored.Filled.ArrowBack, contentDescription = stringResource(R.string.common_back))
                    }
                },
            )
        }
    ) { padding ->
        Column(Modifier.fillMaxSize().padding(padding).padding(16.dp)) {
            Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                OutlinedTextField(
                    value = newName, onValueChange = { newName = it.take(60) },
                    label = { Text(stringResource(R.string.categories_new)) },
                    singleLine = true, modifier = Modifier.weight(1f)
                )
                Button(onClick = { viewModel.create(newName) { if (it) newName = "" } }, enabled = !busy) {
                    Text(stringResource(R.string.categories_add))
                }
            }
            Spacer(Modifier.height(12.dp))
            if (loading) CircularProgressIndicator()
            when (error) {
                null -> Unit
                // A limit is not a fault. It reads as a notice, keeps the existing
                // categories on screen, and offers an upgrade only when one can
                // actually be bought.
                LIMIT_REACHED -> NoticeBanner(
                    role = SemanticRole.Commerce,
                    title = stringResource(R.string.categories_limit_title),
                    message = if (entitlements.isPurchaseOpen()) {
                        stringResource(R.string.categories_limit_body)
                    } else {
                        stringResource(R.string.categories_limit_body_purchase_closed)
                    },
                )
                else -> NoticeBanner(
                    role = SemanticRole.Danger,
                    title = stringResource(R.string.categories_error),
                    message = stringResource(R.string.categories_error_body),
                )
            }
            LazyColumn(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                items(categories, key = { it.category_code }) { c ->
                    Card(Modifier.fillMaxWidth()) {
                        Row(
                            Modifier.fillMaxWidth().padding(12.dp),
                            horizontalArrangement = Arrangement.SpaceBetween
                        ) {
                            Column {
                                Text(
                                    c.name,
                                    style = MaterialTheme.typography.bodyLarge.copy(
                                        textDirection = TextDirection.Content,
                                    ),
                                )
                                Text(
                                    pluralStringResource(
                                        R.plurals.categories_product_count,
                                        c.product_count,
                                        c.product_count,
                                    ),
                                    style = MaterialTheme.typography.bodySmall,
                                    color = MaterialTheme.colorScheme.onSurfaceVariant
                                )
                            }
                            Row {
                                val url = storeUrl
                                if (!url.isNullOrBlank()) {
                                    IconButton(onClick = { copyLink(context, "$url/c/${c.category_code}") }) {
                                        Icon(Icons.Outlined.ContentCopy, contentDescription = stringResource(R.string.action_copy_url))
                                    }
                                    IconButton(onClick = { shareCategoryLink(context, c.name, url, c.category_code) }) {
                                        Icon(Icons.Outlined.Share, contentDescription = stringResource(R.string.action_share_link))
                                    }
                                }
                                IconButton(onClick = { pendingDelete = c.category_code }, enabled = !busy) {
                                    Icon(Icons.Outlined.Delete, contentDescription = stringResource(R.string.common_delete),
                                        tint = MaterialTheme.colorScheme.error)
                                }
                            }
                        }
                    }
                }
            }
        }
    }
    pendingDelete?.let { code ->
        AlertDialog(
            onDismissRequest = { pendingDelete = null },
            title = { Text(stringResource(R.string.common_delete)) },
            text = { Text(stringResource(R.string.category_delete_confirm)) },
            confirmButton = {
                TextButton(onClick = { pendingDelete = null; viewModel.delete(code) }) {
                    Text(stringResource(R.string.common_delete), color = MaterialTheme.colorScheme.error)
                }
            },
            dismissButton = { TextButton(onClick = { pendingDelete = null }) { Text(stringResource(R.string.common_cancel)) } },
        )
    }
}

/** The backend's code for a plan boundary, from plan-limits.ts. */
private const val PLAN_LIMIT_REACHED = "PLAN_LIMIT_REACHED"

/** Internal marker so the screen can render a boundary as a notice, not a fault. */
private const val LIMIT_REACHED = "plan_limit_reached"
