package app.orderak.seller.feature.settings

import android.content.Context
import android.net.Uri
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material.icons.outlined.ContentCopy
import androidx.compose.material.icons.outlined.Share
import androidx.compose.material3.Button
import androidx.compose.material3.Card
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.ExposedDropdownMenuBox
import androidx.compose.material3.ExposedDropdownMenuDefaults
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.MenuAnchorType
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Text
import androidx.compose.material3.TopAppBar
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalConfiguration
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.heading
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.unit.dp
import androidx.hilt.navigation.compose.hiltViewModel
import androidx.lifecycle.ViewModel
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.lifecycle.viewModelScope
import java.util.Locale
import app.orderak.seller.R
import app.orderak.seller.data.remote.BusinessSubcategoryDto
import app.orderak.seller.data.remote.StoreDto
import app.orderak.seller.data.remote.StoreUpdateReq
import app.orderak.seller.data.remote.BackendApi
import app.orderak.seller.data.session.SessionStore
import app.orderak.seller.feature.products.copyLink
import app.orderak.seller.feature.products.shareStoreLink
import dagger.hilt.android.lifecycle.HiltViewModel
import dagger.hilt.android.qualifiers.ApplicationContext
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.SharingStarted
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.flow.stateIn
import kotlinx.coroutines.launch
import kotlinx.coroutines.delay
import kotlinx.coroutines.Job
import kotlinx.coroutines.withContext
import javax.inject.Inject

@HiltViewModel
class StoreInfoViewModel @Inject constructor(
    private val sessionStore: SessionStore,
    private val api: BackendApi,
    @param:ApplicationContext private val appContext: Context,
) : ViewModel() {

    private val _store = MutableStateFlow<StoreDto?>(null)
    val store: StateFlow<StoreDto?> = _store.asStateFlow()
    private val _busy = MutableStateFlow(false)
    val busy: StateFlow<Boolean> = _busy.asStateFlow()
    private val _slugState = MutableStateFlow<String?>(null)
    val slugState: StateFlow<String?> = _slugState.asStateFlow()
    private val _businessSubcategories =
        MutableStateFlow<List<BusinessSubcategoryDto>>(emptyList())
    val businessSubcategories: StateFlow<List<BusinessSubcategoryDto>> =
        _businessSubcategories.asStateFlow()
    private var slugJob: Job? = null

    // Read-only identity — served from cache so it renders instantly / offline.
    val publicIdentifier =
        sessionStore.publicIdentifier.stateIn(viewModelScope, SharingStarted.WhileSubscribed(5_000), null)
    val storeUrl = sessionStore.storeUrl.stateIn(viewModelScope, SharingStarted.WhileSubscribed(5_000), null)
    val storeCode = sessionStore.storeCode.stateIn(viewModelScope, SharingStarted.WhileSubscribed(5_000), null)
    val countryIso = sessionStore.countryIso.stateIn(viewModelScope, SharingStarted.WhileSubscribed(5_000), null)

    init { refresh() }

    fun refresh() = viewModelScope.launch {
        val phone = sessionStore.phone.first() ?: return@launch
        val secret = sessionStore.getOrCreateSecret()
        val res = api.getStore(phone, secret)
        val s = res.store
        if (res.ok && s != null) {
            _store.value = s
            cache(s)
        } else {
            // Offline fallback: build the view from cached values.
            _store.value = StoreDto(
                store_name = sessionStore.shopName.first(),
                slug = sessionStore.slug.first(),
                country_code = sessionStore.countryIso.first(),
                store_code = sessionStore.storeCode.first(),
                public_identifier = sessionStore.publicIdentifier.first(),
                description = sessionStore.description.first(),
                phone = sessionStore.phone.first(),
                whatsapp = sessionStore.whatsapp.first(),
                email = sessionStore.storeEmail.first(),
                website = sessionStore.website.first(),
                address = sessionStore.address.first(),
                instapay = sessionStore.instapay.first(),
                vfcash = sessionStore.vfcash.first(),
                logo_url = sessionStore.logoUrl.first(),
                cover_url = sessionStore.coverUrl.first(),
            )
        }
    }

    fun save(req: StoreUpdateReq, onDone: () -> Unit) = viewModelScope.launch {
        _busy.value = true
        val phone = sessionStore.phone.first()
        if (phone == null) { _busy.value = false; return@launch }
        val secret = sessionStore.getOrCreateSecret()
        val res = api.updateStore(phone, secret, req)
        _busy.value = false
        val s = res.store
        if (res.ok && s != null) {
            _store.value = s
            cache(s)
            onDone()
        }
    }

    /** Pick -> upload to R2 -> return the public URL to store as logo/cover. */
    fun uploadImage(uri: Uri, kind: String, onResult: (String?) -> Unit) = viewModelScope.launch {
        val phone = sessionStore.phone.first() ?: return@launch
        val secret = sessionStore.getOrCreateSecret()
        val prepared = withContext(Dispatchers.IO) { prepareImage(uri) }
        val (bytes, mime) = prepared ?: run { onResult(null); return@launch }
        if (bytes.isEmpty()) { onResult(null); return@launch }
        val ext = when (mime) { "image/png" -> "png"; "image/webp" -> "webp"; "image/gif" -> "gif"; else -> "jpg" }
        val res = api.uploadMedia(phone, secret, kind, bytes, "$kind.$ext", mime)
        onResult(if (res.ok) res.url else null)
    }

    fun checkSlug(slug: String) {
        slugJob?.cancel()
        slugJob = viewModelScope.launch {
        if (slug == _store.value?.slug) { _slugState.value = "available"; return@launch }
        if (slug.length < 3) { _slugState.value = "invalid"; return@launch }
        _slugState.value = "loading"
        delay(450)
        val phone = sessionStore.phone.first() ?: return@launch
        val result = api.checkSlug(phone, sessionStore.getOrCreateSecret(), slug)
        _slugState.value = when {
            result.error != null -> "network"
            result.reserved -> "reserved"
            !result.valid -> "invalid"
            result.available -> "available"
            else -> "taken"
        }
        }
    }

    fun loadBusinessSubcategories(categoryId: String?, language: String) = viewModelScope.launch {
        if (categoryId.isNullOrBlank()) {
            _businessSubcategories.value = emptyList()
            return@launch
        }
        val response = api.listBusinessSubcategories(categoryId, "", language)
        _businessSubcategories.value =
            if (response.ok) response.subcategories else emptyList()
    }

    /** Decode with sampling so a camera-sized image is never loaded as raw bytes. */
    private fun prepareImage(uri: Uri): Pair<ByteArray, String>? {
        return try {
        val resolver = appContext.contentResolver
        val bounds = android.graphics.BitmapFactory.Options().apply { inJustDecodeBounds = true }
        resolver.openInputStream(uri)?.use { android.graphics.BitmapFactory.decodeStream(it, null, bounds) }
        if (bounds.outWidth <= 0 || bounds.outHeight <= 0) return null
        var sample = 1
        while (maxOf(bounds.outWidth, bounds.outHeight) / (sample * 2) >= 1600) sample *= 2
        val bitmap = resolver.openInputStream(uri)?.use {
            android.graphics.BitmapFactory.decodeStream(it, null, android.graphics.BitmapFactory.Options().apply { inSampleSize = sample })
        } ?: return null
        try {
            val png = resolver.getType(uri) == "image/png"
            val format = if (png) android.graphics.Bitmap.CompressFormat.PNG else android.graphics.Bitmap.CompressFormat.JPEG
            java.io.ByteArrayOutputStream().use { output ->
                if (!bitmap.compress(format, if (png) 100 else 85, output)) return null
                output.toByteArray() to if (png) "image/png" else "image/jpeg"
            }
        } finally {
            bitmap.recycle()
        }
        } catch (_: Exception) {
            null
        } catch (_: OutOfMemoryError) {
            null
        }
    }

    private suspend fun cache(s: StoreDto) {
        sessionStore.saveStoreInfo(
            shopName = s.store_name, description = s.description, whatsapp = s.whatsapp,
            email = s.email, website = s.website, address = s.address,
            logoUrl = s.logo_url, coverUrl = s.cover_url,
        )
        sessionStore.saveStoreIdentity(
            s.slug, s.public_identifier, s.store_code, s.country_code, s.store_url,
        )
        if (!s.slug.isNullOrBlank()) sessionStore.saveSlug(s.slug)
    }
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun StoreInfoScreen(
    onBack: () -> Unit,
    viewModel: StoreInfoViewModel = hiltViewModel(),
) {
    val context = LocalContext.current
    val store by viewModel.store.collectAsStateWithLifecycle()
    val busy by viewModel.busy.collectAsStateWithLifecycle()
    val slugState by viewModel.slugState.collectAsStateWithLifecycle()
    val storeUrl by viewModel.storeUrl.collectAsStateWithLifecycle()
    val storeCode by viewModel.storeCode.collectAsStateWithLifecycle()
    val country by viewModel.countryIso.collectAsStateWithLifecycle()
    val businessSubcategories by viewModel.businessSubcategories.collectAsStateWithLifecycle()
    val appLanguage = LocalConfiguration.current.locales[0].language

    // Editable fields, re-seeded whenever the loaded store changes.
    var name by rememberSaveable(store) { mutableStateOf(store?.store_name.orEmpty()) }
    var slug by rememberSaveable(store) { mutableStateOf(store?.slug.orEmpty()) }
    var description by rememberSaveable(store) { mutableStateOf(store?.description.orEmpty()) }
    val phone = store?.phone.orEmpty()
    var whatsapp by rememberSaveable(store) { mutableStateOf(store?.whatsapp.orEmpty()) }
    var email by rememberSaveable(store) { mutableStateOf(store?.email.orEmpty()) }
    var website by rememberSaveable(store) { mutableStateOf(store?.website.orEmpty()) }
    var address by rememberSaveable(store) { mutableStateOf(store?.address.orEmpty()) }
    var logoUrl by rememberSaveable(store) { mutableStateOf(store?.logo_url.orEmpty()) }
    var coverUrl by rememberSaveable(store) { mutableStateOf(store?.cover_url.orEmpty()) }
    var businessSubcategoryId by rememberSaveable(store) {
        mutableStateOf(store?.business_subcategory_id)
    }
    var businessSubcategoryExpanded by rememberSaveable { mutableStateOf(false) }

    LaunchedEffect(slug) { viewModel.checkSlug(slug) }
    LaunchedEffect(store?.business_category_id, appLanguage) {
        viewModel.loadBusinessSubcategories(store?.business_category_id, appLanguage)
    }

    val pickLogo = rememberLauncherForActivityResult(ActivityResultContracts.GetContent()) { uri: Uri? ->
        uri?.let { viewModel.uploadImage(it, "logo") { url -> if (url != null) logoUrl = url } }
    }
    val pickCover = rememberLauncherForActivityResult(ActivityResultContracts.GetContent()) { uri: Uri? ->
        uri?.let { viewModel.uploadImage(it, "cover") { url -> if (url != null) coverUrl = url } }
    }


    Scaffold(
        topBar = {
            TopAppBar(
                title = { Text(stringResource(R.string.store_info_title), modifier = Modifier.semantics { heading() }) },
                navigationIcon = {
                    IconButton(onClick = onBack) {
                        Icon(Icons.AutoMirrored.Filled.ArrowBack, contentDescription = stringResource(R.string.common_back))
                    }
                },
            )
        }
    ) { padding ->
        Column(
            Modifier.fillMaxSize().padding(padding).padding(16.dp).verticalScroll(rememberScrollState()),
            verticalArrangement = Arrangement.spacedBy(12.dp)
        ) {
            // ---- Read-only identity block ----
            Card(Modifier.fillMaxWidth()) {
                Column(Modifier.padding(16.dp), verticalArrangement = Arrangement.spacedBy(4.dp)) {
                    ReadOnlyRow(stringResource(R.string.store_info_country), country.orEmpty())
                    ReadOnlyRow(stringResource(R.string.store_info_code), storeCode.orEmpty())
                    storeUrl?.let { url ->
                        ReadOnlyRow(stringResource(R.string.store_info_public_id), url)
                        Text(url, style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.primary)
                        Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                            OutlinedButton(onClick = { copyLink(context, url) }) {
                                Icon(Icons.Outlined.ContentCopy, contentDescription = null)
                                Text(stringResource(R.string.action_copy_url), Modifier.padding(start = 6.dp))
                            }
                            OutlinedButton(onClick = { shareStoreLink(context, name, url) }) {
                                Icon(Icons.Outlined.Share, contentDescription = null)
                                Text(stringResource(R.string.action_share_store), Modifier.padding(start = 6.dp))
                            }
                        }
                    } ?: run {
                        Text(stringResource(R.string.settings_link_pending), style = MaterialTheme.typography.bodySmall,
                            color = MaterialTheme.colorScheme.onSurfaceVariant)
                    }
                }
            }

            // ---- Editable fields ----
            Text(stringResource(R.string.store_info_title), style = MaterialTheme.typography.titleMedium)
            Field(name, { name = it.take(60) }, R.string.store_info_name)
            OutlinedTextField(
                value = slug,
                onValueChange = { v -> slug = v.lowercase(Locale.ROOT).filter { it.isLetterOrDigit() || it == '-' }.take(40) },
                label = { Text(stringResource(R.string.store_info_slug)) },
                supportingText = { slugState?.let { Text(stringResource(when(it){"loading"->R.string.slug_loading;"available"->R.string.slug_available;"taken"->R.string.slug_taken;"reserved"->R.string.slug_reserved;"network"->R.string.slug_network;else->R.string.slug_invalid})) } },
                singleLine = true, modifier = Modifier.fillMaxWidth()
            )
            Field(description, { description = it.take(300) }, R.string.store_info_description)
            OutlinedTextField(
                value = phone,
                onValueChange = {},
                readOnly = true,
                label = { Text(stringResource(R.string.store_info_phone)) },
                supportingText = { Text(stringResource(R.string.store_info_phone_verified_help)) },
                singleLine = true,
                modifier = Modifier.fillMaxWidth(),
            )
            Field(whatsapp, { whatsapp = it.take(20) }, R.string.store_info_whatsapp)
            Field(email, { email = it.take(80) }, R.string.store_info_email)
            Field(website, { website = it.take(120) }, R.string.store_info_website)
            Field(address, { address = it.take(200) }, R.string.store_info_address)

            ExposedDropdownMenuBox(
                expanded = businessSubcategoryExpanded,
                onExpandedChange = {
                    if (!store?.business_category_id.isNullOrBlank()) {
                        businessSubcategoryExpanded = it
                    }
                },
                modifier = Modifier.fillMaxWidth(),
            ) {
                val selectedName = businessSubcategories
                    .firstOrNull { it.id == businessSubcategoryId }
                    ?.name
                    .orEmpty()
                OutlinedTextField(
                    value = selectedName,
                    onValueChange = {},
                    readOnly = true,
                    enabled = !store?.business_category_id.isNullOrBlank(),
                    label = { Text(stringResource(R.string.setup_subcategory_label)) },
                    placeholder = { Text(stringResource(R.string.setup_subcategory_placeholder)) },
                    trailingIcon = {
                        ExposedDropdownMenuDefaults.TrailingIcon(
                            expanded = businessSubcategoryExpanded,
                        )
                    },
                    modifier = Modifier
                        .fillMaxWidth()
                        .menuAnchor(MenuAnchorType.PrimaryNotEditable, true),
                )
                ExposedDropdownMenu(
                    expanded = businessSubcategoryExpanded,
                    onDismissRequest = { businessSubcategoryExpanded = false },
                    modifier = Modifier.heightIn(max = 360.dp),
                ) {
                    businessSubcategories.forEach { subcategory ->
                        DropdownMenuItem(
                            text = { Text(subcategory.name) },
                            onClick = {
                                businessSubcategoryId = subcategory.id
                                businessSubcategoryExpanded = false
                            },
                            contentPadding = ExposedDropdownMenuDefaults.ItemContentPadding,
                        )
                    }
                }
            }

            Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                OutlinedButton(onClick = { pickLogo.launch("image/*") }) { Text(stringResource(R.string.store_info_logo)) }
                OutlinedButton(onClick = { pickCover.launch("image/*") }) { Text(stringResource(R.string.store_info_cover)) }
            }

            Spacer(Modifier.height(8.dp))
            Button(
                onClick = {
                    viewModel.save(
                        StoreUpdateReq(
                            store_name = name.trim(),
                            slug = slug.trim().ifBlank { null },
                            description = description.trim(),
                            whatsapp = whatsapp.trim(),
                            email = email.trim(),
                            website = website.trim(),
                            address = address.trim(),
                            logo_url = logoUrl.ifBlank { null },
                            cover_url = coverUrl.ifBlank { null },
                            business_category_id = store?.business_category_id,
                            business_subcategory_id = businessSubcategoryId,
                        ),
                        onDone = onBack,
                    )
                },
                enabled = !busy && (slugState == "available" || slug == store?.slug),
                modifier = Modifier.fillMaxWidth()
            ) { Text(stringResource(R.string.settings_save)) }
        }
    }
}

@Composable
private fun Field(value: String, onValueChange: (String) -> Unit, labelRes: Int) {
    OutlinedTextField(
        value = value, onValueChange = onValueChange,
        label = { Text(stringResource(labelRes)) },
        singleLine = true, modifier = Modifier.fillMaxWidth()
    )
}

@Composable
private fun ReadOnlyRow(label: String, value: String) {
    Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween) {
        Text(label, style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
        Text(value, style = MaterialTheme.typography.bodyMedium)
    }
}
