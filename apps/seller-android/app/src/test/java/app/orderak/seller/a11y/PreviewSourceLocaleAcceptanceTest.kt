package app.orderak.seller.a11y

import java.io.File
import java.lang.reflect.Method
import java.nio.file.Files
import org.junit.Assert.assertTrue
import org.junit.Assert.fail
import org.junit.Test

/**
 * Locked acceptance checks for the R1a preview-source parser's explicit-root
 * entry point.
 *
 * Reached through java.lang.reflect rather than a direct compile-time call:
 * on today's tree `SourceDeclarations.parse()` takes no arguments and is
 * private, so a direct `SourceDeclarations.parse(sourceRoot = ..., multipreviewRoot = ...)`
 * call does not compile at all (Kotlin compiles every unit test in the module
 * together, so that would break unrelated tests too). Reflection lets this
 * file compile unchanged on both the old and the new tree and fail by
 * assertion, not by compilation, until the overload exists. The method-name
 * check tolerates Kotlin's `internal` name mangling (e.g. `parse$app_debug`)
 * by matching on a `parse` prefix instead of an exact name.
 */
class PreviewSourceLocaleAcceptanceTest {

    private fun tempDir(): File = Files.createTempDirectory("r1a-preview-source-").toFile()

    private fun write(dir: File, relativePath: String, text: String) {
        val file = File(dir, relativePath)
        file.parentFile.mkdirs()
        file.writeText(text)
    }

    private fun sourceDeclarationsClass(): Class<*> =
        Class.forName("app.orderak.seller.a11y.SourceDeclarations")

    private fun singletonInstance(): Any {
        val field = sourceDeclarationsClass().getDeclaredField("INSTANCE")
        field.isAccessible = true
        return field.get(null)
    }

    private fun findTwoFileArgParseMethod(): Method? =
        sourceDeclarationsClass().declaredMethods.firstOrNull { method ->
            method.name.startsWith("parse") &&
                method.parameterCount == 2 &&
                method.parameterTypes.all { it == File::class.java }
        }

    @Test
    fun theParserExposesAnExplicitSourceRootAndMultipreviewRootEntryPoint() {
        val method = findTwoFileArgParseMethod()
        val declaredNames = sourceDeclarationsClass().declaredMethods.joinToString { it.toString() }
        assertTrue(
            "Expected SourceDeclarations to declare a parse(sourceRoot: File, multipreviewRoot: File) " +
                "overload (or an internal-mangled equivalent starting with 'parse' and taking two File " +
                "parameters); found among: $declaredNames",
            method != null,
        )
    }

    @Test
    fun aPreviewTestDeclarationWithNoLocaleMetadataFailsParsingInsteadOfDefaultingToArabic() {
        val method = findTwoFileArgParseMethod()
        if (method == null) {
            fail("No two-File-argument parse overload found on SourceDeclarations yet")
            return
        }
        method.isAccessible = true
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
            method.invoke(singletonInstance(), sourceRoot, multipreviewRoot)
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
        val method = findTwoFileArgParseMethod()
        if (method == null) {
            fail("No two-File-argument parse overload found on SourceDeclarations yet")
            return
        }
        method.isAccessible = true
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

        val result = method.invoke(singletonInstance(), sourceRoot, multipreviewRoot)
        val declarations = result as? List<*> ?: emptyList<Any?>()
        val found = declarations.any { declaration ->
            declaration != null &&
                declaration.javaClass.methods.firstOrNull { it.name == "getFunction" }
                    ?.invoke(declaration) == "zzLocaleProbe"
        }
        assertTrue(
            "An explicit-locale @PreviewTest in the injected source root must parse",
            found,
        )
    }
}
