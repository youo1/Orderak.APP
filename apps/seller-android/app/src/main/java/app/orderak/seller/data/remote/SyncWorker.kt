package app.orderak.seller.data.remote

import android.content.Context
import androidx.hilt.work.HiltWorker
import androidx.work.CoroutineWorker
import androidx.work.WorkerParameters
import dagger.assisted.Assisted
import dagger.assisted.AssistedInject
import app.orderak.seller.data.session.SessionStore

@HiltWorker
class SyncWorker @AssistedInject constructor(
    @Assisted appContext: Context,
    @Assisted params: WorkerParameters,
    private val syncRepository: SyncRepository,
    private val sessionStore: SessionStore,
) : CoroutineWorker(appContext, params) {

    override suspend fun doWork(): Result = try {
        sessionStore.setSyncStatus("running")
        if (syncRepository.syncNow()) {
            sessionStore.setSyncStatus("success")
            Result.success()
        } else if (runAttemptCount < 3) {
            sessionStore.setSyncStatus("pending")
            Result.retry()
        } else {
            sessionStore.setSyncStatus("failed")
            Result.failure()
        }
    } catch (_: Exception) {
        if (runAttemptCount < 3) {
            sessionStore.setSyncStatus("pending")
            Result.retry()
        } else {
            sessionStore.setSyncStatus("failed")
            Result.failure()
        }
    }
}
