package app.orderak.seller.core.ui

import android.app.Application
import androidx.test.core.app.ApplicationProvider
import androidx.test.ext.junit.runners.AndroidJUnit4
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotEquals
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.annotation.Config

/**
 * Arabic counts take a different noun form for 1, 2, 3–10 and 11 or more.
 * A fixed «دقائق» is right for 3–10 only, so the last-update line is a
 * count-aware plurals resource. Looked up by name so this file compiles
 * before the resource exists.
 */
@RunWith(AndroidJUnit4::class)
@Config(sdk = [35], qualifiers = "ar", application = Application::class)
class OfflineStripLastUpdatePluralTest {

    private fun lastUpdate(minutes: Int): String {
        val context = ApplicationProvider.getApplicationContext<Application>()
        val id = context.resources.getIdentifier("offline_strip_last_update", "plurals", context.packageName)
        assertNotEquals("offline_strip_last_update must be a plurals resource", 0, id)
        return context.resources.getQuantityString(id, minutes, minutes.toString())
    }

    @Test
    fun arabicUsesTheNounFormEachCountNeeds() {
        assertEquals("آخر تحديث منذ دقيقة", lastUpdate(1))
        assertEquals("آخر تحديث منذ دقيقتين", lastUpdate(2))
        assertEquals("آخر تحديث منذ 5 دقائق", lastUpdate(5))
        assertEquals("آخر تحديث منذ 11 دقيقة", lastUpdate(11))
    }
}
