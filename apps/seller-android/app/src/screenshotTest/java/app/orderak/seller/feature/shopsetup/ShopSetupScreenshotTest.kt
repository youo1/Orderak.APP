package app.orderak.seller.feature.shopsetup

import androidx.compose.material3.Surface
import androidx.compose.runtime.Composable
import androidx.compose.ui.tooling.preview.Preview
import app.orderak.seller.core.phone.Country
import app.orderak.seller.core.ui.theme.OrderakTheme
import com.android.tools.screenshot.PreviewTest

/**
 * The second screen a new seller ever sees: the one step that creates the store, and the ready
 * screen after it, in every state.
 *
 * `ShopSetupActions` is what lets either be drawn without a Hilt graph: no-op-defaulted lambdas
 * in one value. All Arabic: `ar` is the primary direction, so the render is what a seller sees.
 */

private val EGYPT = Country(iso = "EG", flag = "🇪🇬", dialCode = "20", name = "مصر")

/** Filled in far enough to create. */
private val FILLED = ShopSetupUiState(
    fullName = "منى عبد الله",
    ageConfirmed = true,
    name = "بوتيك منى",
    country = EGYPT,
)

@Composable
private fun setup(state: ShopSetupUiState, dark: Boolean = false) {
    OrderakTheme(darkTheme = dark) {
        Surface {
            ShopSetupContent(state = state, actions = ShopSetupActions(), onExit = {})
        }
    }
}

/** Empty, which is how a seller actually meets it. */
@PreviewTest
@Preview(name = "Setup empty", locale = "ar")
@Composable
fun setupEmpty() = setup(ShopSetupUiState(country = EGYPT))

@PreviewTest
@Preview(name = "Setup filled light", locale = "ar")
@Composable
fun setupFilledLight() = setup(FILLED)

@PreviewTest
@Preview(name = "Setup filled dark", locale = "ar")
@Composable
fun setupFilledDark() = setup(FILLED, dark = true)

/** Everything typed but the age confirmation: the bar says what is missing. */
@PreviewTest
@Preview(name = "Setup age not confirmed", locale = "ar")
@Composable
fun setupAgeNotConfirmed() = setup(FILLED.copy(ageConfirmed = false))

/** Creating the store covers the screen. */
@PreviewTest
@Preview(name = "Setup creating light", locale = "ar")
@Composable
fun setupCreatingLight() = setup(FILLED.copy(saving = true))

@PreviewTest
@Preview(name = "Setup creating dark", locale = "ar")
@Composable
fun setupCreatingDark() = setup(FILLED.copy(saving = true), dark = true)

/** Creation failed: a banner with retry, and everything typed is kept. */
@PreviewTest
@Preview(name = "Setup error light", locale = "ar")
@Composable
fun setupErrorLight() = setup(FILLED.copy(error = "network"))

@PreviewTest
@Preview(name = "Setup error dark", locale = "ar")
@Composable
fun setupErrorDark() = setup(FILLED.copy(error = "network"), dark = true)

/** The ready screen: the link, share and copy, and what is left to do. */
@PreviewTest
@Preview(name = "Setup ready light", locale = "ar")
@Composable
fun setupReadyLight() = setup(FILLED.copy(completed = true, storeUrl = "https://orderak.app/EG-mona-boutique-K7M2Q9XA"))

@PreviewTest
@Preview(name = "Setup ready dark", locale = "ar")
@Composable
fun setupReadyDark() = setup(FILLED.copy(completed = true, storeUrl = "https://orderak.app/EG-mona-boutique-K7M2Q9XA"), dark = true)

// ================= The passkey invite that ends onboarding =================
//
// `ShopSetupScreen` sets `showPasskeyInvite` when setup completes and draws this sheet
// over the finished store step. Every render above has `showPasskeyInvite = false`, so
// the sheet the seller is shown at the exact moment their store goes live had no
// baselines — not blank ones, none. `ModalBottomSheet` is not captured by the harness,
// which is why a render of `ShopSetupScreen` in this state would not have helped.
//
// The invite's failure case is the one that matters. A passkey that could not be
// created is the seller's first experience of the account they just made; the sheet
// has to say so and still leave "later" reachable, so the skip button is in that render.

@Composable
private fun passkeyInvite(
    creating: Boolean = false,
    error: String? = null,
    dark: Boolean = false,
) {
    OrderakTheme(darkTheme = dark) {
        Surface {
            OnboardingPasskeyContent(
                creating = creating,
                error = error,
                onCreate = {},
                onSkip = {},
            )
        }
    }
}

@PreviewTest
@Preview(name = "Setup passkey invite", locale = "ar")
@Composable
fun setupPasskeyInvite() = passkeyInvite()

@PreviewTest
@Preview(name = "Setup passkey creating", locale = "ar")
@Composable
fun setupPasskeyCreating() = passkeyInvite(creating = true)

/** The ceremony failed: named, and "not now" stays enabled so the seller is not stuck. */
@PreviewTest
@Preview(name = "Setup passkey failed", locale = "ar")
@Composable
fun setupPasskeyFailed() = passkeyInvite(error = "passkey_failed")

@PreviewTest
@Preview(name = "Setup passkey failed dark", locale = "ar")
@Composable
fun setupPasskeyFailedDark() = passkeyInvite(error = "passkey_failed", dark = true)
