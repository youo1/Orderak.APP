package app.orderak.seller.core.ui.theme

import androidx.compose.material3.Typography
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.googlefonts.GoogleFont
import androidx.compose.ui.text.googlefonts.Font as GoogleFontRef
import androidx.compose.ui.unit.sp
import app.orderak.seller.R

/**
 * Cairo, loaded via the Downloadable Fonts API — no APK size cost, and it's
 * cached device-wide after first use. Requires the Google Fonts provider
 * certificate resource below (standard Android boilerplate, add once).
 *
 * Why one family for both scripts: Roboto (Android's system default) has no
 * Arabic glyphs, so Arabic text silently falls back to Noto Sans Arabic under
 * the hood — different weight/x-height than Roboto, so English and Arabic UI
 * end up visually mismatched. Cairo is designed for both scripts together,
 * so headings, buttons, and body text look like one typeface regardless of
 * which language is showing.
 *
 * Fallback chain: Cairo → Roboto → system-default sans-serif → Hebrew/Arabic
 * system fonts. This ensures text is never invisible even if Cairo download
 * hasn't completed yet (first-launch cold start).
 */
private val googleFontProvider = GoogleFont.Provider(
    providerAuthority = "com.google.android.gms.fonts",
    providerPackage = "com.google.android.gms",
    certificates = R.array.com_google_android_gms_fonts_certs
)

private val cairoFont = GoogleFont("Cairo")
private val tajawalFont = GoogleFont("Tajawal")
private val notoArabicFont = GoogleFont("Noto Sans Arabic")

val CairoFontFamily = FontFamily(
    GoogleFontRef(googleFont = cairoFont, fontProvider = googleFontProvider, weight = FontWeight.Normal),
    GoogleFontRef(googleFont = cairoFont, fontProvider = googleFontProvider, weight = FontWeight.Medium),
    GoogleFontRef(googleFont = cairoFont, fontProvider = googleFontProvider, weight = FontWeight.SemiBold),
    GoogleFontRef(googleFont = cairoFont, fontProvider = googleFontProvider, weight = FontWeight.Bold),
)

// ============================================================
// Material 3 Typography — all 15 levels
// Line heights set to 1.2x–1.5x as per M3 defaults (lineHeight / fontSize)
// Letter spacing is 0 for display/headline, 0.15–0.5 for body, 0.5–1.5 for label
// ============================================================
val OrderakTypography = Typography(
    // -- Display ---------------------------------------------------
    displayLarge = TextStyle(
        fontFamily = CairoFontFamily,
        fontWeight = FontWeight.Bold,
        fontSize = 57.sp,
        lineHeight = 64.sp,
        letterSpacing = (-0.25).sp,
    ),
    displayMedium = TextStyle(
        fontFamily = CairoFontFamily,
        fontWeight = FontWeight.Bold,
        fontSize = 45.sp,
        lineHeight = 52.sp,
        letterSpacing = 0.sp,
    ),
    displaySmall = TextStyle(
        fontFamily = CairoFontFamily,
        fontWeight = FontWeight.Bold,
        fontSize = 36.sp,
        lineHeight = 44.sp,
        letterSpacing = 0.sp,
    ),
    // -- Headline --------------------------------------------------
    headlineLarge = TextStyle(
        fontFamily = CairoFontFamily,
        fontWeight = FontWeight.Bold,
        fontSize = 32.sp,
        lineHeight = 40.sp,
        letterSpacing = 0.sp,
    ),
    headlineMedium = TextStyle(
        fontFamily = CairoFontFamily,
        fontWeight = FontWeight.Bold,
        fontSize = 28.sp,
        lineHeight = 36.sp,
        letterSpacing = 0.sp,
    ),
    headlineSmall = TextStyle(
        fontFamily = CairoFontFamily,
        fontWeight = FontWeight.SemiBold,
        fontSize = 24.sp,
        lineHeight = 32.sp,
        letterSpacing = 0.sp,
    ),
    // -- Title -----------------------------------------------------
    titleLarge = TextStyle(
        fontFamily = CairoFontFamily,
        fontWeight = FontWeight.Bold,
        fontSize = 22.sp,
        lineHeight = 28.sp,
        letterSpacing = 0.sp,
    ),
    titleMedium = TextStyle(
        fontFamily = CairoFontFamily,
        fontWeight = FontWeight.SemiBold,
        fontSize = 16.sp,
        lineHeight = 24.sp,
        letterSpacing = 0.15.sp,
    ),
    titleSmall = TextStyle(
        fontFamily = CairoFontFamily,
        fontWeight = FontWeight.Medium,
        fontSize = 14.sp,
        lineHeight = 20.sp,
        letterSpacing = 0.1.sp,
    ),
    // -- Body ------------------------------------------------------
    bodyLarge = TextStyle(
        fontFamily = CairoFontFamily,
        fontWeight = FontWeight.Normal,
        fontSize = 16.sp,
        lineHeight = 24.sp,
        letterSpacing = 0.5.sp,
    ),
    bodyMedium = TextStyle(
        fontFamily = CairoFontFamily,
        fontWeight = FontWeight.Normal,
        fontSize = 14.sp,
        lineHeight = 20.sp,
        letterSpacing = 0.25.sp,
    ),
    bodySmall = TextStyle(
        fontFamily = CairoFontFamily,
        fontWeight = FontWeight.Normal,
        fontSize = 12.sp,
        lineHeight = 16.sp,
        letterSpacing = 0.4.sp,
    ),
    // -- Label -----------------------------------------------------
    labelLarge = TextStyle(
        fontFamily = CairoFontFamily,
        fontWeight = FontWeight.Medium,
        fontSize = 14.sp,
        lineHeight = 20.sp,
        letterSpacing = 0.1.sp,
    ),
    labelMedium = TextStyle(
        fontFamily = CairoFontFamily,
        fontWeight = FontWeight.Medium,
        fontSize = 12.sp,
        lineHeight = 16.sp,
        letterSpacing = 0.5.sp,
    ),
    labelSmall = TextStyle(
        fontFamily = CairoFontFamily,
        fontWeight = FontWeight.Medium,
        fontSize = 12.sp,
        lineHeight = 16.sp,
        letterSpacing = 0.5.sp,
    ),
)

private fun generatedFontFamily(id: String): FontFamily = when (id) {
    "tajawal" -> TajawalFontFamily
    "noto-arabic" -> NotoArabicFontFamily
    else -> CairoFontFamily
}

private fun generatedFontWeight(value: Int): FontWeight = when {
    value >= 700 -> FontWeight.Bold
    value >= 600 -> FontWeight.SemiBold
    value >= 500 -> FontWeight.Medium
    else -> FontWeight.Normal
}

/**
 * Applies all 15 generated roles. Compose `sp` applies the OS font scale after
 * the generated multiplier, avoiding double accessibility scaling.
 *
 * Values come from GeneratedDesignSystem, which is emitted by the design-system
 * generator. There is no runtime typography source.
 */
fun Typography.withGenerated(): Typography {
    val roles = GeneratedDesignSystem.typography
    if (roles.size != 15) return this
    val family = generatedFontFamily(GeneratedDesignSystem.FONT_FAMILY)
    fun role(name: String, fallback: TextStyle): TextStyle {
        val token = roles[name] ?: return fallback
        if (token.sizeSp <= 0f || token.lineHeight <= 0f) return fallback
        return fallback.copy(
            fontFamily = family,
            fontWeight = generatedFontWeight(token.weight),
            fontSize = token.sizeSp.sp,
            lineHeight = (token.lineHeight * 16f).sp,
            letterSpacing = (token.sizeSp * token.letterSpacingEm).sp,
        )
    }
    return copy(
        displayLarge = role("displayLarge", displayLarge),
        displayMedium = role("displayMedium", displayMedium),
        displaySmall = role("displaySmall", displaySmall),
        headlineLarge = role("headlineLarge", headlineLarge),
        headlineMedium = role("headlineMedium", headlineMedium),
        headlineSmall = role("headlineSmall", headlineSmall),
        titleLarge = role("titleLarge", titleLarge),
        titleMedium = role("titleMedium", titleMedium),
        titleSmall = role("titleSmall", titleSmall),
        bodyLarge = role("bodyLarge", bodyLarge),
        bodyMedium = role("bodyMedium", bodyMedium),
        bodySmall = role("bodySmall", bodySmall),
        labelLarge = role("labelLarge", labelLarge),
        labelMedium = role("labelMedium", labelMedium),
        labelSmall = role("labelSmall", labelSmall),
    )
}

private val TajawalFontFamily = FontFamily(
    GoogleFontRef(googleFont = tajawalFont, fontProvider = googleFontProvider, weight = FontWeight.Normal),
    GoogleFontRef(googleFont = tajawalFont, fontProvider = googleFontProvider, weight = FontWeight.Medium),
    GoogleFontRef(googleFont = tajawalFont, fontProvider = googleFontProvider, weight = FontWeight.Bold),
)

private val NotoArabicFontFamily = FontFamily(
    GoogleFontRef(googleFont = notoArabicFont, fontProvider = googleFontProvider, weight = FontWeight.Normal),
    GoogleFontRef(googleFont = notoArabicFont, fontProvider = googleFontProvider, weight = FontWeight.Medium),
    GoogleFontRef(googleFont = notoArabicFont, fontProvider = googleFontProvider, weight = FontWeight.Bold),
)
