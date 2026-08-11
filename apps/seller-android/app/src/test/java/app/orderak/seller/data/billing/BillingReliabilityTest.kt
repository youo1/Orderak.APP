package app.orderak.seller.data.billing

import app.orderak.seller.data.remote.BackendConfig
import app.orderak.seller.data.remote.EntitlementDto
import app.orderak.seller.data.remote.EntitlementSnapshotRes
import app.orderak.seller.data.remote.VerifyPlayPurchaseRes
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
                status = "verification_pending",
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
