package app.orderak.seller.feature.main

import app.orderak.seller.data.remote.AppVersionPolicy
import org.junit.Assert.assertEquals
import org.junit.Test

class AppVersionGovernanceTest {
    @Test fun `fresh forced update blocks`() {
        assertEquals(VersionUiMode.FORCE_UPDATE, versionUiMode(AppVersionPolicy(status = "force_update"), 1_000))
    }

    @Test fun `stale blocking policy becomes nonblocking warning`() {
        assertEquals(VersionUiMode.STALE_WARNING, versionUiMode(AppVersionPolicy(status = "blocked"), MAX_BLOCKING_CONFIG_AGE_MS + 1))
    }

    @Test fun `warning remains warning while offline`() {
        assertEquals(VersionUiMode.WARNING, versionUiMode(AppVersionPolicy(status = "warning"), null))
    }

    @Test fun `missing policy does nothing`() {
        assertEquals(VersionUiMode.NONE, versionUiMode(null, null))
    }
}
