package app.orderak.seller.feature.settings

import android.app.Application
import androidx.compose.material3.MaterialTheme
import androidx.compose.ui.test.assertCountEquals
import androidx.compose.ui.test.assertIsEnabled
import androidx.compose.ui.test.assertIsNotEnabled
import androidx.compose.ui.test.junit4.createComposeRule
import androidx.compose.ui.test.onAllNodesWithText
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.performClick
import androidx.test.core.app.ApplicationProvider
import androidx.test.ext.junit.runners.AndroidJUnit4
import app.orderak.seller.R
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.annotation.Config
import org.robolectric.annotation.GraphicsMode

/** بياناتك الشخصية, in Arabic: the person behind the shop, with nothing asked that is not used. */
@RunWith(AndroidJUnit4::class)
@GraphicsMode(GraphicsMode.Mode.NATIVE)
@Config(sdk = [35], qualifiers = "ar-w411dp-h891dp-xxhdpi", application = Application::class)
class SellerProfileContentTest {
    @get:Rule
    val rule = createComposeRule()

    private val application: Application get() = ApplicationProvider.getApplicationContext()
    private fun string(id: Int) = application.getString(id)
    private fun has(text: String) = rule.onAllNodesWithText(text, substring = true).fetchSemanticsNodes().isNotEmpty()

    private var saved: List<String?>? = null
    private var resent = 0

    private fun show(fullName: String = "منى عبد الله", email: String = "mona@example.com", savedEmail: String = "mona@example.com", loaded: Boolean = true, status: String? = null) {
        rule.setContent {
            MaterialTheme {
                SellerProfileContent(
                    phone = "01000000001", loaded = loaded, busy = false, savedEmail = savedEmail,
                    emailVerificationStatus = status, fullName = fullName, email = email,
                    birthYear = "1994", profilePhotoUri = "",
                    onFullName = {}, onEmail = {},
                    onResendVerification = { resent++ },
                    onSave = { n, e, b, p, _ -> saved = listOf(n, e, b, p) },
                    onBack = {}, onReauthenticate = {},
                )
            }
        }
    }

    @Test
    fun theNameSaysWhereItAppearsAndTheNumberIsAVerifiedIdentity() {
        show()
        assertTrue(has(string(R.string.seller_profile_name_where)))
        assertTrue(has(string(R.string.seller_profile_phone_login)))
        assertTrue(has(string(R.string.seller_profile_phone_verified)))
    }

    @Test
    fun noPhotoAndNoBirthYearAreAskedFor() {
        show()
        rule.onAllNodesWithText(string(R.string.seller_profile_birth_year), substring = true).assertCountEquals(0)
        rule.onAllNodesWithText(string(R.string.seller_profile_photo), substring = true).assertCountEquals(0)
    }

    @Test
    fun savingCarriesTheBirthYearAndPhotoThroughUnchanged() {
        show()
        rule.onNodeWithText(string(R.string.product_save_bar)).assertIsEnabled().performClick()
        assertEquals(listOf("منى عبد الله", "mona@example.com", "1994", ""), saved)
    }

    @Test
    fun aBlankNameStopsTheBarAndSaysWhy() {
        show(fullName = "")
        rule.onNodeWithText(string(R.string.product_save_bar)).assertIsNotEnabled()
        assertTrue(has(string(R.string.seller_profile_bar_reason)))
    }

    @Test
    fun changingTheEmailSaysTheOldOneStaysUntilTheNewIsConfirmed() {
        show(email = "new@example.com")
        assertTrue(has(string(R.string.seller_profile_email_change)))
    }

    @Test
    fun resendingTheConfirmationReportsItsOutcome() {
        show(status = "sent")
        rule.onNodeWithText(string(R.string.seller_profile_resend_verification)).performClick()
        assertEquals(1, resent)
        assertTrue(has(string(R.string.seller_profile_verification_sent)))
    }

    @Test
    fun beforeTheProfileIsReadThereIsNoFormAndNoBar() {
        show(loaded = false)
        rule.onAllNodesWithText(string(R.string.product_save_bar)).assertCountEquals(0)
    }
}
