package app.orderak.seller.core.network

import app.orderak.seller.data.remote.StoreRes
import kotlinx.serialization.SerializationException
import kotlinx.serialization.Serializable
import kotlinx.serialization.decodeFromString
import org.junit.Assert.assertEquals
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
}
