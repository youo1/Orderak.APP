package app.orderak.seller.core.phone

import com.google.i18n.phonenumbers.NumberParseException
import com.google.i18n.phonenumbers.PhoneNumberUtil

/**
 * The device's half of one answer to "is this the same customer".
 *
 * This mirrors `services/backend/src/domains/identity/phone.ts` deliberately and
 * has to keep mirroring it. A customer is addressed by `store_id` plus this key
 * (I-6); if the two sides disagreed about what a raw phone normalises to, a
 * customer edited on the phone and a customer pulled from the server would be
 * two rows describing one person, and the seller would watch their edit vanish
 * behind a duplicate.
 *
 * The rules, identical on both sides:
 *
 *   - a `deleted:` or `expired:` value is a privacy sentinel, not a number, and
 *     is never parsed, normalised or merged
 *   - a value already in international form carries its own country
 *   - a national value is read against the seller's own country, the only
 *     country information the system has about a buyer
 *   - anything that does not resolve keys to itself, so it can never collide
 *     with another customer
 *
 * The one thing the device does NOT do is decide the key for a customer the
 * server already knows: a pulled row carries its key and that key is stored as
 * given. This is for the offline case, where an order is recorded on the device
 * and the customer must exist before any sync can confirm them.
 */
object CustomerPhone {

    private val phoneUtil: PhoneNumberUtil by lazy { PhoneNumberUtil.getInstance() }

    /**
     * What normalisation concluded. Three outcomes, not two: "could not resolve
     * this" and "this is not a number" both forbid merging, but for different
     * reasons and with different repairs.
     */
    enum class Status { VALID, AMBIGUOUS, INVALID, SENTINEL }

    data class Normalized(
        val status: Status,
        /** The E.164 form, present only when the status is [Status.VALID]. */
        val e164: String?,
        /** Exactly what was entered. Nothing is discarded by normalising. */
        val raw: String,
    ) {
        /**
         * The value to key a customer on: the E.164 form when there is one, the
         * raw value otherwise.
         */
        val key: String get() = e164 ?: raw

        val mergeable: Boolean get() = status == Status.VALID
    }

    /** Values that are not phone numbers and must never be treated as one. */
    fun isPrivacySentinel(value: String): Boolean =
        value.startsWith("deleted:") || value.startsWith("expired:")

    /**
     * Resolve a buyer phone using the seller's own country as the context the
     * value itself lacks.
     *
     * @param regionIso the seller's country, as a two-letter ISO code.
     */
    fun normalize(raw: String, regionIso: String?): Normalized {
        val trimmed = raw.trim()
        if (isPrivacySentinel(trimmed)) return Normalized(Status.SENTINEL, null, trimmed)
        if (trimmed.isEmpty()) return Normalized(Status.INVALID, null, trimmed)

        if (trimmed.startsWith("+")) {
            // International form: it says which country it belongs to, so no
            // region is needed and none is consulted.
            return parseFor(trimmed, region = null)
                ?: Normalized(Status.INVALID, null, trimmed)
        }

        val country = regionIso?.trim()?.uppercase().orEmpty()
        if (!country.matches(Regex("^[A-Z]{2}$"))) {
            // A national number with no country to read it against. It may be a
            // real number; there is simply nothing here that says whose.
            return Normalized(Status.AMBIGUOUS, null, trimmed)
        }

        parseFor(trimmed, region = country)?.let { return it }

        // Plausible length, but not valid for the one country available. Ambiguous
        // rather than invalid: it may be a perfectly good number from somewhere
        // else, and calling it invalid would be a claim this cannot make.
        val digits = trimmed.filter(Char::isDigit)
        return if (digits.length in 8..15) {
            Normalized(Status.AMBIGUOUS, null, trimmed)
        } else {
            Normalized(Status.INVALID, null, trimmed)
        }
    }

    /** The key alone, for the common case where the outcome is not needed. */
    fun keyFor(raw: String, regionIso: String?): String = normalize(raw, regionIso).key

    private fun parseFor(value: String, region: String?): Normalized? = try {
        val parsed = phoneUtil.parse(value, region)
        if (phoneUtil.isValidNumber(parsed)) {
            val e164 = phoneUtil.format(parsed, PhoneNumberUtil.PhoneNumberFormat.E164)
            // The same shape check the server stores against: `+` and 8 to 15
            // digits. libphonenumber is the authority on validity; this only
            // guards the storage form.
            if (e164.matches(Regex("^\\+[1-9]\\d{7,14}$"))) {
                Normalized(Status.VALID, e164, value)
            } else {
                null
            }
        } else {
            null
        }
    } catch (_: NumberParseException) {
        null
    }
}
