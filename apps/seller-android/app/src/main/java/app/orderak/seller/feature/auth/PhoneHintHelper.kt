package app.orderak.seller.feature.auth

import android.content.Context
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.IntentSenderRequest
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.runtime.Composable
import androidx.compose.ui.platform.LocalContext
import com.google.android.gms.auth.api.identity.GetPhoneNumberHintIntentRequest
import com.google.android.gms.auth.api.identity.Identity
import com.google.android.gms.common.api.ApiException

enum class PhoneHintFailure {
    REQUEST_FAILED,
    RESULT_UNAVAILABLE,
}

/**
 * Google Identity Phone Number Hint API wrapper ("Use my phone number").
 *
 * Cancellation is intentionally a no-op. Google Play Services request and
 * result failures are reported separately so the UI can offer manual entry.
 */
object PhoneHintHelper {

    @Composable
    fun rememberPhoneHintLauncher(
        onResult: (String) -> Unit,
        onFailure: (PhoneHintFailure) -> Unit,
    ) = LocalContext.current.let { context ->
        rememberLauncherForActivityResult(
            ActivityResultContracts.StartIntentSenderForResult(),
        ) { result ->
            val intent = result.data ?: return@rememberLauncherForActivityResult
            val phoneNumber = try {
                Identity.getSignInClient(context).getPhoneNumberFromIntent(intent)
            } catch (_: ApiException) {
                onFailure(PhoneHintFailure.RESULT_UNAVAILABLE)
                return@rememberLauncherForActivityResult
            }
            onResult(phoneNumber)
        }
    }

    fun show(
        context: Context,
        onLaunch: (IntentSenderRequest) -> Unit,
        onFailure: (PhoneHintFailure) -> Unit,
    ) {
        val request = GetPhoneNumberHintIntentRequest.builder().build()
        Identity.getSignInClient(context)
            .getPhoneNumberHintIntent(request)
            .addOnSuccessListener { result ->
                onLaunch(IntentSenderRequest.Builder(result).build())
            }
            .addOnFailureListener {
                onFailure(PhoneHintFailure.REQUEST_FAILED)
            }
    }
}
