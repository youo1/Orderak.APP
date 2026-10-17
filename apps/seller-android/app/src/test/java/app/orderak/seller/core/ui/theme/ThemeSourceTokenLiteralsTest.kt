package app.orderak.seller.core.ui.theme

import java.io.File
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * B2: Theme.kt keeps no token value of its own. Every adapter reads the
 * generated constants, and the generated contract records schema 3.
 */
class ThemeSourceTokenLiteralsTest {

    private val source: String by lazy {
        val relative = "src/main/java/app/orderak/seller/core/ui/theme/Theme.kt"
        val file = listOf(File(relative), File("app/$relative"), File("apps/seller-android/app/$relative"))
            .firstOrNull { it.isFile }
            ?: error("Theme.kt not found from ${File(".").absolutePath}")
        file.readText()
            .replace(Regex("""/\*[\s\S]*?\*/"""), "")
            .replace(Regex("""//[^\n]*"""), "")
    }

    /** Everything before the theme composable: the token adapters and the generated accessors. */
    private val adapters: String by lazy {
        val end = source.indexOf("fun OrderakTheme(")
        require(end > 0) { "Theme.kt no longer declares fun OrderakTheme(" }
        source.substring(0, end)
    }

    @Test
    fun unusedOrderakShapesIsDeleted() {
        assertFalse(Regex("""\bOrderakShapes\b""").containsMatchIn(source))
    }

    @Test
    fun adaptersWriteNoTokenValueByHand() {
        val offenders = listOf(
            Regex("""(?<![\w.])\d+(?:\.\d+)?\.dp\b"""),
            Regex("""\b(?:Int|Long)\s*=\s*\d+"""),
            Regex("""\bpercent\s*=\s*\d+"""),
            Regex("""RoundedCornerShape\(\s*\d"""),
        ).flatMap { pattern -> pattern.findAll(adapters).map { it.value }.toList() }
        assertTrue("Theme.kt still writes token values by hand: $offenders", offenders.isEmpty())
    }

    @Test
    fun pinnedNamesRemain() {
        for (name in listOf(
            "generatedShapes",
            "LocalOrderakSpacing provides spacing",
            "OrderakTypography.withGenerated",
            "GeneratedDesignSystem.colorScheme(",
            "GeneratedDesignSystem.extendedColors(",
            "fun reduced()",
        )) {
            assertTrue("Theme.kt lost $name", source.contains(name))
        }
    }

    @Test
    fun generatedContractRecordsSchemaThree() {
        assertEquals(3, DesignSystemContract.SCHEMA_VERSION)
        assertEquals("orderak-mcu-0.3.0+4", DesignSystemContract.GENERATOR_VERSION)
        assertEquals(GeneratedDesignSystem.GENERATOR_VERSION, DesignSystemContract.GENERATOR_VERSION)
        assertEquals(GeneratedDesignSystem.CONTENT_HASH, DesignSystemContract.DEFAULT_FALLBACK_HASH)
    }
}
