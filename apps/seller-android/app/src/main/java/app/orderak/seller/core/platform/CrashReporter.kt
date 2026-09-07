package app.orderak.seller.core.platform

/**
 * Where a crash report gets the context that makes it actionable.
 *
 * Crashlytics has been wired since the project started and has never been told
 * anything: the Gradle plugin is applied, the SDK is on the classpath, and no
 * code has ever called it. So a report arrives as a stack trace with no idea
 * which request the seller was making when it happened.
 *
 * The backend already solves half of this. Every call sends `x-request-id`
 * (BackendApi), the Worker honours it rather than minting its own, logs it as
 * `request_id`, and echoes it back. A request id therefore already identifies
 * one invocation on both sides of the boundary — the app's crashes go to
 * Crashlytics and the Worker's errors go to Sentry, and this id is the only
 * thing that can join them.
 *
 * Attaching it here is what turns two separate dashboards into two views of one
 * incident.
 */
interface CrashReporter {

    /**
     * Record the request about to go out, so a crash names the last thing the
     * app asked the server for.
     *
     * Custom keys are last-write-wins per process, which is exactly the
     * behaviour wanted: a crash report should carry the request that was in
     * flight, not the first one of the session.
     */
    fun noteRequest(requestId: String, route: String)

    /**
     * A backend failure the app handled — reported, not thrown.
     *
     * Deliberately not every failure. See [ApiFailure] for which ones count and
     * why the offline case is excluded.
     */
    fun recordApiFailure(failure: ApiFailure)
}

/**
 * A handled backend failure worth reporting.
 *
 * @param route the redacted route shape, never a real URL — see [redactRoute].
 * @param requestId the id sent on the failing request, so the Worker-side error
 *   can be found in Sentry.
 * @param code the app's own error token (`http_500`, `bad_response`), not the
 *   response body, which is never read into a report.
 */
data class ApiFailure(
    val route: String,
    val requestId: String?,
    val code: String,
)

/**
 * Whether a failure code is worth a non-fatal report.
 *
 * A seller using this app is frequently offline — at a stall, on a bad
 * connection, in a basement — so a failed request is not by itself evidence of
 * anything wrong. Reporting every one would spend the Crashlytics quota on
 * normal life and train whoever reads it to ignore the tool, which is worse than
 * not having it.
 *
 * A 5xx or an unparseable response is different: the server was reached and
 * answered badly, and there is a corresponding Sentry event to find.
 */
fun isReportableFailure(code: String): Boolean =
    code == "bad_response" || (code.startsWith("http_5"))

/**
 * Reduce a request path to a route shape safe to put in a crash report.
 *
 * **This is a privacy control, not a formatting nicety.** `PATCH
 * /api/v1/customers/{customer_key}` addresses a customer by their normalised
 * phone number, so the raw path of that call is a phone number in a URL.
 * Sending it to a third-party crash service would export buyer PII to a system
 * that has no business holding it and no retention policy that anyone here
 * agreed to.
 *
 * The rule is deny-by-default: the `/api/v1/` prefix is kept because it is fixed
 * and carries nothing, and every segment after it is replaced unless it is
 * plainly a static route word. Anything carrying a digit, an escape, a plus or
 * an at-sign is an identifier of some kind and becomes `{id}` — which keeps the
 * report useful (you can still see *which endpoint* failed) while making it
 * structurally unable to carry a phone number, an order id or a product code.
 *
 * The query string is dropped whole rather than filtered. A filter has to be
 * right about every parameter that exists now and every one added later; a drop
 * only has to be right once.
 */
fun redactRoute(path: String): String {
    val withoutQuery = path.substringBefore('?').substringBefore('#')
    val segments = withoutQuery.split('/').filter { it.isNotEmpty() }
    if (segments.isEmpty()) return "/"

    val out = StringBuilder()
    var pastPrefix = false
    for (segment in segments.take(MAX_REPORTED_SEGMENTS)) {
        // The fixed prefix. `v1` contains a digit and would otherwise redact to
        // {id}, which would make every route in the app look the same.
        if (!pastPrefix && segment in FIXED_PREFIX) {
            out.append('/').append(segment)
            continue
        }
        pastPrefix = true
        out.append('/').append(if (isStaticSegment(segment)) segment else "{id}")
    }
    if (segments.size > MAX_REPORTED_SEGMENTS) out.append("/…")
    return out.toString()
}

private const val MAX_REPORTED_SEGMENTS = 8
private val FIXED_PREFIX = setOf("api", "admin", "integrations", "v1", "v2")

/**
 * A segment is static only if it is plainly a route word: lower-case letters,
 * hyphens or underscores, and short. Everything else is treated as an
 * identifier, including anything that merely looks unusual.
 */
private fun isStaticSegment(segment: String): Boolean =
    segment.length <= 24 && segment.all { it in 'a'..'z' || it == '-' || it == '_' }

/**
 * The reporter used where Crashlytics is not available or not wanted — unit
 * tests, and any build that should not talk to Firebase.
 */
object NoOpCrashReporter : CrashReporter {
    override fun noteRequest(requestId: String, route: String) = Unit
    override fun recordApiFailure(failure: ApiFailure) = Unit
}
