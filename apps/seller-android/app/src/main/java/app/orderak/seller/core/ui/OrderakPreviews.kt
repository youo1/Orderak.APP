package app.orderak.seller.core.ui

import androidx.compose.ui.tooling.preview.Preview

/** Standard locale matrix for reusable Compose previews. */
@Preview(name = "English", locale = "en")
@Preview(name = "Arabic RTL", locale = "ar")
@Preview(name = "French", locale = "fr")
@Preview(name = "Expanded pseudo", locale = "en-rXA")
@Preview(name = "RTL pseudo", locale = "ar-rXB")
annotation class OrderakLocalePreviews

/** Stable host-rendered matrix; pseudolocales remain covered on device. */
@Preview(name = "English", locale = "en")
@Preview(name = "Arabic RTL", locale = "ar")
@Preview(name = "French", locale = "fr")
annotation class OrderakShippedLocalePreviews
