package app.orderak.seller.data.billing

import org.junit.Assert.assertTrue
import org.junit.Assume.assumeTrue
import org.junit.Test
import java.io.File

/**
 * Every place that offers a purchase has to ask the same question first.
 *
 * `isPurchaseOpen()` is the one authoritative client-side answer (I-5) and it is
 * unit-tested next door. What that test cannot say is whether anything CONSULTS
 * it — and the gap was real: the account surface drew a purchase button per plan
 * on two conditions, "an Activity exists" and "the Play catalogue returned
 * products", neither of which is permission. It was safe only because
 * BILLING_ENABLED is false, so the catalogue came back empty and no button drew.
 * Safe by accident, on a server response rather than on a decision the client
 * owns, and it would have gone live the moment billing opened.
 *
 * A composable is awkward to unit-test and the invariant is structural, so this
 * reads the sources. It is a blunt instrument on purpose: it does not check that
 * the gate is correct — the other tests do that — only that no purchase surface
 * forgets to ask. A new upgrade affordance added to a file not listed here is
 * the case this cannot catch, which is why the list is asserted to be non-empty
 * and each file is checked for the affordance it is supposed to have.
 */
class PurchaseEntryPointsTest {

    /** The app's Kotlin source root, whichever directory Gradle started us in. */
    private fun sourceRoot(): File? {
        var dir: File? = File("").absoluteFile
        while (dir != null) {
            val candidate = File(dir, "app/src/main/java/app/orderak/seller")
            if (candidate.isDirectory) return candidate
            val nested = File(dir, "apps/seller-android/app/src/main/java/app/orderak/seller")
            if (nested.isDirectory) return nested
            dir = dir.parentFile
        }
        return null
    }

    private fun read(relative: String): String? = sourceRoot()?.resolve(relative)?.takeIf(File::isFile)?.readText()

    /**
     * Files that put a purchase or upgrade affordance in front of a seller,
     * paired with a marker proving the affordance is still there. The marker
     * keeps the test honest: if the control is removed the file stops needing a
     * gate, and this should be updated deliberately rather than passing quietly.
     */
    private val purchaseSurfaces = listOf(
        Triple(
            "feature/settings/SettingsScreen.kt",
            "launches the Play billing flow for a plan",
            "viewModel.purchase(",
        ),
        Triple(
            "feature/operations/OperationsScreens.kt",
            "offers Play guidance and purchase recovery",
            "recoverPurchases",
        ),
        Triple(
            "feature/products/ProductsScreen.kt",
            "offers an upgrade when the product limit is reached",
            "isPurchaseOpen",
        ),
        Triple(
            "feature/settings/CategoriesScreen.kt",
            "offers an upgrade when the category limit is reached",
            "isPurchaseOpen",
        ),
    )

    @Test
    fun `every purchase surface consults the purchase-open decision`() {
        val root = sourceRoot()
        assumeTrue("app sources not reachable from the test working directory", root != null)
        assertTrue("no purchase surfaces listed", purchaseSurfaces.isNotEmpty())

        for ((path, what, affordanceMarker) in purchaseSurfaces) {
            val source = read(path)
            assertTrue("$path is missing", source != null)
            assertTrue(
                "$path no longer $what — update this list deliberately",
                source!!.contains(affordanceMarker),
            )
            assertTrue(
                "$path $what without consulting isPurchaseOpen",
                source.contains("isPurchaseOpen") || source.contains("purchaseOpen"),
            )
        }
    }

    @Test
    fun `only one place decides`() {
        // A second implementation is how two surfaces come to disagree. The
        // decision is defined once, in Entitlements.kt, and read everywhere else.
        val root = sourceRoot()
        assumeTrue("app sources not reachable from the test working directory", root != null)

        val definitions = root!!.walkTopDown()
            .filter { it.isFile && it.extension == "kt" }
            .filter { it.readText().contains("fun isPurchaseOpen(") }
            .map { it.name }
            .toList()

        assertTrue("expected exactly one definition, found $definitions", definitions == listOf("Entitlements.kt"))
    }

    @Test
    fun `the account surface gates the button and the action behind it`() {
        val root = sourceRoot()
        assumeTrue("app sources not reachable from the test working directory", root != null)
        val source = read("feature/settings/SettingsScreen.kt")!!

        // The button, so nothing is offered that cannot complete.
        assertTrue(
            "the plan buttons render without checking purchaseOpen",
            source.contains("if (purchaseOpen && activity != null"),
        )
        // And the action, because the composition that drew the button can be
        // older than the snapshot that closed purchasing.
        assertTrue(
            "purchase() launches the billing flow without checking",
            source.substringAfter("fun purchase(").substringBefore("}")
                .contains("isPurchaseOpen()"),
        )
    }
}
