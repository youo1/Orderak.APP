package app.orderak.seller.core.locale

import androidx.appcompat.app.AppCompatDelegate
import androidx.core.os.LocaleListCompat
import java.util.Locale

/**
 * Single source of truth for supported languages (Plan §3.1).
 * Adding a locale = one entry here + a values-<tag>/strings.xml resource set.
 * AGP generates LocaleConfig from those resource directories.
 */
object AppLocales {

    data class AppLocale(
        val tag: String,        // BCP-47
        val nativeName: String  // Deliberately NOT a string resource: each language
                                // must be shown in its own script regardless of app locale.
    )

    val supported = listOf(
        AppLocale("ar", "العربية"),
        AppLocale("en", "English"),
        AppLocale("fr", "Français"),
    )

    fun currentTag(): String {
        val applied = AppCompatDelegate.getApplicationLocales()
        if (!applied.isEmpty) return applied.toLanguageTags().substringBefore(',')
        return resolveSupportedSystemTag(LocaleListCompat.getDefault().toLanguageTags())
    }

    fun followsSystem(): Boolean = AppCompatDelegate.getApplicationLocales().isEmpty

    /** Applies + auto-persists (autoStoreLocales in Manifest). Activity recreates localized. */
    fun set(tag: String) {
        require(supported.any { it.tag == tag }) { "Unsupported app locale: $tag" }
        AppCompatDelegate.setApplicationLocales(LocaleListCompat.forLanguageTags(tag))
    }

    /** Clears the app override so Android follows the device language again. */
    fun followSystem() {
        AppCompatDelegate.setApplicationLocales(LocaleListCompat.getEmptyLocaleList())
    }

    private const val DEFAULT_TAG = "en"
}

internal fun resolveSupportedSystemTag(languageTags: String): String {
    val primary = languageTags
        .substringBefore(',')
        .substringBefore('-')
        .lowercase(Locale.ROOT)
    return primary.takeIf { it in setOf("ar", "en", "fr") } ?: "en"
}
