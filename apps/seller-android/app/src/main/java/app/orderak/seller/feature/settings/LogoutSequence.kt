package app.orderak.seller.feature.settings

/**
 * Security-sensitive logout ordering expressed as behavior rather than a
 * particular ViewModel implementation.
 */
internal suspend fun runLogoutSequence(
    signOutProvider: () -> Unit,
    clearBusinessData: suspend () -> Unit,
    clearEntitlements: suspend () -> Unit,
    clearSession: suspend () -> Unit,
) {
    signOutProvider()
    clearBusinessData()
    clearEntitlements()
    clearSession()
}
