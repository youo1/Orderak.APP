package app.orderak.seller.core.network

import org.junit.Assert.assertEquals
import org.junit.Assert.assertThrows
import org.junit.Test

class ApiRoutesTest {
    @Test
    fun `explicit v1 seller paths are preserved`() {
        assertEquals("/api/v1/store", ApiRoutes.versioned("/api/v1/store"))
        assertEquals("/api/v1/orders?since=42", ApiRoutes.versioned("/api/v1/orders?since=42"))
    }

    @Test
    fun `unversioned seller paths are rejected`() {
        assertThrows(IllegalArgumentException::class.java) {
            ApiRoutes.versioned("/api/store")
        }
    }

    @Test
    fun `v2 seller paths are rejected`() {
        assertThrows(IllegalArgumentException::class.java) {
            ApiRoutes.versioned("/api/v2/entitlements")
        }
    }

    @Test
    fun `non API paths cannot bypass seller route policy`() {
        assertThrows(IllegalArgumentException::class.java) {
            ApiRoutes.versioned("/health")
        }
    }
}
