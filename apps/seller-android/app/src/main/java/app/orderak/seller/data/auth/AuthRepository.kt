package app.orderak.seller.data.auth

/** Fix(A): sendOtp can complete sign-in on its own (instant verification). */
enum class OtpSendOutcome { CODE_SENT, AUTO_SIGNED_IN }

enum class AuthFailure {
    INVALID_PHONE,
    TOO_MANY_REQUESTS,
    NETWORK_UNAVAILABLE,
    APP_VERIFICATION_FAILED,
    SEND_TIMEOUT,
    OTP_EXPIRED,
    GENERIC,
}

interface AuthRepository {
    /** [phoneE164] is a full international number, e.g. +201012345678 */
    suspend fun sendSmsOtp(phoneE164: String): Result<OtpSendOutcome>
    suspend fun verifyOtp(phoneE164: String, code: String): Result<String> // Returns JWT token
    suspend fun currentIdToken(): String?
    fun clearOtpSession()
    fun signOut()
}

class InvalidOtpException : Exception("invalid otp")
class AuthFailureException(val failure: AuthFailure) : Exception(failure.name)
