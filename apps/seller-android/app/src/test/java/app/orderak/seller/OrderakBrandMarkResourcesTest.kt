package app.orderak.seller

import org.junit.Assert.assertTrue
import org.junit.Test
import java.io.File

/**
 * Plan item B9: the launcher background becomes primary #014D4E, and the
 * three brand-mark drawables drop the legacy green/orange mark colors.
 */
class OrderakBrandMarkResourcesTest {

    private val legacyColors = listOf("#1DAB61", "#127943", "#ED8936")

    private fun resource(relativePath: String): File {
        val file = File("src/main/res/$relativePath")
        assertTrue("expected to find src/main/res/$relativePath (run from the :app module directory)", file.exists())
        return file
    }

    @Test
    fun `launcher background uses the primary brand color role`() {
        val text = resource("values/ic_launcher_background.xml").readText()
        assertTrue(
            "ic_launcher_background.xml must declare primary #014D4E",
            Regex("(?i)#014D4E").containsMatchIn(text),
        )
    }

    @Test
    fun `brand drawables drop the legacy mark colors`() {
        val files = listOf(
            "drawable/ic_launcher_foreground.xml",
            "drawable/ic_launcher_monochrome.xml",
            "drawable/ic_orderak_logo.xml",
        )
        val offenders = files.flatMap { relativePath ->
            val text = resource(relativePath).readText().uppercase()
            legacyColors.filter { text.contains(it) }.map { "$relativePath: $it" }
        }
        assertTrue("legacy mark colors remain: $offenders", offenders.isEmpty())
    }
}
