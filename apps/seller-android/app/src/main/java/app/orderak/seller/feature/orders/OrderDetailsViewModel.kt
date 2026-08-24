package app.orderak.seller.feature.orders

import android.net.Uri
import androidx.lifecycle.SavedStateHandle
import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import androidx.navigation.toRoute
import app.orderak.seller.core.images.ImageStore
import app.orderak.seller.data.billing.EntitlementManager
import app.orderak.seller.data.billing.Feature
import app.orderak.seller.data.db.OrderWithItems
import app.orderak.seller.data.db.PaymentEntity
import app.orderak.seller.data.orders.OrderRepository
import app.orderak.seller.domain.OrderStatus
import app.orderak.seller.feature.payment.PaymentVerifier
import app.orderak.seller.feature.payment.VerificationResult
import app.orderak.seller.app.navigation.OrderDetailsRoute
import dagger.hilt.android.lifecycle.HiltViewModel
import kotlinx.coroutines.flow.MutableSharedFlow
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.SharedFlow
import kotlinx.coroutines.flow.SharingStarted
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asSharedFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.flow.stateIn
import kotlinx.coroutines.launch
import javax.inject.Inject

sealed interface ProofUiState {
    data object Idle : ProofUiState
    data object Running : ProofUiState
    /**
     * [statusApplied] is false when the proof verified but the order could not be
     * moved to PAID. The payment row is recorded locally either way, so the dialog
     * must not report an auto-confirmed order that the server never advanced.
     */
    data class Result(val result: VerificationResult, val statusApplied: Boolean = true) : ProofUiState
}

@HiltViewModel
class OrderDetailsViewModel @Inject constructor(
    private val repo: OrderRepository,
    private val verifier: PaymentVerifier,
    private val imageStore: ImageStore,
    val entitlementManager: EntitlementManager,
    savedStateHandle: SavedStateHandle
) : ViewModel() {

    private val orderId: Long = savedStateHandle.toRoute<OrderDetailsRoute>().id

    val order: StateFlow<OrderWithItems?> =
        repo.order(orderId).stateIn(viewModelScope, SharingStarted.WhileSubscribed(5_000), null)

    val payments: StateFlow<List<PaymentEntity>> =
        repo.payments(orderId).stateIn(viewModelScope, SharingStarted.WhileSubscribed(5_000), emptyList())

    private val _proof = MutableStateFlow<ProofUiState>(ProofUiState.Idle)
    val proof: StateFlow<ProofUiState> = _proof.asStateFlow()

    /**
     * Emitted when a status change did not land.
     *
     * These three used to be local Room writes that could not fail. Now that the
     * server owns the transition table they can — no connection, no session, or a
     * transition it refuses — and `OrderRepository` deliberately writes nothing in
     * that case. Without this the row simply stayed put and the seller was told
     * nothing, which reads as a dead button.
     */
    private val _actionFailed = MutableSharedFlow<Unit>(extraBufferCapacity = 1)
    val actionFailed: SharedFlow<Unit> = _actionFailed.asSharedFlow()

    private fun statusOf(raw: String): OrderStatus =
        runCatching { OrderStatus.valueOf(raw) }.getOrDefault(OrderStatus.NEW) // Fix(#5)

    fun advance() {
        val o = order.value?.order ?: return
        viewModelScope.launch {
            if (!repo.advance(o.id, statusOf(o.status))) _actionFailed.emit(Unit)
        }
    }

    /**
     * Fix(#7): navigate only AFTER the transaction completes — and only when it
     * succeeded. Leaving the screen on a refused cancellation would return the
     * seller to a list still showing the order they believe they just cancelled.
     */
    fun cancel(onDone: () -> Unit) {
        val o = order.value?.order ?: return
        viewModelScope.launch {
            if (repo.cancel(o.id, statusOf(o.status))) onDone() else _actionFailed.emit(Unit)
        }
    }

    fun markPaidManually() {
        val o = order.value?.order ?: return
        viewModelScope.launch {
            if (!repo.markPaid(o.id, statusOf(o.status))) _actionFailed.emit(Unit)
        }
    }

    /** S6a: OCR the proof screenshot -> rules -> auto-Paid or flags (Plan Stage 4). */
    fun verifyProof(uri: Uri) {
        val o = order.value?.order ?: return
        viewModelScope.launch {
            if (!entitlementManager.isFeatureEnabled(Feature.OCR_PAYMENT_VERIFICATION)) {
                entitlementManager.logAttempt(Feature.OCR_PAYMENT_VERIFICATION)
                return@launch
            }
            entitlementManager.logAttempt(Feature.OCR_PAYMENT_VERIFICATION)

            _proof.value = ProofUiState.Running
            val text = verifier.ocr(uri)
            var duplicate = false
            val prelim = PaymentVerifier.evaluate(text, o.totalMinor) { false }
            prelim.ref?.let { duplicate = repo.isDuplicateRef(it) }
            val result = prelim.copy(duplicateRef = duplicate)
            var statusApplied = true
            if (result.verified) {
                val path = imageStore.persist(uri, "proof")
                repo.recordPayment(
                    PaymentEntity(
                        orderId = o.id, ref = result.ref ?: "",
                        amountMinor = o.totalMinor,
                        verified = true, proofPath = path
                    )
                )
                statusApplied = repo.markPaid(o.id, statusOf(o.status))
            }
            _proof.value = ProofUiState.Result(result, statusApplied)
        }
    }

    fun dismissProofResult() { _proof.value = ProofUiState.Idle }
}
