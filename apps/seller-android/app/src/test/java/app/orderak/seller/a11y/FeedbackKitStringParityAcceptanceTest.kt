package app.orderak.seller.a11y

import java.io.File
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * Locked regression: this task adds Banner, OfflineStrip, and Skeleton
 * strings to default, Arabic, English, and French resources. Whatever keys
 * land must keep complete key-and-resource-type parity across all four files
 * (docs/contracts/localization-invariants.md, invariant 1), excluding keys
 * the default resource marks translatable="false" — invariant 1's own
 * "non-translatable brand assets" carve-out (e.g. app_name, which today
 * exists only in the default resource). Parity must hold both before and
 * after this task: it must not newly break on the unchanged tree, and the
 * change must not break it either.
 *
 * Asserts only key names and resource tags (string / string-array / plurals),
 * never string values, so it does not pin any colloquial Arabic copy.
 */
class FeedbackKitStringParityAcceptanceTest {

    private val resourceDirs = listOf("values-ar", "values-en", "values-fr")

    private fun stringsFile(dir: String): File = File("src/main/res/$dir/strings.xml")

    private data class ResourceKey(val tag: String, val name: String)

    private val openTag = Regex("""<(string|string-array|plurals)\s+([^>]*)>""")
    private val nameAttr = Regex("""name="([^"]+)"""")
    private val notTranslatable = Regex("""translatable\s*=\s*"false"""")

    private fun keys(file: File): Set<ResourceKey> {
        assertTrue("Missing ${'$'}{file.path}; run from the app module", file.isFile)
        return openTag.findAll(file.readText())
            .mapNotNull { match ->
                val attrs = match.groupValues[2]
                if (notTranslatable.containsMatchIn(attrs)) return@mapNotNull null
                val name = nameAttr.find(attrs)?.groupValues?.get(1) ?: return@mapNotNull null
                ResourceKey(match.groupValues[1], name)
            }
            .toSet()
    }

    @Test
    fun theFourShippedLocalesKeepCompleteKeyAndResourceTypeParityExcludingNonTranslatableAssets() {
        val base = keys(stringsFile("values"))
        assertTrue("The default values/strings.xml declares no translatable keys at all", base.isNotEmpty())
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
