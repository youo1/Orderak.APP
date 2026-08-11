package app.orderak.seller.feature.auth

import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.NonCancellable
import kotlinx.coroutines.awaitCancellation
import kotlinx.coroutines.test.advanceUntilIdle
import kotlinx.coroutines.test.runCurrent
import kotlinx.coroutines.test.runTest
import kotlinx.coroutines.withContext
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

@OptIn(ExperimentalCoroutinesApi::class)
class AuthOperationControllerTest {

    @Test
    fun `invalidate cancels the active authentication job`() = runTest {
        val controller = AuthOperationController()
        var cancelled = false

        controller.launch(this) {
            try {
                awaitCancellation()
            } finally {
                cancelled = true
            }
        }
        runCurrent()

        controller.invalidate()
        runCurrent()

        assertTrue(cancelled)
    }

    @Test
    fun `late platform result cannot commit after invalidation`() = runTest {
        val controller = AuthOperationController()
        val started = CompletableDeferred<Unit>()
        val releaseLateResult = CompletableDeferred<Unit>()
        var staleResultCommitted = false

        controller.launch(this) { operation ->
            withContext(NonCancellable) {
                started.complete(Unit)
                releaseLateResult.await()
            }
            if (controller.isCurrent(operation)) {
                staleResultCommitted = true
            }
        }
        started.await()

        controller.invalidate()
        releaseLateResult.complete(Unit)
        advanceUntilIdle()

        assertFalse(staleResultCommitted)
    }

    @Test
    fun `starting a newer operation invalidates the previous generation`() = runTest {
        val controller = AuthOperationController()
        var firstGeneration = 0L
        var secondGeneration = 0L

        controller.launch(this) { operation ->
            firstGeneration = operation
            awaitCancellation()
        }
        runCurrent()
        controller.launch(this) { operation ->
            secondGeneration = operation
        }
        advanceUntilIdle()

        assertFalse(controller.isCurrent(firstGeneration))
        assertTrue(controller.isCurrent(secondGeneration))
    }
}
