package app.orderak.seller.data.remote

import android.content.Context
import androidx.work.Constraints
import androidx.work.ExistingPeriodicWorkPolicy
import androidx.work.ExistingWorkPolicy
import androidx.work.NetworkType
import androidx.work.OneTimeWorkRequestBuilder
import androidx.work.PeriodicWorkRequestBuilder
import androidx.work.WorkManager
import java.util.concurrent.TimeUnit

/** تشغيل المزامنة: فورية بعد أي تعديل + دورية كل 15 دقيقة (Plan §3.4 offline-first). */
object SyncScheduler {

    private val net = Constraints.Builder()
        .setRequiredNetworkType(NetworkType.CONNECTED)
        .build()

    fun syncNow(context: Context) {
        WorkManager.getInstance(context).enqueueUniqueWork(
            "orderak-sync-now",
            // Not REPLACE: replacing cancels an in-flight sync mid-cycle (e.g.
            // after an image upload but before its URL is persisted), orphaning
            // uploads.
            //
            // Not KEEP either, which is what this was. KEEP discards the new
            // request rather than deferring it, and SyncRepository holds a mutex
            // so only one sync runs at a time — so an edit made while a sync was
            // running was dropped, and the running sync had usually already read
            // its dirty rows. The seller saw the app report success and the
            // storefront keep showing the old price for up to fifteen minutes,
            // until the periodic worker came round. On a shop taking live orders
            // that is a wrong price on a real transaction, with nothing on screen
            // explaining it.
            //
            // APPEND_OR_REPLACE never cancels running work and queues the new
            // request behind it, which is what KEEP was reaching for.
            //
            // Not plain APPEND, for a specific reason: SyncWorker returns
            // Result.failure() after three attempts, and appending to a chain
            // whose predecessor failed leaves the new request cancelled with it —
            // one failed sync would then block every later one until the app was
            // reinstalled. APPEND_OR_REPLACE starts a fresh chain when the
            // existing one has failed or been cancelled, which is exactly that
            // case.
            ExistingWorkPolicy.APPEND_OR_REPLACE,
            OneTimeWorkRequestBuilder<SyncWorker>().setConstraints(net).build(),
        )
    }

    fun ensurePeriodic(context: Context) {
        WorkManager.getInstance(context).enqueueUniquePeriodicWork(
            "orderak-sync-periodic",
            ExistingPeriodicWorkPolicy.KEEP,
            PeriodicWorkRequestBuilder<SyncWorker>(15, TimeUnit.MINUTES)
                .setConstraints(net)
                .build(),
        )
    }
}
