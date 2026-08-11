package app.orderak.seller.data.auth

import android.app.Activity
import android.os.Build
import androidx.credentials.CreatePublicKeyCredentialRequest
import androidx.credentials.CreatePublicKeyCredentialResponse
import androidx.credentials.CredentialManager
import androidx.credentials.GetCredentialRequest
import androidx.credentials.GetPublicKeyCredentialOption
import androidx.credentials.PublicKeyCredential
import androidx.credentials.exceptions.CreateCredentialCancellationException
import androidx.credentials.exceptions.GetCredentialCancellationException
import androidx.credentials.exceptions.NoCredentialException
import javax.inject.Inject
import javax.inject.Singleton

sealed interface PasskeyResult {
    data class Success(val responseJson: String) : PasskeyResult
    data object Cancelled : PasskeyResult
    data object Unavailable : PasskeyResult
    data class Failed(val cause: Throwable) : PasskeyResult
}

/**
 * Thin Credential Manager adapter. The server owns every WebAuthn option and
 * verifies every response; this class never sees biometric data.
 */
@Singleton
class PasskeyClient @Inject constructor() {
    suspend fun authenticate(activity: Activity, optionsJson: String): PasskeyResult {
        if (!passkeysSupported(Build.VERSION.SDK_INT)) return PasskeyResult.Unavailable
        return try {
            val manager = CredentialManager.create(activity)
            val result = manager.getCredential(
                context = activity,
                request = GetCredentialRequest(
                    listOf(GetPublicKeyCredentialOption(requestJson = optionsJson)),
                ),
            )
            val credential = result.credential as? PublicKeyCredential
                ?: return PasskeyResult.Unavailable
            PasskeyResult.Success(credential.authenticationResponseJson)
        } catch (_: GetCredentialCancellationException) {
            PasskeyResult.Cancelled
        } catch (_: NoCredentialException) {
            PasskeyResult.Unavailable
        } catch (error: Exception) {
            PasskeyResult.Failed(error)
        }
    }

    suspend fun register(activity: Activity, optionsJson: String): PasskeyResult {
        if (!passkeysSupported(Build.VERSION.SDK_INT)) return PasskeyResult.Unavailable
        return try {
            val manager = CredentialManager.create(activity)
            val response = manager.createCredential(
                context = activity,
                request = CreatePublicKeyCredentialRequest(requestJson = optionsJson),
            ) as? CreatePublicKeyCredentialResponse ?: return PasskeyResult.Unavailable
            PasskeyResult.Success(response.registrationResponseJson)
        } catch (_: CreateCredentialCancellationException) {
            PasskeyResult.Cancelled
        } catch (error: Exception) {
            PasskeyResult.Failed(error)
        }
    }
}

internal fun passkeysSupported(sdkInt: Int): Boolean = sdkInt >= Build.VERSION_CODES.P
