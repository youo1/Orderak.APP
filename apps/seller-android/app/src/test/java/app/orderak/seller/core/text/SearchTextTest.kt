package app.orderak.seller.core.text

import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * What counts as a match, in the two scripts sellers actually type.
 *
 * A plain case-insensitive `contains` is adequate in Latin and close to useless
 * in Arabic, and the failures are silent: the seller types a name they know is
 * there, sees nothing, and concludes the search is broken or the product is
 * gone. Each test below is one spelling a real keyboard produces.
 */
class SearchTextTest {

    // ---------- Latin ----------

    @Test
    fun `matches regardless of case`() {
        assertTrue(SearchText.matches("cola", "Cola 500ml"))
        assertTrue(SearchText.matches("COLA", "cola 500ml"))
    }

    @Test
    fun `matches in the middle of a name`() {
        assertTrue(SearchText.matches("500", "Cola 500ml"))
    }

    @Test
    fun `does not match a different word`() {
        assertFalse(SearchText.matches("juice", "Cola 500ml"))
    }

    // ---------- Arabic orthography ----------

    @Test
    fun `alef spellings are the same word`() {
        // أحمد and احمد are both correct and both common. A seller who typed one
        // used to find nothing if the record held the other.
        assertTrue(SearchText.matches("احمد", "أحمد محمود"))
        assertTrue(SearchText.matches("أحمد", "احمد محمود"))
        assertTrue(SearchText.matches("اسماعيل", "إسماعيل"))
        assertTrue(SearchText.matches("الان", "الآن"))
    }

    @Test
    fun `ta marbuta and ha are interchangeable at the end of a word`() {
        assertTrue(SearchText.matches("قهوه", "قهوة"))
        assertTrue(SearchText.matches("قهوة", "قهوه"))
    }

    @Test
    fun `alef maqsura and ya are interchangeable`() {
        assertTrue(SearchText.matches("مصطفي", "مصطفى"))
        assertTrue(SearchText.matches("مصطفى", "مصطفي"))
    }

    @Test
    fun `diacritics do not prevent a match`() {
        // An on-screen keyboard may or may not insert them; the seller does not
        // control which, and should not have to reproduce them to search.
        assertTrue(SearchText.matches("محمد", "مُحَمَّد"))
        assertTrue(SearchText.matches("مُحَمَّد", "محمد"))
    }

    @Test
    fun `tatweel is ignored`() {
        // A display-only stretch, never part of the word.
        assertTrue(SearchText.matches("كتاب", "كـــتاب"))
    }

    @Test
    fun `different Arabic words still do not match`() {
        // Folding must not turn everything into everything.
        assertFalse(SearchText.matches("قهوة", "شاي"))
        assertFalse(SearchText.matches("احمد", "محمود"))
    }

    // ---------- Digits ----------

    @Test
    fun `Arabic-Indic digits find a Latin number`() {
        // The case that fails completely without folding: the two forms of the
        // same phone number share no character at all.
        assertTrue(SearchText.matches("٠١٠", "01012345678"))
        assertTrue(SearchText.matches("٠١٠١٢٣٤٥٦٧٨", "01012345678"))
    }

    @Test
    fun `Latin digits find an Arabic-Indic number`() {
        assertTrue(SearchText.matches("010", "٠١٠١٢٣٤٥٦٧٨"))
    }

    // ---------- Mixed and edge cases ----------

    @Test
    fun `a catalogue holding both scripts is searchable in either`() {
        assertTrue(SearchText.matches("cola", "كولا Cola 500ml"))
        assertTrue(SearchText.matches("كولا", "كولا Cola 500ml"))
    }

    @Test
    fun `a blank query matches everything`() {
        // An empty search box is not a filter. Treating it as one would empty
        // the list the moment a seller cleared the field.
        assertTrue(SearchText.matches("", "anything"))
        assertTrue(SearchText.matches("   ", "anything"))
    }

    @Test
    fun `a null or blank field never matches a real query`() {
        assertFalse(SearchText.matches("cola", null))
        assertFalse(SearchText.matches("cola", ""))
    }

    @Test
    fun `any one field matching is enough`() {
        // Products search name and code; customers search name and phone.
        assertTrue(SearchText.matches("p-ABC123", "Cola", "p-ABC123"))
        assertTrue(SearchText.matches("cola", "Cola", "p-ABC123"))
        assertFalse(SearchText.matches("juice", "Cola", "p-ABC123"))
    }

    @Test
    fun `surrounding whitespace in the query is ignored`() {
        assertTrue(SearchText.matches("  cola  ", "Cola 500ml"))
    }
}
