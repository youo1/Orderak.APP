package app.orderak.seller.core

import app.orderak.seller.core.phone.Countries
import app.orderak.seller.core.locale.AppLocales
import app.orderak.seller.core.locale.resolveSupportedSystemTag
import app.orderak.seller.core.money.parseEgpToPiasters
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotEquals
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test
import java.text.Collator
import java.util.Locale

class LocalizationTest {
    private lateinit var originalLocale: Locale

    @Before
    fun rememberLocale() {
        originalLocale = Locale.getDefault()
    }

    @After
    fun restoreLocale() {
        Locale.setDefault(originalLocale)
    }

    @Test
    fun `language picker vocabulary contains only explicit shipped languages`() {
        assertEquals(listOf("ar", "en", "fr"), AppLocales.supported.map { it.tag })
        assertEquals(listOf("العربية", "English", "Français"), AppLocales.supported.map { it.nativeName })
    }

    @Test
    fun `first launch follows shipped system locales and otherwise uses English`() {
        assertEquals("ar", resolveSupportedSystemTag("ar-EG,en-US"))
        assertEquals("en", resolveSupportedSystemTag("en-GB"))
        assertEquals("fr", resolveSupportedSystemTag("fr-CA"))
        assertEquals("en", resolveSupportedSystemTag("de-DE"))
        assertEquals("en", resolveSupportedSystemTag(""))
    }

    @Test
    fun `money parser accepts French decimal separator`() {
        Locale.setDefault(Locale.FRENCH)
        assertEquals(435L, parseEgpToPiasters("4,35"))
    }

    @Test
    fun `money parser accepts Arabic digits and decimal separator`() {
        Locale.setDefault(Locale.forLanguageTag("ar-EG"))
        assertEquals(435L, parseEgpToPiasters("٤٫٣٥"))
    }

    @Test
    fun `country names follow requested locale`() {
        val egypt = Countries.byIso("EG")
        val english = Countries.localized(egypt, Locale.ENGLISH).name
        val french = Countries.localized(egypt, Locale.FRENCH).name
        assertNotEquals(english, french)
    }

    @Test
    fun `country list uses locale collation`() {
        val locale = Locale.FRENCH
        val collator = Collator.getInstance(locale)
        val countries = Countries.all(locale)
        assertTrue(countries.zipWithNext().all { (a, b) -> collator.compare(a.name, b.name) <= 0 })
    }
}
