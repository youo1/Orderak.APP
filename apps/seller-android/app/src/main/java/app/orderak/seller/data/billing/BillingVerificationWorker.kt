package app.orderak.seller.data.billing

import android.content.Context
import androidx.hilt.work.HiltWorker
import androidx.work.BackoffPolicy
import androidx.work.Constraints
import androidx.work.CoroutineWorker
import androidx.work.Data
import androidx.work.ExistingWorkPolicy
import androidx.work.NetworkType
import androidx.work.OneTimeWorkRequestBuilder
import androidx.work.WorkManager
import androidx.work.WorkerParameters
import androidx.work.workDataOf
import app.orderak.seller.data.remote.BackendApi
import app.orderak.seller.data.remote.EntitlementSnapshotRes
import app.orderak.seller.data.remote.VerifyPlayPurchaseRes
import app.orderak.seller.data.session.SessionStore
import dagger.assisted.Assisted
import dagger.assisted.AssistedInject
import kotlinx.coroutines.flow.first
import java.util.concurrent.TimeUnit

internal sealed interface BillingVerificationDecision {
    data class Succeeded(val snapshot: EntitlementSnapshotRes) : BillingVerificationDecision
    data class Retry(val retryAfterSeconds: Long) : BillingVerificationDecision
    data class Terminal(val error: String) : BillingVerificationDecision
}

internal fun decideBillingVerification(response: VerifyPlayPurchaseRes): BillingVerificationDecision {
    val snapshot = response.entitlements
    if (response.ok && snapshot?.ok == true) return BillingVerificationDecision.Succeeded(snapshot)
    val retryableError = response.error == "network" || response.error == "bad_response" ||
        response.error?.let { it == "http_408" || it == "http_409" || it == "http_429" || it.startsWith("http_5") } == true
    if (response.pending || response.status == "verification_pending" || retryableError) {
        return BillingVerificationDecision.Retry((response.retry_after_seconds ?: 15L).coerceIn(15L, 21_600L))
    }
    return BillingVerificationDecision.Terminal(response.error ?: "verification_failed")
}

object BillingVerificationScheduler {
    private const val INPUT_VERIFICATION_ID = "verification_id"
    private const val WORK_PREFIX = "orderak-billing-verification-"

    fun schedule(context: Context, verificationId: String, retryAtEpochMs: Long) {
        val delayMs = (retryAtEpochMs - System.currentTimeMillis()).coerceAtLeast(0L)
        val constraints = Constraints.Builder()
            .setRequiredNetworkType(NetworkType.CONNECTED)
            .build()
        val request = OneTimeWorkRequestBuilder<BillingVerificationWorker>()
            .setInputData(workDataOf(INPUT_VERIFICATION_ID to verificationId))
            .setInitialDelay(delayMs, TimeUnit.MILLISECONDS)
            .setBackoffCriteria(BackoffPolicy.EXPONENTIAL, 15, TimeUnit.SECONDS)
            .setConstraints(constraints)
            .build()
        WorkManager.getInstance(context).enqueueUniqueWork(
            workName(verificationId),
            ExistingWorkPolicy.KEEP,
            request,
        )
    }

    fun workName(verificationId: String): String = WORK_PREFIX + verificationId

    fun verificationId(params: WorkerParameters): String =
        params.inputData.getString(INPUT_VERIFICATION_ID).orEmpty()
}

@HiltWorker
class BillingVerificationWorker @AssistedInject constructor(
    @Assisted appContext: Context,
    @Assisted params: WorkerParameters,
    private val backendApi: BackendApi,
    private val sessionStore: SessionStore,
    private val entitlementRepository: EntitlementRepository,
    private val billingManager: BillingManager,
) : CoroutineWorker(appContext, params) {

    override suspend fun doWork(): Result {
        val verificationId = inputData.getString("verification_id").orEmpty()
        if (verificationId.isBlank()) return Result.failure(errorData("verification_id_missing"))
        val pending = sessionStore.pendingBillingVerification.first()
        if (pending?.verificationId != verificationId) return Result.success()

        val phone = sessionStore.phone.first().orEmpty()
        val secret = sessionStore.readExistingSecret().orEmpty()
        if (phone.isBlank() || secret.isBlank()) {
            sessionStore.clearPendingBillingVerification(verificationId)
            billingManager.reportVerificationFailure("session_missing")
            return Result.failure(errorData("session_missing"))
        }

        return when (val decision = decideBillingVerification(backendApi.getPlayVerification(phone, secret, verificationId))) {
            is BillingVerificationDecision.Succeeded -> {
                entitlementRepository.acceptSnapshot(decision.snapshot)
                sessionStore.clearPendingBillingVerification(verificationId)
                billingManager.reportVerificationSuccess()
                Result.success()
            }
            is BillingVerificationDecision.Retry -> {
                val retryAt = System.currentTimeMillis() + TimeUnit.SECONDS.toMillis(decision.retryAfterSeconds)
                sessionStore.savePendingBillingVerification(verificationId, retryAt)
                billingManager.reportVerificationPending(verificationId, retryAt)
                Result.retry()
            }
            is BillingVerificationDecision.Terminal -> {
                sessionStore.clearPendingBillingVerification(verificationId)
                billingManager.reportVerificationFailure(decision.error)
                Result.failure(errorData(decision.error))
            }
        }
    }

    private fun errorData(code: String): Data = workDataOf("error" to code.take(100))
}
