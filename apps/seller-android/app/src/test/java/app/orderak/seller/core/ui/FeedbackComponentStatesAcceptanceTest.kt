package app.orderak.seller.core.ui

import org.junit.Assert.assertEquals
import org.junit.Test

/**
 * Locks the Banner, OfflineStrip, and Skeleton state vocabulary to the preview
 * function names already fixed by the approved screenshot references
 * (bannerInformation, bannerWarning, bannerError, bannerSuccess,
 * bannerLockedByPlan, bannerSyncInProgress, bannerSyncFailed,
 * bannerVersionWarning; offlineStripOffline, offlineStripReconnecting;
 * skeletonListRows, skeletonMetricTiles, skeletonDetailBlock).
 *
 * Uses reflection on a fully-qualified class name rather than importing the
 * type directly, so this file compiles on today's tree (where none of these
 * enums exist yet) and fails at test run time instead of breaking the whole
 * module's test compilation.
 */
class FeedbackComponentStatesAcceptanceTest {

    private fun enumEntryNames(className: String): List<String> {
        val type = try {
            Class.forName(className)
        } catch (error: ClassNotFoundException) {
            throw AssertionError("Expected $className to exist as the kit's state enum", error)
        }
        val constants = type.enumConstants
            ?: throw AssertionError("Expected $className to be an enum class")
        return constants.map { (it as Enum<*>).name }
    }

    @Test
    fun bannerStateDeclaresExactlyTheEightApprovedStates() {
        assertEquals(
            listOf(
                "Information", "Warning", "Error", "Success",
                "LockedByPlan", "SyncInProgress", "SyncFailed", "VersionWarning",
            ),
            enumEntryNames("app.orderak.seller.core.ui.BannerState"),
        )
    }

    @Test
    fun offlineStripStateDeclaresExactlyTheTwoApprovedStates() {
        assertEquals(
            listOf("Offline", "Reconnecting"),
            enumEntryNames("app.orderak.seller.core.ui.OfflineStripState"),
        )
    }

    @Test
    fun skeletonVariantDeclaresExactlyTheThreeApprovedVariants() {
        assertEquals(
            listOf("ListRows", "MetricTiles", "DetailBlock"),
            enumEntryNames("app.orderak.seller.core.ui.SkeletonVariant"),
        )
    }

    @Test
    fun emptyStateKindDeclaresExactlyTheTwoApprovedStates() {
        assertEquals(
            listOf("Empty", "FilteredToNothing"),
            enumEntryNames("app.orderak.seller.core.ui.EmptyStateKind"),
        )
    }

    @Test
    fun errorStateKindDeclaresExactlyTheTwoApprovedStates() {
        assertEquals(
            listOf("NoConnection", "ServiceUnavailable"),
            enumEntryNames("app.orderak.seller.core.ui.ErrorStateKind"),
        )
    }
}
