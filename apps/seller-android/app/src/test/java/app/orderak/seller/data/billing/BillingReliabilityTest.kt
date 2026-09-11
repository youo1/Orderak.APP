package app.orderak.seller.data.billing

import app.orderak.seller.core.network.NetworkJson
import app.orderak.seller.data.remote.BackendConfig
import app.orderak.seller.data.remote.EntitlementDto
import app.orderak.seller.data.remote.EntitlementSnapshotRes
import app.orderak.seller.data.remote.VerifyPlayPurchaseRes
import kotlinx.serialization.decodeFromString
import kotlinx.serialization.json.JsonPrimitive
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test
import java.time.Instant
import java.time.temporal.ChronoUnit

class BillingReliabilityTest {
    @Test
    fun pendingResponseSchedulesBoundedRetry() {
        val decision = decideBillingVerification(
            VerifyPlayPurchaseRes(
                pending = true,
                status = JsonPrimitive("verification_pending"),
                verification_id = "verification-1",
                retry_after_seconds = 5,
            )
        )
        assertEquals(BillingVerificationDecision.Retry(15), decision)
    }

    @Test
    fun successfulPollRequiresAuthoritativeSnapshot() {
        val snapshot = EntitlementSnapshotRes(ok = true, organization_id = "org-1", plan_key = "paid1")
        assertEquals(
            BillingVerificationDecision.Succeeded(snapshot),
            decideBillingVerification(VerifyPlayPurchaseRes(ok = true, entitlements = snapshot)),
        )
        assertEquals(
            BillingVerificationDecision.Terminal("verification_failed"),
            decideBillingVerification(VerifyPlayPurchaseRes(ok = true)),
        )
    }

    @Test
    fun networkFailureRetriesButStableProviderFailureIsTerminal() {
        assertEquals(
            BillingVerificationDecision.Retry(15),
            decideBillingVerification(VerifyPlayPurchaseRes(error = "network")),
        )
        assertEquals(
            BillingVerificationDecision.Terminal("unsupported_purchase_shape"),
            decideBillingVerification(VerifyPlayPurchaseRes(error = "unsupported_purchase_shape")),
        )
    }

    /**
     * The decode failure and the retry loop were one bug, so this asserts them
     * together: a real problem+json body, through the real decoder, into the
     * real decision.
     *
     * `status` is the numeric HTTP status on an error body, so decoding it into
     * a String field threw. apiCall reported that as "bad_response", which the
     * branch above classifies as retryable — so a verification that could never
     * succeed was rescheduled by WorkManager indefinitely, and the seller was
     * shown "bad_response" instead of the reason.
     */
    @Test
    fun terminalProblemJsonFailuresAreNotRetriedForever() {
        fun problem(status: Int, code: String) = NetworkJson.decoder.decodeFromString<VerifyPlayPurchaseRes>(
            """{"type":"https://developers.orderak.app/problems/$code","title":"T",""" +
                """"status":$status,"code":"$code","detail":"T","request_id":"r1"}""",
        )

        assertEquals(
            BillingVerificationDecision.Terminal("play_product_not_enabled"),
            decideBillingVerification(problem(409, "play_product_not_enabled")),
        )
        assertEquals(
            BillingVerificationDecision.Terminal("verification_not_found"),
            decideBillingVerification(problem(404, "verification_not_found")),
        )
        assertEquals(
            BillingVerificationDecision.Terminal("billing_lifecycle_disabled"),
            decideBillingVerification(problem(403, "billing_lifecycle_disabled")),
        )
    }

    @Test
    fun duplicateSchedulingUsesTheSameUniqueWorkName() {
        assertEquals(
            BillingVerificationScheduler.workName("verification-1"),
            BillingVerificationScheduler.workName("verification-1"),
        )
    }

    @Test
    fun cachedPaidAccessStopsAtAuthoritativeExpiry() {
        val manager = EntitlementManager(UsageLogger())
        val paidFeature = EntitlementDto(
            key = "analytics_reporting.operational_dashboard",
            implementation_status = "implemented",
            available = true,
            mode = "value",
            value = JsonPrimitive(true),
        )
        manager.updateFromBackend(
            BackendConfig(
                subscription_status = "active",
                current_period_end = Instant.now().minus(1, ChronoUnit.MINUTES).toString(),
                entitlements = mapOf(paidFeature.key to paidFeature),
            )
        )
        assertFalse(manager.isEntitlementAvailable(paidFeature.key))

        manager.updateFromBackend(
            BackendConfig(
                subscription_status = "active",
                current_period_end = Instant.now().plus(1, ChronoUnit.DAYS).toString(),
                entitlements = mapOf(paidFeature.key to paidFeature),
            )
        )
        assertTrue(manager.isEntitlementAvailable(paidFeature.key))
    }
}
