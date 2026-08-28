package app.orderak.seller.app.navigation

import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.NavigationBar
import androidx.compose.material3.NavigationBarItem
import androidx.compose.material3.NavigationBarItemDefaults
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.tooling.preview.Preview
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
    NavigationBar {
        SellerSurface.entries.forEach { item ->
            val label = stringResource(item.labelRes)
            NavigationBarItem(
                selected = selected == item,
                onClick = {},
                icon = { Icon(item.icon, contentDescription = label) },
                label = { Text(label) },
                colors = NavigationBarItemDefaults.colors(
                    selectedIconColor = MaterialTheme.colorScheme.onPrimaryContainer,
                    selectedTextColor = MaterialTheme.colorScheme.onSurface,
                    indicatorColor = MaterialTheme.colorScheme.primaryContainer,
                    unselectedIconColor = MaterialTheme.colorScheme.onSurfaceVariant,
                    unselectedTextColor = MaterialTheme.colorScheme.onSurfaceVariant,
                ),
            )
        }
    }
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
