package app.orderak.seller.data.remote

import app.orderak.seller.data.theme.selectHighestContrast
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.buildJsonArray
import kotlinx.serialization.json.buildJsonObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Test

class DesignSystemPayloadTest {
    private val requiredRoles = listOf(
        "primary", "onPrimary", "primaryContainer", "onPrimaryContainer",
        "secondary", "onSecondary", "secondaryContainer", "onSecondaryContainer",
        "tertiary", "onTertiary", "tertiaryContainer", "onTertiaryContainer",
        "error", "onError", "errorContainer", "onErrorContainer",
        "background", "onBackground", "surface", "onSurface",
        "surfaceVariant", "onSurfaceVariant", "outline", "outlineVariant",
        "inverseSurface", "inverseOnSurface", "inversePrimary", "surfaceTint", "scrim",
    )

    private fun payload(includeHigh: Boolean = true, touchTarget: Int = 48): String {
        val roles = buildJsonObject { requiredRoles.forEach { put(it, JsonPrimitive("#1E3A8A")) } }
        val modes = buildJsonObject {
            put("light", roles)
            put("dark", roles)
        }
        val schemes = buildJsonObject {
            put("standard", modes)
            put("medium", modes)
            if (includeHigh) put("high", modes)
        }
        val typeRoles = buildJsonObject {
            listOf(
                "displayLarge", "displayMedium", "displaySmall",
                "headlineLarge", "headlineMedium", "headlineSmall",
                "titleLarge", "titleMedium", "titleSmall",
                "bodyLarge", "bodyMedium", "bodySmall",
                "labelLarge", "labelMedium", "labelSmall",
            ).forEach { role ->
                put(role, buildJsonObject {
                    put("sizeSp", JsonPrimitive(16))
                    put("lineHeight", JsonPrimitive(1.5))
                    put("weight", JsonPrimitive(400))
                    put("letterSpacingEm", JsonPrimitive(0))
                })
            }
        }
        return buildJsonObject {
            put("schemaVersion", JsonPrimitive(2))
            put("version", JsonPrimitive("abc123"))
            put("revisionId", JsonPrimitive(7))
            put("designSystem", buildJsonObject {
                put("schemaVersion", JsonPrimitive(2))
                put("contentHash", JsonPrimitive("abc123"))
                put("schemes", schemes)
                put("semantic", schemes)
                put("typography", buildJsonObject {
                    put("family", JsonPrimitive("cairo"))
                    put("roles", typeRoles)
                })
                put("spacing", buildJsonObject { put("values", buildJsonArray {}) })
                put("shapes", buildJsonObject {})
                put("components", buildJsonObject {
                    put("minimumTouchTargetDp", JsonPrimitive(touchTarget))
                })
            })
        }.toString()
    }

    @Test
    fun acceptsCompleteSchemaV2AndLegacySchemaV1() {
        assertNotNull(decodeBrandingConfig(payload()))
        assertNotNull(decodeBrandingConfig("""{"version":"legacy","theme":{"primary":"#1E3A8A"}}"""))
    }

    @Test
    fun rejectsMissingContrastAndUnsafeTouchTarget() {
        assertNull(decodeBrandingConfig(payload(includeHigh = false)))
        assertNull(decodeBrandingConfig(payload(touchTarget = 44)))
    }

    @Test
    fun contrastPrecedenceIsMonotonic() {
        assertEquals("high", selectHighestContrast("medium", "standard", "high"))
        assertEquals("medium", selectHighestContrast("standard", "medium"))
        assertEquals("standard", selectHighestContrast("unknown", "standard"))
    }
}
