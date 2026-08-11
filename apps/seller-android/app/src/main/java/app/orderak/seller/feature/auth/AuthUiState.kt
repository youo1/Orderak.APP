package app.orderak.seller.feature.auth

import app.orderak.seller.core.phone.Country

enum class AuthError {
    INVALID_PHONE,
    UNSUPPORTED_COUNTRY,
    SEND_FAILED,
    TOO_MANY_REQUESTS,
    NETWORK_UNAVAILABLE,
    APP_VERIFICATION_FAILED,
    SEND_TIMEOUT,
    INVALID_OTP,
    OTP_EXPIRED,
    PASSKEY_UNAVAILABLE,
    PASSKEY_FAILED,
    SERVICE_UNAVAILABLE,
    GENERIC,
}

/** One state machine for Welcome → phone/OTP or Passkey → destination. */
sealed interface AuthUiState {
    data class Welcome(
        val isPasskeyLoading: Boolean = false,
        val showOtpFallback: Boolean = false,
        val error: AuthError? = null,
    ) : AuthUiState

    data class EnterPhone(
        val country: Country,
        val phone: String,
        val isValid: Boolean,
        val error: AuthError? = null,
        val isSending: Boolean = false,
    ) : AuthUiState

    data class EnterOtp(
        val country: Country,
        val phone: String,
        val phoneE164: String,
        val code: String,
        val secondsLeft: Int,
        val canResend: Boolean,
        val error: AuthError? = null,
        val isVerifying: Boolean = false,
    ) : AuthUiState

    /**
     * Existing sellers may create a passkey now. For new sellers the prompt
     * records the choice now and defers the system ceremony until setup completes.
     */
    data class PasskeyInvite(
        val isCreating: Boolean = false,
        val error: AuthError? = null,
        val deferredForOnboarding: Boolean = false,
    ) : AuthUiState

    data class Success(val isNewSeller: Boolean) : AuthUiState
}

sealed interface AuthEvent {
    data object StartPhone : AuthEvent
    data object BackToWelcome : AuthEvent
    data class CountrySelected(val country: Country) : AuthEvent
    data class PhoneChanged(val text: String) : AuthEvent
    data object RequestOtp : AuthEvent
    data class CodeChanged(val text: String) : AuthEvent
    data object VerifyOtp : AuthEvent
    data object ResendOtp : AuthEvent
    data object ChangeNumber : AuthEvent
    data object SkipPasskey : AuthEvent
}
