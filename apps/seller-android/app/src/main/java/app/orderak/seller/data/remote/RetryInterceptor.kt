package app.orderak.seller.data.remote

import okhttp3.Interceptor
import okhttp3.Response

/**
 * Retry a transient server failure, honouring Retry-After.
 *
 * OkHttp's own `retryOnConnectionFailure` covers establishing a connection, not
 * a 503 or a connection dropped mid-response. Neither did anything else: a
 * transient blip surfaced to the seller as a hard failure, and on the sync path
 * a failure means waiting for the fifteen-minute periodic worker. The deployment
 * context is mobile data on low-end devices, where a transient failure is the
 * normal case rather than the exception.
 *
 * The backend rate-limits generously and returns Retry-After with its 429s —
 * `Access-Control-Expose-Headers` lists it — and nothing read it, so a throttled
 * client either retried on its own schedule or not at all.
 *
 * WHAT IS NOT RETRIED, AND WHY THAT IS THE IMPORTANT PART
 *   Only GETs and requests carrying an idempotency key. `createOrder` dedupes on
 *   `idempotency-key` and is safe to replay; `POST /api/v1/products/sync` is a
 *   full-mirror push where whatever the payload omits is deleted, and replaying
 *   one of those against a catalogue that moved in between is how a seller loses
 *   products. A retry policy that cannot tell those apart is worse than none.
 */
class RetryInterceptor(
    private val maxAttempts: Int = 3,
    /** Injected so tests do not spend real seconds. */
    private val sleep: (Long) -> Unit = { Thread.sleep(it) },
) : Interceptor {

    override fun intercept(chain: Interceptor.Chain): Response {
        val request = chain.request()
        val replayable = request.method == "GET" ||
            request.header("idempotency-key") != null ||
            request.header("x-idempotency-key") != null

        var response = chain.proceed(request)
        var attempt = 1
        while (replayable && attempt < maxAttempts && shouldRetry(response.code)) {
            val waitSeconds = retryAfterSeconds(response) ?: (1L shl attempt) // 2s, 4s
            // The body must be closed before the connection can be reused; an
            // unclosed one leaks it out of the pool for the whole process.
            response.close()
            sleep(waitSeconds.coerceIn(0L, MAX_BACKOFF_SECONDS) * 1000L)
            response = chain.proceed(request)
            attempt++
        }
        return response
    }

    private fun shouldRetry(code: Int): Boolean = code == 429 || code in 500..599

    /**
     * Retry-After in seconds, or null when absent or not a plain number.
     *
     * The HTTP-date form is deliberately not parsed: the backend only ever emits
     * the delta-seconds form (see checkRateLimit's 429s), and a date would need
     * the device clock to agree with the server's, which on these handsets it
     * frequently does not. Falling back to our own backoff is safer than
     * trusting a skewed clock.
     */
    private fun retryAfterSeconds(response: Response): Long? =
        response.header("Retry-After")?.trim()?.toLongOrNull()?.takeIf { it >= 0 }

    private companion object {
        /** Never sleep longer than this, whatever Retry-After claims. */
        const val MAX_BACKOFF_SECONDS = 30L
    }
}

/**
 * Keep one seller's cached response from being served to the next.
 *
 * OkHttp's cache keys on the URL, and the seller credential travels in headers
 * (`x-orderak-phone` / `x-orderak-secret`) rather than in the path. So a
 * cacheable response to a credentialed request would be stored under a key that
 * says nothing about whose data it holds, and the next seller to sign in on the
 * same device would be served it.
 *
 * Nothing currently reaches that state — every credentialed route returns either
 * no cache-control at all or `private, max-age=0, must-revalidate`, and the only
 * two publicly cacheable routes (the plan comparison and assetlinks.json) carry
 * nothing store-specific. This exists so that stays true without anyone having
 * to remember it: adding `public, max-age=…` to a seller route on the server is
 * an ordinary-looking change that would otherwise leak across accounts here.
 *
 * `Vary` is the mechanism HTTP already has for this. OkHttp stores the varied
 * request headers alongside the entry and compares them on lookup, so declaring
 * it makes the phone number part of the cache key — and `private, max-age=0,
 * must-revalidate` plus an ETag still gets its conditional revalidation, which
 * is the actual saving on metered mobile data.
 */
class CredentialVaryInterceptor : Interceptor {
    override fun intercept(chain: Interceptor.Chain): Response {
        val response = chain.proceed(chain.request())
        if (chain.request().header(CREDENTIAL_HEADER) == null) return response
        val existing = response.header("Vary")
        if (existing != null && existing.contains(CREDENTIAL_HEADER, ignoreCase = true)) return response
        val merged = if (existing.isNullOrBlank()) CREDENTIAL_HEADER else "$existing, $CREDENTIAL_HEADER"
        return response.newBuilder().header("Vary", merged).build()
    }

    private companion object {
        const val CREDENTIAL_HEADER = "x-orderak-phone"
    }
}
