package app.orderak.seller.core.ui.theme

import androidx.compose.ui.graphics.Color

// ============================================================
// 1. Primitive Palette — "Navy + Gold" brand colors
//    Naming convention: {Hue}{Strength} for brand colors,
//    {Hue}{Weight} for neutrals (like Tailwind CSS).
// ============================================================

// -- Brand Navy ------------------------------------------------
val NavyPrimary = Color(0xFF1E3A8A)       // 10.4:1 contrast on white
val NavyStrong = Color(0xFF14275C)        // Pressed / active states
val NavySoft = Color(0xFFEEF2FF)          // Containers, chips, soft surfaces
val NavyTint = Color(0xFF3B5BA9)          // Icons, secondary accents

// -- Brand Gold -------------------------------------------------
val GoldPrimary = Color(0xFFD4A017)       // Badges, highlights, CTAs
val GoldSoft = Color(0xFFFDF7E8)          // Subtle gold surface (banners, chips)

// -- Neutral Slate (cool gray) ----------------------------------
val NeutralWhite = Color(0xFFFFFFFF)       // Pure white for cards
val Slate50 = Color(0xFFF8FAFC)           // Light app background
val Slate100 = Color(0xFFF1F5F9)          // Light surface variant (inputs, cards)
val Slate200 = Color(0xFFE2E8F0)          // Borders, dividers
val Slate400 = Color(0xFF94A3B8)          // Disabled text, placeholder
val Slate700 = Color(0xFF334155)          // Muted / secondary text
val Slate800 = Color(0xFF1E293B)          // Dark elevated surface
val Slate900 = Color(0xFF0F172A)          // Dark app background
val InkDark = Color(0xFF14141F)           // Primary text on light surfaces (near-black)

// -- Status -----------------------------------------------------
val Danger = Color(0xFFDC2626)            // Destructive actions, error text
val DangerSoft = Color(0xFFFEF2F2)        // Error containers
val DangerOnContainer = Color(0xFF991B1B) // onErrorContainer (darker red for contrast)
val Warning = Color(0xFFD97706)           // Warnings, attention
val WarningSoft = Color(0xFFFFFBEB)       // Warning containers
val Success = Color(0xFF10B981)           // Positive / success
val SuccessSoft = Color(0xFFECFDF5)       // Success containers

// ============================================================
// 2. Dark-Theme Semantic Tokens
//    Every token carries its own WCAG AA (≥4.5:1) contrast
//    against its intended background.
// ============================================================

// -- Primary ----------------------------------------------------
val DarkPrimary = Color(0xFF818CF8)            // Indigo-400, readable on dark
val DarkOnPrimary = Color(0xFF0A1A4A)          // 9.2:1 on DarkPrimary
val DarkPrimaryContainer = Color(0xFF1E293B)   // Slate-800 container
val DarkOnPrimaryContainer = Color(0xFFC7D2FE) // Indigo-200, 6.1:1 on container

// -- Secondary (gold on dark) -----------------------------------
val DarkSecondary = Color(0xFFFBBF24)           // Amber-400 (brighter gold for dark)
val DarkOnSecondary = Color(0xFF1E1B4B)         // Very dark navy, 7.7:1 on DarkSecondary
val DarkSecondaryContainer = Color(0xFF4A3A00)  // Deep bronze
val DarkOnSecondaryContainer = Color(0xFFFDE68A) // Amber-200

// -- Tertiary (teal accent, distinct from gold) -----------------
val DarkTertiary = Color(0xFF5EEAD4)            // Teal-300
val DarkOnTertiary = Color(0xFF134E4A)          // Dark teal
val DarkTertiaryContainer = Color(0xFF134E4A)
val DarkOnTertiaryContainer = Color(0xFF99F6E4)

// -- Surfaces ---------------------------------------------------
val DarkBackground = Slate900                    // App background
val DarkOnBackground = Slate50                   // 12.6:1
val DarkSurface = Slate800                       // Elevated cards
val DarkOnSurface = Slate50                      // 12.6:1
val DarkSurfaceVariant = Slate700                // Inputs, chips
val DarkOnSurfaceVariant = Slate200              // 5.6:1

// -- Outlines ---------------------------------------------------
val DarkOutline = Slate700
val DarkOutlineVariant = Color(0xFF334155)       // Same as Slate700

// -- Error ------------------------------------------------------
val DarkError = Color(0xFFF87171)                // Red-400
val DarkOnError = Color(0xFF450A0A)              // 8.6:1
val DarkErrorContainer = Color(0xFF7F1D1D)       // Red-900
val DarkOnErrorContainer = Color(0xFFFEF2F2)     // 12.4:1 on container

// -- Inverse ----------------------------------------------------
val DarkInverseSurface = Slate50
val DarkInverseOnSurface = Slate900
val DarkInversePrimary = NavyPrimary             // NavyPrimary on light inverse surface

// -- Utility ----------------------------------------------------
val DarkSurfaceTint = DarkPrimary
val DarkScrim = Color(0xFF000000)                // Standard black scrim

// ============================================================
// 3. Light-Theme Semantic Tokens
//    (Most are defined directly in the ColorScheme; these are
//     only tokens that don't directly map 1:1 to a primitive.)
// ============================================================

// -- Secondary (gold on light) containers -----------------------
val LightSecondaryContainer = GoldSoft            // Soft gold
val LightOnSecondaryContainer = Color(0xFF4A3A00) // Dark bronze, 6.3:1 on GoldSoft

// -- Tertiary (teal) --------------------------------------------
val LightTertiary = Color(0xFF0F766E)             // Teal-700
val LightOnTertiary = Color.White
val LightTertiaryContainer = Color(0xFFCCFBF1)    // Teal-50
val LightOnTertiaryContainer = Color(0xFF134E4A)

// -- Inverse ----------------------------------------------------
val LightInverseSurface = Slate900
val LightInverseOnSurface = Slate50
val LightInversePrimary = DarkPrimary             // Indigo-400 on dark inverse

// -- Utility ----------------------------------------------------
val LightSurfaceTint = NavyPrimary
val LightScrim = Color(0xFF000000)

// ============================================================
// 4. Extended Colors (roles without a stock M3 ColorScheme slot)
// ============================================================
data class OrderakExtendedColors(
    val warning: Color = Warning,
    val warningSoft: Color = WarningSoft,
    val onWarning: Color = InkDark,
    val accent: Color = GoldPrimary,
    val onAccent: Color = InkDark,
    val primaryTint: Color = NavyTint,
    val success: Color = Success,
    val successSoft: Color = SuccessSoft,
    val onSuccess: Color = Color.White,
    val onWarningContainer: Color = InkDark,
    val onSuccessContainer: Color = InkDark,
    val information: Color = NavyTint,
    val informationSoft: Color = NavySoft,
    val onInformation: Color = Color.White,
    val onInformationContainer: Color = NavyStrong,
)
