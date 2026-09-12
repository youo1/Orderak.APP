package app.orderak.seller.data.remote

import okhttp3.Interceptor
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.Protocol
import okhttp3.Request
import okhttp3.RequestBody.Companion.toRequestBody
import okhttp3.Response
import okhttp3.ResponseBody.Companion.toResponseBody
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test
import java.lang.reflect.Proxy

/**
 * A stand-in chain, so this needs neither MockWebServer nor a new dependency.
 *
 * A dynamic proxy rather than a hand-written implementation: OkHttp 5's
 * `Interceptor.Chain` declares upwards of thirty members (withDns,
 * withProxySelector, withCertificatePinner, …) and stubbing them all would be
 * noise that breaks again on the next OkHttp bump. The interceptors under test
 * call exactly two of them; anything else throwing is the correct behaviour,
 * because reaching it would mean the interceptor does something this test did
 * not account for.
 */
private class FakeChain(request: Request, responses: MutableList<Response>) {
    val issued = mutableListOf<Request>()

    val chain: Interceptor.Chain = Proxy.newProxyInstance(
        Interceptor.Chain::class.java.classLoader,
        arrayOf(Interceptor.Chain::class.java),
    ) { _, method, args ->
        when (method.name) {
            "request" -> request
            "proceed" -> {
                issued += args!![0] as Request
                // Repeat the last scripted response once the script runs out, so
                // a test that over-retries fails on the attempt count rather than
                // on an index out of bounds.
                if (responses.size > 1) responses.removeAt(0) else responses[0]
            }
            else -> throw UnsupportedOperationException(method.name)
        }
    } as Interceptor.Chain
}

private fun request(
    url: String = "https://api.orderak.app/api/v1/orders",
    method: String = "GET",
    headers: Map<String, String> = emptyMap(),
): Request {
    val builder = Request.Builder().url(url)
    headers.forEach { (name, value) -> builder.header(name, value) }
    return if (method == "GET") builder.get().build() else builder.method(method, "{}".toRequestBodyJson()).build()
}

private fun String.toRequestBodyJson() = toRequestBody("application/json".toMediaType())

private fun response(request: Request, code: Int, headers: Map<String, String> = emptyMap()): Response {
    val builder = Response.Builder()
        .request(request)
        .protocol(Protocol.HTTP_1_1)
        .code(code)
        .message("m")
        .body("{}".toResponseBody("application/json".toMediaType()))
    headers.forEach { (name, value) -> builder.header(name, value) }
    return builder.build()
}

class RetryInterceptorTest {

    private val slept = mutableListOf<Long>()
    private val interceptor = RetryInterceptor(maxAttempts = 3, sleep = { slept += it })

    @Test
    fun `retries a 503 on a GET and returns the eventual success`() {
        val req = request()
        val chain = FakeChain(req, mutableListOf(response(req, 503), response(req, 200)))

        val result = interceptor.intercept(chain.chain)

        assertEquals(200, result.code)
        assertEquals(2, chain.issued.size)
    }

    @Test
    fun `stops at maxAttempts rather than retrying forever`() {
        val req = request()
        val chain = FakeChain(req, mutableListOf(response(req, 500)))

        val result = interceptor.intercept(chain.chain)

        assertEquals(500, result.code)
        assertEquals(3, chain.issued.size)
    }

    @Test
    fun `honours Retry-After on a 429`() {
        val req = request()
        val chain = FakeChain(req, mutableListOf(response(req, 429, mapOf("Retry-After" to "7")), response(req, 200)))

        interceptor.intercept(chain.chain)

        assertEquals(listOf(7_000L), slept)
    }

    @Test
    fun `caps a Retry-After the server sets absurdly high`() {
        val req = request()
        val chain = FakeChain(req, mutableListOf(response(req, 429, mapOf("Retry-After" to "86400")), response(req, 200)))

        interceptor.intercept(chain.chain)

        assertEquals(listOf(30_000L), slept)
    }

    @Test
    fun `ignores an HTTP-date Retry-After and falls back to its own backoff`() {
        // Not parsed on purpose: it would need the device clock to agree with the
        // server's, which on these handsets it frequently does not.
        val req = request()
        val chain = FakeChain(
            req,
            mutableListOf(response(req, 429, mapOf("Retry-After" to "Wed, 21 Oct 2026 07:28:00 GMT")), response(req, 200)),
        )

        interceptor.intercept(chain.chain)

        assertEquals(listOf(2_000L), slept)
    }

    @Test
    fun `never replays a POST without an idempotency key`() {
        // products/sync is a full-mirror push: whatever the payload omits, the
        // server deletes. Replaying one against a catalogue that moved in between
        // is how a seller loses products.
        val req = request(url = "https://api.orderak.app/api/v1/products/sync", method = "POST")
        val chain = FakeChain(req, mutableListOf(response(req, 503)))

        val result = interceptor.intercept(chain.chain)

        assertEquals(503, result.code)
        assertEquals(1, chain.issued.size)
        assertTrue(slept.isEmpty())
    }

    @Test
    fun `replays a POST that carries an idempotency key`() {
        val req = request(method = "POST", headers = mapOf("idempotency-key" to "abc"))
        val chain = FakeChain(req, mutableListOf(response(req, 503), response(req, 200)))

        val result = interceptor.intercept(chain.chain)

        assertEquals(200, result.code)
        assertEquals(2, chain.issued.size)
    }

    @Test
    fun `does not retry a 4xx that is not 429`() {
        val req = request()
        val chain = FakeChain(req, mutableListOf(response(req, 403)))

        interceptor.intercept(chain.chain)

        assertEquals(1, chain.issued.size)
    }
}

class CredentialVaryInterceptorTest {

    private val interceptor = CredentialVaryInterceptor()

    @Test
    fun `makes the seller phone part of the cache key on a credentialed request`() {
        // OkHttp keys the cache on the URL, and the credential travels in headers.
        // Without this, a cacheable response to one seller could be served to the
        // next seller signed in on the same device.
        val req = request(headers = mapOf("x-orderak-phone" to "+201000000000"))
        val chain = FakeChain(req, mutableListOf(response(req, 200)))

        val result = interceptor.intercept(chain.chain)

        assertEquals("x-orderak-phone", result.header("Vary"))
    }

    @Test
    fun `preserves a Vary the server already set`() {
        val req = request(headers = mapOf("x-orderak-phone" to "+201000000000"))
        val chain = FakeChain(req, mutableListOf(response(req, 200, mapOf("Vary" to "Accept-Language"))))

        val result = interceptor.intercept(chain.chain)

        assertEquals("Accept-Language, x-orderak-phone", result.header("Vary"))
    }

    @Test
    fun `does not duplicate a Vary the server already scoped correctly`() {
        val req = request(headers = mapOf("x-orderak-phone" to "+201000000000"))
        val chain = FakeChain(req, mutableListOf(response(req, 200, mapOf("Vary" to "x-orderak-phone"))))

        val result = interceptor.intercept(chain.chain)

        assertEquals("x-orderak-phone", result.header("Vary"))
    }

    @Test
    fun `leaves an anonymous response alone so public routes stay shareable`() {
        // The plan comparison and assetlinks.json carry nothing store-specific and
        // should be cached once per device, not once per seller.
        val req = request(url = "https://api.orderak.app/api/v1/plans")
        val chain = FakeChain(req, mutableListOf(response(req, 200)))

        val result = interceptor.intercept(chain.chain)

        assertNull(result.header("Vary"))
    }
}
