package app.orderak.seller.feature.shopsetup

import android.app.Application
import android.content.Context
import androidx.compose.ui.test.click
import androidx.compose.ui.test.junit4.createComposeRule
import androidx.compose.ui.test.onAllNodesWithContentDescription
import androidx.compose.ui.test.onAllNodesWithText
import androidx.compose.ui.test.onFirst
import androidx.compose.ui.test.performTouchInput
import androidx.test.core.app.ApplicationProvider
import androidx.test.ext.junit.runners.AndroidJUnit4
import app.orderak.seller.R
import app.orderak.seller.core.ui.theme.OrderakTheme
import org.junit.Assert.assertTrue
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.annotation.Config
import org.robolectric.annotation.GraphicsMode

@RunWith(AndroidJUnit4::class)
@GraphicsMode(GraphicsMode.Mode.NATIVE)
@Config(sdk = [35], qualifiers = "ar-w411dp-h891dp-xxhdpi", application = Application::class)
class BirthYearFieldOpensDialogOnTapTest {

    @get:Rule
    val rule = createComposeRule()

    @Test
    fun tappingTheBirthYearFieldOpensTheYearDialog() {
        val context = ApplicationProvider.getApplicationContext<Context>()
        val openLabel = context.getString(R.string.setup_birth_year_open_description)
        val dialogTitle = context.getString(R.string.setup_birth_year_title)
        rule.setContent {
            OrderakTheme {
                ShopSetupContent(ShopSetupUiState(), ShopSetupActions(), onExit = {})
            }
        }
        rule.waitForIdle()
        // A real touch at the centre of the field, dispatched through Compose hit testing.
        rule.onAllNodesWithContentDescription(openLabel).onFirst().performTouchInput { click() }
        rule.waitForIdle()
        assertTrue(
            "Tapping the birth-year field must open the year dialog",
            rule.onAllNodesWithText(dialogTitle).fetchSemanticsNodes().isNotEmpty(),
        )
    }
}
