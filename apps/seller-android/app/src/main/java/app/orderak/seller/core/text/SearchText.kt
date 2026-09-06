package app.orderak.seller.core.text

import java.text.Normalizer
import java.util.Locale

/**
 * Text matching for the seller's own data, in the two scripts they type in.
 *
 * A naive `contains(query, ignoreCase = true)` is close enough in Latin and
 * close to useless in Arabic. The same word is spelled several equally correct
 * ways — أحمد, احمد, إحمد all name the same person — and a seller typing one of
 * them finds nothing if their catalogue holds another. The same is true of ة and
 * ه at the end of a word, of the diacritics an on-screen keyboard may or may not
 * insert, and of the tatweel character used to stretch a word for display.
 *
 * Phone numbers add Arabic-Indic digits, which are a different set of code
 * points from Latin ones: ٠١٠ and 010 are the same number and share no
 * character. Searching a customer list by phone fails completely without this.
 *
 * Everything here is folding, not stemming. Two spellings of one word are made
 * equal; two different words are left different. Nothing is language-detected,
 * because a catalogue routinely holds both scripts at once — often in one name.
 */
object SearchText {

    private val ARABIC_DIACRITICS = Regex("[\\u064B-\\u065F\\u0670\\u06D6-\\u06ED]")
    private const val TATWEEL = 'ـ'

    /**
     * The comparable form of a piece of text.
     *
     * Applied to both sides of every comparison, so the query and the field are
     * always folded the same way.
     */
    fun fold(input: String): String {
        if (input.isEmpty()) return ""
        // NFKC first, so a composed and a decomposed spelling of the same
        // character arrive here identical before anything else is decided.
        val normalized = Normalizer.normalize(input, Normalizer.Form.NFKC)
        val builder = StringBuilder(normalized.length)
        for (character in normalized) {
            when (character) {
                // Arabic-Indic and Extended Arabic-Indic digits.
                in '٠'..'٩' -> builder.append('0' + (character - '٠'))
                in '۰'..'۹' -> builder.append('0' + (character - '۰'))
                // Alef, in every form a keyboard produces.
                'أ', 'إ', 'آ', 'ٱ', 'ٲ', 'ٳ' -> builder.append('ا')
                // Ta marbuta and ha are interchangeable at the end of a word.
                'ة' -> builder.append('ه')
                // Alef maqsura and ya likewise.
                'ى' -> builder.append('ي')
                // Hamza carriers.
                'ؤ' -> builder.append('و')
                'ئ' -> builder.append('ي')
                // A display-only stretch, never part of the word.
                TATWEEL -> Unit
                else -> builder.append(character)
            }
        }
        return ARABIC_DIACRITICS.replace(builder, "").lowercase(Locale.ROOT).trim()
    }

    /**
     * Whether any of [fields] contains [query].
     *
     * A blank query matches everything: an empty search box is not a filter, and
     * treating it as one would empty the list the moment a seller cleared it.
     * Null and blank fields simply do not match — a product with no code is not a
     * reason to hide it, and not a reason to show it either.
     */
    fun matches(query: String, vararg fields: String?): Boolean {
        val needle = fold(query)
        if (needle.isEmpty()) return true
        return fields.any { field -> !field.isNullOrBlank() && fold(field).contains(needle) }
    }
}
