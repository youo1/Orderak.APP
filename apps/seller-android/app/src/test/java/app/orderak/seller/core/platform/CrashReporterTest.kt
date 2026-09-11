package app.orderak.seller.core.platform

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * Route redaction is a privacy control, so it is tested as one.
 *
 * The case that matters is the customer route: it addresses a customer by their
 * normalised phone number, so its raw path IS a phone number. Everything else
 * here exists to stop a future change loosening the rule far enough to let that
 * one through.
 */
class RedactRouteTest {

    @Test
    fun `keeps the fixed api prefix`() {
        // v1 contains a digit and would redact to {id} under the general rule,
        // which would flatten every route in the app to the same string.
        assertEquals("/api/v1/config", redactRoute("/api/v1/config"))
    }

    @Test
    fun `never lets a customer phone number through`() {
        // The whole reason this function exists. The customer key is a
        // normalised phone number, so the raw path is buyer PII.
        val redacted = redactRoute("/api/v1/customers/+201012345678")
        assertEquals("/api/v1/customers/{id}", redacted)
        assertFalse(redacted.contains("201012345678"))
    }

    @Test
    fun `never lets a percent-encoded phone number through`() {
        // How it actually arrives: the client encodes the leading + before
        // putting it in the URL, so the digits are still there in a different
        // shape.
        val redacted = redactRoute("/api/v1/customers/%2B201012345678")
        assertEquals("/api/v1/customers/{id}", redacted)
        assertFalse(redacted.contains("201012345678"))
    }

    @Test
    fun `redacts identifiers but keeps the route readable`() {
        // The report still has to say WHICH endpoint failed, or it is no use.
        assertEquals("/api/v1/orders/{id}/status", redactRoute("/api/v1/orders/42/status"))
        assertEquals("/api/v1/categories/{id}", redactRoute("/api/v1/categories/c-A1B2C3"))
    }

    @Test
    fun `drops the query string whole`() {
        // Dropped rather than filtered: a filter has to be right about every
        // parameter that exists now and every one added later.
        assertEquals("/api/v1/orders", redactRoute("/api/v1/orders?since=2026-09-01&phone=%2B2010"))
    }

    @Test
    fun `keeps multi-word static routes intact`() {
        assertEquals(
            "/api/v1/auth/phone-change/challenges",
            redactRoute("/api/v1/auth/phone-change/challenges"),
        )
    }

    @Test
    fun `treats an unexpectedly long segment as an identifier`() {
        // Deny-by-default: a segment nobody anticipated is an id, not a word.
        val long = "a".repeat(40)
        assertEquals("/api/v1/{id}", redactRoute("/api/v1/$long"))
    }

    @Test
    fun `handles a path with nothing in it`() {
        assertEquals("/", redactRoute(""))
        assertEquals("/", redactRoute("/"))
    }

    @Test
    fun `truncates a pathologically deep path`() {
        val deep = "/api/v1/" + (1..20).joinToString("/") { "seg" }
        val redacted = redactRoute(deep)
        assertTrue(redacted.endsWith("/…"))
    }
}

class ReportableFailureTest {

    @Test
    fun `reports a server error`() {
        assertTrue(isReportableFailure("http_500"))
        assertTrue(isReportableFailure("http_503"))
        assertTrue(isReportableFailure("bad_response"))
    }

    @Test
    fun `does not report the offline case`() {
        // A seller using this app is frequently offline — at a stall, on a bad
        // connection. Reporting that would spend the quota on normal life and
        // train whoever reads the console to ignore it.
        assertFalse(isReportableFailure("network"))
    }

    @Test
    fun `does not report a client error`() {
        // A 4xx is the server answering correctly about a bad request. It is
        // handled by the DTO's error field and is not an incident.
        assertFalse(isReportableFailure("http_404"))
        assertFalse(isReportableFailure("http_409"))
    }
}
