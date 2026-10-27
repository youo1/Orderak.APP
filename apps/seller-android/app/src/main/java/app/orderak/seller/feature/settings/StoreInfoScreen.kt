package app.orderak.seller.feature.settings

import android.content.Context
import android.net.Uri
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.layout.imePadding
import androidx.compose.material3.ModalBottomSheet
import androidx.compose.material3.TextButton
import androidx.compose.material3.rememberModalBottomSheetState
import androidx.compose.ui.Alignment
import androidx.compose.ui.layout.ContentScale
import app.orderak.seller.core.ui.BottomActionBar
import app.orderak.seller.core.ui.ImagePickerState
import app.orderak.seller.core.ui.ImagePickerTile
import app.orderak.seller.core.ui.KeyValueRow
import app.orderak.seller.core.ui.PickerOption
import app.orderak.seller.core.ui.PickerSheet
import app.orderak.seller.core.ui.PickerSheetMode
import app.orderak.seller.core.ui.SectionHeader
import app.orderak.seller.core.ui.SelectField
import app.orderak.seller.core.ui.TextField
import app.orderak.seller.core.ui.Thumbnail
import app.orderak.seller.core.ui.TopBar
import coil3.compose.AsyncImage
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
import app.orderak.seller.core.ui.theme.LocalOrderakSpacing
import app.orderak.seller.core.ui.Banner
import app.orderak.seller.core.ui.BannerState
import app.orderak.seller.core.ui.backendErrorResource
import app.orderak.seller.R
import app.orderak.seller.data.remote.BusinessSubcategoryDto
import app.orderak.seller.data.remote.StoreDto
import app.orderak.seller.data.remote.StoreUpdateReq
import app.orderak.seller.data.remote.BackendApi
import app.orderak.seller.data.session.SessionStore
import app.orderak.seller.core.share.copyLink
import app.orderak.seller.core.share.shareStoreLink
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
import app.orderak.seller.core.ui.Skeleton
import app.orderak.seller.core.ui.SkeletonVariant

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

    /**
     * A stable backend code for the last refused save, or null.
     *
     * Rendered through `backendErrorResource`, so the seller reads the same
     * sentence for "this slug is taken" here as anywhere else in the app, and a
     * code nobody has mapped yet still produces a sentence rather than a blank.
     */
    private val _saveError = MutableStateFlow<String?>(null)
    val saveError: StateFlow<String?> = _saveError.asStateFlow()
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
        // No phone means no session, and the screen is unreachable without one —
        // but returning here left `_store` null for ever, and the screen reads
        // null as "still loading". A state nothing can leave is worse than an
        // empty form, so fall through to the cached view instead.
        val phone = sessionStore.phone.first() ?: run { _store.value = cachedStore(); return@launch }
        val secret = sessionStore.currentSecret()
        val res = api.getStore(phone, secret)
        val s = res.store
        if (res.ok && s != null) {
            _store.value = s
            cache(s)
        } else {
            // Offline fallback: build the view from cached values.
            _store.value = cachedStore()
        }
    }

    /** The store as this device last knew it. Used offline and when unauthenticated. */
    private suspend fun cachedStore() = StoreDto(
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

    fun save(req: StoreUpdateReq, onDone: () -> Unit) = viewModelScope.launch {
        _busy.value = true
        _saveError.value = null
        val phone = sessionStore.phone.first()
        if (phone == null) {
            _busy.value = false
            // Unreachable in practice — the screen needs a session — but a silent
            // return here is the same defect in one line: a Save that reports
            // nothing at all.
            _saveError.value = "auth"
            return@launch
        }
        val secret = sessionStore.currentSecret()
        val res = api.updateStore(phone, secret, req)
        _busy.value = false
        val s = res.store
        if (res.ok && s != null) {
            _store.value = s
            cache(s)
            onDone()
        } else {
            // The refusal had nowhere to go.
            //
            // `ok` false with a null store left the screen exactly as it was: the
            // spinner stopped, nothing changed on screen, and `onDone` was not
            // called — so a seller whose slug was taken, whose field the server
            // rejected, or who was simply offline could not tell a saved store
            // from a refused one. The server sends a stable code, and the app
            // already has one place that turns those into sentences.
            _saveError.value = res.error ?: "network"
        }
    }

    /** Pick -> upload to R2 -> return the public URL to store as logo/cover. */
    fun uploadImage(uri: Uri, kind: String, onResult: (String?) -> Unit) = viewModelScope.launch {
        val phone = sessionStore.phone.first() ?: return@launch
        val secret = sessionStore.currentSecret()
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
        val result = api.checkSlug(phone, sessionStore.currentSecret(), slug)
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
    val saveError by viewModel.saveError.collectAsStateWithLifecycle()
    val slugState by viewModel.slugState.collectAsStateWithLifecycle()
    val storeUrl by viewModel.storeUrl.collectAsStateWithLifecycle()
    val storeCode by viewModel.storeCode.collectAsStateWithLifecycle()
    val publicIdentifier by viewModel.publicIdentifier.collectAsStateWithLifecycle()
    val country by viewModel.countryIso.collectAsStateWithLifecycle()
    val businessSubcategories by viewModel.businessSubcategories.collectAsStateWithLifecycle()
    val appLanguage = LocalConfiguration.current.locales[0].language

    // Editable fields, seeded once when the store first loads — keyed on
    // whether it has loaded at all (null -> non-null, exactly once), not on
    // the store object itself. Keying on `store` re-seeded every field from
    // the server on every subsequent change to *any* field, including one a
    // background refresh made while the seller was mid-edit on an unrelated
    // field — silently discarding whatever they had typed so far.
    val loaded = store != null
    var name by rememberSaveable(loaded) { mutableStateOf(store?.store_name.orEmpty()) }
    var slug by rememberSaveable(loaded) { mutableStateOf(store?.slug.orEmpty()) }
    var description by rememberSaveable(loaded) { mutableStateOf(store?.description.orEmpty()) }
    val phone = store?.phone.orEmpty()
    var whatsapp by rememberSaveable(loaded) { mutableStateOf(store?.whatsapp.orEmpty()) }
    var email by rememberSaveable(loaded) { mutableStateOf(store?.email.orEmpty()) }
    var website by rememberSaveable(loaded) { mutableStateOf(store?.website.orEmpty()) }
    var address by rememberSaveable(loaded) { mutableStateOf(store?.address.orEmpty()) }
    var logoUrl by rememberSaveable(loaded) { mutableStateOf(store?.logo_url.orEmpty()) }
    var coverUrl by rememberSaveable(loaded) { mutableStateOf(store?.cover_url.orEmpty()) }
    // A picked image that never reached R2 used to leave no trace at all: the
    // callback only ran its success branch, so the seller chose a logo, watched
    // nothing appear, and could not tell a failed upload from a slow one. The
    // store is not dirty in that case, which is why this is its own state rather
    // than the save error above it — nothing the seller typed is at risk.
    var uploadFailed by rememberSaveable { mutableStateOf(false) }
    var businessSubcategoryId by rememberSaveable(loaded) {
        mutableStateOf(store?.business_subcategory_id)
    }

    LaunchedEffect(slug) { viewModel.checkSlug(slug) }
    LaunchedEffect(store?.business_category_id, appLanguage) {
        viewModel.loadBusinessSubcategories(store?.business_category_id, appLanguage)
    }

    val pickLogo = rememberLauncherForActivityResult(ActivityResultContracts.GetContent()) { uri: Uri? ->
        uri?.let {
            uploadFailed = false
            viewModel.uploadImage(it, "logo") { url -> if (url != null) logoUrl = url else uploadFailed = true }
        }
    }
    val pickCover = rememberLauncherForActivityResult(ActivityResultContracts.GetContent()) { uri: Uri? ->
        uri?.let {
            uploadFailed = false
            viewModel.uploadImage(it, "cover") { url -> if (url != null) coverUrl = url else uploadFailed = true }
        }
    }


    StoreInfoContent(
        store = store,
        draft = StoreInfoDraft(
            name = name,
            slug = slug,
            description = description,
            whatsapp = whatsapp,
            email = email,
            website = website,
            address = address,
            logoUrl = logoUrl,
            coverUrl = coverUrl,
            businessSubcategoryId = businessSubcategoryId,
        ),
        onDraft = { d ->
            name = d.name; slug = d.slug; description = d.description
            whatsapp = d.whatsapp; email = d.email; website = d.website
            address = d.address; logoUrl = d.logoUrl; coverUrl = d.coverUrl
            businessSubcategoryId = d.businessSubcategoryId
        },
        phone = phone,
        busy = busy,
        saveError = saveError,
        uploadFailed = uploadFailed,
        slugState = slugState,
        storeUrl = storeUrl,
        storeCode = storeCode,
        country = country,
        publicIdentifier = publicIdentifier,
        businessSubcategories = businessSubcategories,
        onSave = { req, onDone -> viewModel.save(req, onDone) },
        onPickLogo = { pickLogo.launch("image/*") },
        onPickCover = { pickCover.launch("image/*") },
        onCopyLink = { copyLink(context, it) },
        onShareLink = { shareStoreLink(context, name, it) },
        onBack = onBack,
    )
}

/**
 * The ten editable fields of the store form, as one value.
 *
 * Ten values and ten setters threaded separately would be twenty parameters on a
 * composable nobody would read. They are seeded and owned by [StoreInfoScreen] —
 * each is `rememberSaveable(store)`, KEYED on the loaded store — and this type is
 * only how they travel.
 */
data class StoreInfoDraft(
    val name: String = "",
    val slug: String = "",
    val description: String = "",
    val whatsapp: String = "",
    val email: String = "",
    val website: String = "",
    val address: String = "",
    val logoUrl: String = "",
    val coverUrl: String = "",
    val businessSubcategoryId: String? = null,
)

/**
 * The store form, as a function of its state.
 *
 * `store == null` is the loading state, and it is load-bearing rather than
 * cosmetic: the ten draft fields are keyed on the loaded store, so rendering the
 * form before it arrived let a seller start typing their shop name into an empty
 * field and have the whole form reset under them the moment the network
 * answered. Waiting composes the form once, with the values already in hand.
 */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun StoreInfoContent(
    store: StoreDto?,
    draft: StoreInfoDraft,
    onDraft: (StoreInfoDraft) -> Unit,
    phone: String,
    busy: Boolean,
    slugState: String?,
    storeUrl: String?,
    storeCode: String?,
    country: String?,
    /**
     * The store's public identifier (`EG-store-A1B2C3`), or null before the server
     * has issued one. Read by the identity card's own "Public identifier" row, which
     * used to print the store link instead.
     */
    publicIdentifier: String? = null,
    businessSubcategories: List<BusinessSubcategoryDto>,
    onSave: (StoreUpdateReq, (() -> Unit)) -> Unit,
    /** A stable backend code for the last refused save, or null. */
    saveError: String? = null,
    /** True when a chosen image never reached storage. */
    uploadFailed: Boolean = false,
    onPickLogo: () -> Unit,
    onPickCover: () -> Unit,
    onCopyLink: (String) -> Unit,
    onShareLink: (String) -> Unit,
    onBack: () -> Unit,
) {
    val spacing = LocalOrderakSpacing.current
    var subcategorySheet by rememberSaveable { mutableStateOf(false) }
    val slugOk = slugState == "available" || draft.slug == store?.slug
    Scaffold(
        topBar = {
            TopBar(
                title = stringResource(R.string.store_info_title),
                onBack = onBack,
                backDescription = stringResource(R.string.sheet_close),
                closeIcon = true,
            )
        },
        bottomBar = {
            if (store != null) {
                BottomActionBar(
                    primaryLabel = stringResource(R.string.product_save_bar),
                    onPrimary = {
                        onSave(
                            StoreUpdateReq(
                                store_name = draft.name.trim(),
                                slug = draft.slug.trim().ifBlank { null },
                                description = draft.description.trim(),
                                whatsapp = draft.whatsapp.trim(),
                                email = draft.email.trim(),
                                website = draft.website.trim(),
                                address = draft.address.trim(),
                                logo_url = draft.logoUrl.ifBlank { null },
                                cover_url = draft.coverUrl.ifBlank { null },
                                business_category_id = store.business_category_id,
                                business_subcategory_id = draft.businessSubcategoryId,
                            ),
                            onBack,
                        )
                    },
                    primaryEnabled = !busy && slugOk && draft.name.isNotBlank(),
                    disabledReason = if (!busy && !slugOk) stringResource(R.string.store_info_bar_reason) else null,
                )
            }
        },
    ) { padding ->
        // The draft fields are keyed on the loaded store, so rendering the form before it
        // arrived let a seller start typing their shop name into an empty field and have
        // the whole form reset under them when the network answered. Waiting here composes
        // the form once, with the values already in hand.
        if (store == null) {
            Skeleton(SkeletonVariant.DetailBlock, Modifier.padding(padding).padding(spacing.space4))
            return@Scaffold
        }
        Column(
            Modifier
                .fillMaxSize()
                .padding(padding)
                .imePadding()
                .verticalScroll(rememberScrollState())
                .padding(spacing.space4),
            verticalArrangement = Arrangement.spacedBy(spacing.space3),
        ) {
            if (saveError != null) {
                // The answer to the press that is about to be repeated, at the top where the
                // seller is looking; the form below is kept as typed.
                Banner(
                    state = BannerState.Error,
                    title = stringResource(R.string.store_info_save_failed),
                    message = stringResource(backendErrorResource(saveError)),
                )
            }
            if (uploadFailed) {
                // Beside the pickers that caused it: the remedy is to pick again.
                Banner(
                    state = BannerState.Error,
                    title = stringResource(R.string.store_info_upload_failed),
                    message = stringResource(R.string.error_unknown),
                )
            }

            // The cover, with the logo under it: how the store looks.
            ImagePickerTile(
                state = if (draft.coverUrl.isBlank()) ImagePickerState.Placeholder else ImagePickerState.Preview,
                label = stringResource(R.string.store_info_cover),
                addLabel = stringResource(R.string.store_info_cover_add),
                onPick = onPickCover,
            ) {
                AsyncImage(
                    model = draft.coverUrl,
                    contentDescription = null,
                    contentScale = ContentScale.Crop,
                    modifier = Modifier.fillMaxSize(),
                )
            }
            Row(
                Modifier.fillMaxWidth(),
                verticalAlignment = Alignment.CenterVertically,
                horizontalArrangement = Arrangement.spacedBy(spacing.space3),
            ) {
                Thumbnail(size = spacing.space16) {
                    if (draft.logoUrl.isNotBlank()) {
                        AsyncImage(
                            model = draft.logoUrl,
                            contentDescription = null,
                            contentScale = ContentScale.Crop,
                            modifier = Modifier.fillMaxSize(),
                        )
                    }
                }
                Text(
                    stringResource(R.string.store_info_logo),
                    style = MaterialTheme.typography.bodyLarge,
                    modifier = Modifier.weight(1f),
                )
                TextButton(onClick = onPickLogo, modifier = Modifier.heightIn(min = spacing.minimumTouchTarget)) {
                    Text(stringResource(R.string.store_info_change))
                }
            }

            SectionHeader(title = stringResource(R.string.store_info_section_identity))
            TextField(
                value = draft.name,
                onValueChange = { onDraft(draft.copy(name = it.take(60))) },
                label = stringResource(R.string.store_info_name),
                required = true,
                enabled = !busy,
            )
            TextField(
                value = draft.description,
                onValueChange = { onDraft(draft.copy(description = it.take(300))) },
                label = stringResource(R.string.store_info_description),
                singleLine = false,
                enabled = !busy,
            )

            // The link as the code builds it: only the middle is the seller's. The permanent
            // code at the end never changes, so old links keep working after a rename.
            SectionHeader(title = stringResource(R.string.store_info_section_link))
            TextField(
                value = draft.slug,
                onValueChange = { v ->
                    onDraft(draft.copy(slug = v.lowercase(Locale.ROOT).filter { it.isLetterOrDigit() || it == '-' }.take(40)))
                },
                label = stringResource(R.string.store_info_slug),
                prefix = "orderak.app/" + country.orEmpty() + "-",
                suffix = storeCode?.takeIf { it.isNotBlank() }?.let { "-$it" },
                helper = when (slugState) {
                    "loading" -> stringResource(R.string.slug_loading)
                    "available" -> stringResource(R.string.slug_available)
                    else -> stringResource(R.string.store_info_slug_note)
                },
                error = when (slugState) {
                    "taken" -> stringResource(R.string.slug_taken)
                    "reserved" -> stringResource(R.string.slug_reserved)
                    "network" -> stringResource(R.string.slug_network)
                    "invalid" -> stringResource(R.string.slug_invalid)
                    else -> null
                },
                enabled = !busy,
            )
            if (storeUrl != null) {
                Row(horizontalArrangement = Arrangement.spacedBy(spacing.space2)) {
                    OutlinedButton(
                        onClick = { onCopyLink(storeUrl) },
                        modifier = Modifier.heightIn(min = spacing.minimumTouchTarget),
                    ) {
                        Icon(Icons.Outlined.ContentCopy, contentDescription = null)
                        Text(stringResource(R.string.action_copy_url), Modifier.padding(start = spacing.space1))
                    }
                    OutlinedButton(
                        onClick = { onShareLink(storeUrl) },
                        modifier = Modifier.heightIn(min = spacing.minimumTouchTarget),
                    ) {
                        Icon(Icons.Outlined.Share, contentDescription = null)
                        Text(stringResource(R.string.action_share_store), Modifier.padding(start = spacing.space1))
                    }
                }
            } else {
                Text(
                    stringResource(R.string.settings_link_pending),
                    style = MaterialTheme.typography.bodySmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                )
            }

            if (!store.business_category_id.isNullOrBlank()) {
                SectionHeader(title = stringResource(R.string.store_info_section_activity))
                SelectField(
                    label = stringResource(R.string.setup_subcategory_label),
                    value = businessSubcategories.firstOrNull { it.id == draft.businessSubcategoryId }?.name.orEmpty(),
                    onClick = { subcategorySheet = true },
                    enabled = !busy,
                )
            }

            SectionHeader(title = stringResource(R.string.store_info_section_contact))
            // The verified sign-in number: shown, not editable. Changing it needs a new
            // confirmation, which is not this page.
            TextField(
                value = phone,
                onValueChange = {},
                label = stringResource(R.string.store_info_phone),
                helper = stringResource(R.string.store_info_phone_verified_help),
                enabled = false,
            )
            TextField(
                value = draft.whatsapp,
                onValueChange = { onDraft(draft.copy(whatsapp = it.take(20))) },
                label = stringResource(R.string.store_info_whatsapp),
                enabled = !busy,
            )
            TextField(
                value = draft.email,
                onValueChange = { onDraft(draft.copy(email = it.take(80))) },
                label = stringResource(R.string.store_info_email),
                enabled = !busy,
            )
            TextField(
                value = draft.website,
                onValueChange = { onDraft(draft.copy(website = it.take(120))) },
                label = stringResource(R.string.store_info_website),
                enabled = !busy,
            )
            TextField(
                value = draft.address,
                onValueChange = { onDraft(draft.copy(address = it.take(200))) },
                label = stringResource(R.string.store_info_address),
                enabled = !busy,
            )

            // What identifies the store and cannot be changed here.
            publicIdentifier?.takeIf { it.isNotBlank() }?.let {
                KeyValueRow(label = stringResource(R.string.store_info_public_id), value = it)
            }
        }
    }

    if (subcategorySheet) {
        ModalBottomSheet(
            onDismissRequest = { subcategorySheet = false },
            sheetState = rememberModalBottomSheetState(skipPartiallyExpanded = true),
            containerColor = MaterialTheme.colorScheme.surface,
            dragHandle = null,
            shape = RoundedCornerShape(spacing.space0),
        ) {
            PickerSheet(
                mode = PickerSheetMode.SingleChoice,
                title = stringResource(R.string.setup_subcategory_label),
                options = businessSubcategories.map { PickerOption(it.id, it.name) },
                selectedKey = draft.businessSubcategoryId,
                onSelect = { option ->
                    subcategorySheet = false
                    onDraft(draft.copy(businessSubcategoryId = option.key))
                },
                closeLabel = stringResource(R.string.sheet_close),
                onClose = { subcategorySheet = false },
            )
        }
    }
}
