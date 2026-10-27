// Retained for one Compose internal: androidx.compose.runtime.reflect.
// ComposableMethod.invoke, the way the accessibility audit also reaches a
// zero-argument preview function. Remove the suppression only if this file
// compiles without it.
@file:Suppress("INVISIBLE_REFERENCE", "INVISIBLE_MEMBER")
@file:OptIn(androidx.compose.runtime.InternalComposeApi::class)

package app.orderak.seller.core.ui

import android.app.Application
import android.content.res.Configuration
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.runtime.currentComposer
import androidx.compose.runtime.reflect.getDeclaredComposableMethod
import androidx.compose.ui.platform.LocalConfiguration
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.test.SemanticsNodeInteraction
import androidx.compose.ui.test.junit4.ComposeContentTestRule
import androidx.compose.ui.test.onNodeWithTag
import androidx.compose.ui.unit.Density
import androidx.test.core.app.ApplicationProvider

/**
 * Composes one named preview of the overlay kit at a font scale.
 *
 * The previews are the kit's own approved states, so a layout rule tested on
 * them is a rule about the pixels the references show. The class is loaded by
 * name so a test file using this compiles on a tree where the previews do not
 * exist yet.
 */
internal fun ComposeContentTestRule.showSheetPreview(function: String, fontScale: Float) {
    val application = ApplicationProvider.getApplicationContext<Application>()
    val composable = Class.forName("app.orderak.seller.core.ui.SheetOverlayScreenshotTestKt")
        .getDeclaredComposableMethod(function)
    setContent {
        val configuration = Configuration(application.resources.configuration).apply {
            this.fontScale = fontScale
        }
        CompositionLocalProvider(
            LocalConfiguration provides configuration,
            LocalDensity provides Density(application.resources.displayMetrics.density, fontScale),
        ) {
            composable.invoke(currentComposer, null)
        }
    }
    waitForIdle()
}

internal fun ComposeContentTestRule.tagged(tag: String): SemanticsNodeInteraction =
    onNodeWithTag(tag, useUnmergedTree = true)
