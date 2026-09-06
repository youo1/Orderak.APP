package app.orderak.seller.core.ui

import app.orderak.seller.data.billing.FeatureKeys
import app.orderak.seller.data.remote.BackendConfig
import app.orderak.seller.data.remote.EntitlementDto
import kotlinx.serialization.json.JsonPrimitive
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test
import java.io.File

/**
 * What the usage card shows, and what it refuses to guess.
 *
 * The dashboard and the subscription screen each used to hold their own key
 * list and their own filter. They disagreed on the case that matters: an
 * unlimited entitlement drew a count on the dashboard and was dropped entirely
 * on the subscription screen, so the two places the app offers to answer "how
 * much of my plan is left" answered differently for the same plan. Equalising
 * the two lists would have fixed that instance and left the next one to happen,
 * so there is one list now — and these tests are about the shared behaviour
 * rather than about either screen.
 */
class PlanUsageTest {

    private fun limit(key: String, value: Int?, used: Int?, mode: String = "value") = EntitlementDto(
        key = key,
        implementation_status = "implemented",
        mode = mode,
        value = value?.let(::JsonPrimitive),
        available = true,
        used = used,
    )

    private fun config(vararg items: EntitlementDto) = BackendConfig(
        plan_id = "free",
        entitlements = items.associateBy { it.key },
    )

    @Test
    fun `a finite limit becomes a meter row`() {
        val rows = planUsageRows(config(limit(FeatureKeys.MAX_PRODUCTS, 20, 3)))
        assertEquals(1, rows.size)
        assertEquals(FeatureKeys.MAX_PRODUCTS, rows[0].key)
        assertEquals(3, rows[0].used)
        assertEquals(20, rows[0].limit)
    }

    @Test
    fun `an unlimited entitlement is kept as a count, not dropped`() {
        // The disagreement this file exists to end. Dropping it left a seller on
        // the top plan looking at a card that had gone silent about the very
        // thing they pay for.
        val rows = planUsageRows(config(limit(FeatureKeys.MAX_PRODUCTS, null, 412, mode = "unlimited")))
        assertEquals(1, rows.size)
        assertEquals(412, rows[0].used)
        assertNull("unlimited must survive as a null ceiling", rows[0].limit)
    }

    @Test
    fun `a key the snapshot does not carry is omitted`() {
        val rows = planUsageRows(config(limit(FeatureKeys.MAX_PRODUCTS, 20, 3)))
        assertTrue(rows.none { it.key == FeatureKeys.MAX_CATEGORIES })
    }

    @Test
    fun `a missing key omits its row and never blanks the card`() {
        // The failure mode worth naming: one absent key must cost one row, not
        // the whole card.
        val rows = planUsageRows(
            config(
                limit(FeatureKeys.MAX_PRODUCTS, 20, 3),
                limit(FeatureKeys.MAX_ORDERS_PER_MONTH, 50, 11),
            ),
        )
        assertEquals(2, rows.size)
    }

    @Test
    fun `an uncounted limit draws nothing rather than an assumed zero`() {
        // `used = null` means nobody counted it. Rendering it as a full bar at
        // zero would tell a seller they have used none of something the server
        // never measured.
        val rows = planUsageRows(config(limit(FeatureKeys.MAX_AI_REQUESTS_PER_MONTH, 20, null)))
        assertTrue(rows.isEmpty())
    }

    @Test
    fun `an empty snapshot yields no rows and no crash`() {
        assertTrue(planUsageRows(BackendConfig(plan_id = "free")).isEmpty())
    }

    @Test
    fun `every usage key is a registered key`() {
        for ((key, _) in PLAN_USAGE_KEYS) {
            assertTrue("$key is not in FeatureKeys.ALL", key in FeatureKeys.ALL)
        }
    }

    @Test
    fun `every registered key has a call site`() {
        // A registry that accumulates keys nothing reads stops being a registry.
        val root = generateSequence(File("").absoluteFile) { it.parentFile }
            .map { File(it, "app/src/main/java/app/orderak/seller") }
            .firstOrNull(File::isDirectory)
            ?: generateSequence(File("").absoluteFile) { it.parentFile }
                .map { File(it, "apps/seller-android/app/src/main/java/app/orderak/seller") }
                .firstOrNull(File::isDirectory)
        if (root == null) return

        val sources = root.walkTopDown()
            .filter { it.isFile && it.extension == "kt" && it.name != "FeatureAvailabilityResolver.kt" }
            .joinToString("\n") { it.readText() }

        val constantFor = mapOf(
            FeatureKeys.OCR_RECEIPT_ASSISTANCE to "FeatureKeys.OCR_RECEIPT_ASSISTANCE",
            FeatureKeys.MAX_PRODUCTS to "FeatureKeys.MAX_PRODUCTS",
            FeatureKeys.MAX_CATEGORIES to "FeatureKeys.MAX_CATEGORIES",
            FeatureKeys.MAX_ORDERS_PER_MONTH to "FeatureKeys.MAX_ORDERS_PER_MONTH",
            FeatureKeys.MAX_AI_REQUESTS_PER_MONTH to "FeatureKeys.MAX_AI_REQUESTS_PER_MONTH",
            FeatureKeys.MAX_CONCURRENT_DEVICES to "FeatureKeys.MAX_CONCURRENT_DEVICES",
            FeatureKeys.SHOW_ADS to "FeatureKeys.SHOW_ADS",
        )
        for (key in FeatureKeys.ALL) {
            val reference = constantFor.getValue(key)
            assertTrue("$reference is registered but never read", sources.contains(reference))
        }
    }
}
