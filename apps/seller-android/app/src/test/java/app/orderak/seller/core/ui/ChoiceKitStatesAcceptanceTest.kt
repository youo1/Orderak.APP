package app.orderak.seller.core.ui

import app.orderak.seller.a11y.SourceDeclarations
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * Locks the ImagePickerTile's states to its previews: every entry has a preview
 * named for it, and every `imagePickerTile` preview names an entry. (Reached by
 * reflection, so the test compiles on a tree without the enum.)
 */
class ChoiceKitStatesAcceptanceTest {

    private fun entries(): List<String> {
        val type = try {
            Class.forName("app.orderak.seller.core.ui.ImagePickerState")
        } catch (error: ClassNotFoundException) {
            throw AssertionError("Expected ImagePickerState to exist", error)
        }
        return type.enumConstants.map { (it as Enum<*>).name }
    }

    @Test
    fun imagePickerStateDeclaresExactlyTheFourApprovedStates() {
        assertEquals(listOf("Placeholder", "Preview", "Uploading", "FailedWithRetry"), entries())
    }

    @Test
    fun everyImagePickerPreviewIsNamedForAStateAndEveryStateHasOne() {
        val previews = SourceDeclarations.all
            .filter { it.facade == "ChoiceFieldScreenshotTestKt" }
            .map { it.function }
        assertTrue("ChoiceFieldScreenshotTest declares no @PreviewTest", previews.isNotEmpty())
        val names = entries()
        val expected = names.map { "imagePickerTile$it" }.toSet()
        val actual = previews.filter { it.startsWith("imagePickerTile") }.toSet()
        assertEquals(expected, actual)
    }
}
