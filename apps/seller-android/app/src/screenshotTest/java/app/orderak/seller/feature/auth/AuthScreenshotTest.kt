package app.orderak.seller.feature.auth

import androidx.compose.material3.Surface
import androidx.compose.runtime.Composable
import androidx.compose.ui.tooling.preview.Preview
import app.orderak.seller.core.phone.Countries
import app.orderak.seller.core.phone.Country
import app.orderak.seller.core.ui.theme.OrderakTheme
import com.android.tools.screenshot.PreviewTest

/**
 * The first screen a tester ever opens, in every state its contract declares.
 *
 * WHY THIS FILE DID NOT EXIST
 *   Not for the reason the five surfaces had. `AuthScreenContent(state, ...)`
 *   has taken an [AuthUiState] all along and needs no view model — it was
 *   renderable the entire time and nobody rendered it. The اليوم and المتجر
 *   files had to be earned by splitting a screen; this one only had to be
 *   written, which is the more embarrassing kind of gap and the reason the
 *   audit counted `auth` as its worst contract at five unverified claims.
 *
 *   `design-coverage.mjs` passed it throughout, because "Welcome" and "PhoneOtp"
 *   are names in an object literal.
 *
 * WHAT IS NOT HERE
 *   [AuthUiState.Success] is deliberately absent. It is not a state a seller
 *   sees — `AuthScreenContent` runs a LaunchedEffect on it and navigates away.
 *   Rendering it would fire that effect, and a render whose only content is a
 *   side effect proves nothing.
 *
 * All Arabic: `ar` is the primary direction, so the render is what a seller sees.
 */

/** `dialCode` carries no "+": Countries.kt stores `dial.toString()` and the UI adds it. */
private val EGYPT = Country(iso = "EG", flag = "🇪🇬", dialCode = "20", name = "مصر")

@Composable
private fun auth(state: AuthUiState, dark: Boolean = false) {
    OrderakTheme(darkTheme = dark) {
        Surface {
            AuthScreenContent(
                state = state,
                onNewSeller = {},
                onExistingSeller = {},
                onBack = {},
                dispatch = {},
                onPasskeySignIn = {},
                onCreatePasskey = {},
            )
        }
    }
}

// ================= Welcome =================

@PreviewTest
@Preview(name = "Auth welcome light", locale = "ar")
@Composable
fun authWelcomeLight() = auth(AuthUiState.Welcome())

@PreviewTest
@Preview(name = "Auth welcome dark", locale = "ar")
@Composable
fun authWelcomeDark() = auth(AuthUiState.Welcome(), dark = true)

/** Passkey sign-in in flight: the returning seller's fast path. */
@PreviewTest
@Preview(name = "Auth welcome passkey loading", locale = "ar")
@Composable
fun authWelcomePasskeyLoading() = auth(AuthUiState.Welcome(isPasskeyLoading = true))

/**
 * The passkey did not work, so the OTP route is offered.
 *
 * The error and the fallback belong in one render: a failure that removes the
 * only way forward is a dead end, and this is the screen where a dead end costs
 * the whole account.
 */
@PreviewTest
@Preview(name = "Auth welcome passkey failed", locale = "ar")
@Composable
fun authWelcomePasskeyFailed() =
    auth(AuthUiState.Welcome(showOtpFallback = true, error = AuthError.PASSKEY_FAILED))

/**
 * Signing in again will not help.
 *
 * The one auth error whose honest answer is "not here" — the account exists and
 * is suspended, so an encouraging retry would be a lie.
 */
@PreviewTest
@Preview(name = "Auth welcome account restricted", locale = "ar")
@Composable
fun authWelcomeRestricted() = auth(AuthUiState.Welcome(error = AuthError.ACCOUNT_RESTRICTED))

// ================= Phone =================

@PreviewTest
@Preview(name = "Auth phone light", locale = "ar")
@Composable
fun authPhoneLight() =
    auth(AuthUiState.EnterPhone(country = EGYPT, phone = "1001234567", isValid = true))

@PreviewTest
@Preview(name = "Auth phone dark", locale = "ar")
@Composable
fun authPhoneDark() =
    auth(AuthUiState.EnterPhone(country = EGYPT, phone = "1001234567", isValid = true), dark = true)

/** Empty and not yet valid: the state the screen actually opens in. */
@PreviewTest
@Preview(name = "Auth phone empty", locale = "ar")
@Composable
fun authPhoneEmpty() =
    auth(AuthUiState.EnterPhone(country = EGYPT, phone = "", isValid = false))

@PreviewTest
@Preview(name = "Auth phone sending", locale = "ar")
@Composable
fun authPhoneSending() = auth(
    AuthUiState.EnterPhone(country = EGYPT, phone = "1001234567", isValid = true, isSending = true),
)

@PreviewTest
@Preview(name = "Auth phone invalid", locale = "ar")
@Composable
fun authPhoneInvalid() = auth(
    AuthUiState.EnterPhone(
        country = EGYPT,
        phone = "100",
        isValid = false,
        error = AuthError.INVALID_PHONE,
    ),
)

/**
 * The number is fine and the network is not.
 *
 * Distinct from INVALID_PHONE on purpose: one is the seller's to fix and the
 * other is not, and telling them to check a correct number wastes the one thing
 * they have at a stall with no signal.
 */
@PreviewTest
@Preview(name = "Auth phone no network", locale = "ar")
@Composable
fun authPhoneNoNetwork() = auth(
    AuthUiState.EnterPhone(
        country = EGYPT,
        phone = "1001234567",
        isValid = true,
        error = AuthError.NETWORK_UNAVAILABLE,
    ),
)

// ================= OTP =================

@PreviewTest
@Preview(name = "Auth otp light", locale = "ar")
@Composable
fun authOtpLight() = auth(
    AuthUiState.EnterOtp(
        country = EGYPT,
        phone = "1001234567",
        phoneE164 = "+201001234567",
        code = "1234",
        secondsLeft = 41,
        canResend = false,
    ),
)

@PreviewTest
@Preview(name = "Auth otp dark", locale = "ar")
@Composable
fun authOtpDark() = auth(
    AuthUiState.EnterOtp(
        country = EGYPT,
        phone = "1001234567",
        phoneE164 = "+201001234567",
        code = "1234",
        secondsLeft = 41,
        canResend = false,
    ),
    dark = true,
)

/** The countdown has run out, so resend is offered rather than implied. */
@PreviewTest
@Preview(name = "Auth otp resendable", locale = "ar")
@Composable
fun authOtpResendable() = auth(
    AuthUiState.EnterOtp(
        country = EGYPT,
        phone = "1001234567",
        phoneE164 = "+201001234567",
        code = "",
        secondsLeft = 0,
        canResend = true,
    ),
)

@PreviewTest
@Preview(name = "Auth otp verifying", locale = "ar")
@Composable
fun authOtpVerifying() = auth(
    AuthUiState.EnterOtp(
        country = EGYPT,
        phone = "1001234567",
        phoneE164 = "+201001234567",
        code = "123456",
        secondsLeft = 22,
        canResend = false,
        isVerifying = true,
    ),
)

@PreviewTest
@Preview(name = "Auth otp wrong code", locale = "ar")
@Composable
fun authOtpWrongCode() = auth(
    AuthUiState.EnterOtp(
        country = EGYPT,
        phone = "1001234567",
        phoneE164 = "+201001234567",
        code = "123456",
        secondsLeft = 18,
        canResend = false,
        error = AuthError.INVALID_OTP,
    ),
)

/** Expired is not wrong: the way out is a new code, not a better guess. */
@PreviewTest
@Preview(name = "Auth otp expired", locale = "ar")
@Composable
fun authOtpExpired() = auth(
    AuthUiState.EnterOtp(
        country = EGYPT,
        phone = "1001234567",
        phoneE164 = "+201001234567",
        code = "123456",
        secondsLeft = 0,
        canResend = true,
        error = AuthError.OTP_EXPIRED,
    ),
)

// ================= Passkey invite =================
//
// These three render the invite's CONTENT, not the screen that hosts it.
//
// They used to call `auth(AuthUiState.PasskeyInvite(…))`, which renders
// `AuthScreenContent` — and in this state that composes a `ModalBottomSheet`, which
// the screenshot harness does not capture. The three baselines were therefore
// byte-identical: one SHA256 across all three, 15,540 bytes each, so three different
// states shared one image and none of them could be reviewed. `PasskeyInviteContent`
// was extracted for this, the same reason `TodayScreen` and `StoreContent` take a
// state instead of a view model.

@Composable
private fun passkeyInvite(state: AuthUiState.PasskeyInvite, dark: Boolean = false) {
    OrderakTheme(darkTheme = dark) {
        Surface { PasskeyInviteContent(state = state, onCreate = {}, onSkip = {}) }
    }
}

@PreviewTest
@Preview(name = "Auth passkey invite", locale = "ar")
@Composable
fun authPasskeyInvite() = passkeyInvite(AuthUiState.PasskeyInvite())

@PreviewTest
@Preview(name = "Auth passkey creating", locale = "ar")
@Composable
fun authPasskeyCreating() = passkeyInvite(AuthUiState.PasskeyInvite(isCreating = true))

/**
 * A new seller: the choice is recorded now and the system ceremony waits until
 * setup completes, so this render must not look like a passkey already exists.
 */
@PreviewTest
@Preview(name = "Auth passkey deferred", locale = "ar")
@Composable
fun authPasskeyDeferred() = passkeyInvite(AuthUiState.PasskeyInvite(deferredForOnboarding = true))

// ---- dark variants for loading and error -------------------------------
// The surfaces render every declared state in both themes; auth's loading and
// error states reached only light above, so they reach dark here. An error
// drawn in errorContainer over a dark background is the case most likely to
// lose contrast, and it is on the screen a locked-out seller is staring at.

@PreviewTest
@Preview(name = "Auth phone sending dark", locale = "ar")
@Composable
fun authPhoneSendingDark() = auth(
    AuthUiState.EnterPhone(country = EGYPT, phone = "1001234567", isValid = true, isSending = true),
    dark = true,
)

@PreviewTest
@Preview(name = "Auth otp wrong code dark", locale = "ar")
@Composable
fun authOtpWrongCodeDark() = auth(
    AuthUiState.EnterOtp(
        country = EGYPT,
        phone = "1001234567",
        phoneE164 = "+201001234567",
        code = "123456",
        secondsLeft = 18,
        canResend = false,
        error = AuthError.INVALID_OTP,
    ),
    dark = true,
)

// ================= Country picker =================
//
// The last sheet in this file, and the one with the highest cost per defect. It is the
// only way to change the country code on the phone step, and the country code is what
// the OTP is sent to: wrong here, the code never arrives and nothing on screen says so.
// It had no baselines because `ModalBottomSheet` is not captured — the same reason the
// passkey sheet had three identical ones, except this one had none to be identical.
//
// The list is passed in rather than looked up, so the filtered render below is a real
// filter result and not a function of the machine's locale.

private val COUNTRY_LIST = Countries.all(java.util.Locale("ar"))

@Composable
private fun countryPicker(
    countries: List<Country>,
    selected: Country,
    query: String = "",
    dark: Boolean = false,
) {
    OrderakTheme(darkTheme = dark) {
        Surface {
            CountryPickerContent(
                countries = countries,
                selected = selected,
                query = query,
                onQueryChange = {},
                onSelected = {},
            )
        }
    }
}

@PreviewTest
@Preview(name = "Auth country picker", locale = "ar")
@Composable
fun authCountryPicker() = countryPicker(COUNTRY_LIST, EGYPT)

/**
 * Searched by dial code, not by name — the shape of query the filter's
 * `dialCode.startsWith` branch exists for, and the one a seller is most likely to type
 * when they already know their prefix. The tick still sits on Egypt.
 */
@PreviewTest
@Preview(name = "Auth country picker search", locale = "ar")
@Composable
fun authCountryPickerSearch() = countryPicker(
    countries = COUNTRY_LIST.filter { it.dialCode.startsWith("2") },
    selected = EGYPT,
    query = "2",
)

@PreviewTest
@Preview(name = "Auth country picker dark", locale = "ar")
@Composable
fun authCountryPickerDark() = countryPicker(COUNTRY_LIST, EGYPT, dark = true)
