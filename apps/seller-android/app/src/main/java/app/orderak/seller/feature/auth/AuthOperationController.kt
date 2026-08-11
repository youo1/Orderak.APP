package app.orderak.seller.feature.auth

import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Job
import kotlinx.coroutines.launch

/**
 * Owns the single in-flight authentication operation.
 *
 * Cancellation stops cooperative work. The generation check is the second
 * guard for platform tasks that may finish after cancellation.
 */
internal class AuthOperationController {
    private var generation = 0L
    private var activeJob: Job? = null

    fun launch(
        scope: CoroutineScope,
        block: suspend (generation: Long) -> Unit,
    ) {
        activeJob?.cancel()
        val operationGeneration = ++generation
        activeJob = scope.launch {
            block(operationGeneration)
        }
    }

    fun invalidate() {
        generation++
        activeJob?.cancel()
        activeJob = null
    }

    fun isCurrent(operationGeneration: Long): Boolean =
        operationGeneration == generation
}
