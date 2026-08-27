package app.orderak.seller.core.ui.theme

import androidx.compose.material3.ColorScheme
import androidx.compose.material3.darkColorScheme
import androidx.compose.material3.lightColorScheme
import androidx.compose.ui.graphics.Color

/**
 * GENERATED FILE — DO NOT EDIT BY HAND.
 *
 * Produced by services/backend/scripts/generate-design-system-fixture.ts from
 * DEFAULT_DESIGN_SYSTEM_SOURCE. Regenerate with, from services/backend:
 *
 *     pnpm run design-system:generate
 *
 * Every colour below was emitted by generateDesignSystem(), which fails on any
 * role pair below its required WCAG ratio. That build-time gate is the only
 * contrast enforcement in the system: colours reach the app through this file
 * and nowhere else, so hand-editing it removes the guarantee entirely.
 */
internal data class GeneratedTypeRole(
    val sizeSp: Float,
    val lineHeight: Float,
    val weight: Int,
    val letterSpacingEm: Float,
)

internal object GeneratedDesignSystem {
    const val GENERATOR_VERSION = "orderak-mcu-0.3.0+3"
    const val CONTENT_HASH = "bd8854f8c6aaa55e971707925e5e863f62e8d38a88a1da497bcbbac2f8766205"
    const val MINIMUM_TOUCH_TARGET_DP = 48f
    const val FONT_FAMILY = "cairo"
    const val DEFAULT_CONTRAST = "standard"

    val contrasts: List<String> = listOf("standard", "medium", "high")

    fun colorScheme(contrast: String, dark: Boolean): ColorScheme {
        val mode = if (dark) "dark" else "light"
        return when (mode to normalizeContrast(contrast)) {
            "light" to "standard" -> LightStandard
            "light" to "medium" -> LightMedium
            "light" to "high" -> LightHigh
            "dark" to "standard" -> DarkStandard
            "dark" to "medium" -> DarkMedium
            "dark" to "high" -> DarkHigh
            else -> LightStandard
        }
    }

    fun extendedColors(contrast: String, dark: Boolean): OrderakExtendedColors {
        val mode = if (dark) "dark" else "light"
        return when (mode to normalizeContrast(contrast)) {
            "light" to "standard" -> LightStandardExtended
            "light" to "medium" -> LightMediumExtended
            "light" to "high" -> LightHighExtended
            "dark" to "standard" -> DarkStandardExtended
            "dark" to "medium" -> DarkMediumExtended
            "dark" to "high" -> DarkHighExtended
            else -> LightStandardExtended
        }
    }

    fun normalizeContrast(contrast: String): String =
        if (contrast in contrasts) contrast else "standard"

    val typography: Map<String, GeneratedTypeRole> = mapOf(
        "displayLarge" to GeneratedTypeRole(57f, 4f, 400, -0.0044f),
        "displayMedium" to GeneratedTypeRole(45f, 3.25f, 400, 0f),
        "displaySmall" to GeneratedTypeRole(36f, 2.75f, 400, 0f),
        "headlineLarge" to GeneratedTypeRole(32f, 2.5f, 400, 0f),
        "headlineMedium" to GeneratedTypeRole(28f, 2.25f, 400, 0f),
        "headlineSmall" to GeneratedTypeRole(24f, 2f, 400, 0f),
        "titleLarge" to GeneratedTypeRole(22f, 1.75f, 400, 0f),
        "titleMedium" to GeneratedTypeRole(16f, 1.5f, 500, 0.0094f),
        "titleSmall" to GeneratedTypeRole(14f, 1.25f, 500, 0.0071f),
        "bodyLarge" to GeneratedTypeRole(16f, 1.5f, 400, 0.0313f),
        "bodyMedium" to GeneratedTypeRole(14f, 1.25f, 400, 0.0179f),
        "bodySmall" to GeneratedTypeRole(12f, 1f, 400, 0.0333f),
        "labelLarge" to GeneratedTypeRole(14f, 1.25f, 500, 0.0071f),
        "labelMedium" to GeneratedTypeRole(12f, 1f, 500, 0.0417f),
        "labelSmall" to GeneratedTypeRole(11f, 1f, 500, 0.0455f),
    )

    val spacing: Map<String, Float> = mapOf(
        "space0" to 0f,
        "space1" to 4f,
        "space2" to 8f,
        "space3" to 12f,
        "space4" to 16f,
        "space6" to 24f,
        "space8" to 32f,
        "space10" to 40f,
        "space12" to 48f,
        "space16" to 64f,
    )

    val shapes: Map<String, Float> = mapOf(
        "extraSmall" to 4f,
        "small" to 8f,
        "medium" to 12f,
        "large" to 16f,
        "extraLarge" to 24f,
    )
}

private val LightStandard: ColorScheme = lightColorScheme(
    primary = Color(0xFF006A62),
    onPrimary = Color(0xFFFFFFFF),
    primaryContainer = Color(0xFF84F5E7),
    onPrimaryContainer = Color(0xFF005049),
    inversePrimary = Color(0xFF66D9CB),
    secondary = Color(0xFF9B4500),
    onSecondary = Color(0xFFFFFFFF),
    secondaryContainer = Color(0xFFFFDBC9),
    onSecondaryContainer = Color(0xFF763300),
    tertiary = Color(0xFF005AC2),
    onTertiary = Color(0xFFFFFFFF),
    tertiaryContainer = Color(0xFFD8E2FF),
    onTertiaryContainer = Color(0xFF004395),
    background = Color(0xFFF3FBFA),
    onBackground = Color(0xFF151D1D),
    surface = Color(0xFFF3FBFA),
    onSurface = Color(0xFF151D1D),
    surfaceVariant = Color(0xFFD5E6E4),
    onSurfaceVariant = Color(0xFF3B4A49),
    surfaceTint = Color(0xFF006A62),
    inverseSurface = Color(0xFF2A3231),
    inverseOnSurface = Color(0xFFEAF2F1),
    error = Color(0xFFBA1A1A),
    onError = Color(0xFFFFFFFF),
    errorContainer = Color(0xFFFFDAD5),
    onErrorContainer = Color(0xFF930009),
    outline = Color(0xFF6A7A79),
    outlineVariant = Color(0xFFB9CAC9),
    scrim = Color(0xFF000000),
    surfaceBright = Color(0xFFF3FBFA),
    surfaceDim = Color(0xFFD3DCDB),
    surfaceContainer = Color(0xFFE7F0EE),
    surfaceContainerHigh = Color(0xFFE2EAE9),
    surfaceContainerHighest = Color(0xFFDCE4E3),
    surfaceContainerLow = Color(0xFFEDF5F4),
    surfaceContainerLowest = Color(0xFFFFFFFF),
    primaryFixed = Color(0xFF84F5E7),
    primaryFixedDim = Color(0xFF66D9CB),
    onPrimaryFixed = Color(0xFF00201D),
    onPrimaryFixedVariant = Color(0xFF005049),
    secondaryFixed = Color(0xFFFFDBC9),
    secondaryFixedDim = Color(0xFFFFB68E),
    onSecondaryFixed = Color(0xFF331200),
    onSecondaryFixedVariant = Color(0xFF763300),
    tertiaryFixed = Color(0xFFD8E2FF),
    tertiaryFixedDim = Color(0xFFADC6FF),
    onTertiaryFixed = Color(0xFF001A42),
    onTertiaryFixedVariant = Color(0xFF004395),
)

private val DarkStandard: ColorScheme = darkColorScheme(
    primary = Color(0xFF66D9CB),
    onPrimary = Color(0xFF003732),
    primaryContainer = Color(0xFF005049),
    onPrimaryContainer = Color(0xFF84F5E7),
    inversePrimary = Color(0xFF006A62),
    secondary = Color(0xFFFFB68E),
    onSecondary = Color(0xFF532200),
    secondaryContainer = Color(0xFF763300),
    onSecondaryContainer = Color(0xFFFFDBC9),
    tertiary = Color(0xFFADC6FF),
    onTertiary = Color(0xFF002E6A),
    tertiaryContainer = Color(0xFF004395),
    onTertiaryContainer = Color(0xFFD8E2FF),
    background = Color(0xFF0D1514),
    onBackground = Color(0xFFDCE4E3),
    surface = Color(0xFF0D1514),
    onSurface = Color(0xFFDCE4E3),
    surfaceVariant = Color(0xFF3B4A49),
    onSurfaceVariant = Color(0xFFB9CAC9),
    surfaceTint = Color(0xFF66D9CB),
    inverseSurface = Color(0xFFDCE4E3),
    inverseOnSurface = Color(0xFF2A3231),
    error = Color(0xFFFFB4AB),
    onError = Color(0xFF690004),
    errorContainer = Color(0xFF930009),
    onErrorContainer = Color(0xFFFFDAD5),
    outline = Color(0xFF849493),
    outlineVariant = Color(0xFF3B4A49),
    scrim = Color(0xFF000000),
    surfaceBright = Color(0xFF333B3A),
    surfaceDim = Color(0xFF0D1514),
    surfaceContainer = Color(0xFF192121),
    surfaceContainerHigh = Color(0xFF242B2B),
    surfaceContainerHighest = Color(0xFF2E3636),
    surfaceContainerLow = Color(0xFF151D1D),
    surfaceContainerLowest = Color(0xFF08100F),
    primaryFixed = Color(0xFF84F5E7),
    primaryFixedDim = Color(0xFF66D9CB),
    onPrimaryFixed = Color(0xFF00201D),
    onPrimaryFixedVariant = Color(0xFF005049),
    secondaryFixed = Color(0xFFFFDBC9),
    secondaryFixedDim = Color(0xFFFFB68E),
    onSecondaryFixed = Color(0xFF331200),
    onSecondaryFixedVariant = Color(0xFF763300),
    tertiaryFixed = Color(0xFFD8E2FF),
    tertiaryFixedDim = Color(0xFFADC6FF),
    onTertiaryFixed = Color(0xFF001A42),
    onTertiaryFixedVariant = Color(0xFF004395),
)

private val LightMedium: ColorScheme = lightColorScheme(
    primary = Color(0xFF003E38),
    onPrimary = Color(0xFFFFFFFF),
    primaryContainer = Color(0xFF007B71),
    onPrimaryContainer = Color(0xFFFFFFFF),
    inversePrimary = Color(0xFF66D9CB),
    secondary = Color(0xFF5C2600),
    onSecondary = Color(0xFFFFFFFF),
    secondaryContainer = Color(0xFFB25000),
    onSecondaryContainer = Color(0xFFFFFFFF),
    tertiary = Color(0xFF003475),
    onTertiary = Color(0xFFFFFFFF),
    tertiaryContainer = Color(0xFF0E69DC),
    onTertiaryContainer = Color(0xFFFFFFFF),
    background = Color(0xFFF3FBFA),
    onBackground = Color(0xFF151D1D),
    surface = Color(0xFFF3FBFA),
    onSurface = Color(0xFF0B1312),
    surfaceVariant = Color(0xFFD5E6E4),
    onSurfaceVariant = Color(0xFF2A3938),
    surfaceTint = Color(0xFF006A62),
    inverseSurface = Color(0xFF2A3231),
    inverseOnSurface = Color(0xFFEAF2F1),
    error = Color(0xFF740006),
    onError = Color(0xFFFFFFFF),
    errorContainer = Color(0xFFD02C27),
    onErrorContainer = Color(0xFFFFFFFF),
    outline = Color(0xFF465555),
    outlineVariant = Color(0xFF60706F),
    scrim = Color(0xFF000000),
    surfaceBright = Color(0xFFF3FBFA),
    surfaceDim = Color(0xFFC0C8C7),
    surfaceContainer = Color(0xFFE2EAE9),
    surfaceContainerHigh = Color(0xFFD6DEDD),
    surfaceContainerHighest = Color(0xFFCBD3D2),
    surfaceContainerLow = Color(0xFFEDF5F4),
    surfaceContainerLowest = Color(0xFFFFFFFF),
    primaryFixed = Color(0xFF007B71),
    primaryFixedDim = Color(0xFF006058),
    onPrimaryFixed = Color(0xFFFFFFFF),
    onPrimaryFixedVariant = Color(0xFFFFFFFF),
    secondaryFixed = Color(0xFFB25000),
    secondaryFixedDim = Color(0xFF8C3E00),
    onSecondaryFixed = Color(0xFFFFFFFF),
    onSecondaryFixedVariant = Color(0xFFFFFFFF),
    tertiaryFixed = Color(0xFF0E69DC),
    tertiaryFixedDim = Color(0xFF0051B0),
    onTertiaryFixed = Color(0xFFFFFFFF),
    onTertiaryFixedVariant = Color(0xFFFFFFFF),
)

private val DarkMedium: ColorScheme = darkColorScheme(
    primary = Color(0xFF7EEFE1),
    onPrimary = Color(0xFF002B27),
    primaryContainer = Color(0xFF1EA295),
    onPrimaryContainer = Color(0xFF000000),
    inversePrimary = Color(0xFF00514B),
    secondary = Color(0xFFFFD3BD),
    onSecondary = Color(0xFF421A00),
    secondaryContainer = Color(0xFFE86D0F),
    onSecondaryContainer = Color(0xFF000000),
    tertiary = Color(0xFFCFDCFF),
    onTertiary = Color(0xFF002455),
    tertiaryContainer = Color(0xFF4D8EFF),
    onTertiaryContainer = Color(0xFF000000),
    background = Color(0xFF0D1514),
    onBackground = Color(0xFFDCE4E3),
    surface = Color(0xFF0D1514),
    onSurface = Color(0xFFFFFFFF),
    surfaceVariant = Color(0xFF3B4A49),
    onSurfaceVariant = Color(0xFFCFE0DE),
    surfaceTint = Color(0xFF66D9CB),
    inverseSurface = Color(0xFFDCE4E3),
    inverseOnSurface = Color(0xFF242B2B),
    error = Color(0xFFFFD2CC),
    onError = Color(0xFF540003),
    errorContainer = Color(0xFFFF5449),
    onErrorContainer = Color(0xFF000000),
    outline = Color(0xFFA5B5B4),
    outlineVariant = Color(0xFF839392),
    scrim = Color(0xFF000000),
    surfaceBright = Color(0xFF3E4646),
    surfaceDim = Color(0xFF0D1514),
    surfaceContainer = Color(0xFF212929),
    surfaceContainerHigh = Color(0xFF2C3434),
    surfaceContainerHighest = Color(0xFF373F3F),
    surfaceContainerLow = Color(0xFF171F1F),
    surfaceContainerLowest = Color(0xFF030908),
    primaryFixed = Color(0xFF84F5E7),
    primaryFixedDim = Color(0xFF66D9CB),
    onPrimaryFixed = Color(0xFF001512),
    onPrimaryFixedVariant = Color(0xFF003E38),
    secondaryFixed = Color(0xFFFFDBC9),
    secondaryFixedDim = Color(0xFFFFB68E),
    onSecondaryFixed = Color(0xFF220A00),
    onSecondaryFixedVariant = Color(0xFF5C2600),
    tertiaryFixed = Color(0xFFD8E2FF),
    tertiaryFixedDim = Color(0xFFADC6FF),
    onTertiaryFixed = Color(0xFF00102E),
    onTertiaryFixedVariant = Color(0xFF003475),
)

private val LightHigh: ColorScheme = lightColorScheme(
    primary = Color(0xFF00332E),
    onPrimary = Color(0xFFFFFFFF),
    primaryContainer = Color(0xFF00534C),
    onPrimaryContainer = Color(0xFFFFFFFF),
    inversePrimary = Color(0xFF66D9CB),
    secondary = Color(0xFF4D1F00),
    onSecondary = Color(0xFFFFFFFF),
    secondaryContainer = Color(0xFF7A3500),
    onSecondaryContainer = Color(0xFFFFFFFF),
    tertiary = Color(0xFF002A62),
    onTertiary = Color(0xFFFFFFFF),
    tertiaryContainer = Color(0xFF004699),
    onTertiaryContainer = Color(0xFFFFFFFF),
    background = Color(0xFFF3FBFA),
    onBackground = Color(0xFF151D1D),
    surface = Color(0xFFF3FBFA),
    onSurface = Color(0xFF000000),
    surfaceVariant = Color(0xFFD5E6E4),
    onSurfaceVariant = Color(0xFF000000),
    surfaceTint = Color(0xFF006A62),
    inverseSurface = Color(0xFF2A3231),
    inverseOnSurface = Color(0xFFFFFFFF),
    error = Color(0xFF600004),
    onError = Color(0xFFFFFFFF),
    errorContainer = Color(0xFF98000A),
    onErrorContainer = Color(0xFFFFFFFF),
    outline = Color(0xFF202F2E),
    outlineVariant = Color(0xFF3D4C4B),
    scrim = Color(0xFF000000),
    surfaceBright = Color(0xFFF3FBFA),
    surfaceDim = Color(0xFFB2BAB9),
    surfaceContainer = Color(0xFFDCE4E3),
    surfaceContainerHigh = Color(0xFFCED6D5),
    surfaceContainerHighest = Color(0xFFC0C8C7),
    surfaceContainerLow = Color(0xFFEAF2F1),
    surfaceContainerLowest = Color(0xFFFFFFFF),
    primaryFixed = Color(0xFF00534C),
    primaryFixedDim = Color(0xFF003A35),
    onPrimaryFixed = Color(0xFFFFFFFF),
    onPrimaryFixedVariant = Color(0xFFFFFFFF),
    secondaryFixed = Color(0xFF7A3500),
    secondaryFixedDim = Color(0xFF572400),
    onSecondaryFixed = Color(0xFFFFFFFF),
    onSecondaryFixedVariant = Color(0xFFFFFFFF),
    tertiaryFixed = Color(0xFF004699),
    tertiaryFixedDim = Color(0xFF00306E),
    onTertiaryFixed = Color(0xFFFFFFFF),
    onTertiaryFixedVariant = Color(0xFFFFFFFF),
)

private val DarkHigh: ColorScheme = darkColorScheme(
    primary = Color(0xFFAEFFF3),
    onPrimary = Color(0xFF000000),
    primaryContainer = Color(0xFF62D5C7),
    onPrimaryContainer = Color(0xFF000E0C),
    inversePrimary = Color(0xFF00514B),
    secondary = Color(0xFFFFECE4),
    onSecondary = Color(0xFF000000),
    secondaryContainer = Color(0xFFFFB184),
    onSecondaryContainer = Color(0xFF190600),
    tertiary = Color(0xFFECEFFF),
    onTertiary = Color(0xFF000000),
    tertiaryContainer = Color(0xFFA7C2FF),
    onTertiaryContainer = Color(0xFF000A22),
    background = Color(0xFF0D1514),
    onBackground = Color(0xFFDCE4E3),
    surface = Color(0xFF0D1514),
    onSurface = Color(0xFFFFFFFF),
    surfaceVariant = Color(0xFF3B4A49),
    onSurfaceVariant = Color(0xFFFFFFFF),
    surfaceTint = Color(0xFF66D9CB),
    inverseSurface = Color(0xFFDCE4E3),
    inverseOnSurface = Color(0xFF000000),
    error = Color(0xFFFFECE9),
    onError = Color(0xFF000000),
    errorContainer = Color(0xFFFFAEA4),
    onErrorContainer = Color(0xFF220000),
    outline = Color(0xFFE3F3F2),
    outlineVariant = Color(0xFFB5C6C5),
    scrim = Color(0xFF000000),
    surfaceBright = Color(0xFF495251),
    surfaceDim = Color(0xFF0D1514),
    surfaceContainer = Color(0xFF2A3231),
    surfaceContainerHigh = Color(0xFF353D3C),
    surfaceContainerHighest = Color(0xFF404848),
    surfaceContainerLow = Color(0xFF192121),
    surfaceContainerLowest = Color(0xFF000000),
    primaryFixed = Color(0xFF84F5E7),
    primaryFixedDim = Color(0xFF66D9CB),
    onPrimaryFixed = Color(0xFF000000),
    onPrimaryFixedVariant = Color(0xFF001512),
    secondaryFixed = Color(0xFFFFDBC9),
    secondaryFixedDim = Color(0xFFFFB68E),
    onSecondaryFixed = Color(0xFF000000),
    onSecondaryFixedVariant = Color(0xFF220A00),
    tertiaryFixed = Color(0xFFD8E2FF),
    tertiaryFixedDim = Color(0xFFADC6FF),
    onTertiaryFixed = Color(0xFF000000),
    onTertiaryFixedVariant = Color(0xFF00102E),
)

private val LightStandardExtended: OrderakExtendedColors = OrderakExtendedColors(
    warning = Color(0xFF755B00),
    warningSoft = Color(0xFFFFDF91),
    onWarning = Color(0xFFFFFFFF),
    onWarningContainer = Color(0xFF241A00),
    success = Color(0xFF006D43),
    successSoft = Color(0xFF92F7BC),
    onSuccess = Color(0xFFFFFFFF),
    onSuccessContainer = Color(0xFF002111),
    information = Color(0xFF00658F),
    informationSoft = Color(0xFFC7E7FF),
    onInformation = Color(0xFFFFFFFF),
    onInformationContainer = Color(0xFF001E2E),
    accent = Color(0xFF9B4500),
    onAccent = Color(0xFFFFFFFF),
    primaryTint = Color(0xFF66D9CB),
)

private val DarkStandardExtended: OrderakExtendedColors = OrderakExtendedColors(
    warning = Color(0xFFE9C259),
    warningSoft = Color(0xFF594400),
    onWarning = Color(0xFF3E2E00),
    onWarningContainer = Color(0xFFFFDF91),
    success = Color(0xFF76DAA1),
    successSoft = Color(0xFF005231),
    onSuccess = Color(0xFF003920),
    onSuccessContainer = Color(0xFF92F7BC),
    information = Color(0xFF88CEFE),
    informationSoft = Color(0xFF004C6D),
    onInformation = Color(0xFF00344C),
    onInformationContainer = Color(0xFFC7E7FF),
    accent = Color(0xFFFFB68E),
    onAccent = Color(0xFF532200),
    primaryTint = Color(0xFF006A62),
)

private val LightMediumExtended: OrderakExtendedColors = OrderakExtendedColors(
    warning = Color(0xFF594400),
    warningSoft = Color(0xFFE9C259),
    onWarning = Color(0xFFFFFFFF),
    onWarningContainer = Color(0xFF241A00),
    success = Color(0xFF005231),
    successSoft = Color(0xFF76DAA1),
    onSuccess = Color(0xFFFFFFFF),
    onSuccessContainer = Color(0xFF002111),
    information = Color(0xFF004C6D),
    informationSoft = Color(0xFF88CEFE),
    onInformation = Color(0xFFFFFFFF),
    onInformationContainer = Color(0xFF001E2E),
    accent = Color(0xFF5C2600),
    onAccent = Color(0xFFFFFFFF),
    primaryTint = Color(0xFF66D9CB),
)

private val DarkMediumExtended: OrderakExtendedColors = OrderakExtendedColors(
    warning = Color(0xFFFFDF91),
    warningSoft = Color(0xFF4B3900),
    onWarning = Color(0xFF241A00),
    onWarningContainer = Color(0xFFFFEFCF),
    success = Color(0xFF92F7BC),
    successSoft = Color(0xFF004529),
    onSuccess = Color(0xFF002111),
    onSuccessContainer = Color(0xFFC0FFD6),
    information = Color(0xFFC7E7FF),
    informationSoft = Color(0xFF00405C),
    onInformation = Color(0xFF001E2E),
    onInformationContainer = Color(0xFFE5F2FF),
    accent = Color(0xFFFFD3BD),
    onAccent = Color(0xFF421A00),
    primaryTint = Color(0xFF00514B),
)

private val LightHighExtended: OrderakExtendedColors = OrderakExtendedColors(
    warning = Color(0xFF3E2E00),
    warningSoft = Color(0xFFCBA740),
    onWarning = Color(0xFFFFFFFF),
    onWarningContainer = Color(0xFF000000),
    success = Color(0xFF003920),
    successSoft = Color(0xFF5ABE88),
    onSuccess = Color(0xFFFFFFFF),
    onSuccessContainer = Color(0xFF000000),
    information = Color(0xFF00344C),
    informationSoft = Color(0xFF6BB3E1),
    onInformation = Color(0xFFFFFFFF),
    onInformationContainer = Color(0xFF000000),
    accent = Color(0xFF4D1F00),
    onAccent = Color(0xFFFFFFFF),
    primaryTint = Color(0xFF66D9CB),
)

private val DarkHighExtended: OrderakExtendedColors = OrderakExtendedColors(
    warning = Color(0xFFFFEFCF),
    warningSoft = Color(0xFF3E2E00),
    onWarning = Color(0xFF000000),
    onWarningContainer = Color(0xFFFFFFFF),
    success = Color(0xFFC0FFD6),
    successSoft = Color(0xFF003920),
    onSuccess = Color(0xFF000000),
    onSuccessContainer = Color(0xFFFFFFFF),
    information = Color(0xFFE5F2FF),
    informationSoft = Color(0xFF00344C),
    onInformation = Color(0xFF000000),
    onInformationContainer = Color(0xFFFFFFFF),
    accent = Color(0xFFFFECE4),
    onAccent = Color(0xFF000000),
    primaryTint = Color(0xFF00514B),
)
