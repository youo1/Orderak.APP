package app.orderak.seller.core.network

import app.orderak.seller.BuildConfig
import org.junit.Assert.assertEquals
import org.junit.Test

/**
 * What remains here is the flavor wiring: each build variant must resolve
 * API_BASE_URL to its own environment, and nothing else may quietly substitute
 * one for another.
 *
 * The four URL-builder tests that used to sit alongside this one went with
 * Backend.storeUrl/categoryUrl/productUrl on 2026-08-22. Those builders
 * reconstructed a share link client-side; every caller now reads the canonical
 * store_url the backend returns, held in SessionStore, so there was nothing
 * left to assert against.
 */
class BackendUrlTest {

    @Test
    fun `base url matches the selected deployment environment`() {
        val expected = when (BuildConfig.DEPLOYMENT_ENVIRONMENT) {
            "staging" -> "https://api.staging.orderak.app"
            "production" -> "https://api.orderak.app"
            "mock" -> "http://10.0.2.2:4010"
            else -> error("Unknown deployment environment")
        }
        assertEquals(expected, BuildConfig.API_BASE_URL)
    }
}
