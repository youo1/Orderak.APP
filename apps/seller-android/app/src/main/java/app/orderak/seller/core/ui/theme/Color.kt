package app.orderak.seller.core.ui.theme

import androidx.compose.ui.graphics.Color

// ============================================================
// Extended colour roles.
//
// Material 3 has no slot for warning, success or information, so they are
// carried here and provided through LocalOrderakExtendedColors.
//
// There are deliberately no default values and no hand-written palette in this
// file. Every colour the app renders is emitted by the design-system generator
// into GeneratedDesignSystem.kt, which is where contrast validation happens.
// A default here would be a colour that never passed that gate, and it would be
// reached exactly when something else had already gone wrong — so the type
// requires every role to be supplied instead.
//
// The previous Navy + Gold primitives (NavyPrimary, GoldPrimary, the Slate
// ramp) were removed with the hand-written colour schemes they fed; nothing
// outside this file referenced them.
// ============================================================
data class OrderakExtendedColors(
    val warning: Color,
    val warningSoft: Color,
    val onWarning: Color,
    val onWarningContainer: Color,
    val success: Color,
    val successSoft: Color,
    val onSuccess: Color,
    val onSuccessContainer: Color,
    val information: Color,
    val informationSoft: Color,
    val onInformation: Color,
    val onInformationContainer: Color,
    val accent: Color,
    val onAccent: Color,
    val primaryTint: Color,
)
