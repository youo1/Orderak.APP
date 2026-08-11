package app.orderak.seller.feature.splash

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import dagger.hilt.android.lifecycle.HiltViewModel
import kotlinx.coroutines.Job
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.launch
import javax.inject.Inject

sealed interface EntryUiState {
    data class Checking(val trigger: EntryTrigger) : EntryUiState
    data class Resolved(val decision: EntryDecision) : EntryUiState
}

/** One entry gate used by launch, login, setup, restriction recheck, and API invalidation. */
@HiltViewModel
class SplashViewModel @Inject constructor(
    private val resolver: EntryRouteResolver,
) : ViewModel() {
    private val _uiState = MutableStateFlow<EntryUiState>(EntryUiState.Checking(EntryTrigger.APP_LAUNCH))
    val uiState: StateFlow<EntryUiState> = _uiState.asStateFlow()
    private var resolveJob: Job? = null

    init {
        resolve(EntryTrigger.APP_LAUNCH)
    }

    fun retry() = resolve(EntryTrigger.RETRY)

    private fun resolve(trigger: EntryTrigger) {
        resolveJob?.cancel()
        resolveJob = viewModelScope.launch {
            _uiState.value = EntryUiState.Checking(trigger)
            _uiState.value = EntryUiState.Resolved(resolver.resolve(trigger))
        }
    }
}
