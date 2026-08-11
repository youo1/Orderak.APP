package app.orderak.seller.feature.payment

import android.content.Context
import android.net.Uri
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
        /** Pure rules — static & context-free so it's unit-testable. */
        fun evaluate(rawText: String, expectedTotalPiasters: Long, duplicateCheck: (String) -> Boolean): VerificationResult {
            val normalized = normalizeDigits(rawText)
            val egp = expectedTotalPiasters / 100.0
            val candidates = Regex("\\d+(?:\\.\\d{1,2})?").findAll(normalized)
                .mapNotNull { it.value.toDoubleOrNull() }
            val amountMatched = candidates.any { kotlin.math.abs(it - egp) < 0.01 }
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
