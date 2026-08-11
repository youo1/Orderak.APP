package app.orderak.seller.data.auth

/** Current Android/Firebase timing profile; security tests own these values. */
internal object AuthTimingPolicy {
    const val SMS_RETRIEVAL_TIMEOUT_SECONDS = 60L
    const val SEND_OPERATION_TIMEOUT_MS = 90_000L
    const val OTP_SESSION_TTL_MS = 10 * 60 * 1_000L
}
