package app.orderak.seller.feature.auth

import android.app.Activity
import android.content.Context
import android.os.Build
import android.util.Log
import androidx.lifecycle.SavedStateHandle
import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import app.orderak.seller.core.phone.Countries
import app.orderak.seller.core.phone.Country
import app.orderak.seller.data.auth.AuthFailure
import app.orderak.seller.data.auth.AuthFailureException
import app.orderak.seller.data.auth.AuthRepository
import app.orderak.seller.data.auth.InvalidOtpException
import app.orderak.seller.data.auth.OtpSendOutcome
import app.orderak.seller.data.auth.PasskeyClient
import app.orderak.seller.data.auth.PasskeyResult
import app.orderak.seller.data.remote.AuthCompleteRes
import app.orderak.seller.data.remote.BackendApi
import app.orderak.seller.data.remote.PhoneCompleteReq
import app.orderak.seller.data.remote.StoreDto
import app.orderak.seller.data.session.SessionStore
import dagger.hilt.android.lifecycle.HiltViewModel
import dagger.hilt.android.qualifiers.ApplicationContext
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.Job
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.launch
import javax.inject.Inject

@HiltViewModel
class AuthViewModel @Inject constructor(
    private val authRepository: AuthRepository,
    private val sessionStore: SessionStore,
    private val backendApi: BackendApi,
    private val passkeyClient: PasskeyClient,
    private val savedStateHandle: SavedStateHandle,
    @param:ApplicationContext private val appContext: Context,
) : ViewModel() {

    private val _state = MutableStateFlow<AuthUiState>(AuthUiState.Welcome())
    val state: StateFlow<AuthUiState> = _state.asStateFlow()
    private var countdownJob: Job? = null
    private val authOperations = AuthOperationController()

    fun dispatch(event: AuthEvent) {
        when (event) {
            AuthEvent.StartPhone -> startPhone()
            AuthEvent.BackToWelcome -> backToWelcome()
            is AuthEvent.CountrySelected -> onCountrySelected(event.country)
            is AuthEvent.PhoneChanged -> onPhoneChanged(event.text)
            AuthEvent.RequestOtp -> requestOtp()
            is AuthEvent.CodeChanged -> onCodeChanged(event.text)
            AuthEvent.VerifyOtp -> submitOtp()
            AuthEvent.ResendOtp -> resendOtp()
            AuthEvent.ChangeNumber -> changeNumber()
            AuthEvent.SkipPasskey -> skipPasskey()
        }
    }

    fun signInWithPasskey(activity: Activity) {
        val current = _state.value as? AuthUiState.Welcome ?: return
        if (current.isPasskeyLoading) return
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.P) {
            _state.value = current.copy(showOtpFallback = true, error = AuthError.PASSKEY_UNAVAILABLE)
            return
        }
        _state.value = current.copy(isPasskeyLoading = true, error = null)
        launchAuthOperation(
            onUnexpectedFailure = {
                _state.value = current.copy(
                    showOtpFallback = true,
                    error = AuthError.PASSKEY_FAILED,
                )
            },
        ) { operation ->
            val options = backendApi.passkeyAuthenticationOptions()
            if (!authOperations.isCurrent(operation)) return@launchAuthOperation
            if (!options.ok || options.challenge_id.isNullOrBlank() || options.options_json.isNullOrBlank()) {
                _state.value = current.copy(
                    showOtpFallback = true,
                    error = if (options.error == "feature_disabled") AuthError.SERVICE_UNAVAILABLE else AuthError.PASSKEY_FAILED,
                )
                return@launchAuthOperation
            }
            val result = passkeyClient.authenticate(activity, options.options_json)
            if (!authOperations.isCurrent(operation)) return@launchAuthOperation
            when (result) {
                PasskeyResult.Cancelled -> _state.value = AuthUiState.Welcome()
                PasskeyResult.Unavailable -> _state.value = AuthUiState.Welcome(
                    showOtpFallback = true,
                    error = AuthError.PASSKEY_UNAVAILABLE,
                )
                is PasskeyResult.Failed -> {
                    Log.w(TAG, "Passkey authentication failed")
                    if (authOperations.isCurrent(operation)) {
                        _state.value = AuthUiState.Welcome(
                            showOtpFallback = true,
                            error = AuthError.PASSKEY_FAILED,
                        )
                    }
                }
                is PasskeyResult.Success -> completePasskeyAuthentication(
                    operation = operation,
                    challengeId = options.challenge_id,
                    responseJson = result.responseJson,
                )
            }
        }
    }

    fun createPasskey(activity: Activity) {
        val current = _state.value as? AuthUiState.PasskeyInvite ?: return
        if (current.isCreating) return
        if (current.deferredForOnboarding) {
            launchAuthOperation(
                onUnexpectedFailure = {
                    _state.value = current.copy(isCreating = false, error = AuthError.PASSKEY_FAILED)
                },
            ) { operation ->
                sessionStore.saveOnboardingPasskeyOptIn(true)
                if (authOperations.isCurrent(operation)) {
                    _state.value = AuthUiState.Success(isNewSeller = true)
                }
            }
            return
        }
        _state.value = current.copy(isCreating = true, error = null)
        launchAuthOperation(
            onUnexpectedFailure = {
                _state.value = current.copy(isCreating = false, error = AuthError.PASSKEY_FAILED)
            },
        ) { operation ->
            val snapshot = sessionStore.snapshot()
            val phone = snapshot.phone
            val secret = sessionStore.readExistingSecret()
            val recentAuth = sessionStore.readRecentAuthToken()
            if (!authOperations.isCurrent(operation)) return@launchAuthOperation
            if (phone.isNullOrBlank() || secret.isNullOrBlank() || recentAuth.isNullOrBlank()) {
                _state.value = current.copy(error = AuthError.PASSKEY_FAILED)
                return@launchAuthOperation
            }
            val options = backendApi.passkeyRegistrationOptions(phone, secret, recentAuth)
            if (!authOperations.isCurrent(operation)) return@launchAuthOperation
            if (!options.ok || options.challenge_id.isNullOrBlank() || options.options_json.isNullOrBlank()) {
                _state.value = current.copy(error = AuthError.PASSKEY_FAILED)
                return@launchAuthOperation
            }
            val result = passkeyClient.register(activity, options.options_json)
            if (!authOperations.isCurrent(operation)) return@launchAuthOperation
            when (result) {
                PasskeyResult.Cancelled -> {
                    if (authOperations.isCurrent(operation)) _state.value = current
                }
                PasskeyResult.Unavailable -> _state.value = current.copy(error = AuthError.PASSKEY_UNAVAILABLE)
                is PasskeyResult.Failed -> {
                    Log.w(TAG, "Passkey registration failed")
                    if (authOperations.isCurrent(operation)) {
                        _state.value = current.copy(error = AuthError.PASSKEY_FAILED)
                    }
                }
                is PasskeyResult.Success -> {
                    val completed = backendApi.completePasskeyRegistration(
                        phone = phone,
                        secret = secret,
                        recentAuthToken = recentAuth,
                        challengeId = options.challenge_id,
                        responseJson = result.responseJson,
                        label = Build.MODEL?.take(60),
                    )
                    if (authOperations.isCurrent(operation)) {
                        _state.value = if (completed.ok) {
                            AuthUiState.Success(isNewSeller = false)
                        } else {
                            current.copy(error = AuthError.PASSKEY_FAILED)
                        }
                    }
                }
            }
        }
    }

    private fun startPhone() {
        invalidateAuthOperations()
        _state.value = restoredPhone()
    }

    private fun restoredPhone(): AuthUiState.EnterPhone {
        val savedIso: String? = savedStateHandle[KEY_ISO]
        val country = if (savedIso.isNullOrBlank()) {
            Countries.defaultFor(appContext)
        } else {
            Countries.byIso(savedIso)
        }
        val phone: String = savedStateHandle[KEY_PHONE] ?: ""
        return AuthUiState.EnterPhone(
            country = country,
            phone = phone,
            isValid = Countries.isValid(country, phone) && Countries.isSupported(country),
        )
    }

    private fun backToWelcome() {
        invalidateAuthOperations()
        countdownJob?.cancel()
        authRepository.clearOtpSession()
        _state.value = AuthUiState.Welcome()
    }

    private fun onCountrySelected(country: Country) {
        val current = _state.value as? AuthUiState.EnterPhone ?: return
        if (current.isSending) return
        savedStateHandle[KEY_ISO] = country.iso
        _state.value = current.copy(
            country = country,
            isValid = Countries.isValid(country, current.phone) && Countries.isSupported(country),
            error = null,
        )
    }

    private fun onPhoneChanged(raw: String) {
        val current = _state.value as? AuthUiState.EnterPhone ?: return
        if (current.isSending) return
        val phone = raw.filter(Char::isDigit).take(MAX_NATIONAL_LEN)
        savedStateHandle[KEY_PHONE] = phone
        _state.value = current.copy(
            phone = phone,
            isValid = Countries.isValid(current.country, phone) && Countries.isSupported(current.country),
            error = null,
        )
    }

    private fun requestOtp() {
        val current = _state.value as? AuthUiState.EnterPhone ?: return
        if (!Countries.isSupported(current.country)) {
            _state.value = current.copy(error = AuthError.UNSUPPORTED_COUNTRY)
            return
        }
        val e164 = Countries.toE164(current.country, current.phone)
        if (!current.isValid || e164 == null) {
            _state.value = current.copy(error = AuthError.INVALID_PHONE)
            return
        }
        _state.value = current.copy(isSending = true, error = null)
        launchAuthOperation(
            onUnexpectedFailure = {
                _state.value = current.copy(isSending = false, error = AuthError.GENERIC)
            },
        ) { operation ->
            authRepository.sendSmsOtp(e164)
                .onSuccess { outcome ->
                    if (!authOperations.isCurrent(operation)) return@onSuccess
                    when (outcome) {
                        OtpSendOutcome.AUTO_SIGNED_IN -> completePhoneSignIn(e164, operation)
                        OtpSendOutcome.CODE_SENT -> enterOtp(
                            e164 = e164,
                            country = current.country,
                            phone = current.phone,
                        )
                    }
                }
                .onFailure { error ->
                    if (authOperations.isCurrent(operation)) {
                        _state.value = current.copy(
                            isSending = false,
                            error = mapAuthError(error, AuthError.SEND_FAILED),
                        )
                    }
                }
        }
    }

    private fun enterOtp(e164: String, country: Country, phone: String) {
        _state.value = AuthUiState.EnterOtp(
            country = country,
            phone = phone,
            phoneE164 = e164,
            code = "",
            secondsLeft = RESEND_SECONDS,
            canResend = false,
        )
        startCountdown()
    }

    private fun onCodeChanged(raw: String) {
        val current = _state.value as? AuthUiState.EnterOtp ?: return
        if (current.isVerifying) return
        val code = normalizeOtpDigits(raw, OTP_LENGTH)
        _state.value = current.copy(code = code, error = null)
    }

    private fun submitOtp() {
        val current = _state.value as? AuthUiState.EnterOtp ?: return
        if (current.code.length != OTP_LENGTH || current.isVerifying) return
        verify(current.phoneE164, current.code)
    }

    private fun resendOtp() {
        val current = _state.value as? AuthUiState.EnterOtp ?: return
        if (!current.canResend) return
        _state.value = current.copy(
            secondsLeft = RESEND_SECONDS,
            canResend = false,
            error = null,
        )
        launchAuthOperation(
            onUnexpectedFailure = {
                _state.value = current.copy(
                    canResend = true,
                    error = AuthError.GENERIC,
                )
            },
        ) { operation ->
            authRepository.sendSmsOtp(current.phoneE164)
                .onSuccess { outcome ->
                    if (!authOperations.isCurrent(operation)) return@onSuccess
                    when (outcome) {
                        OtpSendOutcome.AUTO_SIGNED_IN ->
                            completePhoneSignIn(current.phoneE164, operation)
                        OtpSendOutcome.CODE_SENT -> startCountdown()
                    }
                }
                .onFailure { error ->
                    if (authOperations.isCurrent(operation)) {
                        _state.value = current.copy(
                            canResend = true,
                            error = mapAuthError(error, AuthError.SEND_FAILED),
                        )
                    }
                }
        }
    }

    private fun changeNumber() {
        invalidateAuthOperations()
        countdownJob?.cancel()
        authRepository.clearOtpSession()
        _state.value = restoredPhone()
    }

    private fun startCountdown() {
        countdownJob?.cancel()
        countdownJob = viewModelScope.launch {
            var left = RESEND_SECONDS
            while (left > 0) {
                delay(1_000)
                left--
                val current = _state.value as? AuthUiState.EnterOtp ?: return@launch
                _state.value = current.copy(secondsLeft = left, canResend = left == 0)
            }
        }
    }

    private fun verify(e164: String, code: String) {
        countdownJob?.cancel()
        val current = _state.value as? AuthUiState.EnterOtp ?: return
        if (current.isVerifying) return
        _state.value = current.copy(isVerifying = true, error = null)
        launchAuthOperation(
            onUnexpectedFailure = {
                _state.value = current.copy(
                    code = "",
                    secondsLeft = 0,
                    canResend = true,
                    isVerifying = false,
                    error = AuthError.GENERIC,
                )
            },
        ) { operation ->
            authRepository.verifyOtp(e164, code)
                .onSuccess {
                    if (authOperations.isCurrent(operation)) {
                        completePhoneSignIn(e164, operation)
                    }
                }
                .onFailure { error ->
                    if (authOperations.isCurrent(operation)) {
                        _state.value = current.copy(
                            code = "",
                            secondsLeft = 0,
                            canResend = true,
                            isVerifying = false,
                            error = if (error is InvalidOtpException) {
                                AuthError.INVALID_OTP
                            } else {
                                mapAuthError(error, AuthError.GENERIC)
                            },
                        )
                    }
                }
        }
    }

    private suspend fun completePhoneSignIn(e164: String, operation: Long) {
        if (!authOperations.isCurrent(operation)) return
        countdownJob?.cancel()
        val phoneCountryIso = when (val current = _state.value) {
            is AuthUiState.EnterPhone -> current.country.iso
            is AuthUiState.EnterOtp -> current.country.iso
            else -> savedStateHandle.get<String>(KEY_ISO)
        }?.takeIf { it.length == 2 } ?: Countries.defaultFor(appContext).iso
        val idToken = authRepository.currentIdToken()
        if (!authOperations.isCurrent(operation)) return
        if (idToken.isNullOrBlank()) {
            _state.value = restoredPhone().copy(error = AuthError.GENERIC)
            return
        }
        val response = backendApi.completePhoneAuth(
            PhoneCompleteReq(
                id_token = idToken,
                phone = e164,
                device_secret = sessionStore.getOrCreateSecret(),
                phone_country_iso = phoneCountryIso,
            ),
        )
        if (!authOperations.isCurrent(operation)) return
        if (!response.ok) {
            _state.value = restoredPhone().copy(
                error = if (response.error == "feature_disabled") AuthError.SERVICE_UNAVAILABLE else AuthError.GENERIC,
            )
            return
        }
        if (response.exists) {
            sessionStore.savePhoneCountry(e164, phoneCountryIso)
            if (!authOperations.isCurrent(operation)) return
            if (!saveAuthenticatedSession(response, operation)) return
            _state.value = if (
                response.passkey_registration_available &&
                Build.VERSION.SDK_INT >= Build.VERSION_CODES.P
            ) {
                AuthUiState.PasskeyInvite()
            } else {
                AuthUiState.Success(isNewSeller = false)
            }
        } else {
            val token = response.onboarding_token
            if (token.isNullOrBlank()) {
                _state.value = restoredPhone().copy(error = AuthError.GENERIC)
                return
            }
            sessionStore.saveOnboardingToken(token)
            if (!authOperations.isCurrent(operation)) return
            sessionStore.beginPreRegistration(e164, phoneCountryIso)
            if (!authOperations.isCurrent(operation)) return
            if (response.passkey_invite && Build.VERSION.SDK_INT >= Build.VERSION_CODES.P) {
                _state.value = AuthUiState.PasskeyInvite(deferredForOnboarding = true)
            } else {
                sessionStore.saveOnboardingPasskeyOptIn(false)
                _state.value = AuthUiState.Success(isNewSeller = true)
            }
        }
    }

    private fun skipPasskey() {
        val current = _state.value as? AuthUiState.PasskeyInvite ?: return
        invalidateAuthOperations()
        if (!current.deferredForOnboarding) {
            _state.value = AuthUiState.Success(isNewSeller = false)
            return
        }
        launchAuthOperation(
            onUnexpectedFailure = {
                _state.value = current.copy(isCreating = false, error = AuthError.PASSKEY_FAILED)
            },
        ) { operation ->
            sessionStore.saveOnboardingPasskeyOptIn(false)
            if (authOperations.isCurrent(operation)) {
                _state.value = AuthUiState.Success(isNewSeller = true)
            }
        }
    }

    private suspend fun completePasskeyAuthentication(
        operation: Long,
        challengeId: String,
        responseJson: String,
    ) {
        if (!authOperations.isCurrent(operation)) return
        val completed = backendApi.completePasskeyAuthentication(
            challengeId = challengeId,
            responseJson = responseJson,
            deviceSecret = sessionStore.getOrCreateSecret(),
        )
        if (!authOperations.isCurrent(operation)) return
        if (!completed.ok || completed.phone.isNullOrBlank()) {
            _state.value = AuthUiState.Welcome(
                showOtpFallback = true,
                error = AuthError.PASSKEY_FAILED,
            )
            return
        }
        sessionStore.savePhone(completed.phone)
        if (!authOperations.isCurrent(operation)) return
        if (!saveAuthenticatedSession(completed, operation)) return
        _state.value = AuthUiState.Success(isNewSeller = false)
    }

    private suspend fun saveAuthenticatedSession(
        response: AuthCompleteRes,
        operation: Long,
    ): Boolean {
        if (!authOperations.isCurrent(operation)) return false
        response.store?.let {
            saveStore(it)
            if (!authOperations.isCurrent(operation)) return false
        }
        response.recent_auth_token?.let {
            sessionStore.saveRecentAuth(it, response.recent_auth_expires_at)
            if (!authOperations.isCurrent(operation)) return false
        }
        sessionStore.markRegistered()
        if (!authOperations.isCurrent(operation)) return false
        sessionStore.markOnboardingComplete()
        if (!authOperations.isCurrent(operation)) return false
        sessionStore.clearOnboardingToken()
        return authOperations.isCurrent(operation)
    }

    private suspend fun saveStore(store: StoreDto) {
        sessionStore.saveStoreIdentity(
            store.slug,
            store.public_identifier,
            store.store_code,
            store.country_code,
            store.store_url,
        )
        sessionStore.saveStoreInfo(
            shopName = store.store_name,
            description = store.description,
            whatsapp = store.whatsapp,
            email = store.email,
            website = store.website,
            address = store.address,
            logoUrl = store.logo_url,
            coverUrl = store.cover_url,
        )
    }

    private fun launchAuthOperation(
        onUnexpectedFailure: () -> Unit,
        block: suspend (operation: Long) -> Unit,
    ) {
        authOperations.launch(viewModelScope) { operation ->
            try {
                block(operation)
            } catch (error: CancellationException) {
                throw error
            } catch (_: Exception) {
                if (authOperations.isCurrent(operation)) {
                    Log.w(TAG, "Authentication operation failed")
                    onUnexpectedFailure()
                }
            }
        }
    }

    private fun invalidateAuthOperations() {
        authOperations.invalidate()
    }

    private fun mapAuthError(error: Throwable, fallback: AuthError): AuthError {
        val failure = (error as? AuthFailureException)?.failure ?: return fallback
        return when (failure) {
            AuthFailure.INVALID_PHONE -> AuthError.INVALID_PHONE
            AuthFailure.TOO_MANY_REQUESTS -> AuthError.TOO_MANY_REQUESTS
            AuthFailure.NETWORK_UNAVAILABLE -> AuthError.NETWORK_UNAVAILABLE
            AuthFailure.APP_VERIFICATION_FAILED -> AuthError.APP_VERIFICATION_FAILED
            AuthFailure.SEND_TIMEOUT -> AuthError.SEND_TIMEOUT
            AuthFailure.OTP_EXPIRED -> AuthError.OTP_EXPIRED
            AuthFailure.GENERIC -> fallback
        }
    }

    override fun onCleared() {
        invalidateAuthOperations()
        countdownJob?.cancel()
        authRepository.clearOtpSession()
        super.onCleared()
    }

    companion object {
        private const val TAG = "AuthVM"
        private const val KEY_PHONE = "phone"
        private const val KEY_ISO = "country_iso"
        const val OTP_LENGTH = 6
        const val RESEND_SECONDS = 60
        const val MAX_NATIONAL_LEN = 15
    }
}
