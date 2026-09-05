package app.orderak.seller.feature.payment

import android.content.Context
import android.net.Uri
import app.orderak.seller.core.money.Money
import app.orderak.seller.core.money.parseMinorUnits
import com.google.mlkit.vision.common.InputImage
import com.google.mlkit.vision.text.TextRecognition
import com.google.mlkit.vision.text.latin.TextRecognizerOptions
import dagger.hilt.android.qualifiers.ApplicationContext
import kotlinx.coroutines.suspendCancellableCoroutine
import javax.inject.Inject
import javax.inject.Singleton
import kotlin.coroutines.resume

data class VerificationResult(
    val amountMatched: Boolean,
    val ref: String?,          // longest digit run >= 9 chars (VF Cash / InstaPay tx id heuristic)
    val duplicateRef: Boolean,
    val rawText: String,
) {
    val verified: Boolean get() = amountMatched && (ref != null) && !duplicateRef
}

/**
 * S6a killer feature, v1 = on-device OCR + rules (Plan Stage 4).
 * Honesty rule: assists fraud detection, never claims 100% (copy handled in UI).
 * TODO(V2): provider-template parsing (sender/timestamp) + PSP-grade verification.
 */
@Singleton
class PaymentVerifier @Inject constructor(
    @param:ApplicationContext private val context: Context
) {
    private val recognizer = TextRecognition.getClient(TextRecognizerOptions.DEFAULT_OPTIONS)

    suspend fun ocr(uri: Uri): String = suspendCancellableCoroutine { cont ->
        try {
            val image = InputImage.fromFilePath(context, uri)
            recognizer.process(image)
                .addOnSuccessListener { if (cont.isActive) cont.resume(it.text) }
                .addOnFailureListener { if (cont.isActive) cont.resume("") }
        } catch (_: Exception) {
            if (cont.isActive) cont.resume("")
        }
    }

    companion object {
        /**
         * Pure rules — static & context-free so it's unit-testable.
         *
         * Takes the order's [Money], not a bare number. The previous signature was
         * `expectedTotalPiasters: Long` and carried four separate assumptions that
         * every currency has two decimal places: the parameter name, a literal
         * `/ 100.0`, a candidate regex bounded at two decimals, and a 0.01
         * tolerance. In Kuwait, Bahrain and Oman — all three already in
         * SUPPORTED_CURRENCIES — every one of them is wrong by a factor of ten,
         * and the failure is a receipt for the right amount being rejected, or one
         * for a tenth of it being accepted.
         *
         * The comparison is in minor units, as integers. Comparing majors as
         * doubles needs a tolerance, and a tolerance is exactly where a
         * factor-of-ten error hides: 0.01 is one piastre and it is ten fils.
         */
        fun evaluate(rawText: String, expected: Money, duplicateCheck: (String) -> Boolean): VerificationResult {
            val normalized = normalizeDigits(rawText)
            // Take whole numeric tokens and let the currency judge them. Bounding
            // the fraction in the pattern instead looks equivalent and is not: on
            // "250.001" a two-decimal pattern matches the prefix "250.00", which
            // parses to exactly the expected 250.00 and accepts a receipt for an
            // amount nobody wrote. The token has to arrive intact to be refused.
            val amountMatched = Regex("\\d+(?:\\.\\d+)?").findAll(normalized)
                .mapNotNull { parseMinorUnits(it.value, expected.currency) }
                .any { it == expected.amountMinor }
            val ref = Regex("\\d{9,}").findAll(normalized).map { it.value }.maxByOrNull { it.length }
            val duplicate = ref != null && duplicateCheck(ref)
            return VerificationResult(amountMatched, ref, duplicate, rawText)
        }

        /** Arabic-Indic digits -> Latin; drops thousands separators (٬ and ,) so ١٬٠٠٠ matches. */
        fun normalizeDigits(s: String): String = buildString(s.length) {
            for (c in s) when (c) {
                in '٠'..'٩' -> append('0' + (c - '٠'))
                in '۰'..'۹' -> append('0' + (c - '۰'))
                '٫' -> append('.')
                '٬', ',' -> Unit  // thousands separators
                else -> append(c)
            }
        }
    }
}
