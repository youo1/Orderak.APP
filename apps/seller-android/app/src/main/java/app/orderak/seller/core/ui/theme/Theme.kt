package app.orderak.seller.core.ui.theme

import android.app.Activity
import androidx.compose.foundation.isSystemInDarkTheme
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
import androidx.compose.material3.darkColorScheme
import androidx.compose.material3.lightColorScheme
import androidx.compose.runtime.Composable
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.runtime.SideEffect
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
import app.orderak.seller.data.remote.BrandingRepository

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
// Light color scheme — navy + gold with modern Slate neutrals.
// Every onX color has ≥4.5:1 contrast against X.
// ============================================================
val OrderakLightColorScheme = lightColorScheme(
    // -- Primary (navy) -------------------------------------------
    primary = NavyPrimary,
    onPrimary = Color.White,                         // 10.4:1
    primaryContainer = NavySoft,
    onPrimaryContainer = NavyStrong,                 // 11.3:1 on NavySoft
    // -- Secondary (gold) -----------------------------------------
    secondary = GoldPrimary,
    onSecondary = InkDark,                           // 6.7:1 on GoldPrimary
    secondaryContainer = LightSecondaryContainer,    // GoldSoft
    onSecondaryContainer = LightOnSecondaryContainer,// 6.3:1
    // -- Tertiary (teal) ------------------------------------------
    tertiary = LightTertiary,
    onTertiary = LightOnTertiary,
    tertiaryContainer = LightTertiaryContainer,
    onTertiaryContainer = LightOnTertiaryContainer,
    // -- Surfaces -------------------------------------------------
    background = Slate50,
    onBackground = InkDark,
    surface = NeutralWhite,
    onSurface = InkDark,
    surfaceVariant = Slate100,
    onSurfaceVariant = Slate700,                     // 6.9:1 on Slate100
    // -- Outlines -------------------------------------------------
    outline = Slate200,
    outlineVariant = Slate200,
    // -- Error ----------------------------------------------------
    error = Danger,
    onError = Color.White,                           // 5.0:1
    errorContainer = DangerSoft,
    onErrorContainer = DangerOnContainer,            // 5.9:1 on DangerSoft
    // -- Inverse --------------------------------------------------
    inverseSurface = LightInverseSurface,            // Slate900
    inverseOnSurface = LightInverseOnSurface,        // Slate50
    inversePrimary = LightInversePrimary,
    // -- Utility --------------------------------------------------
    surfaceTint = LightSurfaceTint,
    scrim = LightScrim,
)

// ============================================================
// Dark color scheme — premium cool dark slate.
// Every onX color has ≥4.5:1 contrast against X.
// ============================================================
private val OrderakDarkColorScheme = darkColorScheme(
    // -- Primary --------------------------------------------------
    primary = DarkPrimary,
    onPrimary = DarkOnPrimary,                       // 9.2:1
    primaryContainer = DarkPrimaryContainer,
    onPrimaryContainer = DarkOnPrimaryContainer,     // 6.1:1
    // -- Secondary (gold, brighter for dark) ---------------------
    secondary = DarkSecondary,
    onSecondary = DarkOnSecondary,                   // 7.7:1
    secondaryContainer = DarkSecondaryContainer,
    onSecondaryContainer = DarkOnSecondaryContainer, // 9.9:1
    // -- Tertiary (teal) ------------------------------------------
    tertiary = DarkTertiary,
    onTertiary = DarkOnTertiary,
    tertiaryContainer = DarkTertiaryContainer,
    onTertiaryContainer = DarkOnTertiaryContainer,
    // -- Surfaces -------------------------------------------------
    background = DarkBackground,                     // Slate900
    onBackground = DarkOnBackground,                 // Slate50, 12.6:1
    surface = DarkSurface,                           // Slate800
    onSurface = DarkOnSurface,                       // Slate50, 12.6:1
    surfaceVariant = DarkSurfaceVariant,             // Slate700
    onSurfaceVariant = DarkOnSurfaceVariant,         // Slate200, 5.6:1
    // -- Outlines -------------------------------------------------
    outline = DarkOutline,                           // Slate700
    outlineVariant = DarkOutlineVariant,             // #334155
    // -- Error ----------------------------------------------------
    error = DarkError,                               // #F87171
    onError = DarkOnError,                           // #450A0A, 8.6:1
    errorContainer = DarkErrorContainer,
    onErrorContainer = DarkOnErrorContainer,         // 12.4:1
    // -- Inverse --------------------------------------------------
    inverseSurface = DarkInverseSurface,             // Slate50
    inverseOnSurface = DarkInverseOnSurface,         // Slate900
    inversePrimary = DarkInversePrimary,
    // -- Utility --------------------------------------------------
    surfaceTint = DarkSurfaceTint,
    scrim = DarkScrim,
)

// ============================================================
// Extended color tokens (roles without a stock M3 slot)
// ============================================================
val LocalOrderakExtendedColors = staticCompositionLocalOf { OrderakExtendedColors() }

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
)

val LocalOrderakSpacing = staticCompositionLocalOf { OrderakSpacing() }

// ============================================================
// Remote branding helpers
// ============================================================

/** Pre-compiled hex validator — avoids allocating a new Regex every call. */
private val hexPattern = Regex("^#[0-9a-fA-F]{6}$")

private fun hex(v: String?): Color? {
    if (v == null || !hexPattern.matches(v)) return null
    return Color(0xFF000000 or v.substring(1).toLong(16))
}

private fun Map<String, String>.color(role: String, fallback: Color): Color =
    hex(this[role]) ?: fallback

private fun ColorScheme.withSnapshot(roles: Map<String, String>?): ColorScheme {
    if (roles == null) return this
    return copy(
        primary = roles.color("primary", primary),
        onPrimary = roles.color("onPrimary", onPrimary),
        primaryContainer = roles.color("primaryContainer", primaryContainer),
        onPrimaryContainer = roles.color("onPrimaryContainer", onPrimaryContainer),
        inversePrimary = roles.color("inversePrimary", inversePrimary),
        secondary = roles.color("secondary", secondary),
        onSecondary = roles.color("onSecondary", onSecondary),
        secondaryContainer = roles.color("secondaryContainer", secondaryContainer),
        onSecondaryContainer = roles.color("onSecondaryContainer", onSecondaryContainer),
        tertiary = roles.color("tertiary", tertiary),
        onTertiary = roles.color("onTertiary", onTertiary),
        tertiaryContainer = roles.color("tertiaryContainer", tertiaryContainer),
        onTertiaryContainer = roles.color("onTertiaryContainer", onTertiaryContainer),
        error = roles.color("error", error),
        onError = roles.color("onError", onError),
        errorContainer = roles.color("errorContainer", errorContainer),
        onErrorContainer = roles.color("onErrorContainer", onErrorContainer),
        background = roles.color("background", background),
        onBackground = roles.color("onBackground", onBackground),
        surface = roles.color("surface", surface),
        surfaceDim = roles.color("surfaceDim", surfaceDim),
        surfaceBright = roles.color("surfaceBright", surfaceBright),
        surfaceContainerLowest = roles.color("surfaceContainerLowest", surfaceContainerLowest),
        surfaceContainerLow = roles.color("surfaceContainerLow", surfaceContainerLow),
        surfaceContainer = roles.color("surfaceContainer", surfaceContainer),
        surfaceContainerHigh = roles.color("surfaceContainerHigh", surfaceContainerHigh),
        surfaceContainerHighest = roles.color("surfaceContainerHighest", surfaceContainerHighest),
        onSurface = roles.color("onSurface", onSurface),
        surfaceVariant = roles.color("surfaceVariant", surfaceVariant),
        onSurfaceVariant = roles.color("onSurfaceVariant", onSurfaceVariant),
        outline = roles.color("outline", outline),
        outlineVariant = roles.color("outlineVariant", outlineVariant),
        inverseSurface = roles.color("inverseSurface", inverseSurface),
        inverseOnSurface = roles.color("inverseOnSurface", inverseOnSurface),
        surfaceTint = roles.color("surfaceTint", surfaceTint),
        scrim = roles.color("scrim", scrim),
    )
}

private fun remoteShapes(values: Map<String, Double>?): Shapes {
    if (values == null) return OrderakShapes
    fun radius(name: String, fallback: Dp): Dp =
        values[name]?.takeIf { it in 0.0..40.0 }?.toFloat()?.dp ?: fallback
    return Shapes(
        extraSmall = androidx.compose.foundation.shape.RoundedCornerShape(radius("extraSmall", 4.dp)),
        small = androidx.compose.foundation.shape.RoundedCornerShape(radius("small", 8.dp)),
        medium = androidx.compose.foundation.shape.RoundedCornerShape(radius("medium", 12.dp)),
        large = androidx.compose.foundation.shape.RoundedCornerShape(radius("large", 16.dp)),
        extraLarge = androidx.compose.foundation.shape.RoundedCornerShape(radius("extraLarge", 24.dp)),
    )
}

private fun remoteSpacing(snapshot: BrandingRepository.DesignSystemSnapshot?): OrderakSpacing {
    val tokens = snapshot?.spacing?.tokens ?: return OrderakSpacing()
    fun token(name: String, fallback: Dp): Dp =
        tokens[name]?.takeIf { it in 0.0..144.0 }?.toFloat()?.dp ?: fallback
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
        minimumTouchTarget = maxOf(48.0, snapshot.components.minimumTouchTargetDp).toFloat().dp,
    )
}

private fun remoteExtended(
    semantic: Map<String, String>?,
    roles: Map<String, String>?,
): OrderakExtendedColors {
    if (semantic == null) return OrderakExtendedColors()
    return OrderakExtendedColors(
        warning = semantic.color("warning", Warning),
        warningSoft = semantic.color("warningContainer", WarningSoft),
        onWarning = semantic.color("onWarning", InkDark),
        onWarningContainer = semantic.color("onWarningContainer", InkDark),
        success = semantic.color("success", Success),
        successSoft = semantic.color("successContainer", SuccessSoft),
        onSuccess = semantic.color("onSuccess", Color.White),
        onSuccessContainer = semantic.color("onSuccessContainer", InkDark),
        information = semantic.color("information", NavyTint),
        informationSoft = semantic.color("informationContainer", NavySoft),
        onInformation = semantic.color("onInformation", Color.White),
        onInformationContainer = semantic.color("onInformationContainer", NavyStrong),
        accent = roles?.color("secondary", GoldPrimary) ?: GoldPrimary,
        onAccent = roles?.color("onSecondary", InkDark) ?: InkDark,
        primaryTint = roles?.color("inversePrimary", NavyTint) ?: NavyTint,
    )
}

// ============================================================
// Main Theme Composable
// ============================================================
@Composable
fun OrderakTheme(
    darkTheme: Boolean = isSystemInDarkTheme(),
    contrastLevel: String = "standard",
    remoteConfig: BrandingRepository.BrandingConfig? = null,
    content: @Composable () -> Unit
) {
    val snapshot = remoteConfig?.designSystem
    val safeContrast = contrastLevel.takeIf { it in setOf("standard", "medium", "high") } ?: "standard"
    val mode = if (darkTheme) "dark" else "light"
    val roles = snapshot?.schemes?.get(safeContrast)?.get(mode)
    val semantics = snapshot?.semantic?.get(safeContrast)?.get(mode)
    // Compiled defaults only. The legacy RemoteTheme layer that used to sit here
    // applied ten roles and was then overwritten wholesale by withSnapshot, which
    // sets all thirty-six — so whenever the server sent a v2 snapshot its work was
    // discarded. It survived for clients below versionCode 2, and the app is at 2
    // with no Play release, so that install base is internal testers on an older
    // build who can update.
    //
    // It also carried the only client-side contrast guard. That is not lost: the
    // Worker refuses to store a revision whose contrast fails, returning 422 from
    // admin-theme.ts, so no failing scheme can reach a device to be guarded from.
    val fallback = if (darkTheme) OrderakDarkColorScheme else OrderakLightColorScheme
    val colorScheme = fallback.withSnapshot(roles)
    val extended = remoteExtended(semantics, roles)
    val spacing = remoteSpacing(snapshot)

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
    ) {
        MaterialTheme(
            colorScheme = colorScheme,
            typography = OrderakTypography.withRemote(snapshot?.typography),
            shapes = remoteShapes(snapshot?.shapes),
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
@Preview(name = "Light Theme", showBackground = true, backgroundColor = 0xFFF8FAFC)
@Composable
private fun PreviewOrderakLightTheme() {
    OrderakTheme(darkTheme = false) {
        ThemePreviewContent()
    }
}

@Preview(name = "Dark Theme", showBackground = true, backgroundColor = 0xFF0F172A)
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
