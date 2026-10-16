// Retained because androidx.compose.runtime.reflect.ComposableMethod.invoke is
// exposed only through internal Kotlin metadata; without these suppressions the
// compiler reports the call as an invisible reference/member. Remove them only
// if the file compiles without them.
@file:Suppress("INVISIBLE_REFERENCE", "INVISIBLE_MEMBER")
@file:OptIn(
    androidx.compose.runtime.InternalComposeApi::class,
    androidx.compose.ui.ExperimentalComposeUiApi::class,
    androidx.compose.ui.test.ExperimentalTestApi::class,
    androidx.compose.ui.text.ExperimentalTextApi::class,
    androidx.compose.ui.unit.ExperimentalUnitApi::class,
)
package app.orderak.seller.a11y
import android.app.Application
import android.content.Context
import android.content.res.Configuration
import android.view.View
import androidx.activity.compose.LocalActivityResultRegistryOwner
import androidx.activity.compose.LocalOnBackPressedDispatcherOwner
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.size
import androidx.compose.material3.Text
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.runtime.currentComposer
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.reflect.getDeclaredComposableMethod
import androidx.compose.ui.graphics.asAndroidBitmap
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalConfiguration
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.LocalLayoutDirection
import androidx.compose.ui.platform.LocalResources
import androidx.compose.ui.semantics.SemanticsActions
import androidx.compose.ui.semantics.SemanticsNode
import androidx.compose.ui.semantics.SemanticsProperties
import androidx.compose.ui.semantics.getOrNull
import androidx.compose.ui.test.captureToImage
import androidx.compose.ui.test.isRoot
import androidx.compose.ui.test.junit4.ComposeTestRule
import androidx.compose.ui.test.junit4.createComposeRule
import androidx.compose.ui.text.LinkAnnotation
import androidx.compose.ui.text.TextLayoutResult
import androidx.compose.ui.text.buildAnnotatedString
import androidx.compose.ui.text.withLink
import androidx.compose.ui.unit.LayoutDirection
import androidx.compose.ui.unit.dp
import androidx.test.core.app.ApplicationProvider
import androidx.test.ext.junit.runners.AndroidJUnit4
import com.google.android.apps.common.testing.accessibility.framework.utils.contrast.BitmapImage
import com.google.android.apps.common.testing.accessibility.framework.utils.contrast.ContrastSwatch
import java.io.File
import java.util.Locale
import kotlin.math.ceil
import kotlin.math.floor
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.ParameterizedRobolectricTestRunner
import org.robolectric.annotation.Config
import org.robolectric.annotation.GraphicsMode
@RunWith(ParameterizedRobolectricTestRunner::class)
@GraphicsMode(GraphicsMode.Mode.NATIVE)
@Config(sdk = [35], qualifiers = "ar-w411dp-h891dp-xxhdpi", application = Application::class)
class AccessibilityPreviewAuditTest(private val caseName: String) {
    @get:Rule
    val rule = createComposeRule()
    @Test
    fun auditsPreviewState() {
        auditPreview(caseName)
    }
    private fun collectTexts(rule: ComposeTestRule): Set<String> {
        val texts = linkedSetOf<String>()
        val roots = rule.onAllNodes(isRoot(), useUnmergedTree = false).fetchSemanticsNodes()
        for (root in roots) {
            fun visit(node: SemanticsNode) {
                node.config.getOrNull(SemanticsProperties.Text)?.forEach { texts += it.text }
                node.children.forEach { visit(it) }
            }
            visit(root)
        }
        return texts
    }
    private fun auditPreview(caseName: String) {
        val facade = caseName.substringBefore(' ')
        val function = caseName.substringAfter(' ')
        val declaration = SourceDeclarations.byId("$facade.$function")
            ?: error("No parsed source @PreviewTest declaration for $facade.$function")
        val facadeClass = Class.forName(declaration.qualifiedFacade, false, javaClass.classLoader)
        val composable = facadeClass.getDeclaredComposableMethod(function)
        val application = ApplicationProvider.getApplicationContext<Context>()
        val variantState = mutableStateOf(declaration.locales.first())
        rule.setContent {
            val localeTag = variantState.value
            val configuration = Configuration(application.resources.configuration).apply {
                setLocale(localeFromTag(localeTag))
            }
            val localeContext = application.createConfigurationContext(configuration)
            val layoutDirection =
                if (configuration.getLayoutDirection() == View.LAYOUT_DIRECTION_RTL) {
                    LayoutDirection.Rtl
                } else {
                    LayoutDirection.Ltr
                }
            val activityResultRegistryOwner = requireNotNull(LocalActivityResultRegistryOwner.current) {
                "the test activity must provide an ActivityResultRegistryOwner"
            }
            val onBackPressedDispatcherOwner = requireNotNull(LocalOnBackPressedDispatcherOwner.current) {
                "the test activity must provide an OnBackPressedDispatcherOwner"
            }
            CompositionLocalProvider(
                LocalConfiguration provides configuration,
                LocalContext provides localeContext,
                LocalResources provides localeContext.resources,
                LocalLayoutDirection provides layoutDirection,
                LocalActivityResultRegistryOwner provides activityResultRegistryOwner,
                LocalOnBackPressedDispatcherOwner provides onBackPressedDispatcherOwner,
            ) {
                composable.invoke(currentComposer, null)
            }
        }
        val textsByLocale = linkedMapOf<String, Set<String>>()
        val allDiagnostics = mutableListOf<String>()
        for (localeTag in declaration.locales) {
            variantState.value = localeTag
            rule.waitForIdle()
            textsByLocale[localeTag] = collectTexts(rule)
            val diagnostics = auditAccessibility(rule, "${declaration.id} [$localeTag]")
            for (diagnostic in diagnostics) {
                assertTrue("Diagnostic must name the preview: $diagnostic", declaration.id in diagnostic)
                assertTrue("Diagnostic must name a rule: $diagnostic", RULES.any { it in diagnostic })
                allDiagnostics += diagnostic
            }
        }
        val unknown = allDiagnostics.filterNot { diagnostic ->
            KNOWN_FINDINGS.any { it.matches(diagnostic) }
        }
        assertTrue(
            "Accessibility findings for ${declaration.id}:\n" + unknown.joinToString("\n"),
            unknown.isEmpty(),
        )
        val stale = KNOWN_FINDINGS.filter { entry ->
            entry.preview == declaration.id &&
                allDiagnostics.none { diagnostic -> entry.matches(diagnostic) }
        }
        if (stale.isNotEmpty()) {
            println(
                "KNOWN_FINDINGS entries for ${declaration.id} no longer occur (remove them): " +
                    stale.joinToString("; ") { "${it.rule}: ${it.needle}" },
            )
        }
        val english = textsByLocale["en"]
        val arabic = textsByLocale["ar"]
        if (english != null && arabic != null) {
            assertTrue(
                "The locale host did not switch en/ar strings for ${declaration.id}",
                english != arabic,
            )
        }
    }
    companion object {
        private val RULES = listOf("Label", "Target", "Contrast")
        @JvmStatic
        @ParameterizedRobolectricTestRunner.Parameters(name = "{0}")
        fun previewCases(): List<Array<Any>> =
            SourceDeclarations.all.map { arrayOf<Any>("${it.facade} ${it.function}") }
    }
}
@RunWith(AndroidJUnit4::class)
@GraphicsMode(GraphicsMode.Mode.NATIVE)
@Config(sdk = [35], qualifiers = "ar-w411dp-h891dp-xxhdpi", application = Application::class)
class AccessibilityAuditHarnessTest {
    @get:Rule
    val rule = createComposeRule()
    @Test
    fun sourceAnnotationCountMatchesAuditedCases() {
        val declarations = SourceDeclarations.all
        val observed = declarations.size
        val files = declarations.map { it.file }.distinct().size
        val estimate = 320
        val cases = AccessibilityPreviewAuditTest.previewCases().map { it[0].toString() }
        println(
            "Accessibility preview audit: observed $observed @PreviewTest annotations in " +
                "$files source files; manager estimate ~$estimate; " +
                "discrepancy ${estimate - observed}; audited cases ${cases.size}",
        )
        assertEquals("Every source @PreviewTest declaration must be audited", observed, cases.size)
        for (declaration in declarations) {
            assertTrue(
                "No audit case for ${declaration.id}",
                cases.any {
                    declaration.facade in it &&
                        Regex("\\b${Regex.escape(declaration.function)}\\b").containsMatchIn(it)
                },
            )
        }
    }
    @Test
    fun inlineTextLinkIsNamedByItsLinkedText() {
        rule.setContent {
            Text(
                buildAnnotatedString {
                    append("اقرأ ")
                    withLink(LinkAnnotation.Url("https://orderak.app/terms")) {
                        append("الشروط والأحكام")
                    }
                },
            )
        }
        rule.waitForIdle()
        val findings = auditAccessibility(rule, "proofInlineTextLink")
            .filter { "Label:" in it || "Target:" in it }
        assertTrue(
            "An inline text link is named by the linked text and exempt from Target: $findings",
            findings.isEmpty(),
        )
    }
    @Test
    fun iconOnlyClickableBesideLinkStillFailsLabel() {
        rule.setContent {
            Column {
                Text(
                    buildAnnotatedString {
                        withLink(LinkAnnotation.Url("https://orderak.app/terms")) {
                            append("الشروط والأحكام")
                        }
                    },
                )
                Box(Modifier.size(24.dp).clickable {})
            }
        }
        rule.waitForIdle()
        val labels = auditAccessibility(rule, "proofIconOnlyBesideLink").filter { "Label:" in it }
        assertTrue("An icon-only clickable must still be reported: $labels", labels.isNotEmpty())
    }
}
private data class KnownFinding(
    val preview: String,
    val rule: String,
    val needle: String,
    val reason: String,
    val plan: String,
) {
    fun matches(diagnostic: String): Boolean =
        diagnostic.startsWith("$preview ") &&
            "$rule:" in diagnostic &&
            (needle.isEmpty() || needle in diagnostic)
}
private data class KnownKind(val reason: String, val plan: String)
private val KNOWN_KINDS: Map<String, KnownKind> = mapOf(
    "TS" to KnownKind("Touch target is below the 48dp minimum", "B5: enlarge the kit control to a 48dp target"),
    "CF" to KnownKind("Field label colour is below the 4.5:1 threshold", "R1: use the accessible onSurfaceVariant token"),
    "CS" to KnownKind("Stepper glyph contrast is below the 3:1 threshold", "B5: raise the stepper glyph token contrast"),
    "CD" to KnownKind("Dialog window not captured under Robolectric", "R1: audit dialog window capture and colour tokens"),
    "CG" to KnownKind("Text colour is below the WCAG threshold", "R1: use the accessible design-system colour token"),
    "CO" to KnownKind("Text crop is outside the captured frame in this preview", "R1: keep the audited text node inside the visible frame"),
)
private val KNOWN_FINDINGS: List<KnownFinding> = """
        CD|ProductEditScreenshotTestKt.productEditConfirmDelete|Contrast|text "إلغاء"
        CD|ProductEditScreenshotTestKt.productEditConfirmDelete|Contrast|text "امسح المنتج"
        CD|ProductEditScreenshotTestKt.productEditConfirmDelete|Contrast|text "تحذف المنتج؟ مش هينفع ترجّعه بعد كده."
        CD|ProductEditScreenshotTestKt.productEditConfirmDelete|Contrast|text "حذف"
        CD|ProductEditScreenshotTestKt.productEditStockConflictDark|Contrast|text "اكتب ١٢ برضه"
        CD|ProductEditScreenshotTestKt.productEditStockConflictDark|Contrast|text "انت كتبت ١٢، والمحل دلوقتي عنده ٩ — جه طلب وانت بتعدّل. باقي تعديلاتك اتحفظت."
        CD|ProductEditScreenshotTestKt.productEditStockConflictDark|Contrast|text "خليها ٩"
        CD|ProductEditScreenshotTestKt.productEditStockConflict|Contrast|text "اكتب ١٢ برضه"
        CD|ProductEditScreenshotTestKt.productEditStockConflict|Contrast|text "انت كتبت ١٢، والمحل دلوقتي عنده ٩ — جه طلب وانت بتعدّل. باقي تعديلاتك اتحفظت."
        CD|ProductEditScreenshotTestKt.productEditStockConflict|Contrast|text "خليها ٩"
        CF|AccountScreenshotTestKt.accountContentLight|Contrast|text "رقم فودافون كاش"
        CF|AccountScreenshotTestKt.accountLoadingLight|Contrast|text "رقم فودافون كاش"
        CF|AuthScreenshotTestKt.authOtpDark|Contrast|text "رقم الموبايل"
        CF|AuthScreenshotTestKt.authOtpExpired|Contrast|text "رقم الموبايل"
        CF|AuthScreenshotTestKt.authOtpLight|Contrast|text "رقم الموبايل"
        CF|AuthScreenshotTestKt.authOtpResendable|Contrast|text "رقم الموبايل"
        CF|AuthScreenshotTestKt.authOtpVerifying|Contrast|text "رقم الموبايل"
        CF|AuthScreenshotTestKt.authOtpWrongCodeDark|Contrast|text "رقم الموبايل"
        CF|AuthScreenshotTestKt.authOtpWrongCode|Contrast|text "رقم الموبايل"
        CF|AuthScreenshotTestKt.authPhoneSendingDark|Contrast|text "رقم الموبايل"
        CF|AuthScreenshotTestKt.authPhoneSending|Contrast|text "رقم الموبايل"
        CF|StoreGroupScreenshotTestKt.sellerProfileContentDark|Contrast|text "رقم الهاتف (معرف الحساب)"
        CF|StoreGroupScreenshotTestKt.sellerProfileContentLight|Contrast|text "رقم الهاتف (معرف الحساب)"
        CF|StoreGroupScreenshotTestKt.sellerProfilePhotoUploadFailed|Contrast|text "رقم الهاتف (معرف الحساب)"
        CF|StoreGroupScreenshotTestKt.sellerProfileSaving|Contrast|text "رقم الهاتف (معرف الحساب)"
        CF|StoreGroupScreenshotTestKt.sellerProfileVerificationError|Contrast|text "رقم الهاتف (معرف الحساب)"
        CS|OrderScreensScreenshotTestKt.newOrderContentDark|Contrast|text "−"
        CS|OrderScreensScreenshotTestKt.newOrderContentLight|Contrast|text "−"
        CS|OrderScreensScreenshotTestKt.newOrderFilled|Contrast|text "+"
        CS|OrderScreensScreenshotTestKt.newOrderPhoneInvalid|Contrast|text "−"
        CS|OrderScreensScreenshotTestKt.newOrderSaving|Contrast|text "−"
        CS|OrderScreensScreenshotTestKt.newOrderStockErrorDark|Contrast|text "+"
        CS|OrderScreensScreenshotTestKt.newOrderStockErrorDark|Contrast|text "−"
        CS|OrderScreensScreenshotTestKt.newOrderStockErrorLight|Contrast|text "+"
        CS|OrderScreensScreenshotTestKt.newOrderStockErrorLight|Contrast|text "−"
        TS|OrdersScreenshotTestKt.ordersBothGroupsDark|Target|touch target
        TS|OrdersScreenshotTestKt.ordersBothGroupsLight|Target|touch target
        TS|OrdersScreenshotTestKt.ordersContentDark|Target|touch target
        TS|OrdersScreenshotTestKt.ordersContentLight|Target|touch target
        TS|OrdersScreenshotTestKt.ordersErrorDark|Target|touch target
        TS|OrdersScreenshotTestKt.ordersErrorLight|Target|touch target
        TS|OrdersScreenshotTestKt.ordersFilteredToNone|Target|touch target
        TS|OrdersScreenshotTestKt.ordersFilteredUnpaid|Target|touch target
        CO|AccountScreenshotTestKt.accountContentDark|Contrast|is outside the captured image
        CO|AccountScreenshotTestKt.accountContentLight|Contrast|is outside the captured image
        CO|AccountScreenshotTestKt.accountFreePlan|Contrast|is outside the captured image
        CO|AccountScreenshotTestKt.accountFreePlanUpgradable|Contrast|is outside the captured image
        CO|AccountScreenshotTestKt.accountLinkPending|Contrast|is outside the captured image
        CO|AccountScreenshotTestKt.accountLoadingDark|Contrast|is outside the captured image
        CO|AccountScreenshotTestKt.accountLoadingLight|Contrast|is outside the captured image
        CO|AuthScreenshotTestKt.authCountryPicker|Contrast|is outside the captured image
        CO|AuthScreenshotTestKt.authCountryPickerDark|Contrast|is outside the captured image
        CO|AuthScreenshotTestKt.authCountryPickerSearch|Contrast|is outside the captured image
        CO|BillingScreenshotTestKt.plansContentDark|Contrast|is outside the captured image
        CO|BillingScreenshotTestKt.plansContentLight|Contrast|is outside the captured image
        CO|BillingScreenshotTestKt.plansPurchaseOpen|Contrast|is outside the captured image
        CO|OrdersScreenshotTestKt.ordersBothGroupsDark|Contrast|is outside the captured image
        CO|OrdersScreenshotTestKt.ordersBothGroupsLight|Contrast|is outside the captured image
        CO|OrdersScreenshotTestKt.ordersContentDark|Contrast|is outside the captured image
        CO|OrdersScreenshotTestKt.ordersContentLight|Contrast|is outside the captured image
        CO|OrdersScreenshotTestKt.ordersErrorDark|Contrast|is outside the captured image
        CO|OrdersScreenshotTestKt.ordersErrorLight|Contrast|is outside the captured image
        CO|OrdersScreenshotTestKt.ordersFilteredToNone|Contrast|is outside the captured image
        CO|OrdersScreenshotTestKt.ordersFilteredUnpaid|Contrast|is outside the captured image
        CO|StoreGroupScreenshotTestKt.storeInfoContentDark|Contrast|is outside the captured image
        CO|StoreGroupScreenshotTestKt.storeInfoContentLight|Contrast|is outside the captured image
        CO|StoreGroupScreenshotTestKt.storeInfoIdentityLight|Contrast|is outside the captured image
        CO|StoreGroupScreenshotTestKt.storeInfoSaving|Contrast|is outside the captured image
        CO|StoreGroupScreenshotTestKt.storeInfoSlugTaken|Contrast|is outside the captured image
""".trimIndent().lines().filter { it.isNotBlank() }.map { line ->
    val parts = line.split("|", limit = 4)
    val kind = KNOWN_KINDS.getValue(parts[0])
    KnownFinding(
        preview = parts[1],
        rule = parts[2],
        needle = parts[3],
        reason = kind.reason,
        plan = kind.plan,
    )
}
fun auditAccessibility(rule: ComposeTestRule, preview: String): List<String> {
    val diagnostics = mutableListOf<String>()
    val density = rule.density.density
    val minimumTouchPx = 48f * density
    var skippedDisabled = 0
    var skippedEmptyTargets = 0
    val mergedRoots =
        rule.onAllNodes(isRoot(), useUnmergedTree = false).fetchSemanticsNodes()
    for (mergedRoot in mergedRoots) {
        val actionable = mutableListOf<SemanticsNode>()
        fun visitMerged(node: SemanticsNode) {
            val disabled = isDisabled(node)
            if (disabled) skippedDisabled++
            val emptySize = node.size.width == 0 || node.size.height == 0
            if (!disabled && !emptySize) {
                val clickable = node.config.getOrNull(SemanticsActions.OnClick) != null
                val toggleable = node.config.getOrNull(SemanticsProperties.ToggleableState) != null
                if (clickable || toggleable) {
                    actionable += node
                    val descriptions =
                        node.config.getOrNull(SemanticsProperties.ContentDescription).orEmpty()
                    val texts = node.config.getOrNull(SemanticsProperties.Text).orEmpty()
                    val labelled = (descriptions + texts.map { it.text }).any { it.isNotBlank() }
                    if (!labelled && !isInlineLink(node)) {
                        diagnostics += "$preview Label: actionable node at ${node.boundsInRoot} " +
                            "has no ContentDescription or Text"
                    }
                }
            }
            node.children.forEach { visitMerged(it) }
        }
        visitMerged(mergedRoot)
        val inlineLinkIds = actionable
            .filter { isInlineLink(it) }
            .map { it.id }
            .toHashSet()
        for (node in actionable) {
            if (node.id in inlineLinkIds) continue
            val touch = node.touchBoundsInRoot
            if (touch.width <= 0f || touch.height <= 0f) {
                skippedEmptyTargets++
                continue
            }
            if (touch.width < minimumTouchPx - 0.5f || touch.height < minimumTouchPx - 0.5f) {
                diagnostics += "$preview Target: touch target " +
                    "${touch.width / density}x${touch.height / density}dp at $touch is smaller than 48dp"
            }
        }
        for (first in actionable.indices) {
            for (second in first + 1 until actionable.size) {
                val a = actionable[first]
                val b = actionable[second]
                if (a.id in inlineLinkIds || b.id in inlineLinkIds) continue
                if (a.touchBoundsInRoot.width <= 0f || a.touchBoundsInRoot.height <= 0f ||
                    b.touchBoundsInRoot.width <= 0f || b.touchBoundsInRoot.height <= 0f
                ) {
                    continue
                }
                if (a.touchBoundsInRoot.overlaps(b.touchBoundsInRoot) &&
                    !isAncestor(a, b) &&
                    !isAncestor(b, a)
                ) {
                    diagnostics += "$preview Target: ${a.touchBoundsInRoot} overlaps ${b.touchBoundsInRoot}"
                }
            }
        }
    }
    val unmergedRoots = rule.onAllNodes(isRoot(), useUnmergedTree = true)
    val unmergedNodes = unmergedRoots.fetchSemanticsNodes()
    for (index in unmergedNodes.indices) {
        val bitmap = unmergedRoots[index].captureToImage().asAndroidBitmap()
        val atfImage = BitmapImage(bitmap)
        fun visitUnmerged(node: SemanticsNode) {
            val disabled = isDisabled(node)
            if (disabled) skippedDisabled++
            val emptySize = node.size.width == 0 || node.size.height == 0
            if (!disabled && !emptySize) {
                val content = node.config.getOrNull(SemanticsProperties.Text)
                    .orEmpty()
                    .joinToString(" ") { it.text }
                    .trim()
                if (content.isNotEmpty()) {
                    val bounds = node.boundsInRoot
                    val left = floor(bounds.left).toInt().coerceAtLeast(0)
                    val top = floor(bounds.top).toInt().coerceAtLeast(0)
                    val right = ceil(bounds.right).toInt().coerceAtMost(bitmap.width)
                    val bottom = ceil(bounds.bottom).toInt().coerceAtMost(bitmap.height)
                    if (right <= left || bottom <= top) {
                        diagnostics += "$preview Contrast: text \"$content\" at $bounds " +
                            "is outside the captured image"
                    } else {
                        val ratio = try {
                            val crop = atfImage.crop(left, top, right - left, bottom - top)
                            ContrastSwatch(crop, false).contrastRatios.minOrNull()
                                ?: throw IllegalStateException("ATF returned no contrast ratio")
                        } catch (error: Throwable) {
                            throw AssertionError(
                                "$preview Contrast: failed to measure text \"$content\" at $bounds",
                                error,
                            )
                        }
                        val threshold = if (isLargeText(node, density)) 3.0 else 4.5
                        if (ratio <= 1.0) {
                            diagnostics += "$preview Contrast: text \"$content\" at $bounds " +
                                "is not measurable (single-colour crop)"
                        } else if (ratio < threshold) {
                            diagnostics += "$preview Contrast: text \"$content\" at $bounds measured " +
                                "${formatRatio(ratio)}:1, below ${formatRatio(threshold)}:1"
                        }
                    }
                }
            }
            node.children.forEach { visitUnmerged(it) }
        }
        visitUnmerged(unmergedNodes[index])
    }
    println(
        "auditAccessibility[$preview] diagnostics=${diagnostics.size} " +
            "skippedDisabled=$skippedDisabled skippedEmptyTargets=$skippedEmptyTargets",
    )
    return diagnostics
}
private fun isAncestor(ancestor: SemanticsNode, node: SemanticsNode): Boolean {
    var parent = node.parent
    while (parent != null) {
        if (parent.id == ancestor.id) return true
        parent = parent.parent
    }
    return false
}
private fun isDisabled(node: SemanticsNode): Boolean {
    var current: SemanticsNode? = node
    while (current != null) {
        if (current.config.getOrNull(SemanticsProperties.Disabled) != null) return true
        current = current.parent
    }
    return false
}
private fun isInlineLink(node: SemanticsNode): Boolean {
    val bounds = node.boundsInRoot
    var parent = node.parent
    while (parent != null) {
        val texts = parent.config.getOrNull(SemanticsProperties.Text)
        if (!texts.isNullOrEmpty()) {
            val hasLink = texts.any { annotated ->
                annotated.getLinkAnnotations(0, annotated.length).isNotEmpty()
            }
            if (hasLink) {
                val ancestor = parent.boundsInRoot
                val inside = bounds.left >= ancestor.left - 0.5f &&
                    bounds.top >= ancestor.top - 0.5f &&
                    bounds.right <= ancestor.right + 0.5f &&
                    bounds.bottom <= ancestor.bottom + 0.5f
                if (inside) return true
            }
        }
        parent = parent.parent
    }
    return false
}
private fun formatRatio(value: Double): String = String.format(Locale.US, "%.2f", value)
private fun isLargeText(node: SemanticsNode, density: Float): Boolean {
    val results = mutableListOf<TextLayoutResult>()
    node.config.getOrNull(SemanticsActions.GetTextLayoutResult)?.action?.invoke(results)
    val style = results.firstOrNull()?.layoutInput?.style ?: return false
    val fontSize = style.fontSize
    val sp = if (fontSize.isSp) fontSize.value else fontSize.value / density
    val weight = style.fontWeight?.weight ?: 400
    return sp >= 18f || (sp >= 14f && weight >= 700)
}
private fun localeFromTag(tag: String): Locale {
    val normalized = tag.replace("-r", "-")
    val parts = normalized.split("-")
    return when (parts.size) {
        1 -> Locale(parts[0])
        2 -> Locale(parts[0], parts[1])
        else -> Locale.forLanguageTag(normalized)
    }
}
internal data class SourceDeclaration(
    val file: File,
    val packageName: String,
    val facade: String,
    val function: String,
    val locales: List<String>,
) {
    val id: String get() = "$facade.$function"
    val qualifiedFacade: String get() = if (packageName.isEmpty()) facade else "$packageName.$facade"
}
internal object SourceDeclarations {
    private val annotationRegex = Regex("""(?m)^\s*@PreviewTest\s*$""")
    private val functionRegex = Regex("""\bfun\s+(\w+)\s*\(""")
    private val packageRegex = Regex("""(?m)^package\s+([\w.]+)""")
    private val localeRegex = Regex("""locale\s*=\s*"([^"]+)"""")
    private val multiAnnotationRegex = Regex("""@(\w+)\s*$""", RegexOption.MULTILINE)
    private val sourceRoot = File("src/screenshotTest/java")
    val all: List<SourceDeclaration> by lazy { parse() }
    private val byId: Map<String, SourceDeclaration> by lazy { all.associateBy { it.id } }
    fun byId(id: String): SourceDeclaration? = byId[id]
    private fun parse(): List<SourceDeclaration> {
        check(sourceRoot.isDirectory) {
            "Missing ${sourceRoot.absolutePath}; unit tests must run from the app module"
        }
        val multipreviews = parseMultipreviews()
        val declarations = mutableListOf<SourceDeclaration>()
        sourceRoot.walkTopDown()
            .filter { it.isFile && it.extension == "kt" }
            .sortedBy { it.path }
            .forEach { file ->
                val text = file.readText()
                val packageName = packageRegex.find(text)?.groupValues?.get(1).orEmpty()
                val facade = file.nameWithoutExtension + "Kt"
                annotationRegex.findAll(text).forEach { match ->
                    val functionStart = text.indexOf("fun", match.range.last)
                    check(functionStart >= 0) { "No function after @PreviewTest in ${file.path}" }
                    val block = text.substring(match.range.last, functionStart)
                    val function = functionRegex.find(text, match.range.last)
                        ?.groupValues?.get(1)
                        ?: error("No function after @PreviewTest in ${file.path}")
            val inline = localeRegex.findAll(block).map { it.groupValues[1] }.toList()
            val resolved = if (inline.isNotEmpty()) {
                inline
            } else {
                multiAnnotationRegex.findAll(block)
                    .map { it.groupValues[1] }
                    .filter { it != "Composable" && it != "PreviewTest" }
                    .flatMap { annotation ->
                        multipreviews[annotation] ?: error(
                            "Unresolved multipreview @$annotation in ${file.path} for $function",
                        )
                    }
                    .toList()
            }
            val locales = resolved.ifEmpty { listOf("ar") }
            declarations += SourceDeclaration(file, packageName, facade, function, locales)
                }
            }
        return declarations
    }
    private fun parseMultipreviews(): Map<String, List<String>> {
        val root = File("src/main/java/app/orderak/seller/core/ui")
        check(root.isDirectory) { "Missing multipreview source root ${root.absolutePath}" }
        val result = mutableMapOf<String, List<String>>()
        root.walkTopDown()
            .filter { it.isFile && it.extension == "kt" }
            .forEach { file ->
                val text = file.readText()
                val matches = Regex("""annotation class (\w+)""").findAll(text).toList()
                for ((index, match) in matches.withIndex()) {
                    val start = if (index == 0) 0 else matches[index - 1].range.last + 1
                    val block = text.substring(start, match.range.first)
                    val locales = localeRegex.findAll(block).map { it.groupValues[1] }.toList()
                    if (locales.isNotEmpty()) result[match.groupValues[1]] = locales
                }
            }
        return result
    }
}
