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
            // KEEP, not REPLACE: replacing cancels an in-flight sync mid-cycle
            // (e.g. after an image upload but before its URL is persisted),
            // orphaning uploads. An already-running sync covers the new request.
            ExistingWorkPolicy.KEEP,
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
