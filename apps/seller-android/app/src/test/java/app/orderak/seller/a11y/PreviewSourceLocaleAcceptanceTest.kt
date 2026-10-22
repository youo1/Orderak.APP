package app.orderak.seller.a11y

import java.io.File
import java.nio.file.Files
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * Locked acceptance checks for the R1a preview-source parser.
 *
 * The parser must fail when a @PreviewTest declares no locale metadata,
 * instead of silently defaulting every unlabelled preview to Arabic, and it
 * must accept an injected source root so a fixture can prove that without
 * touching the real app sources (whose multipreview annotations always carry
 * explicit locales today, so the failure path is otherwise untestable).
 */
class PreviewSourceLocaleAcceptanceTest {

    private fun tempDir(): File = Files.createTempDirectory("r1a-preview-source-").toFile()

    private fun write(dir: File, relativePath: String, text: String) {
        val file = File(dir, relativePath)
        file.parentFile.mkdirs()
        file.writeText(text)
    }

    @Test
    fun aPreviewTestDeclarationWithNoLocaleMetadataFailsParsingInsteadOfDefaultingToArabic() {
        val sourceRoot = tempDir()
        val multipreviewRoot = tempDir()
        write(
            sourceRoot,
            "app/orderak/seller/core/ui/ZzNoLocaleScreenshotTest.kt",
            """
            package app.orderak.seller.core.ui

            import androidx.compose.runtime.Composable

            @PreviewTest
            @Composable
            fun zzNoLocaleProbe() {}

            """.trimIndent(),
        )

        var threw = false
        try {
            SourceDeclarations.parse(sourceRoot = sourceRoot, multipreviewRoot = multipreviewRoot)
        } catch (error: Throwable) {
            threw = true
        }
        assertTrue(
            "A @PreviewTest with no locale metadata must fail parsing, not default to Arabic",
            threw,
        )
    }

    @Test
    fun anInjectedSourceRootWithExplicitLocaleMetadataParsesWithoutTouchingRealAppSources() {
        val sourceRoot = tempDir()
        val multipreviewRoot = tempDir()
        write(
            sourceRoot,
            "app/orderak/seller/core/ui/ZzLocaleScreenshotTest.kt",
            """
            package app.orderak.seller.core.ui

            import androidx.compose.runtime.Composable
            import androidx.compose.ui.tooling.preview.Preview

            @PreviewTest
            @Preview(locale = "en")
            @Preview(locale = "ar")
            @Composable
            fun zzLocaleProbe() {}

            """.trimIndent(),
        )

        val declarations = SourceDeclarations.parse(sourceRoot = sourceRoot, multipreviewRoot = multipreviewRoot)
        assertTrue(
            "An explicit-locale @PreviewTest in the injected source root must parse",
            declarations.any { it.function == "zzLocaleProbe" },
        )
    }
}
