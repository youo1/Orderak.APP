package app.orderak.seller.feature.auth

import org.junit.Assert.assertTrue
import org.junit.Test
import java.io.File

/**
 * Plan item B9 forbids touching AuthHeader.kt. This guards its existing tint
 * behavior so an unintended edit to it is caught.
 */
class AuthHeaderTintRegressionTest {

    @Test
    fun `AuthHeader keeps tinting its Icon with the primary color role`() {
        val file = File("src/main/java/app/orderak/seller/feature/auth/AuthHeader.kt")
        assertTrue("expected to find ${file.path} (run from the :app module directory)", file.exists())
        val source = file.readText()
        val start = source.indexOf("Icon(")
        assertTrue("expected to find an Icon(...) call in AuthHeader.kt", start != -1)
        var depth = 0
        var end = -1
        var i = start + "Icon(".length - 1
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
        assertTrue("could not find the matching closing parenthesis for Icon(...)", end != -1)
        val call = source.substring(start, end + 1)
        assertTrue(
            "AuthHeader's Icon(...) must still draw R.drawable.ic_orderak_logo",
            call.contains("R.drawable.ic_orderak_logo"),
        )
        assertTrue(
            "AuthHeader must keep tinting with MaterialTheme.colorScheme.primary",
            call.contains("tint = MaterialTheme.colorScheme.primary"),
        )
    }
}
