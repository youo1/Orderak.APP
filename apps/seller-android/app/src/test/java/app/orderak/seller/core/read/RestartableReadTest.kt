package app.orderak.seller.core.read

import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.flow.flow
import kotlinx.coroutines.flow.flowOf
import kotlinx.coroutines.launch
import kotlinx.coroutines.test.runTest
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class RestartableReadTest {

    @Test
    fun `values pass through`() = runTest {
        val read = RestartableRead { flowOf(listOf(1, 2)) }

        // `first` rather than `toList`: the stream is restartable by design, so it
        // never completes and collecting it to the end would hang.
        assertEquals(listOf(1, 2), read.values.first())
        assertFalse(read.failed.value)
    }

    /**
     * The regression this class exists for.
     *
     * Orders, Store and Customers all ended their read with `catch`, which ends
     * the stream rather than skipping an emission. One thrown Room read left the
     * surface permanently empty — the last value the `stateIn` saw was the empty
     * list `catch` emitted — and there was no way back short of restarting the
     * app. The error screen even had a retry button that nobody could wire up,
     * because there was nothing to retry.
     */
    @Test
    fun `a failed read can be run again`() = runTest {
        var attempts = 0
        val read = RestartableRead {
            flow {
                attempts += 1
                if (attempts == 1) throw IllegalStateException("the read threw")
                emit("second attempt")
            }
        }

        val seen = mutableListOf<String>()
        val collector = launch { read.values.collect { seen += it } }
        testScheduler.advanceUntilIdle()

        assertTrue("the failure is reported", read.failed.value)
        assertEquals("nothing was emitted by the failed attempt", emptyList<String>(), seen)

        read.retry()
        testScheduler.advanceUntilIdle()

        assertEquals("the second attempt reached the collector", listOf("second attempt"), seen)
        assertFalse("the failure clears once a read succeeds", read.failed.value)
        assertEquals(2, attempts)

        collector.cancel()
    }

    /**
     * A read that was cancelled is not a read that failed.
     *
     * Two ways this matters, and both are wrong in the same direction: a screen
     * leaving the composition cancels the collection, and a query cancelled
     * mid-flight throws `CancellationException` from inside the flow. Reporting
     * either as an error shows the seller a failure they never had.
     */
    @Test
    fun `cancellation is not reported as a failure`() = runTest {
        val read = RestartableRead<String> { flow { throw CancellationException("the read was cancelled") } }

        val collector = launch { runCatching { read.values.collect {} } }
        testScheduler.advanceUntilIdle()

        assertFalse("a cancelled read is not an error the seller had", read.failed.value)

        collector.cancel()
        testScheduler.advanceUntilIdle()
        assertFalse(read.failed.value)
    }

    /** A retry while nothing is failing re-reads; it is not a second error. */
    @Test
    fun `retrying a healthy read re-reads it`() = runTest {
        var attempts = 0
        val read = RestartableRead {
            flow {
                attempts += 1
                emit(attempts)
            }
        }

        val seen = mutableListOf<Int>()
        val collector = launch { read.values.collect { seen += it } }
        testScheduler.advanceUntilIdle()

        read.retry()
        testScheduler.advanceUntilIdle()

        assertEquals(listOf(1, 2), seen)
        assertFalse(read.failed.value)

        collector.cancel()
    }
}
