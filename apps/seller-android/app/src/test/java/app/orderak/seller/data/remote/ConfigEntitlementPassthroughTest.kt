package app.orderak.seller.data.remote

import app.orderak.seller.core.network.NetworkJson
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.intOrNull
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * The entitlement map has to survive the trip through the piggybacked config.
 *
 * There are two ways the app can learn what a plan allows: `/api/v1/entitlements`
 * directly, and the `config` block the orders pull carries along with it. The
 * second is the one that works when the first request fails, and until work
 * item 03a it could not carry entitlements at all — `ConfigRes` had no such
 * field, so the server could have sent a complete map and the decoder would have
 * dropped it on the floor without an error.
 *
 * That failure is silent in both directions, which is why it is worth a test
 * rather than a reading: an empty map is a valid map, every gate reads it as
 * "not built", and the app looks like a plan with no features rather than like
 * something broken.
 */
class ConfigEntitlementPassthroughTest {

    private val json = NetworkJson.decoder

    /** A config payload shaped the way loadPlanConfig now emits it. */
    private val payload = """
        {
          "ok": true,
          "plan_id": "free",
          "plan_name": "Free",
          "ads_enabled": true,
          "limits": { "max_products": 20, "max_categories": 5 },
          "features": { "ai_assistant": true },
          "entitlements": {
            "max_products": {
              "key": "max_products",
              "name": "max_products",
              "category": "Plan limits",
              "implementation_status": "implemented",
              "mode": "value",
              "value": 20,
              "display_value": "20",
              "available": true,
              "used": 3,
              "remaining": 17,
              "custom_required": false
            },
            "orders_fulfilment.order_history": {
              "key": "orders_fulfilment.order_history",
              "name": "Order history",
              "category": "Orders & fulfilment",
              "implementation_status": "implemented",
              "mode": "value",
              "value": true,
              "display_value": "Included",
              "available": true,
              "custom_required": false
            }
          }
        }
    """.trimIndent()

    @Test
    fun `config response decodes the entitlement map`() {
        val decoded = json.decodeFromString<ConfigRes>(payload)

        assertTrue(decoded.ok)
        assertEquals(2, decoded.entitlements.size)
        val products = decoded.entitlements.getValue("max_products")
        assertEquals(3, products.used)
        assertEquals(20, (products.value as? JsonPrimitive)?.intOrNull)
        assertTrue(decoded.entitlements.getValue("orders_fulfilment.order_history").available)
    }

    @Test
    fun `an older payload without the field still decodes`() {
        // Every installed build predates this field, and the server keeps sending
        // the flat blocks for them. The reverse has to hold too: a response
        // written before the field existed must not fail to parse.
        val legacy = json.decodeFromString<ConfigRes>(
            """{"ok":true,"plan_id":"free","limits":{"max_products":20}}""",
        )
        assertTrue(legacy.ok)
        assertTrue(legacy.entitlements.isEmpty())
    }

    @Test
    fun `the fallback conversion carries the map into BackendConfig`() {
        // Mirrors the conversion in SyncRepository. The map used to be omitted
        // here, so even a complete server response reached the resolver empty.
        val c = json.decodeFromString<ConfigRes>(payload)
        val config = BackendConfig(
            plan_id = c.plan_id,
            plan_name = c.plan_name,
            ads_enabled = c.ads_enabled,
            limits = c.limits,
            features = c.features,
            entitlements = c.entitlements,
            governance = c.governance,
        )

        assertEquals(c.entitlements.keys, config.entitlements.keys)
        assertTrue(config.entitlements.getValue("max_products").available)
    }

    @Test
    fun `a meter can be drawn from what the map carries`() {
        // Both meter call sites drop a row whose `used` is null and a value that
        // is not an integer. A map that arrives without those is a map that
        // renders nothing, which looks the same to a seller as no map at all.
        val decoded = json.decodeFromString<ConfigRes>(payload)
        val renderable = decoded.entitlements.values.count { item ->
            item.used != null && item.mode == "value" && (item.value as? JsonPrimitive)?.intOrNull != null
        }
        assertTrue("no entitlement in the map can draw a meter", renderable > 0)
    }
}
