package app.orderak.seller.feature.shopsetup

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class ShopSetupPolicyTest {
    private val filled = ShopSetupUiState(fullName = "Ayman Seller", ageConfirmed = true, name = "Fresh Market")

    @Test
    fun `a store can be created with a name, a full name and the age confirmation`() {
        assertTrue(filled.canCreate)
    }

    @Test
    fun `each of the three is required`() {
        assertFalse(filled.copy(name = "A").canCreate)
        assertFalse(filled.copy(fullName = "Al").canCreate)
        assertFalse(filled.copy(ageConfirmed = false).canCreate)
    }

    @Test
    fun `a name and a full name are trimmed before they are counted`() {
        assertFalse(filled.copy(name = "  A  ").canCreate)
        assertTrue(filled.copy(name = "  Ab  ").canCreate)
    }

    @Test
    fun `validation names the first blocking field`() {
        assertEquals("invalid_full_name", accountValidationError(filled.copy(fullName = "Al")))
        assertEquals("age_confirmation_required", accountValidationError(filled.copy(ageConfirmed = false)))
        assertNull(accountValidationError(filled))
    }

    @Test
    fun `no city, category or slug is needed to create`() {
        // The state has nowhere to hold them: they are offered after the store exists.
        assertTrue(ShopSetupUiState::class.java.declaredFields.none { it.name in setOf("city", "categoryId", "slug") })
    }

    @Test
    fun `slug generation transliterates Arabic and strips French diacritics`() {
        assertEquals("mtjr-alanaqa", onboardingSlugify("متجر الأناقة"))
        assertEquals("beaute-elegante", onboardingSlugify("Beauté Élégante"))
    }

    @Test
    fun `onboarding preview always uses the production public store domain`() {
        assertEquals(
            "orderak.app/EG-fresh-market-••••••••",
            onboardingStoreLinkPreview("eg", "fresh-market"),
        )
    }
}
