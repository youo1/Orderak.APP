package app.orderak.seller.feature.auth

/**
 * Firebase phone credentials expect ASCII digits. Numeric keyboards may emit
 * localized decimal digits, so normalize them before building the credential.
 */
internal fun normalizeOtpDigits(raw: String, maxLength: Int): String = buildString {
    for (character in raw) {
        val digit = Character.digit(character, 10)
        if (digit in 0..9) {
            append(('0'.code + digit).toChar())
            if (length == maxLength) break
        }
    }
}
