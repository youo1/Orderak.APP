package app.orderak.seller.data.remote

import app.orderak.seller.core.platform.ApiFailure
import app.orderak.seller.core.platform.CrashReporter
import com.google.firebase.crashlytics.FirebaseCrashlytics
import dagger.Binds
import dagger.Module
import dagger.hilt.InstallIn
import dagger.hilt.components.SingletonComponent
import javax.inject.Inject
import javax.inject.Singleton

/**
 * [CrashReporter] backed by Firebase Crashlytics.
 *
 * Collection is off in `debug` and in the `mock` flavour, set through the
 * `crashlyticsCollectionEnabled` manifest placeholder. The SDK still accepts
 * these calls there and discards them, so nothing needs a build-type branch —
 * the flavour decides whether anything is sent, and this class does not have to
 * know which flavour it is in.
 *
 * Every call is wrapped. A crash reporter that can itself crash the app is worse
 * than no crash reporter: this runs on the request path of every backend call,
 * and Firebase throws if it was never initialised — which is exactly the state
 * of a build whose `google-services.json` is the CI placeholder.
 */
@Singleton
class FirebaseCrashReporter @Inject constructor() : CrashReporter {

    private val crashlytics: FirebaseCrashlytics?
        get() = runCatching { FirebaseCrashlytics.getInstance() }.getOrNull()

    override fun noteRequest(requestId: String, route: String) {
        runCatching {
            crashlytics?.apply {
                setCustomKey(KEY_REQUEST_ID, requestId)
                setCustomKey(KEY_ROUTE, route)
            }
        }
    }

    override fun recordApiFailure(failure: ApiFailure) {
        runCatching {
            crashlytics?.apply {
                setCustomKey(KEY_ROUTE, failure.route)
                failure.requestId?.let { setCustomKey(KEY_REQUEST_ID, it) }
                // A synthetic throwable, because there is no real one worth
                // sending: the IOException the client throws carries only the
                // code, and its stack is the OkHttp plumbing rather than
                // anything about the seller's situation. The message is the
                // grouping key, so it must name the route and the code and
                // nothing variable — a request id in here would make every
                // occurrence its own issue.
                recordException(
                    BackendFailure("${failure.code} ${failure.route}"),
                )
            }
        }
    }

    private companion object {
        const val KEY_REQUEST_ID = "request_id"
        const val KEY_ROUTE = "route"
    }
}

/**
 * Marker for a handled backend failure, so these group separately from real
 * crashes in the Crashlytics console.
 */
class BackendFailure(message: String) : Exception(message)

@Module
@InstallIn(SingletonComponent::class)
abstract class CrashReporterModule {
    @Binds
    @Singleton
    abstract fun bindCrashReporter(implementation: FirebaseCrashReporter): CrashReporter
}
