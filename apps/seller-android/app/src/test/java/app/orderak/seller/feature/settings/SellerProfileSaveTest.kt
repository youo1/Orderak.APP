package app.orderak.seller.feature.settings

import app.orderak.seller.data.session.AccountStage
import app.orderak.seller.data.session.LocalSessionSnapshot
import app.orderak.seller.data.session.OnboardingStage
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

/**
 * What a profile save writes.
 *
 * WHY THIS EXISTS
 *   `team_security.owner_account` sat in the behaviour-debt baseline reading
 *   "The profile screen edits seller details. Onboarding validation is tested;
 *   this screen's own save path is not."
 *
 *   The save path's whole correctness is that `saveShop` takes the SHOP's name,
 *   category, city, country and logo alongside the seller's own details, and
 *   none of those five are on this screen. They are re-supplied from the session
 *   snapshot, so getting one wrong means editing a birth year erases a shop
 *   name. That decision was inline in a `viewModelScope.launch` where nothing
 *   could reach it.
 */
class SellerProfileSaveTest {

    private fun snapshot(
        shopName: String? = "بوتيك منى",
        category: String? = "أزياء",
        city: String? = "القاهرة",
        countryIso: String? = "EG",
        logoUri: String? = "file:///logo.png",
    ) = LocalSessionSnapshot(
        phone = "01000000001",
        shopName = shopName,
        category = category,
        city = city,
        countryIso = countryIso,
        logoUri = logoUri,
        fullName = "منى عبد الله",
        email = "mona@example.com",
        birthYear = "1994",
        profilePhotoUri = null,
        storeCode = "EG-A1B2C3",
        publicIdentifier = "EG-mona-boutique",
        accountStage = AccountStage.REGISTERED,
        onboardingStage = OnboardingStage.COMPLETE,
        onboardingStep = 3,
        cachedAccountStatus = "active",
        accountStatusCheckedAtEpochMs = 0,
    )

    /* ---------------- the half this screen does not edit ---------------- */

    @Test
    fun `the shop is carried through untouched`() {
        // The one that matters. Every one of these five is a field saveShop
        // requires and this screen has no control for.
        val write = profileSave(snapshot(), "منى", null, null, null)

        assertEquals("بوتيك منى", write.name)
        assertEquals("أزياء", write.category)
        assertEquals("القاهرة", write.city)
        assertEquals("EG", write.countryIso)
        assertEquals("file:///logo.png", write.logoUri)
    }

    @Test
    fun `a shop with no name writes no name, rather than one nobody chose`() {
        val write = profileSave(snapshot(shopName = null), "منى", null, null, null)
        assertEquals("", write.name)
    }

    @Test
    fun `a missing country falls back to EG`() {
        // The only default here, and a real one: a store with no country cannot
        // be addressed at all.
        val write = profileSave(snapshot(countryIso = null), "منى", null, null, null)
        assertEquals("EG", write.countryIso)
    }

    @Test
    fun `a shop with no logo keeps having none`() {
        val write = profileSave(snapshot(logoUri = null), "منى", null, null, null)
        assertNull(write.logoUri)
    }

    /* ---------------- the half it does edit ---------------- */

    @Test
    fun `the edited values are what gets written`() {
        val write = profileSave(
            snapshot(),
            fullName = "منى عبد الله",
            email = "new@example.com",
            birthYear = "1990",
            profilePhotoUri = "https://cdn/photo.jpg",
        )

        assertEquals("منى عبد الله", write.fullName)
        assertEquals("new@example.com", write.email)
        assertEquals("1990", write.birthYear)
        assertEquals("https://cdn/photo.jpg", write.profilePhotoUri)
    }

    @Test
    fun `surrounding space is trimmed off every field`() {
        val write = profileSave(snapshot(), "  منى  ", "  a@b.com  ", "  1990  ", "  u  ")

        assertEquals("منى", write.fullName)
        assertEquals("a@b.com", write.email)
        assertEquals("1990", write.birthYear)
        assertEquals("u", write.profilePhotoUri)
    }

    @Test
    fun `clearing an optional field clears it, rather than storing an empty string`() {
        // A seller who deletes their email means they have none. Writing "" would
        // store a value that is not a value, and the three optional fields are
        // read back as nullable everywhere else.
        val write = profileSave(snapshot(), "منى", "   ", "", "  ")

        assertNull(write.email)
        assertNull(write.birthYear)
        assertNull(write.profilePhotoUri)
    }

    @Test
    fun `a blank full name is written blank, not null`() {
        // fullName is NOT optional in saveShop, so it has no null to fall to.
        // The screen's own save button is what stops a blank one being sent.
        val write = profileSave(snapshot(), "   ", null, null, null)
        assertEquals("", write.fullName)
    }
}
