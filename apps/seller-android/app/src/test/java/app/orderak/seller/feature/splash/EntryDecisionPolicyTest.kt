package app.orderak.seller.feature.splash

import app.orderak.seller.data.session.AccountStage
import app.orderak.seller.data.session.LocalSessionSnapshot
import app.orderak.seller.data.session.OnboardingStage
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class EntryDecisionPolicyTest {
    @Test
    fun `missing local identity always routes to auth`() {
        val result = decide(local(phone = null), RemoteAccountState.Restricted("suspended"))
        assertEquals(EntryDecision.Auth, result)
    }

    @Test
    fun `missing existing device credential routes to auth without provisioning`() {
        val result = decide(local(), RemoteAccountState.Active, hasSecret = false)
        assertEquals(EntryDecision.Auth, result)
    }

    @Test
    fun `confirmed restriction wins over incomplete setup`() {
        val result = decide(
            local(onboardingStage = OnboardingStage.IN_PROGRESS),
            RemoteAccountState.Restricted("suspended"),
        )
        assertEquals(EntryDecision.Restricted("suspended"), result)
    }

    @Test
    fun `registered credential rejection routes to auth`() {
        val result = decide(
            local(accountStage = AccountStage.REGISTERED),
            RemoteAccountState.CredentialRejected,
        )
        assertEquals(EntryDecision.Auth, result)
    }

    @Test
    fun `pre-registration credential rejection keeps setup available`() {
        val result = decide(
            local(
                accountStage = AccountStage.PRE_REGISTRATION,
                onboardingStage = OnboardingStage.IN_PROGRESS,
                onboardingStep = 2,
            ),
            RemoteAccountState.CredentialRejected,
        )
        assertEquals(EntryDecision.ShopSetup(resumeStep = 2), result)
    }

    @Test
    fun `stale completed marker cannot route pre-registration to main`() {
        val result = decide(
            local(
                accountStage = AccountStage.PRE_REGISTRATION,
                onboardingStage = OnboardingStage.COMPLETE,
            ),
            RemoteAccountState.CredentialRejected,
        )
        assertEquals(EntryDecision.ShopSetup(resumeStep = null), result)
    }

    @Test
    fun `pre-registration resumes step two while account status is unavailable`() {
        val result = decide(
            local(
                accountStage = AccountStage.PRE_REGISTRATION,
                onboardingStage = OnboardingStage.IN_PROGRESS,
                onboardingStep = 2,
            ),
            RemoteAccountState.Unavailable,
        )
        assertEquals(EntryDecision.ShopSetup(resumeStep = 2), result)
    }

    @Test
    fun `cached restriction is sticky while refresh is unavailable`() {
        val result = decide(
            local(cachedStatus = "banned", onboardingStage = OnboardingStage.COMPLETE),
            RemoteAccountState.Unavailable,
        )
        assertEquals(EntryDecision.Restricted("banned"), result)
    }

    @Test
    fun `successful active refresh clears cached restriction for routing`() {
        val result = decide(
            local(cachedStatus = "suspended", onboardingStage = OnboardingStage.COMPLETE),
            RemoteAccountState.Active,
        )
        assertEquals(EntryDecision.Main(offline = false), result)
    }

    @Test
    fun `unavailable refresh continues completed cached session offline`() {
        val result = decide(
            local(onboardingStage = OnboardingStage.COMPLETE),
            RemoteAccountState.Unavailable,
        )
        assertTrue(result is EntryDecision.Main)
        assertTrue((result as EntryDecision.Main).offline)
    }

    @Test
    fun `active account with incomplete setup resumes saved step`() {
        val result = decide(
            local(onboardingStage = OnboardingStage.IN_PROGRESS, onboardingStep = 2),
            RemoteAccountState.Active,
        )
        assertEquals(EntryDecision.ShopSetup(resumeStep = 2), result)
    }

    @Test
    fun `active completed account enters online main`() {
        val result = decide(
            local(onboardingStage = OnboardingStage.COMPLETE),
            RemoteAccountState.Active,
        )
        assertTrue(result is EntryDecision.Main)
        assertFalse((result as EntryDecision.Main).offline)
    }

    private fun decide(
        local: LocalSessionSnapshot,
        remote: RemoteAccountState,
        hasSecret: Boolean = true,
    ) = EntryDecisionPolicy.decide(local, hasSecret, remote)

    private fun local(
        phone: String? = "+201000000000",
        accountStage: AccountStage = AccountStage.REGISTERED,
        onboardingStage: OnboardingStage = OnboardingStage.NOT_STARTED,
        onboardingStep: Int = 1,
        cachedStatus: String? = null,
    ) = LocalSessionSnapshot(
        phone = phone,
        shopName = if (onboardingStage == OnboardingStage.COMPLETE) "Shop" else null,
        category = null,
        city = null,
        countryIso = "EG",
        logoUri = null,
        fullName = null,
        email = null,
        birthYear = null,
        profilePhotoUri = null,
        storeCode = if (accountStage == AccountStage.REGISTERED) "ABC123" else null,
        publicIdentifier = null,
        accountStage = accountStage,
        onboardingStage = onboardingStage,
        onboardingStep = onboardingStep,
        cachedAccountStatus = cachedStatus,
        accountStatusCheckedAtEpochMs = null,
    )
}
