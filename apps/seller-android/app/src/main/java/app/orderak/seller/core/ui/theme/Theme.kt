package app.orderak.seller.core.ui.theme

import android.app.Activity
import android.animation.ValueAnimator
import androidx.compose.foundation.isSystemInDarkTheme
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.material3.Button
import androidx.compose.material3.ColorScheme
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.Shapes
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.runtime.SideEffect
import androidx.compose.runtime.remember
import androidx.compose.runtime.staticCompositionLocalOf
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.luminance
import androidx.compose.ui.graphics.toArgb
import androidx.compose.ui.platform.LocalView
import androidx.compose.ui.tooling.preview.Preview
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.Dp
import androidx.core.view.WindowCompat

// ============================================================
// Shape tokens — Material 3 small / medium / large
// ============================================================
val OrderakShapes = Shapes(
    extraSmall = androidx.compose.foundation.shape.RoundedCornerShape(4.dp),
    small = androidx.compose.foundation.shape.RoundedCornerShape(8.dp),
    medium = androidx.compose.foundation.shape.RoundedCornerShape(12.dp),
    large = androidx.compose.foundation.shape.RoundedCornerShape(16.dp),
    extraLarge = androidx.compose.foundation.shape.RoundedCornerShape(24.dp),
)

// ============================================================
// Extended color tokens (roles without a stock M3 slot)
// ============================================================
// Defaulted to the generated standard/light roles rather than a hand-written
// palette, so even the composition-local fallback is a contrast-validated value.
val LocalOrderakExtendedColors = staticCompositionLocalOf {
    GeneratedDesignSystem.extendedColors("standard", dark = false)
}

data class OrderakSpacing(
    val space0: Dp = 0.dp,
    val space1: Dp = 4.dp,
    val space2: Dp = 8.dp,
    val space3: Dp = 12.dp,
    val space4: Dp = 16.dp,
    val space6: Dp = 24.dp,
    val space8: Dp = 32.dp,
    val space10: Dp = 40.dp,
    val space12: Dp = 48.dp,
    val space16: Dp = 64.dp,
    val minimumTouchTarget: Dp = 48.dp,
    /**
     * Trailing clearance for a list a floating action button floats over.
     *
     * Not a rhythm value, and deliberately not on the 4dp scale: it is a
     * measurement of something else. A FAB is 56dp tall with 16dp of margin
     * below it, so 72dp is the floor before it starts covering the last row, and
     * the extra is breathing room.
     *
     * It lives here, named, because the two lists that need it each carried a
     * bare `80.dp`. An unexplained literal invites the reasonable-looking fix of
     * snapping it to `space16` — which is 64dp, eight dp short of the floor, and
     * would hide the bottom of the last order the seller is scrolling to. Change
     * this number only together with the FAB's size or its padding.
     */
    val fabClearance: Dp = 80.dp,
    /**
     * The catalogue thumbnail, in a list row.
     *
     * A component dimension rather than a rhythm value: it is the size a product
     * photo is drawn at, and the scale has no step at 56. It is named so the
     * literal is explained rather than snapped to 48 or 64 — each of those is a
     * layout change to a row a seller scans, and neither has been judged against
     * a render. This is the value that was already there; nothing was "tried and
     * rejected", and an earlier version of this comment wrongly said otherwise.
     *
     * If a redesign changes it, change it here and let the store-surface
     * baselines show the result.
     */
    val thumbnail: Dp = 56.dp,
    /**
     * An icon drawn inside a label, a chip, a row or a button.
     *
     * The app carried this as `14.dp` at two sites and `18.dp` at two more, which
     * is not a scale — it is the same intent typed four times. 16dp is the step
     * the spacing scale already has between [space3] and [space4], so the icon
     * group does not introduce a fifth number into the system.
     */
    val iconSmall: Dp = 16.dp,
    /**
     * A standalone icon: a leading slot, a control, an inline progress spinner.
     *
     * `20.dp` at eight sites and `22.dp` at three. The two dp of difference were
     * not visible at any of them; keeping both would mean the next icon has to
     * choose between two values that mean the same thing.
     */
    val iconMedium: Dp = 20.dp,
    /**
     * A decorative icon that stands for a whole action on its own — the
     * fingerprint on the passkey button, which is the only one of these.
     *
     * Named rather than snapped to [space12]: 48dp would draw it larger than the
     * button's own label, and [iconMedium] would leave it reading as a bullet
     * beside the text rather than as the subject of the button.
     */
    val iconHero: Dp = 44.dp,
)

/**
 * Layout measurements that are not rhythm values.
 *
 * These are the sizes of the surface itself — how wide the app is allowed to
 * grow, and where it stops being a phone. They are separate from [OrderakSpacing]
 * because nothing here is spacing: a max content width is a reading measure, and
 * a breakpoint is a comparison against the window, not a distance between two
 * things. Both were bare literals repeated across screens, which is what made
 * them worth naming: seven copies of `560.dp` in the auth and shop-setup flows
 * are seven places to miss when the measure changes.
 */
data class OrderakLayout(
    /**
     * The widest a column of content is drawn before it is centred.
     *
     * Measured in characters, not in design rhythm: this is the width at which an
     * Arabic sentence in `bodyLarge` stops being comfortable to read left to
     * right. A tablet or an unfolded phone gets wider margins instead of longer
     * lines, which is why the value is fixed rather than proportional.
     */
    val contentMaxWidth: Dp = 560.dp,
    /**
     * The window width at which a screen switches from one column to two.
     *
     * The same number as Material's expanded window-size class lower bound, so a
     * screen that branches on this agrees with the platform's own classification
     * instead of carrying a second opinion about what "wide" means.
     */
    val wideLayoutMinWidth: Dp = 720.dp,
)

val LocalOrderakLayout = staticCompositionLocalOf { OrderakLayout() }

val LocalOrderakSpacing = staticCompositionLocalOf { OrderakSpacing() }

// ============================================================
// Motion
// ============================================================

/**
 * Durations, from the system rather than written at the call site.
 *
 * The reference states both the numbers and the restraint: "150ms for hover and
 * colour, 180ms for the sidebar slide, 200ms for switches and drawers", and
 * "Nothing bounces, nothing springs, nothing has an entrance animation."
 *
 * The app had exactly one duration — a hand-written `tween(300)` at six sites,
 * longer than every value the system names, and unconditional. Reduced motion is
 * the reason these are values rather than constants: when the platform reports
 * that animators are disabled, every duration collapses to [instant]. The web
 * side already zeroes its duration tokens under `prefers-reduced-motion`; on
 * Android `ValueAnimator.areAnimatorsEnabled` is the same switch, and reading it
 * once here is what stops each new animation from having to remember.
 */
data class OrderakMotion(
    val instant: Int = 0,
    val short: Int = 150,
    val medium: Int = 180,
    val long: Int = 200,
) {
    /** Every duration zeroed, for a device with animation turned off. */
    fun reduced(): OrderakMotion = OrderakMotion(instant, instant, instant, instant)
}

val LocalOrderakMotion = staticCompositionLocalOf { OrderakMotion() }

/**
 * The pill radius, which Material's [Shapes] has no slot for.
 *
 * A proportion of the element's own height rather than a large dp value. The
 * system's web tokens express it the same way (`--orderak-shape-full`), and a
 * fixed radius is only a pill below twice its own value: `RoundedCornerShape(100.dp)`
 * and a 50% radius are the same shape on a 56dp button and two different shapes
 * on anything taller than 200dp.
 */
val Shapes.full: RoundedCornerShape
    get() = RoundedCornerShape(percent = 50)

// ============================================================
// Generated design-system accessors
//
// Colour, typography, spacing and shape values are produced by
// services/backend/scripts/generate-design-system-fixture.ts and land in
// GeneratedDesignSystem.kt. Nothing here reads the network: the generator's
// contrast validation is the only gate these values pass through, so it has to
// be the only way they are produced.
// ============================================================

private fun generatedShapes(): Shapes {
    val values = GeneratedDesignSystem.shapes
    fun radius(name: String, fallback: Dp): Dp =
        values[name]?.takeIf { it in 0f..40f }?.dp ?: fallback
    return Shapes(
        extraSmall = androidx.compose.foundation.shape.RoundedCornerShape(radius("extraSmall", 4.dp)),
        small = androidx.compose.foundation.shape.RoundedCornerShape(radius("small", 8.dp)),
        medium = androidx.compose.foundation.shape.RoundedCornerShape(radius("medium", 12.dp)),
        large = androidx.compose.foundation.shape.RoundedCornerShape(radius("large", 16.dp)),
        extraLarge = androidx.compose.foundation.shape.RoundedCornerShape(radius("extraLarge", 24.dp)),
    )
}

private fun generatedSpacing(): OrderakSpacing {
    val tokens = GeneratedDesignSystem.spacing
    fun token(name: String, fallback: Dp): Dp =
        tokens[name]?.takeIf { it in 0f..144f }?.dp ?: fallback
    return OrderakSpacing(
        space0 = token("space0", 0.dp),
        space1 = token("space1", 4.dp),
        space2 = token("space2", 8.dp),
        space3 = token("space3", 12.dp),
        space4 = token("space4", 16.dp),
        space6 = token("space6", 24.dp),
        space8 = token("space8", 32.dp),
        space10 = token("space10", 40.dp),
        space12 = token("space12", 48.dp),
        space16 = token("space16", 64.dp),
        minimumTouchTarget = maxOf(48f, GeneratedDesignSystem.MINIMUM_TOUCH_TARGET_DP).dp,
    )
}

// ============================================================
// Main Theme Composable
// ============================================================
@Composable
fun OrderakTheme(
    darkTheme: Boolean = isSystemInDarkTheme(),
    contrastLevel: String = GeneratedDesignSystem.DEFAULT_CONTRAST,
    content: @Composable () -> Unit
) {
    val safeContrast = GeneratedDesignSystem.normalizeContrast(contrastLevel)
    val colorScheme = GeneratedDesignSystem.colorScheme(safeContrast, darkTheme)
    val extended = GeneratedDesignSystem.extendedColors(safeContrast, darkTheme)
    val spacing = generatedSpacing()
    val motion = remember {
        if (ValueAnimator.areAnimatorsEnabled()) OrderakMotion() else OrderakMotion().reduced()
    }
    // Constructed once rather than per-read: every field is a constant today, but
    // a CompositionLocal's value is compared by identity, so a fresh instance per
    // composition would recompose every reader of it for no reason.
    val layout = remember { OrderakLayout() }

    // enableEdgeToEdge() is already called in MainActivity.onCreate() on Android 15+
    // (backported by the AndroidX library). The window is transparent by default;
    // here we only need to ensure system bar icons have proper contrast.
    val view = LocalView.current
    if (!view.isInEditMode) {
        SideEffect {
            val window = (view.context as Activity).window
            val lightBackground = colorScheme.background.luminance() > 0.5f
            WindowCompat.getInsetsController(window, view).isAppearanceLightStatusBars = lightBackground
            WindowCompat.getInsetsController(window, view).isAppearanceLightNavigationBars = lightBackground
        }
    }

    CompositionLocalProvider(
        LocalOrderakExtendedColors provides extended,
        LocalOrderakSpacing provides spacing,
        LocalOrderakMotion provides motion,
        LocalOrderakLayout provides layout,
    ) {
        MaterialTheme(
            colorScheme = colorScheme,
            typography = OrderakTypography.withGenerated(),
            shapes = generatedShapes(),
        ) {
            Surface(
                modifier = Modifier.fillMaxSize(),
                color = MaterialTheme.colorScheme.background,
                content = content,
            )
        }
    }
}

// ============================================================
// Previews for visual verification
// ============================================================
// No backgroundColor: OrderakTheme paints its own from colorScheme.background,
// so a literal here can only duplicate it and then go stale. These two carried
// the pre-#014D4E backdrop for exactly that reason.
@Preview(name = "Light Theme")
@Composable
private fun PreviewOrderakLightTheme() {
    OrderakTheme(darkTheme = false) {
        ThemePreviewContent()
    }
}

@Preview(name = "Dark Theme")
@Composable
private fun PreviewOrderakDarkTheme() {
    OrderakTheme(darkTheme = true) {
        ThemePreviewContent()
    }
}

@Composable
private fun ThemePreviewContent() {
    Column(modifier = Modifier.padding(16.dp)) {
        Text("Headline Large", style = MaterialTheme.typography.headlineLarge)
        Text("Headline Medium", style = MaterialTheme.typography.headlineMedium)
        Text("Title Large", style = MaterialTheme.typography.titleLarge)
        Text("Title Medium", style = MaterialTheme.typography.titleMedium)
        Text("Body Large", style = MaterialTheme.typography.bodyLarge)
        Text("Body Medium", style = MaterialTheme.typography.bodyMedium)
        Text("Body Small", style = MaterialTheme.typography.bodySmall)
        Spacer(modifier = Modifier.height(8.dp))
        Text("Label Large", style = MaterialTheme.typography.labelLarge)
        Text("Label Small", style = MaterialTheme.typography.labelSmall)
        Spacer(modifier = Modifier.height(16.dp))
        Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            Button(onClick = {}) { Text("Primary") }
            OutlinedButton(onClick = {}) { Text("Outline") }
        }
        Spacer(modifier = Modifier.height(8.dp))
        Surface(
            color = MaterialTheme.colorScheme.surfaceVariant,
            shape = MaterialTheme.shapes.medium,
            modifier = Modifier.fillMaxWidth(),
        ) {
            Text(
                "Surface Variant card",
                modifier = Modifier.padding(16.dp),
                style = MaterialTheme.typography.bodyMedium,
            )
        }
    }
}
