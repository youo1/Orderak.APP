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
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.SharingStarted
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.flow.stateIn
import kotlinx.coroutines.launch
import javax.inject.Inject

sealed interface ProofUiState {
    data object Idle : ProofUiState
    data object Running : ProofUiState
    data class Result(val result: VerificationResult) : ProofUiState
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

    private fun statusOf(raw: String): OrderStatus =
        runCatching { OrderStatus.valueOf(raw) }.getOrDefault(OrderStatus.NEW) // Fix(#5)

    fun advance() {
        val o = order.value?.order ?: return
        viewModelScope.launch { repo.advance(o.id, statusOf(o.status)) }
    }

    /** Fix(#7): navigate only AFTER the transaction completes. */
    fun cancel(onDone: () -> Unit) {
        val o = order.value?.order ?: return
        viewModelScope.launch {
            repo.cancel(o.id, statusOf(o.status))
            onDone()
        }
    }

    fun markPaidManually() {
        val o = order.value?.order ?: return
        viewModelScope.launch { repo.markPaid(o.id, statusOf(o.status)) }
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
            if (result.verified) {
                val path = imageStore.persist(uri, "proof")
                repo.recordPayment(
                    PaymentEntity(
                        orderId = o.id, ref = result.ref ?: "",
                        amountMinor = o.totalMinor,
                        verified = true, proofPath = path
                    )
                )
                repo.markPaid(o.id, runCatching { OrderStatus.valueOf(o.status) }.getOrDefault(OrderStatus.NEW))
            }
            _proof.value = ProofUiState.Result(result)
        }
    }

    fun dismissProofResult() { _proof.value = ProofUiState.Idle }
}
