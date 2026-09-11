package app.orderak.seller.feature.settings

import kotlinx.coroutines.CancellationException

/**
 * Security-sensitive logout ordering expressed as behavior rather than a
 * particular ViewModel implementation.
 */
internal suspend fun runLogoutSequence(
    revokeCredential: suspend () -> Unit,
    signOutProvider: () -> Unit,
    clearBusinessData: suspend () -> Unit,
    clearEntitlements: suspend () -> Unit,
    clearSession: suspend () -> Unit,
    clearDeviceSecret: () -> Unit,
) {
    // Auth contract v8, guarantee 10. Provider sign-out still precedes the local
    // database and session, which is the ordering v7 protected and this keeps.
    //
    // The two new steps bracket it, and both have to sit where they do: the
    // revocation authenticates with the credential the middle of this sequence
    // destroys, and the local secret is what it authenticates with, so one runs
    // first and the other last.
    //
    // The revocation's best-effort guarantee lives here rather than in a caller.
    // A seller signing out with no network must still be signed out on the
    // handset in front of them, and putting the catch in the sequence means that
    // holds for every caller rather than for whichever ones remembered. The
    // caller still sees the failure — SessionLogoutManager logs it inside its own
    // lambda — but it cannot turn local teardown into something that needs a
    // server to be reachable.
    try {
        revokeCredential()
    } catch (cancelled: CancellationException) {
        throw cancelled
    } catch (_: Exception) {
        // Deliberately swallowed; see above.
    }
    signOutProvider()
    clearBusinessData()
    clearEntitlements()
    clearSession()
    clearDeviceSecret()
}
