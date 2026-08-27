package app.orderak.seller.data.theme

/** Formal accessibility precedence: standard < medium < high. */
internal fun selectHighestContrast(vararg values: String): String {
    val order = mapOf("standard" to 0, "medium" to 1, "high" to 2)
    return values.maxByOrNull { order[it] ?: 0 }?.takeIf(order::containsKey) ?: "standard"
}

/**
 * The contrast level the platform is asking for.
 *
 * `UiModeManager.getContrast()` (API 34+) reports a float, which is the only
 * source that can distinguish *medium* from *high* — the generator emits all
 * three levels, so on older releases the Settings.Secure flag is still read to
 * catch users who asked for high-contrast text.
 */
internal fun systemContrastLevel(
    uiModeContrast: Float?,
    highTextContrastEnabled: Boolean,
): String = when {
    uiModeContrast != null && uiModeContrast >= 0.66f -> "high"
    uiModeContrast != null && uiModeContrast >= 0.33f -> "medium"
    highTextContrastEnabled -> "high"
    else -> "standard"
}
