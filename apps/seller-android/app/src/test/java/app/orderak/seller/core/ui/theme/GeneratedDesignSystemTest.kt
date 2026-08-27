package app.orderak.seller.core.ui.theme

import app.orderak.seller.data.theme.selectHighestContrast
import app.orderak.seller.data.theme.systemContrastLevel
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotEquals
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * Replaces DesignSystemPayloadTest.
 *
 * That test validated a *remote* design-system payload before it reached the UI.
 * There is no remote payload any more: the design system is generated at build
 * time into [GeneratedDesignSystem]. The invariants it protected still matter,
 * so they are asserted here against the generated source instead — completeness
 * of every contrast/mode combination, the full 15-role type scale, and the 48dp
 * touch-target floor.
 */
class GeneratedDesignSystemTest {

    private val requiredRoles = listOf(
        "primary", "onPrimary", "primaryContainer", "onPrimaryContainer",
        "secondary", "onSecondary", "secondaryContainer", "onSecondaryContainer",
        "tertiary", "onTertiary", "tertiaryContainer", "onTertiaryContainer",
        "error", "onError", "errorContainer", "onErrorContainer",
        "background", "onBackground", "surface", "onSurface",
        "surfaceVariant", "onSurfaceVariant", "outline", "outlineVariant",
        "inverseSurface", "inverseOnSurface", "inversePrimary", "surfaceTint", "scrim",
    )

    private val typographyRoles = listOf(
        "displayLarge", "displayMedium", "displaySmall",
        "headlineLarge", "headlineMedium", "headlineSmall",
        "titleLarge", "titleMedium", "titleSmall",
        "bodyLarge", "bodyMedium", "bodySmall",
        "labelLarge", "labelMedium", "labelSmall",
    )

    @Test
    fun everyContrastAndModeResolvesToADistinctScheme() {
        val schemes = GeneratedDesignSystem.contrasts.flatMap { contrast ->
            listOf(false, true).map { dark -> GeneratedDesignSystem.colorScheme(contrast, dark) }
        }
        assertEquals(6, schemes.size)
        // Light and dark must not collapse onto the same scheme.
        assertNotEquals(
            GeneratedDesignSystem.colorScheme("standard", dark = false).background,
            GeneratedDesignSystem.colorScheme("standard", dark = true).background,
        )
        // Raising contrast must actually change the emitted colours.
        assertNotEquals(
            GeneratedDesignSystem.colorScheme("standard", dark = true).primary,
            GeneratedDesignSystem.colorScheme("high", dark = true).primary,
        )
    }

    @Test
    fun schemesExposeEveryRequiredMaterialRole() {
        // ColorScheme is a data class with non-null Color members, so the compiler
        // already guarantees presence. What is worth asserting is that the
        // generator filled them rather than defaulting: no role may be transparent.
        for (contrast in GeneratedDesignSystem.contrasts) {
            for (dark in listOf(false, true)) {
                val scheme = GeneratedDesignSystem.colorScheme(contrast, dark)
                val values = listOf(
                    scheme.primary, scheme.onPrimary, scheme.primaryContainer, scheme.onPrimaryContainer,
                    scheme.secondary, scheme.onSecondary, scheme.secondaryContainer, scheme.onSecondaryContainer,
                    scheme.tertiary, scheme.onTertiary, scheme.tertiaryContainer, scheme.onTertiaryContainer,
                    scheme.error, scheme.onError, scheme.errorContainer, scheme.onErrorContainer,
                    scheme.background, scheme.onBackground, scheme.surface, scheme.onSurface,
                    scheme.surfaceVariant, scheme.onSurfaceVariant, scheme.outline, scheme.outlineVariant,
                    scheme.inverseSurface, scheme.inverseOnSurface, scheme.inversePrimary,
                    scheme.surfaceTint, scheme.scrim,
                )
                assertEquals(requiredRoles.size, values.size)
                assertTrue(
                    "$contrast/$dark has a fully transparent role",
                    values.all { it.alpha == 1f },
                )
            }
        }
    }

    @Test
    fun typographyCarriesAllFifteenRoles() {
        assertEquals(15, GeneratedDesignSystem.typography.size)
        assertTrue(GeneratedDesignSystem.typography.keys.containsAll(typographyRoles))
        assertTrue(GeneratedDesignSystem.typography.values.all { it.sizeSp > 0f && it.lineHeight > 0f })
    }

    @Test
    fun touchTargetFloorIsAccessible() {
        assertTrue(GeneratedDesignSystem.MINIMUM_TOUCH_TARGET_DP >= 48f)
    }

    @Test
    fun unknownContrastFallsBackToStandard() {
        assertEquals("standard", GeneratedDesignSystem.normalizeContrast("enormous"))
        assertEquals("high", GeneratedDesignSystem.normalizeContrast("high"))
    }

    @Test
    fun contrastPrecedenceIsMonotonic() {
        assertEquals("high", selectHighestContrast("medium", "standard", "high"))
        assertEquals("medium", selectHighestContrast("standard", "medium"))
        assertEquals("standard", selectHighestContrast("unknown", "standard"))
    }

    @Test
    fun systemContrastPrefersTheUiModeSignalThenTheLegacyFlag() {
        assertEquals("high", systemContrastLevel(uiModeContrast = 1.0f, highTextContrastEnabled = false))
        assertEquals("medium", systemContrastLevel(uiModeContrast = 0.5f, highTextContrastEnabled = false))
        assertEquals("standard", systemContrastLevel(uiModeContrast = 0.0f, highTextContrastEnabled = false))
        // Below API 34 there is no float signal, so the legacy flag is all there is.
        assertEquals("high", systemContrastLevel(uiModeContrast = null, highTextContrastEnabled = true))
        assertEquals("standard", systemContrastLevel(uiModeContrast = null, highTextContrastEnabled = false))
    }
}
