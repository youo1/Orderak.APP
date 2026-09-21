package app.orderak.seller.feature.settings

import android.content.Context
import android.net.Uri
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
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
import androidx.compose.material3.TopAppBar
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.heading
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.unit.dp
import androidx.hilt.navigation.compose.hiltViewModel
import androidx.lifecycle.ViewModel
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.lifecycle.viewModelScope
import app.orderak.seller.R
import app.orderak.seller.core.ui.FullScreenLoading
import app.orderak.seller.data.remote.BackendApi
import app.orderak.seller.data.session.SessionStore
import dagger.hilt.android.lifecycle.HiltViewModel
import dagger.hilt.android.qualifiers.ApplicationContext
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import javax.inject.Inject

@HiltViewModel
class SellerProfileViewModel @Inject constructor(
    private val sessionStore: SessionStore,
    private val api: BackendApi,
    @param:ApplicationContext private val appContext: Context,
) : ViewModel() {
    private val _phone = MutableStateFlow("")
    val phone: StateFlow<String> = _phone.asStateFlow()

    private val _fullName = MutableStateFlow("")
    val fullName: StateFlow<String> = _fullName.asStateFlow()

    private val _email = MutableStateFlow("")
    val email: StateFlow<String> = _email.asStateFlow()

    private val _birthYear = MutableStateFlow("")
    val birthYear: StateFlow<String> = _birthYear.asStateFlow()

    private val _profilePhotoUri = MutableStateFlow("")
    val profilePhotoUri: StateFlow<String> = _profilePhotoUri.asStateFlow()

    private val _busy = MutableStateFlow(false)
    val busy: StateFlow<Boolean> = _busy.asStateFlow()
    private val _emailVerificationStatus = MutableStateFlow<String?>(null)
    val emailVerificationStatus: StateFlow<String?> = _emailVerificationStatus.asStateFlow()

    /**
     * Whether the session snapshot has been read.
     *
     * Every field above seeds "", and reading the snapshot is a suspend call, so
     * the form rendered with a blank phone number — the seller's own, and the
     * one read-only identity on the page — and filled it in a beat later. The
     * contract declares a loading state; this is what it is for.
     */
    private val _loaded = MutableStateFlow(false)
    val loaded: StateFlow<Boolean> = _loaded.asStateFlow()

    init {
        viewModelScope.launch {
            val snap = sessionStore.snapshot()
            _phone.value = snap.phone.orEmpty()
            _fullName.value = snap.fullName.orEmpty()
            _email.value = snap.email.orEmpty()
            _birthYear.value = snap.birthYear.orEmpty()
            _profilePhotoUri.value = snap.profilePhotoUri.orEmpty()
            _loaded.value = true
        }
    }

    fun save(
        fullName: String,
        email: String?,
        birthYear: String?,
        profilePhotoUri: String?,
        onDone: () -> Unit,
    ) {
        viewModelScope.launch {
            _busy.value = true
            // The decision is in profileSave, so it can be checked: this save
            // carries the SHOP half of saveShop through from the snapshot, and
            // getting one of those wrong erases a shop name on a birth-year edit.
            val write = profileSave(sessionStore.snapshot(), fullName, email, birthYear, profilePhotoUri)
            sessionStore.saveShop(
                name = write.name,
                category = write.category,
                city = write.city,
                countryIso = write.countryIso,
                logoUri = write.logoUri,
                fullName = write.fullName,
                email = write.email,
                birthYear = write.birthYear,
                profilePhotoUri = write.profilePhotoUri,
            )
            _busy.value = false
            onDone()
        }
    }

    fun uploadProfilePhoto(uri: Uri, onResult: (String?) -> Unit) = viewModelScope.launch {
        val phone = sessionStore.phone.first() ?: return@launch
        val secret = sessionStore.getOrCreateSecret()
        val prepared = withContext(Dispatchers.IO) { prepareImage(uri) }
        val (bytes, mime) = prepared ?: run { onResult(null); return@launch }
        if (bytes.isEmpty()) { onResult(null); return@launch }
        val ext = when (mime) {
            "image/png" -> "png"
            "image/webp" -> "webp"
            "image/gif" -> "gif"
            else -> "jpg"
        }
        val res = api.uploadMedia(phone, secret, "profile", bytes, "profile.$ext", mime)
        if (res.ok && res.url != null) {
            _profilePhotoUri.value = res.url
            onResult(res.url)
        } else {
            onResult(null)
        }
    }

    fun resendEmailVerification(onReauthenticate: () -> Unit) = viewModelScope.launch {
        val phone = sessionStore.phone.first() ?: return@launch
        val secret = sessionStore.getOrCreateSecret()
        val recent = sessionStore.readRecentAuthToken()
        if (recent.isNullOrBlank()) {
            onReauthenticate()
            return@launch
        }
        _busy.value = true
        val result = api.resendAccountEmailVerification(phone, secret, recent)
        _emailVerificationStatus.value = when {
            result.ok -> "sent"
            result.error == "recent_auth_required" -> {
                onReauthenticate()
                null
            }
            else -> result.error ?: "failed"
        }
        _busy.value = false
    }

    private fun prepareImage(uri: Uri): Pair<ByteArray, String>? {
        return try {
            val resolver = appContext.contentResolver
            val bounds = android.graphics.BitmapFactory.Options().apply { inJustDecodeBounds = true }
            resolver.openInputStream(uri)?.use {
                android.graphics.BitmapFactory.decodeStream(it, null, bounds)
            }
            if (bounds.outWidth <= 0 || bounds.outHeight <= 0) return null
            var sample = 1
            while (maxOf(bounds.outWidth, bounds.outHeight) / (sample * 2) >= 800) sample *= 2
            val bitmap = resolver.openInputStream(uri)?.use {
                android.graphics.BitmapFactory.decodeStream(
                    it, null,
                    android.graphics.BitmapFactory.Options().apply { inSampleSize = sample },
                )
            } ?: return null
            try {
                val png = resolver.getType(uri) == "image/png"
                val format =
                    if (png) android.graphics.Bitmap.CompressFormat.PNG else android.graphics.Bitmap.CompressFormat.JPEG
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
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun SellerProfileScreen(
    onBack: () -> Unit,
    onReauthenticate: () -> Unit,
    viewModel: SellerProfileViewModel = hiltViewModel(),
) {
    val phone by viewModel.phone.collectAsStateWithLifecycle()
    val savedFullName by viewModel.fullName.collectAsStateWithLifecycle()
    val savedEmail by viewModel.email.collectAsStateWithLifecycle()
    val savedBirthYear by viewModel.birthYear.collectAsStateWithLifecycle()
    val savedPhotoUri by viewModel.profilePhotoUri.collectAsStateWithLifecycle()
    val busy by viewModel.busy.collectAsStateWithLifecycle()
    val loaded by viewModel.loaded.collectAsStateWithLifecycle()
    val emailVerificationStatus by viewModel.emailVerificationStatus.collectAsStateWithLifecycle()

    var fullName by rememberSaveable { mutableStateOf("") }
    var email by rememberSaveable { mutableStateOf("") }
    var birthYear by rememberSaveable { mutableStateOf("") }
    var profilePhotoUri by rememberSaveable { mutableStateOf("") }

    // Seed from ViewModel on first load
    LaunchedEffect(savedFullName, savedEmail, savedBirthYear, savedPhotoUri) {
        if (fullName.isBlank()) fullName = savedFullName
        if (email.isBlank()) email = savedEmail
        if (birthYear.isBlank()) birthYear = savedBirthYear
        if (profilePhotoUri.isBlank()) profilePhotoUri = savedPhotoUri
    }

    val pickPhoto = rememberLauncherForActivityResult(ActivityResultContracts.GetContent()) { uri: Uri? ->
        uri?.let { viewModel.uploadProfilePhoto(it) { url -> if (url != null) profilePhotoUri = url } }
    }

    SellerProfileContent(
        phone = phone,
        loaded = loaded,
        busy = busy,
        savedEmail = savedEmail,
        emailVerificationStatus = emailVerificationStatus,
        fullName = fullName,
        email = email,
        birthYear = birthYear,
        profilePhotoUri = profilePhotoUri,
        onFullName = { fullName = it },
        onEmail = { email = it },
        onBirthYear = { birthYear = it },
        onProfilePhotoUri = { profilePhotoUri = it },
        onPickPhoto = { pickPhoto.launch("image/*") },
        onResendVerification = viewModel::resendEmailVerification,
        onSave = viewModel::save,
        onBack = onBack,
        onReauthenticate = onReauthenticate,
    )
}

/**
 * The seller's own profile, as a function of its state.
 *
 * [loaded] is the screen's loading state and it was missing: every field in the
 * view model seeds "" and the session snapshot is read in a suspend call, so the
 * form drew with a blank phone number — the seller's own, and the one read-only
 * identity on this page — and filled it in a beat later.
 */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun SellerProfileContent(
    phone: String,
    loaded: Boolean,
    busy: Boolean,
    savedEmail: String,
    emailVerificationStatus: String?,
    fullName: String,
    email: String,
    birthYear: String,
    profilePhotoUri: String,
    onFullName: (String) -> Unit,
    onEmail: (String) -> Unit,
    onBirthYear: (String) -> Unit,
    onProfilePhotoUri: (String) -> Unit,
    onPickPhoto: () -> Unit,
    onResendVerification: (() -> Unit) -> Unit,
    onSave: (String, String?, String?, String?, () -> Unit) -> Unit,
    onBack: () -> Unit,
    onReauthenticate: () -> Unit,
) {
    Scaffold(
        topBar = {
            TopAppBar(
                title = { Text(stringResource(R.string.seller_profile_title), modifier = Modifier.semantics { heading() }) },
                navigationIcon = {
                    IconButton(onClick = onBack) {
                        Icon(
                            Icons.AutoMirrored.Filled.ArrowBack,
                            contentDescription = stringResource(R.string.common_back),
                        )
                    }
                },
            )
        },
    ) { padding ->
        // The four editable fields are seeded from the snapshot on first read,
        // so drawing the form before it lands shows a blank phone number and
        // then swaps it in.
        if (!loaded) {
            FullScreenLoading(Modifier.padding(padding))
            return@Scaffold
        }
        Column(
            Modifier
                .fillMaxSize()
                .padding(padding)
                .padding(16.dp)
                .verticalScroll(rememberScrollState()),
            verticalArrangement = Arrangement.spacedBy(12.dp),
        ) {
            Text(
                stringResource(R.string.seller_profile_header),
                style = MaterialTheme.typography.bodySmall,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
            )

            OutlinedTextField(
                value = phone,
                onValueChange = {},
                label = { Text(stringResource(R.string.seller_profile_phone)) },
                enabled = false,
                singleLine = true,
                modifier = Modifier.fillMaxWidth(),
            )
            if (savedEmail.isNotBlank()) {
                OutlinedButton(
                    onClick = { onResendVerification(onReauthenticate) },
                    enabled = !busy,
                    modifier = Modifier.fillMaxWidth(),
                ) {
                    Text(stringResource(R.string.seller_profile_resend_verification))
                }
                emailVerificationStatus?.let { status ->
                    Text(
                        if (status == "sent") {
                            stringResource(R.string.seller_profile_verification_sent)
                        } else {
                            stringResource(R.string.seller_profile_verification_failed)
                        },
                        style = MaterialTheme.typography.bodySmall,
                        color = if (status == "sent") {
                            MaterialTheme.colorScheme.primary
                        } else {
                            MaterialTheme.colorScheme.error
                        },
                    )
                }
            }

            OutlinedTextField(
                value = fullName,
                onValueChange = { onFullName(it.take(80)) },
                label = { Text(stringResource(R.string.seller_profile_full_name)) },
                singleLine = true,
                modifier = Modifier.fillMaxWidth(),
            )
            OutlinedTextField(
                value = email,
                onValueChange = { onEmail(it.take(80)) },
                label = { Text(stringResource(R.string.seller_profile_email)) },
                singleLine = true,
                modifier = Modifier.fillMaxWidth(),
            )
            OutlinedTextField(
                value = birthYear,
                onValueChange = { v -> onBirthYear(v.filter(Char::isDigit).take(4)) },
                label = { Text(stringResource(R.string.seller_profile_birth_year)) },
                singleLine = true,
                modifier = Modifier.fillMaxWidth(),
            )

            Card(Modifier.fillMaxWidth()) {
                Column(Modifier.padding(12.dp)) {
                    Text(
                        stringResource(R.string.seller_profile_photo),
                        style = MaterialTheme.typography.titleMedium,
                    )
                    if (profilePhotoUri.isNotBlank()) {
                        Text(
                            stringResource(R.string.seller_profile_photo_set),
                            style = MaterialTheme.typography.bodySmall,
                            color = MaterialTheme.colorScheme.primary,
                        )
                    }
                    OutlinedButton(onClick = { onPickPhoto() }) {
                        Text(
                            if (profilePhotoUri.isBlank()) stringResource(R.string.setup_add_photo)
                            else stringResource(R.string.setup_change_photo),
                        )
                    }
                }
            }

            Spacer(Modifier.height(8.dp))
            Button(
                onClick = {
                    onSave(fullName, email, birthYear, profilePhotoUri, onBack)
                },
                enabled = !busy && fullName.isNotBlank(),
                modifier = Modifier.fillMaxWidth(),
            ) { Text(stringResource(R.string.settings_save)) }
        }
    }
}
