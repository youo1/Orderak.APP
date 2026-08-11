package app.orderak.seller.core.phone

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class CountriesTest {

    // ── toE164 ──

    @Test
    fun `toE164 formats a valid EG number correctly`() {
        val egypt = Countries.byIso("EG")
        assertEquals("+201012345678", Countries.toE164(egypt, "01012345678"))
    }

    @Test
    fun `toE164 preserves leading zero after country code for Italy`() {
        // libphonenumber checks: landline with area code 02 (Milan)
        // Manual trimStart('0') would incorrectly produce +392...
        val italy = Countries.byIso("IT")
        val result = Countries.toE164(italy, "0212345678")
        // The leading '0' after +39 is significant in Italian numbering
        assertNotNull("Italian numbers with area code should format successfully", result)
        assertEquals("+390212345678", result)
    }

    @Test
    fun `toE164 returns null for clearly invalid number`() {
        val egypt = Countries.byIso("EG")
        assertNull(Countries.toE164(egypt, "999"))
    }

    @Test
    fun `toE164 returns null for blank input`() {
        val egypt = Countries.byIso("EG")
        assertNull(Countries.toE164(egypt, ""))
    }

    // ── fromE164 ──

    @Test
    fun `fromE164 resolves an EG E164 to Egypt`() {
        val country = Countries.fromE164("+201012345678")
        assertNotNull(country)
        assertEquals("EG", country?.iso)
    }

    @Test
    fun `fromE164 resolves US number to correct Country`() {
        val country = Countries.fromE164("+14155551234")
        assertNotNull(country)
        // NANP covers multiple regions; libphonenumber returns the canonical one.
        // US is the primary region for +1.
        assertTrue(country?.iso == "US" || country?.iso == "CA")
    }

    @Test
    fun `fromE164 returns null for blank input`() {
        assertNull(Countries.fromE164(""))
    }

    @Test
    fun `fromE164 returns null for unparseable input`() {
        assertNull(Countries.fromE164("not-a-number"))
    }

    @Test
    fun `fromE164 resolves Italy E164 correctly`() {
        val country = Countries.fromE164("+390212345678")
        assertNotNull(country)
        assertEquals("IT", country?.iso)
    }

    // ── curated / default ──

    @Test
    fun `curated contains EG as first entry`() {
        assertTrue(Countries.curated.isNotEmpty())
        assertEquals("EG", Countries.curated.first().iso)
    }

    @Test
    fun `default resolves to EG or system region`() {
        val default = Countries.default
        assertNotNull(default)
        assertTrue(default.iso.length == 2)
    }

    @Test
    fun `byIso returns default for null`() {
        assertEquals(Countries.default.iso, Countries.byIso(null).iso)
    }

    @Test
    fun `byIso returns default for unknown iso`() {
        assertEquals(Countries.default.iso, Countries.byIso("XX").iso)
    }
}
