package app.orderak.seller.data.auth

import android.app.Activity
import android.os.SystemClock
import android.util.Log
import app.orderak.seller.BuildConfig
import com.google.firebase.FirebaseException
import com.google.firebase.FirebaseNetworkException
import com.google.firebase.FirebaseTooManyRequestsException
import com.google.firebase.auth.FirebaseAuth
import com.google.firebase.auth.FirebaseAuthException
import com.google.firebase.auth.FirebaseAuthInvalidCredentialsException
import com.google.firebase.auth.FirebaseAuthMissingActivityForRecaptchaException
import com.google.firebase.auth.PhoneAuthCredential
import com.google.firebase.auth.PhoneAuthOptions
import com.google.firebase.auth.PhoneAuthProvider
import kotlinx.coroutines.suspendCancellableCoroutine
import kotlinx.coroutines.tasks.await
import kotlinx.coroutines.withTimeoutOrNull
import java.lang.ref.WeakReference
import java.util.concurrent.TimeUnit
import javax.inject.Inject
import javax.inject.Singleton
import kotlin.coroutines.resume

/** Weak activity reference required only for Firebase's reCAPTCHA fallback. */
object CurrentActivityHolder {
    private var ref = WeakReference<Activity?>(null)
    var activity: Activity?
        get() = ref.get()
        set(value) { ref = WeakReference(value) }
}

@Singleton
class FirebaseAuthRepository @Inject constructor() : AuthRepository {

    private val auth = FirebaseAuth.getInstance()
    private val requestState = OtpRequestState()
    private var resendToken: PhoneAuthProvider.ForceResendingToken? = null

    override suspend fun sendSmsOtp(phoneE164: String): Result<OtpSendOutcome> {
        val attempt = requestState.begin(phoneE164, SystemClock.elapsedRealtime())
        if (!attempt.mayReuseResendToken) resendToken = null

        val outcome = withTimeoutOrNull(AuthTimingPolicy.SEND_OPERATION_TIMEOUT_MS) {
            suspendCancellableCoroutine { cont ->
                val activity = CurrentActivityHolder.activity
                    ?: return@suspendCancellableCoroutine cont.resume(
                        Result.failure(AuthFailureException(AuthFailure.APP_VERIFICATION_FAILED))
                    )

                val callbacks = object : PhoneAuthProvider.OnVerificationStateChangedCallbacks() {
                    override fun onCodeSent(id: String, token: PhoneAuthProvider.ForceResendingToken) {
                        if (!requestState.acceptVerificationId(
                                attempt.generation,
                                id,
                                SystemClock.elapsedRealtime(),
                            )
                        ) return
                        resendToken = token
                        if (cont.isActive) cont.resume(Result.success(OtpSendOutcome.CODE_SENT))
                    }

                    override fun onVerificationCompleted(credential: PhoneAuthCredential) {
                        auth.signInWithCredential(credential).addOnCompleteListener { task ->
                            if (!cont.isActive || !requestState.isCurrent(
                                    attempt.generation,
                                    SystemClock.elapsedRealtime(),
                                )
                            ) return@addOnCompleteListener

                            val user = task.result?.user
                            if (!task.isSuccessful || user == null) {
                                cont.resume(Result.failure(mapFailure(task.exception)))
                                return@addOnCompleteListener
                            }
                            user.getIdToken(false)
                                .addOnSuccessListener {
                                    if (cont.isActive && requestState.isCurrent(
                                            attempt.generation,
                                            SystemClock.elapsedRealtime(),
                                        )
                                    ) {
                                        clearOtpSession()
                                        cont.resume(Result.success(OtpSendOutcome.AUTO_SIGNED_IN))
                                    }
                                }
                                .addOnFailureListener { error ->
                                    if (cont.isActive) cont.resume(Result.failure(mapFailure(error)))
                                }
                        }
                    }

                    override fun onVerificationFailed(error: FirebaseException) {
                        val failure = mapFailure(error)
                        if (BuildConfig.DEBUG) {
                            Log.w("OrderakAuth", "OTP send failed: ${failure.failure.name}")
                        }
                        requestState.invalidate(attempt.generation)
                        resendToken = null
                        if (cont.isActive) cont.resume(Result.failure(failure))
                    }

                    override fun onCodeAutoRetrievalTimeOut(id: String) {
                        if (requestState.acceptVerificationId(
                                attempt.generation,
                                id,
                                SystemClock.elapsedRealtime(),
                            ) && cont.isActive
                        ) {
                            cont.resume(Result.success(OtpSendOutcome.CODE_SENT))
                        }
                    }
                }

                val builder = PhoneAuthOptions.newBuilder(auth)
                    .setPhoneNumber(phoneE164)
                    .setTimeout(AuthTimingPolicy.SMS_RETRIEVAL_TIMEOUT_SECONDS, TimeUnit.SECONDS)
                    .setActivity(activity)
                    .setCallbacks(callbacks)
                resendToken?.let(builder::setForceResendingToken)
                PhoneAuthProvider.verifyPhoneNumber(builder.build())
            }
        }

        if (outcome != null) return outcome
        requestState.invalidate(attempt.generation)
        resendToken = null
        return Result.failure(AuthFailureException(AuthFailure.SEND_TIMEOUT))
    }

    override suspend fun verifyOtp(phoneE164: String, code: String): Result<String> {
        val verificationId = requestState.verificationId(phoneE164, SystemClock.elapsedRealtime())
            ?: return Result.failure(AuthFailureException(AuthFailure.OTP_EXPIRED))
        return try {
            val result = auth.signInWithCredential(
                PhoneAuthProvider.getCredential(verificationId, code)
            ).await()
            val token = result.user?.getIdToken(false)?.await()?.token
                ?: throw IllegalStateException("missing Firebase token")
            clearOtpSession()
            Result.success(token)
        } catch (error: Exception) {
            Result.failure(mapOtpCredentialFailure(error) ?: mapFailure(error))
        }
    }

    override suspend fun currentIdToken(): String? =
        auth.currentUser?.getIdToken(true)?.await()?.token

    override fun clearOtpSession() {
        requestState.clear()
        resendToken = null
    }

    override fun signOut() {
        clearOtpSession()
        auth.signOut()
    }

    private fun mapFailure(error: Throwable?): AuthFailureException {
        val failure = when (error) {
            is FirebaseTooManyRequestsException -> AuthFailure.TOO_MANY_REQUESTS
            is FirebaseNetworkException -> AuthFailure.NETWORK_UNAVAILABLE
            is FirebaseAuthMissingActivityForRecaptchaException -> AuthFailure.APP_VERIFICATION_FAILED
            is FirebaseAuthInvalidCredentialsException -> AuthFailure.INVALID_PHONE
            is FirebaseAuthException -> when (error.errorCode) {
                "ERROR_INVALID_PHONE_NUMBER" -> AuthFailure.INVALID_PHONE
                "ERROR_TOO_MANY_REQUESTS", "ERROR_QUOTA_EXCEEDED" -> AuthFailure.TOO_MANY_REQUESTS
                "ERROR_APP_NOT_AUTHORIZED", "ERROR_CAPTCHA_CHECK_FAILED", "ERROR_MISSING_CLIENT_IDENTIFIER" ->
                    AuthFailure.APP_VERIFICATION_FAILED
                else -> AuthFailure.GENERIC
            }
            else -> AuthFailure.GENERIC
        }
        return AuthFailureException(failure)
    }
}

internal fun mapOtpCredentialFailure(error: Exception): Exception? =
    if (error is FirebaseAuthInvalidCredentialsException) {
        mapOtpCredentialErrorCode(error.errorCode)
    } else {
        null
    }

internal fun mapOtpCredentialErrorCode(errorCode: String): Exception =
    if (errorCode == "ERROR_SESSION_EXPIRED") {
        AuthFailureException(AuthFailure.OTP_EXPIRED)
    } else {
        InvalidOtpException()
    }
