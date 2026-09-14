package app.orderak.seller.data.refresh

import android.content.Context
import androidx.work.Constraints
import androidx.work.ExistingPeriodicWorkPolicy
import androidx.work.ExistingWorkPolicy
import androidx.work.NetworkType
import androidx.work.OneTimeWorkRequestBuilder
import androidx.work.PeriodicWorkRequestBuilder
import androidx.work.WorkManager
import java.util.concurrent.TimeUnit

/**
 * When the device refreshes and delivers: on demand, and every fifteen minutes.
 */
object RefreshScheduler {

    private val net = Constraints.Builder()
        .setRequiredNetworkType(NetworkType.CONNECTED)
        .build()

    /**
     * Cancel the work the old scheduler enqueued.
     *
     * A unique work name is an identity, so renaming one does not rename the
     * work already queued under the old name — it leaves it there, scheduled
     * forever against a worker class that no longer exists. WorkManager persists
     * these across restarts and reinstalls of the *app process*, so a device
     * upgrading into this build would keep waking every fifteen minutes to run
     * something that cannot be constructed.
     *
     * Called from [ensurePeriodic], which every launch reaches, so the cleanup
     * happens once on the first launch after the upgrade and is a no-op after.
     */
    private fun cancelLegacyWork(context: Context) {
        val manager = WorkManager.getInstance(context)
        manager.cancelUniqueWork("orderak-sync-now")
        manager.cancelUniqueWork("orderak-sync-periodic")
    }

    fun refreshNow(context: Context) {
        WorkManager.getInstance(context).enqueueUniqueWork(
            "orderak-refresh-now",
            // Not REPLACE: replacing cancels an in-flight run mid-cycle — for
            // instance between converting a legacy product and recording that it
            // converted — and the next run would then try it again.
            //
            // Not KEEP either, which is what this once was. KEEP discards the new
            // request rather than deferring it, and a refresh holds a mutex so
            // only one runs at a time — so an edit made while one was running was
            // dropped, and the running pass had usually already read its rows.
            // The seller saw the app report success and the storefront keep
            // showing the old price for up to fifteen minutes, with nothing on
            // screen explaining it.
            //
            // APPEND_OR_REPLACE never cancels running work and queues the new
            // request behind it, which is what KEEP was reaching for.
            //
            // Not plain APPEND, for a specific reason: the worker returns
            // Result.failure() after three attempts, and appending to a chain
            // whose predecessor failed leaves the new request cancelled with it —
            // one failed run would then block every later one until the app was
            // reinstalled. APPEND_OR_REPLACE starts a fresh chain when the
            // existing one has failed or been cancelled, which is exactly that
            // case.
            ExistingWorkPolicy.APPEND_OR_REPLACE,
            OneTimeWorkRequestBuilder<RefreshWorker>().setConstraints(net).build(),
        )
    }

    fun ensurePeriodic(context: Context) {
        cancelLegacyWork(context)
        WorkManager.getInstance(context).enqueueUniquePeriodicWork(
            "orderak-refresh-periodic",
            ExistingPeriodicWorkPolicy.KEEP,
            PeriodicWorkRequestBuilder<RefreshWorker>(15, TimeUnit.MINUTES)
                .setConstraints(net)
                .build(),
        )
    }
}
