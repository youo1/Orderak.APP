package app.orderak.seller.data.auth

import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class PasskeySupportTest {
    @Test
    fun `API 24 through 27 use OTP fallback`() {
        (24..27).forEach { assertFalse(passkeysSupported(it)) }
    }

    @Test
    fun `Android 9 and newer allow Credential Manager passkeys`() {
        assertTrue(passkeysSupported(28))
        assertTrue(passkeysSupported(35))
    }
}
