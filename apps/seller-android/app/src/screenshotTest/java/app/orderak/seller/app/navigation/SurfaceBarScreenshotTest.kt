package app.orderak.seller.app.navigation

import androidx.compose.material3.Surface
import androidx.compose.runtime.Composable
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.tooling.preview.Preview
import app.orderak.seller.core.ui.BottomNav
import app.orderak.seller.core.ui.NavItem
import app.orderak.seller.core.ui.theme.OrderakTheme
import com.android.tools.screenshot.PreviewTest

/**
 * The five-surface bar on its own.
 *
 * Rendering the whole shell would drag a ViewModel and a database in with it,
 * which is more than this needs to check: that five destinations fit, that their
 * labels survive Arabic without truncating, and that the selected indicator
 * lands where it should.
 */
@Composable
private fun SurfaceBar(selected: SellerSurface) {
    BottomNav(
        items = SellerSurface.entries.map { item ->
            NavItem(
                label = stringResource(item.labelRes),
                icon = item.icon,
                selectedIcon = item.selectedIcon,
            )
        },
        selectedIndex = SellerSurface.entries.indexOf(selected),
        onSelect = {},
    )
}

@PreviewTest
@Preview(name = "Surfaces light", locale = "ar")
@Composable
fun surfaceBarLight() {
    OrderakTheme(darkTheme = false) { Surface { SurfaceBar(SellerSurface.Today) } }
}

@PreviewTest
@Preview(name = "Surfaces dark account", locale = "ar")
@Composable
fun surfaceBarDarkAccount() {
    OrderakTheme(darkTheme = true) { Surface { SurfaceBar(SellerSurface.Account) } }
}

/** English is the longest of the three shipped locales for these labels. */
@PreviewTest
@Preview(name = "Surfaces english", locale = "en")
@Composable
fun surfaceBarEnglish() {
    OrderakTheme(darkTheme = false) { Surface { SurfaceBar(SellerSurface.Store) } }
}
