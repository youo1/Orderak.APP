package app.orderak.seller.data.refresh

import android.content.Context
import androidx.hilt.work.HiltWorker
import androidx.work.CoroutineWorker
import androidx.work.WorkerParameters
import app.orderak.seller.data.orders.OrderCommandQueue
import app.orderak.seller.data.session.SessionStore
import dagger.assisted.Assisted
import dagger.assisted.AssistedInject

/**
 * Deliver the orders the seller has taken, then bring the device up to date.
 *
 * THE ORDER OF THESE TWO LINES IS THE POINT
 *   The command drain runs first and its result is kept separately. Under the
 *   old sync the order push sat inside `doSync`, after a catalogue pull that
 *   returned early on failure — so a seller whose catalogue request failed also
 *   could not deliver a sale they had already made. Two unrelated failures wired
 *   together by nothing more than statement order, and the one that mattered was
 *   the one that got skipped.
 *
 *   Class B is independent of Class A. That is a line in the data authority
 *   contract, and this is where it is either true or not.
 */
@HiltWorker
class RefreshWorker @AssistedInject constructor(
    @Assisted appContext: Context,
    @Assisted params: WorkerParameters,
    private val orderCommands: OrderCommandQueue,
    private val refresher: SellerRefresher,
    private val sessionStore: SessionStore,
) : CoroutineWorker(appContext, params) {

    override suspend fun doWork(): Result = try {
        sessionStore.setSyncStatus("running")
        // Deliberately not `commandsDrained && refresher.refreshNow()`: && would
        // skip the refresh whenever the drain failed, which is the same coupling
        // in the other direction.
        val commandsDrained = runCatching { orderCommands.drain() }.getOrDefault(false)
        val refreshed = refresher.refreshNow()
        finish(commandsDrained && refreshed)
    } catch (_: Exception) {
        finish(false)
    }

    private suspend fun finish(succeeded: Boolean): Result = when {
        succeeded -> {
            sessionStore.setSyncStatus("success")
            Result.success()
        }
        runAttemptCount < MAX_ATTEMPTS -> {
            sessionStore.setSyncStatus("pending")
            Result.retry()
        }
        else -> {
            sessionStore.setSyncStatus("failed")
            Result.failure()
        }
    }

    private companion object {
        const val MAX_ATTEMPTS = 3
    }
}
