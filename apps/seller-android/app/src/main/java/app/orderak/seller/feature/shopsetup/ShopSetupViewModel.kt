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
import app.orderak.seller.data.remote.BusinessCategoryDto
import app.orderak.seller.data.remote.BusinessSubcategoryDto
import app.orderak.seller.data.remote.CityCatalogSuggestionDto
import app.orderak.seller.data.remote.OnboardingAccountReq
import app.orderak.seller.data.remote.OnboardingCompleteReq
import app.orderak.seller.data.session.SessionStore
import dagger.hilt.android.lifecycle.HiltViewModel
import java.text.Normalizer
import java.util.Calendar
import java.util.Locale
import java.util.TimeZone
import java.util.UUID
import javax.inject.Inject
import kotlinx.coroutines.Job
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch

enum class SlugAvailability { IDLE, CHECKING, AVAILABLE, TAKEN, INVALID, OFFLINE }

internal fun accountValidationError(state: ShopSetupUiState): String? = when {
    state.fullName.trim().length !in 3..80 -> "invalid_full_name"
    state.birthYear !in 1900..currentUtcYear() -> "invalid_birth_year"
    !state.emailValid -> "invalid_email"
    else -> null
}

@Immutable
data class ShopSetupUiState(
    val step: Int = 1,
    val fullName: String = "",
    val birthYear: Int? = null,
    val email: String = "",
    val name: String = "",
    val slug: String = "",
    val slugAvailability: SlugAvailability = SlugAvailability.IDLE,
    val country: Country = Countries.default,
    val language: String = "en",
    val taxonomyVersion: Int? = null,
    val categories: List<BusinessCategoryDto> = emptyList(),
    val categoryId: String? = null,
    val categoryKey: String? = null,
    val categoryName: String? = null,
    val subcategories: List<BusinessSubcategoryDto> = emptyList(),
    val subcategoryId: String? = null,
    val subcategoryName: String? = null,
    val subcategoryQuery: String = "",
    val taxonomyLoading: Boolean = false,
    val taxonomyError: Boolean = false,
    val city: String = "",
    val cityCatalogId: Long? = null,
    val citySuggestions: List<CityCatalogSuggestionDto> = emptyList(),
    val citySearching: Boolean = false,
    val cityError: Boolean = false,
    val cityManualEntry: Boolean = false,
    val saving: Boolean = false,
    val error: String? = null,
    val reauthenticationRequired: Boolean = false,
    val completed: Boolean = false,
    val showPasskeyInvite: Boolean = false,
    val passkeyCreating: Boolean = false,
) {
    val emailValid: Boolean
        get() = email.isBlank() || EMAIL_PATTERN.matches(email.trim())
    val canContinueAccount: Boolean
        get() = fullName.trim().length in 3..80 &&
            birthYear in 1900..currentUtcYear() &&
            emailValid
    val canFinishStore: Boolean
        get() = name.trim().length in 2..60 &&
            SLUG_PATTERN.matches(slug) &&
            slugAvailability == SlugAvailability.AVAILABLE &&
            !categoryId.isNullOrBlank() &&
            country.iso.length == 2 &&
            city.trim().length >= 2

    companion object {
        private val EMAIL_PATTERN = Regex("^[^\\s@]+@[^\\s@]+\\.[^\\s@]+$")
        private val SLUG_PATTERN = Regex("^[a-z0-9]+(?:-[a-z0-9]+)*$")
    }
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
    private var slugJob: Job? = null
    private var cityJob: Job? = null
    private var subcategoryJob: Job? = null
    private val idempotencyKey = UUID.randomUUID().toString()

    init {
        viewModelScope.launch {
            val saved = sessionStore.snapshot()
            val country = Countries.byIso(saved.countryIso)
            val currentLanguage = _state.value.language
            val restoredSlug = saved.slug?.takeIf(String::isNotBlank)
                ?: saved.shopName?.let(::onboardingSlugify).orEmpty()
            _state.value = ShopSetupUiState(
                step = saved.onboardingStep,
                fullName = saved.fullName.orEmpty(),
                birthYear = saved.birthYear?.toIntOrNull()?.takeIf { it in 1900..currentUtcYear() },
                email = saved.email.orEmpty(),
                name = saved.shopName.orEmpty(),
                slug = restoredSlug,
                categoryId = saved.businessCategoryId,
                categoryKey = saved.category,
                categoryName = saved.businessCategoryName,
                subcategoryId = saved.businessSubcategoryId,
                subcategoryName = saved.businessSubcategoryName,
                taxonomyVersion = saved.businessTaxonomyVersion,
                country = country,
                language = currentLanguage,
                city = saved.city.orEmpty(),
                cityCatalogId = saved.cityCatalogId,
                cityManualEntry = saved.cityCatalogId == null && !saved.city.isNullOrBlank(),
            )
            if (restoredSlug.isNotBlank()) checkSlug()
            loadCategories()
        }
    }

    fun onLocaleChanged(locale: Locale) {
        val language = locale.language.takeIf { it in setOf("ar", "en", "fr") } ?: "en"
        val localizedCountry = Countries.localized(_state.value.country, locale)
        if (language == _state.value.language && localizedCountry.name == _state.value.country.name) return
        _state.update { it.copy(language = language, country = localizedCountry) }
        loadCategories()
    }

    fun onFullNameChanged(value: String) = updateDraft {
        it.copy(fullName = value.take(80), error = null)
    }

    fun onBirthYearChanged(value: Int) {
        if (value !in 1900..currentUtcYear()) return
        updateDraft { it.copy(birthYear = value, error = null) }
    }

    fun onEmailChanged(value: String) = updateDraft {
        it.copy(email = value.take(254), error = null)
    }

    fun onNameChanged(value: String) {
        _state.update {
            val cleanName = value.take(60)
            it.copy(name = cleanName, slug = onboardingSlugify(cleanName), error = null)
        }
        scheduleDraft()
        checkSlug()
    }

    fun retryTaxonomy() = loadCategories()

    fun onCategorySelected(category: BusinessCategoryDto) {
        _state.update {
            it.copy(
                categoryId = category.id,
                categoryKey = category.key,
                categoryName = category.name,
                taxonomyVersion = category.version,
                subcategoryId = null,
                subcategoryName = null,
                subcategoryQuery = "",
                subcategories = emptyList(),
                taxonomyError = false,
                error = null,
            )
        }
        scheduleDraft()
    }

    fun onSubcategoryQueryChanged(value: String) {
        _state.update { it.copy(subcategoryQuery = value.take(80)) }
        val categoryId = _state.value.categoryId ?: return
        loadSubcategories(categoryId, value)
    }

    fun onSubcategorySelected(subcategory: BusinessSubcategoryDto) {
        _state.update {
            it.copy(
                subcategoryId = subcategory.id,
                subcategoryName = subcategory.name,
                taxonomyVersion = subcategory.version,
                subcategoryQuery = "",
                taxonomyError = false,
                error = null,
            )
        }
        scheduleDraft()
    }

    fun onCityChanged(value: String) {
        _state.update {
            it.copy(
                city = value.take(100),
                cityCatalogId = null,
                cityManualEntry = false,
                cityError = false,
                error = null,
            )
        }
        scheduleDraft()
        searchCities(value)
    }

    fun useManualCity() {
        cityJob?.cancel()
        _state.update {
            it.copy(
                cityCatalogId = null,
                citySuggestions = emptyList(),
                citySearching = false,
                cityError = false,
                cityManualEntry = true,
            )
        }
        scheduleDraft()
    }

    fun retryCitySearch() = searchCities(_state.value.city)

    fun onCitySelected(suggestion: CityCatalogSuggestionDto) {
        val token = sessionStore.readOnboardingToken() ?: return
        viewModelScope.launch {
            _state.update { it.copy(citySearching = true, cityError = false) }
            val response = backendApi.selectCatalogCity(
                token,
                suggestion.city_id,
                _state.value.language,
            )
            val city = response.city
            if (response.ok && city != null) {
                _state.update {
                    it.copy(
                        city = city.name,
                        cityCatalogId = city.city_id,
                        citySuggestions = emptyList(),
                        citySearching = false,
                        cityManualEntry = false,
                        cityError = false,
                    )
                }
                scheduleDraft()
            } else {
                _state.update { it.copy(citySearching = false, cityError = true) }
            }
        }
    }

    fun next() {
        val current = _state.value
        if (current.saving) return
        accountValidationError(current)?.let { validationError ->
            _state.update { it.copy(error = validationError) }
            return
        }
        val token = sessionStore.readOnboardingToken()
        if (token.isNullOrBlank()) {
            _state.update { it.copy(reauthenticationRequired = true, error = "onboarding_expired") }
            return
        }
        _state.update { it.copy(saving = true, error = null) }
        viewModelScope.launch {
            val response = backendApi.saveOnboardingAccount(
                token,
                OnboardingAccountReq(
                    full_name = current.fullName.trim(),
                    birth_year = requireNotNull(current.birthYear),
                    email = current.email.trim().ifBlank { null },
                    terms_accepted = true,
                    app_version = BuildConfig.VERSION_NAME,
                ),
            )
            when {
                response.ok -> {
                    saveDraft(current, 2)
                    _state.update { it.copy(step = 2, saving = false) }
                }
                response.error in setOf("onboarding_expired", "onboarding_auth") ->
                    _state.update { it.copy(saving = false, reauthenticationRequired = true, error = response.error) }
                else -> _state.update { it.copy(saving = false, error = response.error ?: "network") }
            }
        }
    }

    fun back() {
        val current = _state.value
        _state.update { it.copy(step = 1, error = null) }
        viewModelScope.launch { saveDraft(current, 1) }
    }

    fun finish() {
        val current = _state.value
        if (!current.canFinishStore || current.saving) return
        val token = sessionStore.readOnboardingToken()
        if (token.isNullOrBlank()) {
            _state.update { it.copy(reauthenticationRequired = true, error = "onboarding_expired") }
            return
        }
        _state.update { it.copy(saving = true, error = null) }
        viewModelScope.launch {
            val response = backendApi.completeOnboarding(
                token,
                idempotencyKey,
                OnboardingCompleteReq(
                    device_secret = sessionStore.getOrCreateSecret(),
                    store_name = current.name.trim(),
                    slug = current.slug,
                    business_category = current.categoryKey.orEmpty(),
                    business_category_id = requireNotNull(current.categoryId),
                    business_subcategory_id = null,
                    country_iso = current.country.iso,
                    city_catalog_id = current.cityCatalogId,
                    city_name = current.city.trim(),
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
                        category = store.business_category ?: current.categoryKey.orEmpty(),
                        city = store.city_name ?: current.city.trim(),
                        countryIso = store.country_code ?: current.country.iso,
                        logoUri = null,
                        fullName = current.fullName.trim(),
                        email = current.email.trim().ifBlank { null },
                        birthYear = current.birthYear?.toString(),
                        profilePhotoUri = null,
                        cityCatalogId = store.city_catalog_id ?: current.cityCatalogId,
                        businessCategoryId = store.business_category_id ?: current.categoryId,
                        businessCategoryName = current.categoryName,
                        businessSubcategoryId = store.business_subcategory_id,
                        businessSubcategoryName = null,
                        businessTaxonomyVersion = store.business_taxonomy_version ?: current.taxonomyVersion,
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
                        it.copy(saving = false, completed = true, showPasskeyInvite = showPasskeyInvite)
                    }
                }
                response.error in setOf("onboarding_expired", "onboarding_auth") ->
                    _state.update { it.copy(saving = false, reauthenticationRequired = true, error = response.error) }
                response.error == "slug_taken" ->
                    _state.update {
                        it.copy(saving = false, slugAvailability = SlugAvailability.TAKEN, error = "slug_taken")
                    }
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

    private fun loadCategories() {
        viewModelScope.launch {
            _state.update { it.copy(taxonomyLoading = true, taxonomyError = false) }
            val response = backendApi.listBusinessCategories(_state.value.language)
            if (response.ok) {
                val selected = response.categories.firstOrNull { it.id == _state.value.categoryId }
                _state.update {
                    it.copy(
                        taxonomyVersion = response.version ?: it.taxonomyVersion,
                        categories = response.categories,
                        categoryName = selected?.name ?: it.categoryName,
                        taxonomyLoading = false,
                    )
                }
                _state.value.categoryId?.let(::loadSubcategories)
            } else {
                _state.update { it.copy(taxonomyLoading = false, taxonomyError = true) }
            }
        }
    }

    private fun loadSubcategories(categoryId: String, query: String = "") {
        subcategoryJob?.cancel()
        subcategoryJob = viewModelScope.launch {
            delay(if (query.isBlank()) 0 else 250)
            _state.update { it.copy(taxonomyLoading = true, taxonomyError = false) }
            val response = backendApi.listBusinessSubcategories(categoryId, query, _state.value.language)
            if (response.ok && _state.value.categoryId == categoryId) {
                val selected = response.subcategories.firstOrNull { it.id == _state.value.subcategoryId }
                _state.update {
                    it.copy(
                        subcategories = response.subcategories,
                        subcategoryName = selected?.name ?: it.subcategoryName,
                        taxonomyLoading = false,
                    )
                }
            } else if (_state.value.categoryId == categoryId) {
                _state.update { it.copy(taxonomyLoading = false, taxonomyError = true) }
            }
        }
    }

    private fun checkSlug() {
        slugJob?.cancel()
        slugJob = viewModelScope.launch {
            val slug = _state.value.slug
            if (slug.length !in 3..40) {
                _state.update { it.copy(slugAvailability = SlugAvailability.INVALID) }
                return@launch
            }
            _state.update { it.copy(slugAvailability = SlugAvailability.CHECKING) }
            delay(450)
            val token = sessionStore.readOnboardingToken()
            if (token.isNullOrBlank()) {
                _state.update { it.copy(slugAvailability = SlugAvailability.OFFLINE) }
                return@launch
            }
            val response = backendApi.checkOnboardingSlug(token, slug)
            _state.update {
                it.copy(
                    slugAvailability = when {
                        response.error != null -> SlugAvailability.OFFLINE
                        !response.valid -> SlugAvailability.INVALID
                        response.available -> SlugAvailability.AVAILABLE
                        else -> SlugAvailability.TAKEN
                    },
                )
            }
        }
    }

    private fun searchCities(query: String) {
        cityJob?.cancel()
        cityJob = viewModelScope.launch {
            if (query.isNotBlank()) delay(350)
            val token = sessionStore.readOnboardingToken()
            if (token.isNullOrBlank()) {
                _state.update { it.copy(citySearching = false, cityError = true) }
                return@launch
            }
            _state.update { it.copy(citySearching = true, cityError = false) }
            val response = backendApi.searchCityCatalog(
                token,
                _state.value.language,
                query.trim(),
            )
            if (response.ok) {
                _state.update {
                    it.copy(
                        citySuggestions = response.cities.take(10),
                        citySearching = false,
                        cityError = false,
                    )
                }
            } else {
                _state.update {
                    it.copy(citySuggestions = emptyList(), citySearching = false, cityError = true)
                }
            }
        }
    }

    private fun updateDraft(transform: (ShopSetupUiState) -> ShopSetupUiState) {
        _state.update(transform)
        scheduleDraft()
    }

    private fun scheduleDraft() {
        draftJob?.cancel()
        draftJob = viewModelScope.launch {
            delay(350)
            saveDraft(_state.value, _state.value.step)
        }
    }

    private suspend fun saveDraft(state: ShopSetupUiState, step: Int) {
        sessionStore.saveOnboardingDraft(
            step = step,
            name = state.name,
            category = state.categoryKey,
            city = state.city,
            countryIso = state.country.iso,
            logoUri = null,
            fullName = state.fullName,
            email = state.email.ifBlank { null },
            birthYear = state.birthYear?.toString(),
            profilePhotoUri = null,
            slug = state.slug,
            cityCatalogId = state.cityCatalogId,
            businessCategoryId = state.categoryId,
            businessCategoryName = state.categoryName,
            businessSubcategoryId = state.subcategoryId,
            businessSubcategoryName = state.subcategoryName,
            businessTaxonomyVersion = state.taxonomyVersion,
        )
    }
}

internal fun currentUtcYear(): Int =
    Calendar.getInstance(TimeZone.getTimeZone("UTC")).get(Calendar.YEAR)

private val ARABIC_TRANSLITERATION = mapOf(
    'ا' to "a", 'أ' to "a", 'إ' to "e", 'آ' to "a", 'ب' to "b",
    'ت' to "t", 'ث' to "th", 'ج' to "j", 'ح' to "h", 'خ' to "kh",
    'د' to "d", 'ذ' to "dh", 'ر' to "r", 'ز' to "z", 'س' to "s",
    'ش' to "sh", 'ص' to "s", 'ض' to "d", 'ط' to "t", 'ظ' to "z",
    'ع' to "a", 'غ' to "gh", 'ف' to "f", 'ق' to "q", 'ك' to "k",
    'ل' to "l", 'م' to "m", 'ن' to "n", 'ه' to "h", 'و' to "w",
    'ي' to "y", 'ى' to "a", 'ة' to "a",
)

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
