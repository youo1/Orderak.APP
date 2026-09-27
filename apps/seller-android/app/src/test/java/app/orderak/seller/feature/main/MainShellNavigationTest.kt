package app.orderak.seller.feature.main

import app.orderak.seller.app.navigation.SellerSurface
import org.junit.Assert.assertEquals
import org.junit.Test

/**
 * The shell's route-to-surface mapping, which is what the navigation bar's
 * selection and the back handler both read.
 *
 * These exist because the failure they prevent is invisible: a route that resolves
 * to the wrong surface selects the wrong tab, and a route that resolves to none
 * makes back leave the app from a surface the seller is standing on. Neither
 * throws, and neither appears in a crash report.
 */
class MainShellNavigationTest {

    @Test
    fun `every surface's own route resolves back to it`() {
        for (surface in SellerSurface.entries) {
            assertEquals(surface, sellerSurfaceForRoute(surface.name))
        }
    }

    /** The first frame of the inner NavHost has no entry, and the bar still draws. */
    @Test
    fun `no route falls back to the surface the graph starts on`() {
        assertEquals(SellerSurface.Default, sellerSurfaceForRoute(null))
    }

    /** A destination that is not a surface must not select a surface by accident. */
    @Test
    fun `an unrelated route falls back rather than matching a prefix`() {
        assertEquals(SellerSurface.Default, sellerSurfaceForRoute("OrderDetailsRoute"))
        assertEquals(SellerSurface.Default, sellerSurfaceForRoute(""))
        // The old shell saved the surface by name; a route is a string, so a
        // name that merely starts the same must still not match.
        assertEquals(SellerSurface.Default, sellerSurfaceForRoute("Toda"))
        assertEquals(SellerSurface.Default, sellerSurfaceForRoute("OrdersRoute"))
    }

    /**
     * Back leaves the app only from the start surface.
     *
     * The handler is enabled on `shellOwnsBack(surface)`, so this asserts the rule
     * the shell reads rather than restating the composable's condition.
     */
    @Test
    fun `the shell leaves back to the system on the start surface only`() {
        assertEquals(false, shellOwnsBack(SellerSurface.Default))
        for (surface in SellerSurface.entries.filter { it != SellerSurface.Default }) {
            assertEquals("back is not the shell's on ${surface.name}", true, shellOwnsBack(surface))
        }
    }
}
