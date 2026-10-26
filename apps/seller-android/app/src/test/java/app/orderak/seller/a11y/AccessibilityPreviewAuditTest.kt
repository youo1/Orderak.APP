// Retained for two Compose internals: androidx.compose.runtime.reflect.
// ComposableMethod.invoke, exposed only through internal Kotlin metadata, and
// LayoutNode.compositionLocalMap, which previewLabel reads to name the locale a
// node was composed with. Both can move on a Compose BOM upgrade; remove these
// suppressions only if the file compiles without them.
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
import android.graphics.Bitmap
import android.graphics.Canvas
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
import androidx.compose.ui.node.LayoutNode
import androidx.compose.ui.platform.LocalConfiguration
import androidx.compose.ui.platform.ViewRootForTest
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.platform.LocalLayoutDirection
import androidx.compose.ui.platform.LocalResources
import androidx.compose.ui.semantics.SemanticsActions
import androidx.compose.ui.semantics.SemanticsNode
import androidx.compose.ui.semantics.SemanticsProperties
import androidx.compose.ui.semantics.getOrNull
import androidx.compose.ui.test.SemanticsNodeInteraction
import androidx.compose.ui.test.captureToImage
import androidx.compose.ui.test.isRoot
import androidx.compose.ui.test.junit4.ComposeTestRule
import androidx.compose.ui.test.junit4.createComposeRule
import androidx.compose.ui.text.LinkAnnotation
import androidx.compose.ui.text.TextLayoutResult
import androidx.compose.ui.text.buildAnnotatedString
import androidx.compose.ui.text.withLink
import androidx.compose.ui.unit.Density
import androidx.compose.ui.unit.LayoutDirection
import androidx.compose.ui.unit.dp
import androidx.test.core.app.ApplicationProvider
import androidx.test.ext.junit.runners.AndroidJUnit4
import com.google.android.apps.common.testing.accessibility.framework.utils.contrast.BitmapImage
import com.google.android.apps.common.testing.accessibility.framework.utils.contrast.ContrastSwatch
import java.io.File
import java.util.Locale
import kotlin.math.abs
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
        val variantState = mutableStateOf(declaration.variants.first())
        rule.setContent {
            val variant = variantState.value
            val configuration = Configuration(application.resources.configuration).apply {
                setLocale(localeFromTag(variant.locale))
                uiMode = variant.uiMode
                fontScale = variant.fontScale
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
                LocalDensity provides Density(
                    density = application.resources.displayMetrics.density,
                    fontScale = variant.fontScale,
                ),
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
        for (variant in declaration.variants) {
            variantState.value = variant
            rule.waitForIdle()
            val mode = if (
                (variant.uiMode and Configuration.UI_MODE_NIGHT_MASK) ==
                Configuration.UI_MODE_NIGHT_YES
            ) {
                "dark"
            } else {
                "light"
            }
            val scale = (variant.fontScale * 100).toInt()
            val label = "${variant.locale} $mode $scale"
            if (variant.locale !in textsByLocale) {
                textsByLocale[variant.locale] = collectTexts(rule)
            }
            val diagnostics = auditAccessibility(rule, "${declaration.id} [$label]")
            for (diagnostic in diagnostics) {
                assertTrue("Diagnostic must name the preview: $diagnostic", declaration.id in diagnostic)
                assertTrue("Diagnostic must name a rule: $diagnostic", RULES.any { it in diagnostic })
                allDiagnostics += diagnostic
            }
        }
        // Each entry absorbs exactly one diagnostic, the most specific matching
        // entry first, so a listed preview cannot hide a second finding of the
        // same kind: the list says how many of each are known, per locale run.
        val remaining = KNOWN_FINDINGS
            .filter { it.preview == declaration.id }
            .sortedByDescending { it.needle.length }
            .toMutableList()
        val unknown = allDiagnostics.filter { diagnostic ->
            val index = remaining.indexOfFirst { it.matches(diagnostic) }
            if (index >= 0) remaining.removeAt(index)
            index < 0
        }
        assertTrue(
            "Accessibility findings for ${declaration.id}:\n" + unknown.joinToString("\n"),
            unknown.isEmpty(),
        )
        val stale = remaining
        // A stale entry would hide a regression on the same node, so the list
        // must match what the audit finds today, in both directions.
        assertTrue(
            "KNOWN_FINDINGS entries for ${declaration.id} no longer occur (remove them): " +
                stale.joinToString("; ") { "${it.rule}: ${it.needle}" },
            stale.isEmpty(),
        )
        val english = textsByLocale["en"]
        val arabic = textsByLocale["ar"]
        if (english != null && arabic != null && (english.isNotEmpty() || arabic.isNotEmpty())) {
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
    fun matches(diagnostic: String): Boolean {
        if (!diagnostic.startsWith(preview)) return false
        val boundary = diagnostic.getOrNull(preview.length)
        if (boundary != ' ' && boundary != '[') return false
        return "$rule:" in diagnostic && (needle.isEmpty() || needle in diagnostic)
    }
}
private data class KnownKind(val reason: String, val plan: String)
private val KNOWN_KINDS: Map<String, KnownKind> = mapOf(
    "CF" to KnownKind("Field label colour is below the 4.5:1 threshold", "R1: use the accessible onSurfaceVariant token"),
    "CG" to KnownKind("Text colour is below the WCAG threshold", "R1: use the accessible design-system colour token"),
    "IL" to KnownKind(
        "Inline text link has no semantics label of its own",
        "R3: present the terms and privacy links as their own controls in the redesigned setup",
    ),
)
private val KNOWN_FINDINGS: List<KnownFinding> = """
        CF|AccountScreenshotTestKt.accountContentLight|Contrast|text "رقم فودافون كاش"
        CF|AccountScreenshotTestKt.accountLoadingLight|Contrast|text "رقم فودافون كاش"
        CF|AccountScreenshotTestKt.accountFreePlan|Contrast|text "رقم فودافون كاش"
        CF|AccountScreenshotTestKt.accountFreePlanUpgradable|Contrast|text "رقم فودافون كاش"
        CF|AccountScreenshotTestKt.accountLinkPending|Contrast|text "رقم فودافون كاش"
        IL|ShopSetupScreenshotTestKt.setupAccountDark|Label|has no ContentDescription or Text
        IL|ShopSetupScreenshotTestKt.setupAccountDark|Label|has no ContentDescription or Text
        IL|ShopSetupScreenshotTestKt.setupAccountEmpty|Label|has no ContentDescription or Text
        IL|ShopSetupScreenshotTestKt.setupAccountEmpty|Label|has no ContentDescription or Text
        IL|ShopSetupScreenshotTestKt.setupAccountInvalidEmail|Label|has no ContentDescription or Text
        IL|ShopSetupScreenshotTestKt.setupAccountInvalidEmail|Label|has no ContentDescription or Text
        IL|ShopSetupScreenshotTestKt.setupAccountLight|Label|has no ContentDescription or Text
        IL|ShopSetupScreenshotTestKt.setupAccountLight|Label|has no ContentDescription or Text
        IL|ShopSetupScreenshotTestKt.setupAccountSaving|Label|has no ContentDescription or Text
        IL|ShopSetupScreenshotTestKt.setupAccountSaving|Label|has no ContentDescription or Text
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
/**
 * Audits every active Compose root, which includes the roots of dialog and
 * popup windows: each root is its own window with its own semantics and its own
 * pixels, and its bounds are relative to that window.
 *
 * [capture] returns the pixels of one root, or null when they cannot be read.
 * A root that has text but no pixels is reported, never passed: an unread
 * window proves nothing about contrast.
 */
fun auditAccessibility(
    rule: ComposeTestRule,
    preview: String,
    capture: (SemanticsNodeInteraction) -> Bitmap? = ::captureWindow,
): List<String> {
    val diagnostics = mutableListOf<String>()
    // The content's locale is only visible on the audited nodes themselves, so
    // each diagnostic reads it from the node it is about. The preview harness
    // already passes an explicit "[locale]" suffix and keeps that label as-is.
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
                    if (!labelled) {
                        diagnostics += "${previewLabel(node, preview)} Label: actionable node at " +
                            "${node.boundsInRoot} has no ContentDescription or Text"
                    }
                }
            }
            node.children.forEach { visitMerged(it) }
        }
        visitMerged(mergedRoot)
        for (node in actionable) {
            val touch = node.touchBoundsInRoot
            if (touch.width <= 0f || touch.height <= 0f) {
                skippedEmptyTargets++
                continue
            }
            if (touch.width < minimumTouchPx - 0.5f || touch.height < minimumTouchPx - 0.5f) {
                diagnostics += "${previewLabel(node, preview)} Target: touch target " +
                    "${touch.width / density}x${touch.height / density}dp at $touch is smaller than 48dp"
            }
        }
        for (first in actionable.indices) {
            for (second in first + 1 until actionable.size) {
                val a = actionable[first]
                val b = actionable[second]
                val touchA = reachableTouchBounds(a)
                val touchB = reachableTouchBounds(b)
                if (touchA.width <= 0f || touchA.height <= 0f || touchB.width <= 0f || touchB.height <= 0f) {
                    continue
                }
                if (touchA.overlaps(touchB) && !isAncestor(a, b) && !isAncestor(b, a)) {
                    diagnostics += "${previewLabel(a, preview)} Target: $touchA overlaps $touchB"
                }
            }
        }
    }
    val unmergedRoots = rule.onAllNodes(isRoot(), useUnmergedTree = true)
    val unmergedNodes = unmergedRoots.fetchSemanticsNodes()
    for (index in unmergedNodes.indices) {
        var bitmap = capture(unmergedRoots[index])
        var atfImage = bitmap?.let { BitmapImage(it) }
        fun visitUnmerged(node: SemanticsNode) {
            val disabled = isDisabled(node)
            if (disabled) skippedDisabled++
            val emptySize = node.size.width == 0 || node.size.height == 0
            if (!disabled && !emptySize) {
                val content = node.config.getOrNull(SemanticsProperties.Text)
                    .orEmpty()
                    .joinToString(" ") { it.text }
                    .trim()
                if (content.isNotEmpty() && bitmap == null) {
                    diagnostics += "${previewLabel(node, preview)} Contrast: text \"$content\" at " +
                        "${node.boundsInRoot} is in a window that was not captured"
                } else if (content.isNotEmpty() && bitmap != null && atfImage != null) {
                    val bounds = node.boundsInRoot
                    var window: Bitmap = bitmap!!
                    var windowImage: BitmapImage = atfImage!!
                    var region = visibleRegion(node.boundsInRoot, window)
                    // Text that is not wholly in the frame is measured where a seller
                    // would read it: the scroll container brings it fully into view, the
                    // frame is captured again, and the container goes back to where it
                    // was. A sliver of a label is not a measurement of the label.
                    var restoreTo: Pair<Float, Float>? = null
                    var recaptured = true
                    if (region == null || !isWhollyVisible(node, region)) {
                        restoreTo = scrollIntoView(rule, node, window)
                        if (restoreTo != null) {
                            val fresh = capture(unmergedRoots[index])
                            if (fresh == null) {
                                recaptured = false
                            } else {
                                window = fresh
                                windowImage = BitmapImage(fresh)
                                region = visibleRegion(node.boundsInRoot, window)
                            }
                        }
                    }
                    if (!recaptured) {
                        diagnostics += "${previewLabel(node, preview)} Contrast: text \"$content\" at $bounds " +
                            "is in a window that was not captured after scrolling"
                    } else if (region == null) {
                        diagnostics += "${previewLabel(node, preview)} Contrast: text \"$content\" at $bounds " +
                            "is outside the captured image"
                    } else {
                        val (left, top, right, bottom) = region
                        val measuredAt = node.boundsInRoot
                        val ratio = try {
                            val crop = windowImage.crop(left, top, right - left, bottom - top)
                            ContrastSwatch(crop, false).contrastRatios.minOrNull()
                                ?: throw IllegalStateException("ATF returned no contrast ratio")
                        } catch (error: Throwable) {
                            throw AssertionError(
                                "${previewLabel(node, preview)} Contrast: failed to measure " +
                                    "text \"$content\" at $measuredAt",
                                error,
                            )
                        }
                        val threshold = if (isLargeText(node, density)) 3.0 else 4.5
                        if (ratio <= 1.0) {
                            diagnostics += "${previewLabel(node, preview)} Contrast: text \"$content\" at $measuredAt " +
                                "is not measurable (single-colour crop)"
                        } else if (ratio < threshold) {
                            diagnostics += "${previewLabel(node, preview)} Contrast: text \"$content\" at $measuredAt " +
                                "measured ${formatRatio(ratio)}:1, below ${formatRatio(threshold)}:1"
                        }
                    }
                    if (restoreTo != null) {
                        val container = scrollContainerOf(node)
                        val restored = container != null && restoreScroll(rule, container, restoreTo)
                        if (!restored) {
                            // The frame the later nodes are measured on must match the
                            // screen, whatever happened to the scroll position.
                            val fresh = capture(unmergedRoots[index])
                            bitmap = fresh
                            atfImage = fresh?.let { BitmapImage(it) }
                            diagnostics += "${previewLabel(node, preview)} Contrast: the scroll container of " +
                                "text \"$content\" did not return to its position after measuring"
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
/**
 * The pixels of one root. The activity's own root is read the way the harness
 * always has. A dialog or popup root is drawn from its own view, because a
 * window copy of the activity returns the activity's surface, not the dialog's.
 * Pixels the dialog leaves transparent stay transparent; a dialog's text sits on
 * the dialog's own surface, which is what is measured.
 */
private fun captureWindow(interaction: SemanticsNodeInteraction): Bitmap? {
    val node = interaction.fetchSemanticsNode()
    if (!isOverlayWindow(node)) return interaction.captureToImage().asAndroidBitmap()
    val view = (node.root as? ViewRootForTest)?.view ?: return null
    if (view.width <= 0 || view.height <= 0) return null
    val bitmap = Bitmap.createBitmap(view.width, view.height, Bitmap.Config.ARGB_8888)
    view.draw(Canvas(bitmap))
    return bitmap
}

/** The part of [bounds] inside [window], as left, top, right, bottom pixels; null when none is. */
private fun visibleRegion(bounds: androidx.compose.ui.geometry.Rect, window: Bitmap): IntArray? {
    val left = floor(bounds.left).toInt().coerceAtLeast(0)
    val top = floor(bounds.top).toInt().coerceAtLeast(0)
    val right = ceil(bounds.right).toInt().coerceAtMost(window.width)
    val bottom = ceil(bounds.bottom).toInt().coerceAtMost(window.height)
    return if (right <= left || bottom <= top) null else intArrayOf(left, top, right, bottom)
}

private fun scrollContainerOf(node: SemanticsNode): SemanticsNode? =
    generateSequence(node.parent) { it.parent }
        .firstOrNull { it.config.getOrNull(SemanticsActions.ScrollBy) != null }

/** The text is inside the frame in full, not only a part of it. */
private fun isWhollyVisible(node: SemanticsNode, region: IntArray): Boolean =
    region[2] - region[0] >= node.size.width - 1 && region[3] - region[1] >= node.size.height - 1

/** Where a scroll container is now: horizontal, then vertical, as its own scroll values read. */
private fun scrollValues(container: SemanticsNode): Pair<Float, Float> {
    val horizontal = container.config.getOrNull(SemanticsProperties.HorizontalScrollAxisRange)
    val vertical = container.config.getOrNull(SemanticsProperties.VerticalScrollAxisRange)
    return (horizontal?.value?.invoke() ?: 0f) to (vertical?.value?.invoke() ?: 0f)
}

/**
 * Puts a scroll container back to [saved], read from the container itself. A
 * scroll stops at the ends of its content, so reversing the amount asked for is
 * not the same as going back; and a horizontal container may run against the
 * layout direction, which shows as the error growing, so the sign is flipped.
 */
private fun restoreScroll(rule: ComposeTestRule, container: SemanticsNode, saved: Pair<Float, Float>): Boolean {
    val action = container.config.getOrNull(SemanticsActions.ScrollBy)?.action ?: return false
    var flipX = false
    repeat(6) {
        val now = scrollValues(container)
        val dx = saved.first - now.first
        val dy = saved.second - now.second
        if (abs(dx) < 0.5f && abs(dy) < 0.5f) return true
        rule.runOnUiThread { action(if (flipX) -dx else dx, dy) }
        rule.waitForIdle()
        val after = scrollValues(container)
        if (abs(saved.first - after.first) > abs(dx) + 0.5f) flipX = !flipX
    }
    val last = scrollValues(container)
    return abs(saved.first - last.first) < 0.5f && abs(saved.second - last.second) < 0.5f
}

/**
 * Scrolls the nearest scroll container just far enough to bring [node] wholly
 * into the part of [window] that container shows. Returns where the container
 * was before, to restore it; null when the node is in no scroll container or
 * scrolling does not bring it into view (the container is then put back).
 *
 * `boundsInRoot` is clipped to the node's ancestors, so a node below the fold has
 * empty bounds; where it really is comes from its position and size. A
 * horizontal container may run against the layout direction, so the other
 * direction is tried when the first does not reveal the node.
 */
private fun scrollIntoView(
    rule: ComposeTestRule,
    node: SemanticsNode,
    window: Bitmap,
): Pair<Float, Float>? {
    val container = scrollContainerOf(node) ?: return null
    val action = container.config[SemanticsActions.ScrollBy].action ?: return null
    val saved = scrollValues(container)
    val viewport = container.boundsInRoot
    val at = node.positionInRoot
    val left = at.x
    val top = at.y
    val right = at.x + node.size.width
    val bottom = at.y + node.size.height
    val bottomEdge = minOf(viewport.bottom, window.height.toFloat())
    val rightEdge = minOf(viewport.right, window.width.toFloat())
    val dy = when {
        bottom > bottomEdge -> bottom - bottomEdge
        top < viewport.top -> top - viewport.top
        else -> 0f
    }
    val dx = when {
        right > rightEdge -> right - rightEdge
        left < viewport.left -> left - viewport.left
        else -> 0f
    }
    if (dx == 0f && dy == 0f) return null
    for (candidate in listOf(dx to dy, -dx to dy)) {
        rule.runOnUiThread { action(candidate.first, candidate.second) }
        rule.waitForIdle()
        val region = visibleRegion(node.boundsInRoot, window)
        if (region != null && isWhollyVisible(node, region)) return saved
        restoreScroll(rule, container, saved)
        if (dx == 0f) break
    }
    return null
}

/**
 * The part of a target's touch bounds a finger can reach: a scroll container
 * clips its content, so a row half scrolled out of view cannot be touched where
 * it runs under whatever is pinned beside the container.
 */
private fun reachableTouchBounds(node: SemanticsNode): androidx.compose.ui.geometry.Rect {
    var reachable = node.touchBoundsInRoot
    var ancestor = node.parent
    while (ancestor != null) {
        if (ancestor.config.getOrNull(SemanticsActions.ScrollBy) != null) {
            reachable = reachable.intersect(ancestor.boundsInRoot)
        }
        ancestor = ancestor.parent
    }
    return reachable
}

/** A dialog or popup marks a node below its root, not the root itself. */
private fun isOverlayWindow(node: SemanticsNode): Boolean =
    node.config.getOrNull(SemanticsProperties.IsDialog) != null ||
        node.config.getOrNull(SemanticsProperties.IsPopup) != null ||
        node.children.any { isOverlayWindow(it) }

private fun previewLabel(node: SemanticsNode, preview: String): String {
    if (LOCALE_SUFFIX.containsMatchIn(preview)) return preview
    val layoutNode = node.layoutInfo as? LayoutNode
    val configuration = layoutNode?.compositionLocalMap?.get(LocalConfiguration)
    val tag = configuration?.locales?.get(0)?.toLanguageTag()
        ?: ApplicationProvider.getApplicationContext<Context>()
            .resources.configuration.locales[0].toLanguageTag()
    return "$preview [$tag]"
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
private fun formatRatio(value: Double): String = String.format(Locale.US, "%.2f", value)
private val LOCALE_SUFFIX = Regex("""\[[^\]]+\]\s*$""")
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
internal data class PreviewVariant(
    val locale: String,
    val uiMode: Int = Configuration.UI_MODE_NIGHT_NO,
    val fontScale: Float = 1f,
)
internal data class SourceDeclaration(
    val file: File,
    val packageName: String,
    val facade: String,
    val function: String,
    val variants: List<PreviewVariant>,
) {
    val id: String get() = "$facade.$function"
    val qualifiedFacade: String get() = if (packageName.isEmpty()) facade else "$packageName.$facade"
    val locales: List<String> get() = variants.map { it.locale }.distinct()
}
internal object SourceDeclarations {
    private val annotationRegex = Regex("""(?m)^\s*@PreviewTest\s*$""")
    private val functionRegex = Regex("""\bfun\s+(\w+)\s*\(""")
    private val packageRegex = Regex("""(?m)^package\s+([\w.]+)""")
    private val previewRegex = Regex("""@Preview\s*\(([^)]*)\)""", RegexOption.DOT_MATCHES_ALL)
    private val localeRegex = Regex("""locale\s*=\s*"([^"]+)"""")
    private val uiModeRegex = Regex("""uiMode\s*=\s*(?:Configuration\.)?UI_MODE_NIGHT_(YES|NO)""")
    private val fontScaleRegex = Regex("""fontScale\s*=\s*([\d.]+)f?""")
    private val annotationNameRegex = Regex("""@(\w+)""")
    private val annotationClassRegex = Regex("""^\s*annotation class (\w+)""")
    private val defaultSourceRoot = File("src/screenshotTest/java")
    private val defaultMultipreviewRoot = File("src/main/java/app/orderak/seller/core/ui")
    val all: List<SourceDeclaration> by lazy {
        parse(defaultSourceRoot, defaultMultipreviewRoot)
    }
    private val byId: Map<String, SourceDeclaration> by lazy { all.associateBy { it.id } }
    fun byId(id: String): SourceDeclaration? = byId[id]

    fun parse(sourceRoot: File, multipreviewRoot: File): List<SourceDeclaration> {
        check(sourceRoot.isDirectory) {
            "Missing ${sourceRoot.absolutePath}; unit tests must run from the app module"
        }
        val multipreviews = parseMultipreviews(multipreviewRoot)
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
                    val inline = variantsIn(block, file.path, function)
                    val resolved = if (inline.isNotEmpty()) {
                        inline
                    } else {
                        annotationNameRegex.findAll(block)
                            .map { it.groupValues[1] }
                            .filter { it != "Composable" && it != "PreviewTest" && it != "Preview" }
                            .flatMap { annotation ->
                                multipreviews[annotation] ?: error(
                                    "Unresolved multipreview @$annotation in ${file.path} for $function",
                                )
                            }
                            .toList()
                    }
                    check(resolved.isNotEmpty()) {
                        "Missing explicit locale metadata for @PreviewTest $function in ${file.path}"
                    }
                    declarations += SourceDeclaration(file, packageName, facade, function, resolved)
                }
            }
        return declarations
    }

    private fun variantsIn(block: String, path: String, function: String): List<PreviewVariant> =
        previewRegex.findAll(block).map { match ->
            val attributes = match.groupValues[1]
            val locale = localeRegex.find(attributes)?.groupValues?.get(1)
                ?: error("Missing explicit locale for @PreviewTest $function in $path")
            val dark = uiModeRegex.find(attributes)?.groupValues?.get(1) == "YES"
            val fontScale = fontScaleRegex.find(attributes)?.groupValues?.get(1)?.toFloat() ?: 1f
            PreviewVariant(
                locale = locale,
                uiMode = if (dark) {
                    Configuration.UI_MODE_NIGHT_YES
                } else {
                    Configuration.UI_MODE_NIGHT_NO
                },
                fontScale = fontScale,
            )
        }.toList()

    private fun parseMultipreviews(root: File): Map<String, List<PreviewVariant>> {
        check(root.isDirectory) { "Missing multipreview source root ${root.absolutePath}" }
        val result = mutableMapOf<String, List<PreviewVariant>>()
        root.walkTopDown()
            .filter { it.isFile && it.extension == "kt" }
            .forEach { file ->
                val lines = file.readText().lines()
                for (index in lines.indices) {
                    val name = annotationClassRegex.find(lines[index])?.groupValues?.get(1)
                        ?: continue
                    var start = index - 1
                    while (start >= 0 && lines[start].trimStart().startsWith("@")) start--
                    val block = lines.subList(start + 1, index).joinToString("\n")
                    val variants = variantsIn(block, file.path, name)
                    if (variants.isNotEmpty()) result[name] = variants
                }
            }
        return result
    }
}
