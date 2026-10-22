package app.orderak.seller.a11y

import android.app.Application
import androidx.test.core.app.ApplicationProvider
import androidx.test.ext.junit.runners.AndroidJUnit4
import app.orderak.seller.R
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotEquals
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.annotation.Config

/**
 * Locked acceptance check for D-15: the shared retry string used across the
 * R1a feedback family (Banner's sync-failed retry, ErrorState, and every
 * other caller of `common_retry`) must read the approved Modern Standard
 * Arabic glossary term, not today's colloquial wording. Asserted by resource
 * key only, per the spec's own rule against pinning colloquial Arabic; no
 * component API is assumed.
 */
@RunWith(AndroidJUnit4::class)
@Config(sdk = [35], qualifiers = "ar-w411dp-h891dp-xxhdpi", application = Application::class)
class D15CommonRetryStringAcceptanceTest {

    @Test
    fun commonRetryUsesTheApprovedStandardArabicGlossaryTerm() {
        val value = ApplicationProvider.getApplicationContext<Application>()
            .resources.getString(R.string.common_retry)
        assertNotEquals(
            "D-15 replaces today's colloquial retry text; the resource must no longer read it",
            "حاول تاني",
            value,
        )
        assertEquals(
            "D-15's glossary gives إعادة المحاولة as the retry verbal noun",
            "إعادة المحاولة",
            value,
        )
    }
}
