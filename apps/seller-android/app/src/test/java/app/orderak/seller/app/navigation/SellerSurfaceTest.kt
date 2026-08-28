package app.orderak.seller.app.navigation

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * The shell's contract with itself.
 *
 * These are cheap assertions about a small enum, and they exist because the
 * thing they protect is easy to break by accident and expensive to notice: a
 * seller restored onto the wrong surface after process death has no way to tell
 * that anything went wrong, and neither does a crash report.
 */
class SellerSurfaceTest {

    @Test
    fun `five surfaces, in the order the navigation bar draws them`() {
        assertEquals(
            listOf(
                SellerSurface.Today,
                SellerSurface.Orders,
                SellerSurface.Store,
                SellerSurface.Customers,
                SellerSurface.Account,
            ),
            SellerSurface.entries.toList(),
        )
    }

    @Test
    fun `the app opens on today`() {
        assertEquals(SellerSurface.Today, SellerSurface.Default)
    }

    /**
     * The shell saves the surface by name. An ordinal survives process death
     * only until the surface list changes, and then silently restores the
     * neighbour — reordering this enum would have moved every seller who was
     * mid-task onto a different screen.
     */
    @Test
    fun `every surface round-trips through its saved name`() {
        for (surface in SellerSurface.entries) {
            assertEquals(surface, SellerSurface.valueOf(surface.name))
        }
    }

    @Test
    fun `every surface carries a label and an icon`() {
        for (surface in SellerSurface.entries) {
            assertTrue("${surface.name} has no label resource", surface.labelRes != 0)
            assertNotNull("${surface.name} has no icon", surface.icon)
        }
    }

    /**
     * Material 3 puts the ceiling for bottom navigation at five. Past that the
     * labels truncate and the targets fall under the 48dp minimum, so a sixth
     * surface is a signal to regroup rather than to widen the bar.
     */
    @Test
    fun `the bar stays within the five-destination ceiling`() {
        assertTrue(
            "Bottom navigation holds at most five destinations",
            SellerSurface.entries.size <= 5,
        )
    }
}
