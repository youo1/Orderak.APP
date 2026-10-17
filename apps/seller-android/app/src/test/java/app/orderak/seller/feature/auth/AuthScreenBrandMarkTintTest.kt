package app.orderak.seller.feature.auth

import org.junit.Assert.assertTrue
import org.junit.Test
import java.io.File

/**
 * Plan item B9: the welcome screen's Orderak mark must be tinted with the
 * primary color role, the same way AuthHeader already tints its Icon.
 */
class AuthScreenBrandMarkTintTest {

    private fun callBody(source: String, callStart: String): String {
        val start = source.indexOf(callStart)
        assertTrue("expected to find `$callStart` in AuthScreen.kt", start != -1)
        var depth = 0
        var end = -1
        var i = start + callStart.length - 1 // position at the opening '('
        while (i < source.length) {
            when (source[i]) {
                '(' -> depth++
                ')' -> {
                    depth--
                    if (depth == 0) {
                        end = i
                        break
                    }
                }
            }
            i++
        }
        assertTrue("could not find the matching closing parenthesis for `$callStart`", end != -1)
        return source.substring(start, end + 1)
    }

    @Test
    fun `welcome screen tints the Orderak mark Image with the primary color role`() {
        val file = File("src/main/java/app/orderak/seller/feature/auth/AuthScreen.kt")
        assertTrue("expected to find ${file.path} (run from the :app module directory)", file.exists())
        val call = callBody(file.readText(), "Image(")
        assertTrue(
            "the welcome Image(...) must still draw R.drawable.ic_orderak_logo",
            call.contains("R.drawable.ic_orderak_logo"),
        )
        val tinted = Regex("ColorFilter\\.tint\\(\\s*(color\\s*=\\s*)?MaterialTheme\\.colorScheme\\.primary\\s*,?\\s*\\)")
            .containsMatchIn(call)
        assertTrue(
            "the welcome mark must be tinted with ColorFilter.tint(MaterialTheme.colorScheme.primary), " +
                "matching AuthHeader's existing tint behavior. Found call: $call",
            tinted,
        )
    }
}
