package app.orderak.seller.core.network

import app.orderak.seller.BuildConfig
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Test

/**
 * The public URL builders are the single choke point for share links. They must
 * produce the new scheme (/{public_identifier}[/c|/p/{code}]) and never embed a
 * phone number or the legacy /c/ store prefix.
 */
class BackendUrlTest {

    private val pid = "EG-fresh-market-7KX9MP4R"

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

    @Test
    fun `store url uses the public identifier at the root`() {
        assertEquals("${BuildConfig.SITE_BASE_URL}/EG-fresh-market-7KX9MP4R", Backend.storeUrl(pid))
    }

    @Test
    fun `category url nests under the store`() {
        assertEquals(
            "${BuildConfig.SITE_BASE_URL}/EG-fresh-market-7KX9MP4R/c/c-A82KD9",
            Backend.categoryUrl(pid, "c-A82KD9"),
        )
    }

    @Test
    fun `product url nests under the store`() {
        assertEquals(
            "${BuildConfig.SITE_BASE_URL}/EG-fresh-market-7KX9MP4R/p/p-H72LP9",
            Backend.productUrl(pid, "p-H72LP9"),
        )
    }

    @Test
    fun `store url never contains the legacy c prefix`() {
        assertFalse(Backend.storeUrl(pid).contains("/c/"))
    }
}
