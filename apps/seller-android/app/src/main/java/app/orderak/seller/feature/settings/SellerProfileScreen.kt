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

    init {
        viewModelScope.launch {
            val snap = sessionStore.snapshot()
            _phone.value = snap.phone.orEmpty()
            _fullName.value = snap.fullName.orEmpty()
            _email.value = snap.email.orEmpty()
            _birthYear.value = snap.birthYear.orEmpty()
            _profilePhotoUri.value = snap.profilePhotoUri.orEmpty()
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
            val snap = sessionStore.snapshot()
            sessionStore.saveShop(
                name = snap.shopName.orEmpty(),
                category = snap.category.orEmpty(),
                city = snap.city.orEmpty(),
                countryIso = snap.countryIso ?: "EG",
                logoUri = snap.logoUri,
                fullName = fullName.trim(),
                email = email?.trim()?.ifBlank { null },
                birthYear = birthYear?.trim()?.ifBlank { null },
                profilePhotoUri = profilePhotoUri?.trim()?.ifBlank { null },
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
                    onClick = { viewModel.resendEmailVerification(onReauthenticate) },
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
                onValueChange = { fullName = it.take(80) },
                label = { Text(stringResource(R.string.seller_profile_full_name)) },
                singleLine = true,
                modifier = Modifier.fillMaxWidth(),
            )
            OutlinedTextField(
                value = email,
                onValueChange = { email = it.take(80) },
                label = { Text(stringResource(R.string.seller_profile_email)) },
                singleLine = true,
                modifier = Modifier.fillMaxWidth(),
            )
            OutlinedTextField(
                value = birthYear,
                onValueChange = { v -> birthYear = v.filter(Char::isDigit).take(4) },
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
                    OutlinedButton(onClick = { pickPhoto.launch("image/*") }) {
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
                    viewModel.save(
                        fullName = fullName,
                        email = email,
                        birthYear = birthYear,
                        profilePhotoUri = profilePhotoUri,
                        onDone = onBack,
                    )
                },
                enabled = !busy && fullName.isNotBlank(),
                modifier = Modifier.fillMaxWidth(),
            ) { Text(stringResource(R.string.settings_save)) }
        }
    }
}
