package app.orderak.seller.data.db

import app.orderak.seller.core.phone.CustomerPhone
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * A seller's edit to a customer has to survive the sync that follows it.
 *
 * This is the behaviour behind `customers_crm.editable_customer_profiles`. The
 * catalogue sold that feature at paid1 while CustomerDetailsScreen rendered an
 * order list with no edit control and no write path — the finding that put the
 * behaviour axis into the evidence verifier, and the reason this file is named
 * as that feature's evidence rather than the screen.
 *
 * Two properties, both of which have to hold or the editor is worse than not
 * having one:
 *
 *   - an edit not yet acknowledged is never overwritten by the value it replaced
 *   - two spellings of one number are one customer, and anything that cannot be
 *     resolved is left alone rather than merged with a guess (I-6)
 */
class CustomerMergeTest {

    private fun local(
        key: String = "+201012345678",
        name: String? = "Mona",
        dirty: Boolean = false,
    ) = CustomerEntity(
        customerKey = key,
        phone = "01012345678",
        phoneE164 = "+201012345678",
        phoneStatus = "valid",
        name = name,
        createdAt = 1_000L,
        updatedAt = 1_000L,
        dirty = dirty,
    )

    // ---- an edit persists ---------------------------------------------------

    @Test
    fun `an edit the server has not acknowledged survives the next pull`() {
        // The seller renamed this customer while offline. Sync pushes the edit
        // and then pulls the list; the pulled row still carries the old name,
        // because the push has not landed. Accepting it would show the seller
        // their correction reverting.
        val edited = local(name = "Mona Abdullah", dirty = true)

        assertFalse(mayAcceptServerCopy(edited))
    }

    @Test
    fun `an acknowledged row takes the server's copy`() {
        val settled = local(name = "Mona", dirty = false)

        assertTrue(mayAcceptServerCopy(settled))

        val adopted = adoptedCustomer(
            customerKey = settled.customerKey,
            phoneRaw = settled.phone,
            phoneE164 = settled.phoneE164,
            phoneStatus = "valid",
            name = "Mona Abdullah",
            altContact = "01199887766",
            note = "Prefers evening delivery",
            local = settled,
            now = 9_000L,
        )

        // The edit is what the server now holds, so it is what the device shows.
        assertEquals("Mona Abdullah", adopted.name)
        assertEquals("01199887766", adopted.altContact)
        assertEquals("Prefers evening delivery", adopted.note)
        assertFalse(adopted.dirty)
        // First-seen time is the device's own and does not move because a sync ran.
        assertEquals(1_000L, adopted.createdAt)
    }

    @Test
    fun `a customer this device has never seen is first seen now`() {
        val adopted = adoptedCustomer(
            customerKey = "+201555000111",
            phoneRaw = "+201555000111",
            phoneE164 = "+201555000111",
            phoneStatus = "valid",
            name = "Karim",
            altContact = null,
            note = null,
            local = null,
            now = 9_000L,
        )

        assertEquals(9_000L, adopted.createdAt)
        assertTrue(mayAcceptServerCopy(null))
    }

    // ---- identity (I-6) -----------------------------------------------------

    @Test
    fun `two spellings of one number are one customer`() {
        val national = CustomerPhone.normalize("01012345678", "EG")
        val international = CustomerPhone.normalize("+201012345678", "EG")

        assertEquals(CustomerPhone.Status.VALID, national.status)
        assertEquals(CustomerPhone.Status.VALID, international.status)
        assertEquals(international.key, national.key)
        assertEquals("+201012345678", national.key)
    }

    @Test
    fun `a number with no country to read it against keys to itself`() {
        // A bare national number and no seller country. It may be a real number;
        // there is nothing here that says whose, and merging it with a number
        // that happens to share its digits would join two people's histories.
        val ambiguous = CustomerPhone.normalize("5551234567", null)

        assertEquals(CustomerPhone.Status.AMBIGUOUS, ambiguous.status)
        assertNull(ambiguous.e164)
        assertEquals("5551234567", ambiguous.key)
        assertFalse(ambiguous.mergeable)
    }

    @Test
    fun `an unresolvable value never collides with a resolved one`() {
        val resolved = CustomerPhone.normalize("01012345678", "EG")
        val unresolved = CustomerPhone.normalize("12345", "EG")

        assertEquals(CustomerPhone.Status.INVALID, unresolved.status)
        assertNotEquals(resolved.key, unresolved.key)
    }

    @Test
    fun `a privacy sentinel is not a phone number and is never parsed`() {
        // The buyer-privacy erasure path writes `deleted:<hex>` into buyer_phone.
        // Normalising, merging or re-identifying one would undo the erasure it
        // records.
        val sentinel = CustomerPhone.normalize("deleted:a1b2c3d4e5f60718293a", "EG")

        assertEquals(CustomerPhone.Status.SENTINEL, sentinel.status)
        assertNull(sentinel.e164)
        assertEquals("deleted:a1b2c3d4e5f60718293a", sentinel.key)
        assertFalse(sentinel.mergeable)
    }
}
