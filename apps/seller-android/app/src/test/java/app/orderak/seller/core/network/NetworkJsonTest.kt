package app.orderak.seller.core.network

import app.orderak.seller.data.remote.AccountStatusRes
import app.orderak.seller.data.remote.StoreRes
import app.orderak.seller.data.remote.VerifyPlayPurchaseRes
import kotlinx.serialization.SerializationException
import kotlinx.serialization.Serializable
import kotlinx.serialization.decodeFromString
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Assert.assertThrows
import org.junit.Test

class NetworkJsonTest {
    @Serializable
    private data class Nested(val name: String)

    @Serializable
    private data class RequiredEnvelope(val id: String, val nested: Nested)

    @Test
    fun `central decoder always ignores unknown response fields`() {
        assertTrue(NetworkJson.decoder.configuration.ignoreUnknownKeys)
        val decoded = NetworkJson.decoder.decodeFromString<RequiredEnvelope>(
            """{"id":"1","future_top":true,"nested":{"name":"store","future_nested":42}}""",
        )
        assertEquals("store", decoded.nested.name)
    }

    @Test
    fun `required missing or wrong typed fields still fail`() {
        assertThrows(SerializationException::class.java) {
            NetworkJson.decoder.decodeFromString<RequiredEnvelope>("""{"nested":{"name":"store"}}""")
        }
        assertThrows(SerializationException::class.java) {
            NetworkJson.decoder.decodeFromString<RequiredEnvelope>("""{"id":5,"nested":{"name":"store"}}""")
        }
    }

    @Test
    fun `problem code maps to existing domain error property`() {
        val decoded = NetworkJson.decoder.decodeFromString<StoreRes>(
            """{"type":"https://developers.orderak.app/problems/auth","title":"Auth","status":401,"code":"auth","detail":"Auth","request_id":"r1","future":true}""",
        )
        assertEquals("auth", decoded.error)
    }

    /**
     * The test above passes for a DTO that has no `status` field of its own.
     * Every DTO that does had to decode `status` as two different types: a
     * domain string on 2xx, and the numeric HTTP status on problem+json, which
     * RFC 9457 requires. Declaring it as a String made every error body throw
     * and surface as "bad_response" — losing the `code` sitting beside it.
     *
     * These cover both halves of both affected DTOs, because the previous
     * decode failure was invisible to a suite that only ever fed them success
     * bodies.
     */
    private fun problemJson(status: Int, code: String): String =
        """{"type":"https://developers.orderak.app/problems/$code","title":"T","status":$status,""" +
            """"code":"$code","detail":"T","request_id":"r1"}"""

    @Test
    fun `billing verification decodes a problem json error instead of failing`() {
        val decoded = NetworkJson.decoder.decodeFromString<VerifyPlayPurchaseRes>(
            problemJson(409, "play_product_not_enabled"),
        )
        assertEquals("play_product_not_enabled", decoded.error)
        assertNull(decoded.verificationState)
        assertFalse(decoded.ok)
    }

    @Test
    fun `billing verification still reads the domain status from a success body`() {
        val decoded = NetworkJson.decoder.decodeFromString<VerifyPlayPurchaseRes>(
            """{"ok":false,"pending":true,"status":"verification_pending","verification_id":"v1","retry_after_seconds":30}""",
        )
        assertEquals("verification_pending", decoded.verificationState)
        assertTrue(decoded.pending)
        assertEquals("v1", decoded.verification_id)
    }

    @Test
    fun `account status decodes a problem json error instead of failing`() {
        val decoded = NetworkJson.decoder.decodeFromString<AccountStatusRes>(problemJson(401, "auth"))
        assertEquals("auth", decoded.error)
        assertFalse(decoded.ok)
    }

    @Test
    fun `account status still reads the domain status from a success body`() {
        val decoded = NetworkJson.decoder.decodeFromString<AccountStatusRes>(
            """{"ok":true,"status":"suspended"}""",
        )
        assertTrue(decoded.ok)
        assertEquals("suspended", decoded.accountStatus)
        assertEquals(
            "active",
            NetworkJson.decoder.decodeFromString<AccountStatusRes>("""{"ok":true}""").accountStatus,
        )
    }
}
