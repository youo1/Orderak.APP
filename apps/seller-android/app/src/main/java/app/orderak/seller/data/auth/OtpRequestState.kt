package app.orderak.seller.data.auth

/** Guards mutable OTP state from cross-phone reuse and stale Firebase callbacks. */
internal class OtpRequestState(
    private val sessionTtlMs: Long = AuthTimingPolicy.OTP_SESSION_TTL_MS,
) {
    data class Attempt(val generation: Long, val mayReuseResendToken: Boolean)

    private data class Session(
        val phoneE164: String,
        val generation: Long,
        val verificationId: String?,
        val expiresAtMs: Long,
    )

    private var nextGeneration = 0L
    private var session: Session? = null

    fun begin(phoneE164: String, nowMs: Long): Attempt {
        val previous = session
        val reuse = previous?.phoneE164 == phoneE164 && previous.expiresAtMs > nowMs
        val generation = ++nextGeneration
        session = Session(
            phoneE164 = phoneE164,
            generation = generation,
            verificationId = if (reuse) previous.verificationId else null,
            expiresAtMs = nowMs + sessionTtlMs,
        )
        return Attempt(generation, reuse)
    }

    fun acceptVerificationId(generation: Long, verificationId: String, nowMs: Long): Boolean {
        val current = session ?: return false
        if (current.generation != generation || current.expiresAtMs <= nowMs) return false
        session = current.copy(verificationId = verificationId)
        return true
    }

    fun isCurrent(generation: Long, nowMs: Long): Boolean {
        val current = session ?: return false
        return current.generation == generation && current.expiresAtMs > nowMs
    }

    fun verificationId(phoneE164: String, nowMs: Long): String? {
        val current = session ?: return null
        if (current.phoneE164 != phoneE164 || current.expiresAtMs <= nowMs) return null
        return current.verificationId
    }

    fun invalidate(generation: Long) {
        if (session?.generation == generation) session = null
    }

    fun clear() {
        session = null
    }
}
