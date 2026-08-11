package app.orderak.seller.core.phone

import android.content.Context
import android.telephony.TelephonyManager
import com.google.i18n.phonenumbers.NumberParseException
import com.google.i18n.phonenumbers.PhoneNumberUtil
import java.text.Collator
import java.util.Locale

/**
 * Country data for phone sign-in.
 * ISO: 2-letter country code (e.g., "EG").
 * Flag: Emoji flag string.
 * DialCode: Calling code without '+' (e.g., "20").
 * Name: Display name (metadata only — use [localized] at UI boundaries).
 */
data class Country(
    val iso: String,
    val flag: String,
    val dialCode: String,
    val name: String
)

object Countries {

    private val phoneUtil: PhoneNumberUtil get() = PhoneNumberUtil.getInstance()

    /**
     * All ISO 3166 countries with dialing codes and flags.
     */
    val all: List<Country> by lazy {
        Locale.getISOCountries().mapNotNull { iso ->
            val dial = phoneUtil.getCountryCodeForRegion(iso)
            if (dial == 0) return@mapNotNull null
            Country(
                iso = iso.uppercase(Locale.ROOT),
                flag = isoToFlag(iso),
                dialCode = dial.toString(),
                // Stable metadata fallback. UI code derives localized names
                // with all(locale) so runtime language switches are respected.
                name = Locale("", iso).getDisplayCountry(Locale.ENGLISH)
            )
        }.sortedBy { it.iso }
    }

    /** Localized presentation list, sorted using the active app locale. */
    fun all(locale: Locale): List<Country> {
        val collator = Collator.getInstance(locale)
        return all.map { country ->
            country.copy(name = Locale("", country.iso).getDisplayCountry(locale))
        }.sortedWith { left, right -> collator.compare(left.name, right.name) }
    }

    /**
     * Curated ISO list for quick selection (target-market focused).
     * Lazily resolved so it does not force eager initialization of [all].
     */
    private val _curatedIsos = listOf(
        "EG", "SA", "AE", "KW", "QA", "BH", "OM", "JO", "IQ",
        "LY", "MA", "DZ", "TN", "SD", "LB", "PS",
    )

    private val _curated: List<Country> by lazy {
        _curatedIsos.mapNotNull { iso -> all.find { it.iso == iso } }
    }

    /** English-named curated list (for default display or fallback). */
    val curated: List<Country> get() = _curated

    /** Localized curated list sorted using the active app locale. */
    fun curated(locale: Locale): List<Country> {
        val localized = all(locale).associateBy { it.iso }
        return _curatedIsos.mapNotNull { localized[it] }
    }

    /** Defaults to Egypt, or the user's region if supported. */
    val default: Country by lazy {
        val systemIso = Locale.getDefault().country.uppercase(Locale.ROOT)
        all.find { it.iso == systemIso } ?: all.find { it.iso == "EG" } ?: all.first()
    }

    /** Network country first, then device locale; neither requires GPS. */
    fun defaultFor(context: Context): Country {
        val networkIso = runCatching {
            (context.getSystemService(Context.TELEPHONY_SERVICE) as? TelephonyManager)
                ?.networkCountryIso
                ?.uppercase(Locale.ROOT)
        }.getOrNull()
        val localeIso = Locale.getDefault().country.uppercase(Locale.ROOT)
        return all.find { it.iso == networkIso }
            ?: all.find { it.iso == localeIso }
            ?: default
    }

    fun byIso(iso: String?): Country {
        return all.find { it.iso == iso?.uppercase(Locale.ROOT) } ?: default
    }

    fun localized(country: Country, locale: Locale): Country = country.copy(
        name = Locale("", country.iso).getDisplayCountry(locale),
    )

    /**
     * Formats a phone number to E.164 using libphonenumber.
     *
     * This is safer than manual concatenation because some countries (e.g. Italy)
     * require a leading zero after the country code. Returns `null` if the number
     * cannot be parsed — callers should treat that as an invalid phone.
     *
     * Usage:
     * ```kotlin
     * val e164 = Countries.toE164(country, national)
     * if (e164 == null) { /* show INVALID_PHONE error */ }
     * ```
     */
    fun toE164(country: Country, national: String): String? {
        if (national.isBlank()) return null
        return try {
            val parsed = phoneUtil.parse(national, country.iso)
            // isPossibleNumber is a fast check; isValidNumberForRegion is authoritative
            if (phoneUtil.isValidNumberForRegion(parsed, country.iso)) {
                phoneUtil.format(parsed, PhoneNumberUtil.PhoneNumberFormat.E164)
            } else {
                null
            }
        } catch (_: NumberParseException) {
            null
        }
    }

    /**
     * Resolves an E.164 phone number to the correct [Country] using
     * libphonenumber's region detection. Useful when parsing a complete phone
     * number received from SIM or phone-hint APIs where the country is unknown.
     *
     * Returns `null` when the number cannot be parsed or the region is not
     * in the supported [all] list.
     */
    fun fromE164(phone: String): Country? {
        if (phone.isBlank()) return null
        return try {
            val parsed = phoneUtil.parse(phone, null)
            val region = phoneUtil.getRegionCodeForNumber(parsed) ?: return null
            all.find { it.iso == region }
        } catch (_: NumberParseException) {
            null
        }
    }

    /** libphonenumber validation: unbeatable for format and validity checks. */
    fun isValid(country: Country, national: String): Boolean {
        if (national.isBlank()) return false
        return try {
            val numberProto = phoneUtil.parse(national, country.iso)
            phoneUtil.isValidNumberForRegion(numberProto, country.iso)
        } catch (_: NumberParseException) {
            false
        }
    }

    /** Business logic: restricted to ISO 3166 list. */
    fun isSupported(country: Country): Boolean {
        return all.any { it.iso == country.iso }
    }

    /** Converts "EG" -> "🇪🇬" */
    private fun isoToFlag(iso: String): String {
        if (iso.length != 2) return "🌐"
        val normalized = iso.uppercase(Locale.ROOT)
        val firstLetter = Character.codePointAt(normalized, 0) - 0x41 + 0x1F1E6
        val secondLetter = Character.codePointAt(normalized, 1) - 0x41 + 0x1F1E6
        return String(Character.toChars(firstLetter)) + String(Character.toChars(secondLetter))
    }
}
