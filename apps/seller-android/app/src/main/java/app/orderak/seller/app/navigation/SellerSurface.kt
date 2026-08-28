package app.orderak.seller.app.navigation

import androidx.annotation.StringRes
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.outlined.ReceiptLong
import androidx.compose.material.icons.filled.Home
import androidx.compose.material.icons.outlined.Group
import androidx.compose.material.icons.outlined.Inventory2
import androidx.compose.material.icons.outlined.Person
import androidx.compose.ui.graphics.vector.ImageVector
import app.orderak.seller.R

/**
 * The five top-level surfaces of the seller app.
 *
 * Replaces four tabs plus a settings icon in the app bar. That shape had room
 * for four ideas and a drawer, so everything that was not an order, a product
 * or a customer ended up in settings — which is how a screen that should hold a
 * store's identity came to hold devices, translations, deletion and the AI
 * assistant as well.
 *
 * Each surface is named for something a seller does, not for a table. The
 * catalogue's fifteen feature categories each map onto exactly one of them, so a
 * new feature joins an existing surface instead of creating another loose entry.
 *
 * The enum replaces a bare Int. The Int worked, but `tab == 2` says nothing
 * about which screen that is, and a fifth surface would have shifted every
 * comparison by one.
 */
enum class SellerSurface(
    @StringRes val labelRes: Int,
    val icon: ImageVector,
) {
    /** Today's work: counters, plan usage, the catalog link, notices. */
    Today(R.string.nav_dashboard, Icons.Filled.Home),

    /** Orders, ordered by whether they need the seller. */
    Orders(R.string.nav_orders, Icons.AutoMirrored.Outlined.ReceiptLong),

    /** The catalog: products, categories, the public storefront. */
    Store(R.string.nav_products, Icons.Outlined.Inventory2),

    /** Customers and their history. */
    Customers(R.string.nav_customers, Icons.Outlined.Group),

    /**
     * Identity, plan, devices, support — grouped rather than listed flat.
     *
     * Absorbs what the settings screen used to show. The old route was kept
     * reachable until this surface had been checked against it entry by entry;
     * it has been, so the route is gone and this is the only way in.
     */
    Account(R.string.nav_account, Icons.Outlined.Person),
    ;

    companion object {
        val Default = Today
    }
}
