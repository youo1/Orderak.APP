package app.orderak.seller.core.ui

import app.orderak.seller.a11y.SourceDeclarations
import java.io.File
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * Locks the overlay kit's state vocabulary to the preview names the screenshot
 * references carry.
 *
 * An earlier attempt at this kit called `SnackbarState.valueOf("FailureRetry")`
 * from a preview named for a state called `FailureWithRetry`, and it threw at
 * run time. Here every preview's state name must be an entry of its enum, and
 * every entry must have a preview, in both directions.
 *
 * The enums are reached by reflection so this file compiles on a tree that has
 * none of them yet and fails by assertion there.
 */
class SheetKitStatesAcceptanceTest {

    private fun entries(className: String): List<String> {
        val type = try {
            Class.forName("app.orderak.seller.core.ui.$className")
        } catch (error: ClassNotFoundException) {
            throw AssertionError("Expected $className to exist as the overlay kit's state enum", error)
        }
        val constants = type.enumConstants
            ?: throw AssertionError("Expected $className to be an enum class")
        return constants.map { (it as Enum<*>).name }
    }

    @Test
    fun snackbarStateDeclaresExactlyTheThreeApprovedStates() {
        assertEquals(listOf("Undo", "FailureWithRetry", "NoAction"), entries("SnackbarState"))
    }

    @Test
    fun confirmSheetStateDeclaresExactlyTheThreeApprovedStates() {
        assertEquals(listOf("Destructive", "Regular", "InProgress"), entries("ConfirmSheetState"))
    }

    @Test
    fun pickerSheetModeDeclaresExactlyTheTwoApprovedModes() {
        assertEquals(listOf("SingleChoice", "SearchableWithManualEntry"), entries("PickerSheetMode"))
    }

    private val previews: List<String> by lazy {
        SourceDeclarations.all
            .filter { it.facade == "SheetOverlayScreenshotTestKt" }
            .map { it.function }
            .also { assertTrue("SheetOverlayScreenshotTest declares no @PreviewTest", it.isNotEmpty()) }
    }

    private fun assertPreviewsMatch(prefix: String, enumName: String) {
        val names = entries(enumName)
        val expected = names.map { prefix + it }.toSet()
        val actual = previews.filter { it.startsWith(prefix) }.toSet()
        assertEquals("Previews for $enumName must be $prefix + each entry", expected, actual)
        for (preview in actual) {
            val suffix = preview.removePrefix(prefix)
            assertTrue("$preview names no entry of $enumName", suffix in names)
        }
    }

    @Test
    fun everySnackbarPreviewIsNamedForAStateAndEveryStateHasOne() =
        assertPreviewsMatch("snackbar", "SnackbarState")

    @Test
    fun everyConfirmSheetPreviewIsNamedForAStateAndEveryStateHasOne() =
        assertPreviewsMatch("confirmSheet", "ConfirmSheetState")

    @Test
    fun everyPickerSheetPreviewIsNamedForAModeAndEveryModeHasOne() =
        assertPreviewsMatch("pickerSheet", "PickerSheetMode")

    @Test
    fun theBottomSheetActionListHasItsOwnPreview() {
        assertTrue("bottomSheetActions preview is missing: $previews", "bottomSheetActions" in previews)
    }

    @Test
    fun theKitDoesNotHostItsSheetsInAModalBottomSheetWindow() {
        // A ModalBottomSheet composes into a separate window that the screenshot
        // harness does not capture (see LanguageSheet.kt), so the kit draws the
        // sheet itself and the screen that adopts it owns the host.
        val root = File("src/main/java/app/orderak/seller/core/ui")
        for (name in listOf("SheetComponents.kt", "SnackbarComponent.kt")) {
            val file = File(root, name)
            assertTrue("Expected ${file.path} to exist", file.isFile)
            val code = file.readLines().filterNot { it.trimStart().startsWith("*") || it.trimStart().startsWith("//") }
            assertTrue(
                "$name must not call ModalBottomSheet",
                code.none { "ModalBottomSheet" in it },
            )
        }
    }
}
