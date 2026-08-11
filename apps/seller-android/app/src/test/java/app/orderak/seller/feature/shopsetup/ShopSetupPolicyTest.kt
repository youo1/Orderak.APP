package app.orderak.seller.feature.shopsetup

import app.orderak.seller.core.phone.Countries
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class ShopSetupPolicyTest {
    @Test
    fun `birth year dialog offers current UTC year down to 1900 only`() {
        val years = birthYearOptions(2026)
        assertEquals(2026, years.first())
        assertEquals(1900, years.last())
        assertEquals(127, years.size)
        assertEquals(years.distinct(), years)
    }

    @Test
    fun `account step requires name birth year and valid optional email`() {
        assertFalse(ShopSetupUiState(fullName = "Al").canContinueAccount)
        assertFalse(ShopSetupUiState(fullName = "Ayman Seller").canContinueAccount)
        assertTrue(
            ShopSetupUiState(
                fullName = "Ayman Seller",
                birthYear = 1988,
                email = "owner@example.com",
            ).canContinueAccount,
        )
        assertFalse(
            ShopSetupUiState(
                fullName = "Ayman Seller",
                birthYear = 1988,
                email = "not-an-email",
            ).canContinueAccount,
        )
        assertFalse(ShopSetupUiState(fullName = "Ayman Seller", birthYear = 1899).canContinueAccount)
        assertFalse(
            ShopSetupUiState(
                fullName = "Ayman Seller",
                birthYear = currentUtcYear() + 1,
            ).canContinueAccount,
        )
    }

    @Test
    fun `account validation identifies the first blocking field`() {
        assertEquals(
            "invalid_full_name",
            accountValidationError(ShopSetupUiState(fullName = "Al")),
        )
        assertEquals(
            "invalid_birth_year",
            accountValidationError(ShopSetupUiState(fullName = "Ayman Seller")),
        )
        assertEquals(
            "invalid_email",
            accountValidationError(
                ShopSetupUiState(
                    fullName = "Ayman Seller",
                    birthYear = 1988,
                    email = "invalid",
                ),
            ),
        )
        assertEquals(
            null,
            accountValidationError(
                ShopSetupUiState(
                    fullName = "Ayman Seller",
                    birthYear = 1988,
                ),
            ),
        )
    }

    @Test
    fun `store step requires only a global category and available existing slug`() {
        val valid = ShopSetupUiState(
            step = 2,
            name = "Global Fashion",
            slug = "global-fashion",
            slugAvailability = SlugAvailability.AVAILABLE,
            categoryKey = "retail",
            categoryId = "retail",
            country = Countries.byIso("EG"),
            city = "Cairo",
        )
        assertTrue(valid.canFinishStore)
        assertFalse(valid.copy(categoryId = null).canFinishStore)
        assertFalse(valid.copy(slugAvailability = SlugAvailability.TAKEN).canFinishStore)
    }

    @Test
    fun `manual city remains valid without a catalogue id`() {
        val state = ShopSetupUiState(
            step = 2,
            name = "Services Hub",
            slug = "services-hub",
            slugAvailability = SlugAvailability.AVAILABLE,
            categoryKey = "services",
            categoryId = "services",
            country = Countries.byIso("FR"),
            city = "Saint-Denis",
            cityCatalogId = null,
        )
        assertTrue(state.canFinishStore)
    }

    @Test
    fun `slug generation transliterates Arabic and strips French diacritics`() {
        assertEquals("mtjr-alanaqa", onboardingSlugify("متجر الأناقة"))
        assertEquals("beaute-elegante", onboardingSlugify("Beauté Élégante"))
    }

    @Test
    fun `onboarding preview always uses the production public store domain`() {
        assertEquals(
            "https://orderak.app/EG-fresh-market-••••••••",
            onboardingStoreLinkPreview("eg", "fresh-market"),
        )
    }
}
