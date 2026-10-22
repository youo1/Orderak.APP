package app.orderak.seller.a11y

import java.io.File
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * Locked regression: this task adds Banner, OfflineStrip, and Skeleton
 * strings to default, Arabic, English, and French resources. Whatever keys
 * land must keep complete key-and-resource-type parity across all four files
 * (docs/contracts/localization-invariants.md, invariant 1) both before and
 * after this task — it must not newly break on the unchanged tree, and the
 * change must not break it either.
 *
 * Asserts only key names and resource tags (string / string-array / plurals),
 * never string values, so it does not pin any colloquial Arabic copy.
 */
class FeedbackKitStringParityAcceptanceTest {

    private val resourceDirs = listOf("values-ar", "values-en", "values-fr")

    private fun stringsFile(dir: String): File = File("src/main/res/$dir/strings.xml")

    private data class ResourceKey(val tag: String, val name: String)

    private val tagAndName = Regex("""<(string|string-array|plurals)\s+name="([^"]+)"""")

    private fun keys(file: File): Set<ResourceKey> {
        assertTrue("Missing ${'$'}{file.path}; run from the app module", file.isFile)
        return tagAndName.findAll(file.readText())
            .map { ResourceKey(it.groupValues[1], it.groupValues[2]) }
            .toSet()
    }

    @Test
    fun theFourShippedLocalesKeepCompleteKeyAndResourceTypeParity() {
        val base = keys(stringsFile("values"))
        assertTrue("The default values/strings.xml declares no keys at all", base.isNotEmpty())
        for (dir in resourceDirs) {
            val actual = keys(stringsFile(dir))
            val missing = base - actual
            val extra = actual - base
            assertTrue(
                "$dir/strings.xml is missing key/type(s) present in the default resource: $missing",
                missing.isEmpty(),
            )
            assertTrue(
                "$dir/strings.xml declares key/type(s) not present in the default resource: $extra",
                extra.isEmpty(),
            )
        }
    }
}
