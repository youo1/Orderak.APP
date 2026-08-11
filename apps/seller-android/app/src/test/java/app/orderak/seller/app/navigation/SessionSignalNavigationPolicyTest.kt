package app.orderak.seller.app.navigation

import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class SessionSignalNavigationPolicyTest {
    @Test
    fun `stale seller signals cannot replace authentication or onboarding`() {
        assertTrue(isAuthenticationOrOnboardingRoute(AuthRoute::class.qualifiedName))
        assertTrue(isAuthenticationOrOnboardingRoute(ShopSetupRoute::class.qualifiedName))
        assertFalse(isAuthenticationOrOnboardingRoute(SplashRoute::class.qualifiedName))
        assertFalse(isAuthenticationOrOnboardingRoute(MainRoute::class.qualifiedName))
        assertFalse(isAuthenticationOrOnboardingRoute(null))
    }
}
