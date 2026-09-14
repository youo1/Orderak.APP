package app.orderak.seller.data.customers

import app.orderak.seller.data.remote.CustomerDto
import app.orderak.seller.data.remote.CustomerRes
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * An edit the seller is told was saved really was saved.
 *
 * WHAT THIS REPLACES, AND WHY THE PROPERTY CHANGED
 *   `CustomerMergeTest` asserted that an edit the server had not acknowledged
 *   survived the next pull. That property was correct and it no longer exists:
 *   there is no unacknowledged edit to protect, because a customer edit is
 *   Class A and either reached the server or did not happen.
 *
 *   The property that replaces it is the one a seller actually depends on:
 *
 *       network failure
 *         -> the operation fails, visibly
 *         -> the local database is unchanged
 *         -> NO pending mutation is created anywhere
 *
 *   The old failure was an edit quietly lost after being reported as saved. The
 *   failure this guards is the same seller harm arriving by the opposite route —
 *   the screen saying "saved" for a write that never left the device.
 *
 * WHY A PURE FUNCTION IS WHAT IS TESTED
 *   `CustomerWriteRepository` has exactly one line that writes the cache, and it
 *   is reachable only from [CustomerWriteResult.Saved]. So the invariant reduces
 *   to a claim about this decision: no answer other than an accepted one carries
 *   a customer. The sweep at the bottom is that claim, over every failure shape
 *   the transport and the server can produce.
 */
class CustomerWriteDecisionTest {

    private val customer = CustomerDto(
        customer_key = "2010xxxxxxx",
        phone_raw = "01012345678",
        phone_e164 = "+201012345678",
        name = "Mona",
        note = "prefers evening delivery",
    )

    @Test
    fun `an accepted edit is the only answer that carries a customer`() {
        val decision = decideCustomerWrite(CustomerRes(ok = true, customer = customer))
        assertTrue(decision is CustomerWriteResult.Saved)
        assertEquals(customer, (decision as CustomerWriteResult.Saved).customer)
    }

    @Test
    fun `a dropped request is offline rather than refused`() {
        // The seller's note is still worth retyping; telling them the server
        // rejected it would be inventing a verdict nobody gave.
        for (code in listOf("network", "bad_response", "http_500", "http_503")) {
            assertEquals(
                "$code must not read as a refusal",
                CustomerWriteResult.Offline,
                decideCustomerWrite(CustomerRes(ok = false, error = code)),
            )
        }
    }

    @Test
    fun `a server refusal keeps its code so the screen can name it`() {
        assertEquals(
            CustomerWriteResult.Refused("not_found"),
            decideCustomerWrite(CustomerRes(ok = false, error = "not_found")),
        )
    }

    @Test
    fun `ok without a customer is not something to store`() {
        assertTrue(decideCustomerWrite(CustomerRes(ok = true, customer = null)) is CustomerWriteResult.Refused)
    }

    @Test
    fun `no failure of any shape is reported as saved`() {
        // The sweep, including the shape that matters most: a server that says
        // no while still sending the record back. Without requiring `ok`, that
        // would turn a refusal into a silent overwrite of what the seller typed.
        val failures = listOf(
            CustomerRes(ok = false, error = "network"),
            CustomerRes(ok = false, error = "bad_response"),
            CustomerRes(ok = false, error = "http_502"),
            CustomerRes(ok = false, error = "not_found"),
            CustomerRes(ok = false, error = "feature_disabled"),
            CustomerRes(ok = false, error = null),
            CustomerRes(ok = false, customer = customer, error = "not_found"),
            CustomerRes(ok = true, customer = null),
        )
        for (res in failures) {
            assertTrue(
                "error=${res.error} ok=${res.ok} must not be reported as saved",
                decideCustomerWrite(res) !is CustomerWriteResult.Saved,
            )
        }
    }
}
