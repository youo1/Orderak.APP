package app.orderak.seller.core.read

import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.catch
import kotlinx.coroutines.flow.flatMapLatest
import kotlinx.coroutines.flow.onEach

/**
 * A read off a local flow that can be asked to try again after it fails.
 *
 * ## The defect this exists for
 *
 * The Orders, Store and Customers surfaces each held their list like this:
 *
 * ```
 * combine(repo.orders, filter) { ... }
 *     .onEach { _loadError.value = false }
 *     .catch { e -> _loadError.value = true; emit(emptyList()) }
 *     .stateIn(scope, WhileSubscribed(5_000), null)
 * ```
 *
 * `catch` does not skip a bad emission. It ends the stream. The `stateIn` kept
 * the empty list it had just been handed, and nothing upstream would ever emit
 * again — no re-read, no sync, no pull-to-refresh. One thrown Room read left the
 * surface permanently empty until the process restarted, behind an error screen
 * whose own component already accepted an `onRetry` that nobody passed it.
 *
 * A Room read is a query. A query that failed once can be run again, so the fix
 * is to keep the subscription replaceable rather than to end it.
 *
 * ## What it does
 *
 * [values] subscribes to [source] and re-subscribes every time [retry] is
 * called. A failure sets [failed] and the attempt ends there: nothing more is
 * emitted until [retry], which is the honest shape of it — the read really did
 * stop, and pretending otherwise would hide a database that is failing on every
 * query behind a screen that looks like it is waiting.
 *
 * Cancellation is rethrown. A cancelled collector is not a failed read, and
 * turning it into an error state is how a screen shows a failure the seller
 * never had.
 */
class RestartableRead<T>(private val source: () -> Flow<T>) {

    /**
     * Bumped to re-subscribe. A counter rather than a one-shot signal because
     * `flatMapLatest` needs a distinct value per attempt: two identical triggers
     * would collapse into one, and a second retry would do nothing.
     */
    private val attempts = MutableStateFlow(0)

    private val _failed = MutableStateFlow(false)

    /** True after [source] threw and until the next attempt succeeds. */
    val failed: StateFlow<Boolean> = _failed.asStateFlow()

    /** The values [source] produces, restartable through [retry]. */
    val values: Flow<T> =
        attempts.flatMapLatest {
            source()
                .onEach { _failed.value = false }
                .catch { error ->
                    if (error is CancellationException) throw error
                    _failed.value = true
                }
        }

    /** Try the read again. */
    fun retry() {
        attempts.value += 1
    }
}
