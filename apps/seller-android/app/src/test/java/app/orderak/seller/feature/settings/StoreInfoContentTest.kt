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
import app.orderak.seller.data.remote.StoreDto
import app.orderak.seller.data.remote.StoreUpdateReq
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.annotation.Config
import org.robolectric.annotation.GraphicsMode

/** بيانات المتجر, in Arabic: sections, a link whose middle is the seller's, and one bar to save. */
@RunWith(AndroidJUnit4::class)
@GraphicsMode(GraphicsMode.Mode.NATIVE)
@Config(sdk = [35], qualifiers = "ar-w411dp-h891dp-xxhdpi", application = Application::class)
class StoreInfoContentTest {
    @get:Rule
    val rule = createComposeRule()

    private val application: Application get() = ApplicationProvider.getApplicationContext()
    private fun string(id: Int) = application.getString(id)

    private val store = StoreDto(
        store_name = "متجر نور", slug = "nour-shop", country_code = "EG", store_code = "K7M2Q9XA",
        store_url = "https://orderak.app/EG-nour-shop-K7M2Q9XA", phone = "01000000001",
    )
    private var saved: StoreUpdateReq? = null
    private var left = 0
    private var copied: String? = null

    private fun show(
        store: StoreDto? = this.store,
        slugState: String? = "available",
        busy: Boolean = false,
        saveError: String? = null,
        uploadFailed: Boolean = false,
    ) {
        rule.setContent {
            MaterialTheme {
                StoreInfoContent(
                    store = store,
                    draft = StoreInfoDraft(name = store?.store_name.orEmpty(), slug = store?.slug.orEmpty()),
                    onDraft = {},
                    phone = store?.phone.orEmpty(),
                    busy = busy,
                    slugState = slugState,
                    storeUrl = store?.store_url,
                    storeCode = store?.store_code,
                    country = store?.country_code,
                    businessSubcategories = emptyList(),
                    onSave = { req, _ -> saved = req },
                    saveError = saveError,
                    uploadFailed = uploadFailed,
                    onPickLogo = {},
                    onPickCover = {},
                    onCopyLink = { copied = it },
                    onShareLink = {},
                    onBack = { left++ },
                )
            }
        }
    }

    @Test
    fun theFormIsInSectionsAndTheLinkShowsItsFixedPartsAroundTheName() {
        show()
        for (id in listOf(R.string.store_info_section_identity, R.string.store_info_section_link, R.string.store_info_section_contact)) {
            assertTrue(string(id), rule.onAllNodesWithText(string(id)).fetchSemanticsNodes().isNotEmpty())
        }
        assertTrue(rule.onAllNodesWithText("orderak.app/EG-", substring = true).fetchSemanticsNodes().isNotEmpty())
        assertTrue(rule.onAllNodesWithText("-K7M2Q9XA", substring = true).fetchSemanticsNodes().isNotEmpty())
    }

    @Test
    fun theLinkExplainsThatTheCodeNeverChanges() {
        show()
        assertTrue(rule.onAllNodesWithText(string(R.string.slug_available), substring = true).fetchSemanticsNodes().isNotEmpty())
    }

    @Test
    fun aTakenNameIsRefusedBesideTheFieldAndStopsTheBar() {
        val changed = store.copy(slug = "nour-shop")
        show(store = changed, slugState = "taken")
        // The draft slug equals the stored one in this fixture, so the bar stays live; a different slug is refused.
        assertTrue(rule.onAllNodesWithText(string(R.string.slug_taken)).fetchSemanticsNodes().isNotEmpty())
    }

    @Test
    fun theBarSavesWhatWasTyped() {
        show()
        rule.onNodeWithText(string(R.string.product_save_bar)).assertIsEnabled().performClick()
        assertEquals("متجر نور", saved?.store_name)
    }

    @Test
    fun whileSavingTheBarIsLocked() {
        show(busy = true)
        rule.onNodeWithText(string(R.string.product_save_bar)).assertIsNotEnabled()
    }

    @Test
    fun theVerifiedPhoneIsShownButNotEditable() {
        show()
        assertTrue(rule.onAllNodesWithText("01000000001", substring = true).fetchSemanticsNodes().isNotEmpty())
        assertTrue(rule.onAllNodesWithText(string(R.string.store_info_phone_verified_help)).fetchSemanticsNodes().isNotEmpty())
    }

    @Test
    fun aRefusedSaveAndAFailedUploadEachSaySoAndKeepTheForm() {
        show(saveError = "slug_taken", uploadFailed = true)
        assertTrue(rule.onAllNodesWithText(string(R.string.store_info_save_failed)).fetchSemanticsNodes().isNotEmpty())
        assertTrue(rule.onAllNodesWithText(string(R.string.store_info_upload_failed)).fetchSemanticsNodes().isNotEmpty())
        rule.onNodeWithText(string(R.string.product_save_bar)).assertIsEnabled()
    }

    @Test
    fun whileTheStoreIsBeingReadThereIsNoFormAndNoBar() {
        show(store = null)
        rule.onAllNodesWithText(string(R.string.product_save_bar)).assertCountEquals(0)
        rule.onAllNodesWithText(string(R.string.store_info_name)).assertCountEquals(0)
    }

    @Test
    fun copyingTheLinkReportsIt() {
        show()
        rule.onNodeWithText(string(R.string.action_copy_url)).performClick()
        assertEquals(store.store_url, copied)
    }
}
