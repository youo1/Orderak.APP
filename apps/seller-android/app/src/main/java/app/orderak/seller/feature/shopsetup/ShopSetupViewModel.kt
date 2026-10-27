package app.orderak.seller.feature.shopsetup

import android.app.Activity
import android.os.Build
import androidx.compose.runtime.Immutable
import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import app.orderak.seller.BuildConfig
import app.orderak.seller.core.phone.Countries
import app.orderak.seller.core.phone.Country
import app.orderak.seller.data.auth.PasskeyClient
import app.orderak.seller.data.auth.PasskeyResult
import app.orderak.seller.data.remote.BackendApi
import app.orderak.seller.data.remote.OnboardingAccountReq
import app.orderak.seller.data.remote.OnboardingCompleteReq
import app.orderak.seller.data.session.SessionStore
import dagger.hilt.android.lifecycle.HiltViewModel
import java.text.Normalizer
import java.util.Locale
import java.util.UUID
import javax.inject.Inject
import kotlinx.coroutines.Job
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch

/**
 * What the one-step setup needs before it can create the store: the shop's name, the seller's
 * full name and the affirmation that they are 18 or older. Everything else (a first product, a
 * payment method, the city and the business type) can wait and is offered afterwards.
 */
internal fun accountValidationError(state: ShopSetupUiState): String? = when {
    state.fullName.trim().length !in 3..80 -> "invalid_full_name"
    !state.ageConfirmed -> "age_confirmation_required"
    else -> null
}

@Immutable
data class ShopSetupUiState(
    val fullName: String = "",
    /**
     * The seller's affirmation that they are 18 or older. Never stored on the device: it must be
     * given afresh each time, and the server records the exact statement shown.
     */
    val ageConfirmed: Boolean = false,
    val name: String = "",
    val country: Country = Countries.default,
    val saving: Boolean = false,
    val error: String? = null,
    val reauthenticationRequired: Boolean = false,
    /** The store exists; the page is now the ready screen. */
    val completed: Boolean = false,
    /** The full public link, once the store has one. */
    val storeUrl: String? = null,
    val showPasskeyInvite: Boolean = false,
    val passkeyCreating: Boolean = false,
) {
    /** What a seller can press: names long enough, and the affirmation given. */
    val canCreate: Boolean
        get() = name.trim().length in 2..60 &&
            fullName.trim().length in 3..80 &&
            ageConfirmed &&
            country.iso.length == 2
}

@HiltViewModel
class ShopSetupViewModel @Inject constructor(
    private val sessionStore: SessionStore,
    private val backendApi: BackendApi,
    private val passkeyClient: PasskeyClient,
) : ViewModel() {
    private val _state = MutableStateFlow(ShopSetupUiState())
    val state: StateFlow<ShopSetupUiState> = _state.asStateFlow()
    private var draftJob: Job? = null
    private val idempotencyKey = UUID.randomUUID().toString()

    /** The account step reached the server; a retry after a failed store creation skips it. */
    private var accountSaved = false

    init {
        viewModelScope.launch {
            val saved = sessionStore.snapshot()
            _state.update {
                it.copy(
                    fullName = saved.fullName.orEmpty(),
                    name = saved.shopName.orEmpty(),
                    country = Countries.byIso(saved.countryIso),
                )
            }
        }
    }

    fun onLocaleChanged(locale: Locale) {
        val localizedCountry = Countries.localized(_state.value.country, locale)
        if (localizedCountry.name == _state.value.country.name) return
        _state.update { it.copy(country = localizedCountry) }
    }

    fun onFullNameChanged(value: String) = updateDraft { it.copy(fullName = value.take(80), error = null) }

    fun onAgeConfirmedChanged(value: Boolean) = _state.update { it.copy(ageConfirmed = value, error = null) }

    fun onNameChanged(value: String) = updateDraft { it.copy(name = value.take(60), error = null) }

    /**
     * Creates the store: saves the account step, then creates the store, behind one button.
     *
     * Whatever was typed is kept if either call fails. The server derives a unique link from the
     * name and the store's permanent code, so there is no "name taken" outcome here.
     */
    fun create() {
        val current = _state.value
        if (current.saving) return
        accountValidationError(current)?.let { validationError ->
            _state.update { it.copy(error = validationError) }
            return
        }
        if (!current.canCreate) return
        val token = sessionStore.readOnboardingToken()
        if (token.isNullOrBlank()) {
            _state.update { it.copy(reauthenticationRequired = true, error = "onboarding_expired") }
            return
        }
        _state.update { it.copy(saving = true, error = null) }
        viewModelScope.launch {
            if (!accountSaved) {
                val account = backendApi.saveOnboardingAccount(
                    token,
                    OnboardingAccountReq(
                        full_name = current.fullName.trim(),
                        age_confirmed = true,
                        terms_accepted = true,
                        app_version = BuildConfig.VERSION_NAME,
                    ),
                )
                when {
                    account.ok -> accountSaved = true
                    account.error in EXPIRED -> {
                        _state.update { it.copy(saving = false, reauthenticationRequired = true, error = account.error) }
                        return@launch
                    }
                    else -> {
                        _state.update { it.copy(saving = false, error = account.error ?: "network") }
                        return@launch
                    }
                }
            }
            val response = backendApi.completeOnboarding(
                token,
                idempotencyKey,
                OnboardingCompleteReq(
                    device_secret = sessionStore.getOrCreateSecret(),
                    store_name = current.name.trim(),
                    country_iso = current.country.iso,
                ),
            )
            when {
                response.ok && response.store != null -> {
                    val store = response.store
                    val showPasskeyInvite = Build.VERSION.SDK_INT >= Build.VERSION_CODES.P &&
                        response.passkey_registration_available &&
                        sessionStore.readOnboardingPasskeyOptIn()
                    sessionStore.saveShop(
                        name = store.store_name ?: current.name.trim(),
                        category = store.business_category.orEmpty(),
                        city = store.city_name.orEmpty(),
                        countryIso = store.country_code ?: current.country.iso,
                        logoUri = null,
                        fullName = current.fullName.trim(),
                        email = null,
                        birthYear = null,
                        profilePhotoUri = null,
                        cityCatalogId = store.city_catalog_id,
                        businessCategoryId = store.business_category_id,
                        businessCategoryName = null,
                        businessSubcategoryId = store.business_subcategory_id,
                        businessSubcategoryName = null,
                        businessTaxonomyVersion = store.business_taxonomy_version,
                    )
                    sessionStore.saveStoreIdentity(
                        store.slug,
                        store.public_identifier,
                        store.store_code,
                        store.country_code,
                        store.store_url,
                    )
                    response.recent_auth_token?.let {
                        sessionStore.saveRecentAuth(it, response.recent_auth_expires_at)
                    }
                    sessionStore.markRegistered()
                    sessionStore.markOnboardingComplete()
                    sessionStore.clearOnboardingToken()
                    sessionStore.clearOnboardingPasskeyOptIn()
                    _state.update {
                        it.copy(
                            saving = false,
                            completed = true,
                            storeUrl = store.store_url,
                            showPasskeyInvite = showPasskeyInvite,
                        )
                    }
                }
                response.error in EXPIRED ->
                    _state.update { it.copy(saving = false, reauthenticationRequired = true, error = response.error) }
                else -> _state.update { it.copy(saving = false, error = response.error ?: "network") }
            }
        }
    }

    fun skipPasskey() = _state.update { it.copy(showPasskeyInvite = false) }

    fun createPasskey(activity: Activity) {
        val current = _state.value
        if (!current.completed || current.passkeyCreating) return
        viewModelScope.launch {
            _state.update { it.copy(passkeyCreating = true, error = null) }
            val snapshot = sessionStore.snapshot()
            val phone = snapshot.phone
            val secret = sessionStore.readExistingSecret()
            val recent = sessionStore.readRecentAuthToken()
            if (phone.isNullOrBlank() || secret.isNullOrBlank() || recent.isNullOrBlank()) {
                _state.update { it.copy(passkeyCreating = false, error = "passkey_failed") }
                return@launch
            }
            val options = backendApi.passkeyRegistrationOptions(phone, secret, recent)
            if (!options.ok || options.options_json.isNullOrBlank() || options.challenge_id.isNullOrBlank()) {
                _state.update { it.copy(passkeyCreating = false, error = options.error ?: "passkey_failed") }
                return@launch
            }
            when (val result = passkeyClient.register(activity, options.options_json)) {
                PasskeyResult.Cancelled -> _state.update { it.copy(passkeyCreating = false) }
                PasskeyResult.Unavailable -> _state.update {
                    it.copy(passkeyCreating = false, error = "passkey_unavailable")
                }
                is PasskeyResult.Failed -> _state.update {
                    it.copy(passkeyCreating = false, error = "passkey_failed")
                }
                is PasskeyResult.Success -> {
                    val completed = backendApi.completePasskeyRegistration(
                        phone,
                        secret,
                        recent,
                        options.challenge_id,
                        result.responseJson,
                        Build.MODEL?.take(60),
                    )
                    _state.update {
                        it.copy(
                            passkeyCreating = false,
                            showPasskeyInvite = !completed.ok,
                            error = completed.error,
                        )
                    }
                }
            }
        }
    }

    private fun updateDraft(transform: (ShopSetupUiState) -> ShopSetupUiState) {
        _state.update(transform)
        draftJob?.cancel()
        draftJob = viewModelScope.launch {
            delay(350)
            saveDraft(_state.value)
        }
    }

    /** The draft is the names and the country; the affirmation is deliberately not kept. */
    private suspend fun saveDraft(state: ShopSetupUiState) {
        sessionStore.saveOnboardingDraft(
            step = 1,
            name = state.name,
            category = null,
            city = "",
            countryIso = state.country.iso,
            logoUri = null,
            fullName = state.fullName,
            email = null,
            birthYear = null,
            profilePhotoUri = null,
            slug = null,
        )
    }

    private companion object {
        val EXPIRED = setOf("onboarding_expired", "onboarding_auth")
    }
}

private val ARABIC_TRANSLITERATION = mapOf(
    'ا' to "a", 'أ' to "a", 'إ' to "e", 'آ' to "a", 'ب' to "b",
    'ت' to "t", 'ث' to "th", 'ج' to "j", 'ح' to "h", 'خ' to "kh",
    'د' to "d", 'ذ' to "dh", 'ر' to "r", 'ز' to "z", 'س' to "s",
    'ش' to "sh", 'ص' to "s", 'ض' to "d", 'ط' to "t", 'ظ' to "z",
    'ع' to "a", 'غ' to "gh", 'ف' to "f", 'ق' to "q", 'ك' to "k",
    'ل' to "l", 'م' to "m", 'ن' to "n", 'ه' to "h", 'و' to "w",
    'ي' to "y", 'ى' to "a", 'ة' to "a",
)

/** The shop name as the link will show it. Only a preview: the server makes the real, unique one. */
internal fun onboardingSlugify(value: String): String {
    val transliterated = buildString {
        value.forEach { append(ARABIC_TRANSLITERATION[it] ?: it) }
    }
    return Normalizer.normalize(transliterated, Normalizer.Form.NFKD)
        .replace(Regex("[\\u0300-\\u036f]"), "")
        .lowercase(Locale.ROOT)
        .trim()
        .replace(Regex("[\\s_]+"), "-")
        .replace(Regex("[^a-z0-9-]"), "")
        .replace(Regex("-+"), "-")
        .trim('-')
        .take(40)
        .trimEnd('-')
}
