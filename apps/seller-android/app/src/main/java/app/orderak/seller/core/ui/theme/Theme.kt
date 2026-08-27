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
)

val LocalOrderakSpacing = staticCompositionLocalOf { OrderakSpacing() }

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
@Preview(name = "Light Theme", showBackground = true, backgroundColor = 0xFFF3FBFA)
@Composable
private fun PreviewOrderakLightTheme() {
    OrderakTheme(darkTheme = false) {
        ThemePreviewContent()
    }
}

@Preview(name = "Dark Theme", showBackground = true, backgroundColor = 0xFF0D1514)
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
