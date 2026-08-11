package app.orderak.seller.core

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.res.pluralStringResource
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.style.TextDirection
import androidx.compose.ui.unit.dp
import app.orderak.seller.R
import app.orderak.seller.core.ui.OrderakShippedLocalePreviews
import app.orderak.seller.core.ui.theme.OrderakTheme
import com.android.tools.screenshot.PreviewTest

/** Golden-image matrix for translation expansion, plurals, and mixed bidi text. */
@PreviewTest
@OrderakShippedLocalePreviews
@Composable
fun localizationSurfaceScreenshot() {
    OrderakTheme {
        Surface {
            Column(
                verticalArrangement = Arrangement.spacedBy(12.dp),
                modifier = Modifier
                    .fillMaxWidth()
                    .padding(24.dp),
            ) {
                Text(
                    text = stringResource(R.string.settings_title),
                    style = MaterialTheme.typography.headlineMedium,
                )
                Text(stringResource(R.string.auth_subtitle))
                Text(stringResource(R.string.welcome_value))
                Text(stringResource(R.string.welcome_create_store))
                Text(stringResource(R.string.welcome_sign_in))
                Text(stringResource(R.string.setup_account_title))
                Text(stringResource(R.string.setup_account_subtitle))
                Text(stringResource(R.string.setup_birth_year_label))
                Text(stringResource(R.string.setup_email_private_help))
                Text(stringResource(R.string.setup_store_heading))
                Text(stringResource(R.string.setup_start_selling))
                Text(stringResource(R.string.passkeys_settings_help))
                Text(stringResource(R.string.support_title))
                Text(stringResource(R.string.announcements_title))
                Text(stringResource(R.string.catalog_languages_title))
                Text(stringResource(R.string.devices_title))
                Text(stringResource(R.string.restricted_title))
                Text(pluralStringResource(R.plurals.categories_product_count, 2, 2))
                Text(
                    text = "iPhone 16 Pro • ORD-10234 • EGP 1,250.00",
                    style = MaterialTheme.typography.bodyLarge.copy(
                        textDirection = TextDirection.Content,
                    ),
                )
            }
        }
    }
}
