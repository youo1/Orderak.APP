package app.orderak.seller.a11y

import androidx.compose.runtime.reflect.getDeclaredComposableMethod
import java.io.File
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test
import org.junit.runner.Description
import org.junit.runner.Request

/**
 * Locked coverage checks: every source @PreviewTest declaration is on the unit-test
 * classpath and is its own named case in AccessibilityPreviewAuditTest.
 *
 * The source is the authority. Counting uses an anchored line-start matcher, and the
 * function a declaration names is the next `fun` after the annotation.
 */
class PreviewAuditCoverageAcceptanceTest {

    private data class Declared(val packageName: String, val facade: String, val function: String)

    private val sourceRoot = File("src/screenshotTest/java")
    private val annotation = Regex("""(?m)^\s*@PreviewTest\s*$""")
    private val function = Regex("""\bfun\s+(\w+)\s*\(""")
    private val packageLine = Regex("""(?m)^package\s+([\w.]+)""")

    private fun declared(): List<Declared> {
        assertTrue(
            "Missing ${sourceRoot.absolutePath}; unit tests must run from the app module",
            sourceRoot.isDirectory,
        )
        val result = sourceRoot.walkTopDown()
            .filter { it.isFile && it.extension == "kt" }
            .sortedBy { it.path }
            .flatMap { file ->
                val text = file.readText()
                val pkg = packageLine.find(text)?.groupValues?.get(1).orEmpty()
                val facade = file.nameWithoutExtension + "Kt"
                annotation.findAll(text).map { match ->
                    val name = function.find(text, match.range.last)?.groupValues?.get(1)
                        ?: error("No function after @PreviewTest in ${file.path}")
                    Declared(pkg, facade, name)
                }.toList()
            }
            .toList()
        assertTrue("No @PreviewTest declarations found", result.isNotEmpty())
        return result
    }

    private fun leaves(description: Description): List<Description> =
        if (description.children.isEmpty()) listOf(description)
        else description.children.flatMap { leaves(it) }

    @Test
    fun everyDeclaredStateResolvesFromTheUnitTestClasspath() {
        val loader = javaClass.classLoader
        for (d in declared()) {
            val qualified = if (d.packageName.isEmpty()) d.facade else "${d.packageName}.${d.facade}"
            val cls = Class.forName(qualified, false, loader)
            cls.getDeclaredComposableMethod(d.function)
        }
    }

    @Test
    fun everyDeclaredStateIsItsOwnNamedAuditCase() {
        val sources = declared()
        val description = Request.aClass(AccessibilityPreviewAuditTest::class.java).runner.description
        val auditCases = leaves(description).filter { "ScreenshotTestKt" in it.displayName }
        assertEquals(
            "Audited case count must equal the source @PreviewTest count",
            sources.size,
            auditCases.size,
        )
        for (d in sources) {
            val fn = Regex("""\b${Regex.escape(d.function)}\b""")
            assertTrue(
                "No audit case names ${d.facade}.${d.function}",
                auditCases.any { d.facade in it.displayName && fn.containsMatchIn(it.displayName) },
            )
        }
    }
}
