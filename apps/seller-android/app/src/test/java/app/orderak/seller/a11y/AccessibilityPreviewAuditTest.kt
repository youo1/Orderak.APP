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
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.LocalDensity
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
import androidx.compose.ui.unit.Density
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
    "TS" to KnownKind("Touch target is below the 48dp minimum", "B5: enlarge the kit control to a 48dp target"),
    "CF" to KnownKind("Field label colour is below the 4.5:1 threshold", "R1: use the accessible onSurfaceVariant token"),
    "CD" to KnownKind("Dialog window not captured under Robolectric", "R1: audit dialog window capture and colour tokens"),
    "CG" to KnownKind("Text colour is below the WCAG threshold", "R1: use the accessible design-system colour token"),
    "CO" to KnownKind("Text crop is outside the captured frame in this preview", "R1: keep the audited text node inside the visible frame"),
    "IL" to KnownKind(
        "Inline text link has no semantics label of its own",
        "R3: present the terms and privacy links as their own controls in the redesigned setup",
    ),
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
        TS|OrdersScreenshotTestKt.ordersBothGroupsDark|Target|touch target
        TS|OrdersScreenshotTestKt.ordersBothGroupsLight|Target|touch target
        TS|OrdersScreenshotTestKt.ordersContentDark|Target|touch target
        TS|OrdersScreenshotTestKt.ordersContentLight|Target|touch target
        TS|OrdersScreenshotTestKt.ordersErrorDark|Target|touch target
        TS|OrdersScreenshotTestKt.ordersErrorLight|Target|touch target
        TS|OrdersScreenshotTestKt.ordersFilteredToNone|Target|touch target
        TS|OrdersScreenshotTestKt.ordersFilteredUnpaid|Target|touch target
        CO|AccountScreenshotTestKt.accountContentDark|Contrast|text "إجراءات الحساب" at
        CO|AccountScreenshotTestKt.accountContentDark|Contrast|text "احفظ" at
        CO|AccountScreenshotTestKt.accountContentDark|Contrast|text "تسجيل خروج" at
        CO|AccountScreenshotTestKt.accountContentDark|Contrast|text "حالة طلب الحذف" at
        CO|AccountScreenshotTestKt.accountContentDark|Contrast|text "طلب حذف الحساب" at
        CO|AccountScreenshotTestKt.accountContentDark|Contrast|text "لغة التطبيق" at
        CO|AccountScreenshotTestKt.accountContentLight|Contrast|text "إجراءات الحساب" at
        CO|AccountScreenshotTestKt.accountContentLight|Contrast|text "احفظ" at
        CO|AccountScreenshotTestKt.accountContentLight|Contrast|text "تسجيل خروج" at
        CO|AccountScreenshotTestKt.accountContentLight|Contrast|text "حالة طلب الحذف" at
        CO|AccountScreenshotTestKt.accountContentLight|Contrast|text "طلب حذف الحساب" at
        CO|AccountScreenshotTestKt.accountContentLight|Contrast|text "لغة التطبيق" at
        CO|AccountScreenshotTestKt.accountFreePlan|Contrast|text "إجراءات الحساب" at
        CO|AccountScreenshotTestKt.accountFreePlan|Contrast|text "احفظ" at
        CO|AccountScreenshotTestKt.accountFreePlan|Contrast|text "تسجيل خروج" at
        CO|AccountScreenshotTestKt.accountFreePlan|Contrast|text "حالة طلب الحذف" at
        CO|AccountScreenshotTestKt.accountFreePlan|Contrast|text "رقم فودافون كاش" at
        CO|AccountScreenshotTestKt.accountFreePlan|Contrast|text "طلب حذف الحساب" at
        CO|AccountScreenshotTestKt.accountFreePlan|Contrast|text "لغة التطبيق" at
        CO|AccountScreenshotTestKt.accountFreePlanUpgradable|Contrast|text "إجراءات الحساب" at
        CO|AccountScreenshotTestKt.accountFreePlanUpgradable|Contrast|text "احفظ" at
        CO|AccountScreenshotTestKt.accountFreePlanUpgradable|Contrast|text "تسجيل خروج" at
        CO|AccountScreenshotTestKt.accountFreePlanUpgradable|Contrast|text "حالة طلب الحذف" at
        CO|AccountScreenshotTestKt.accountFreePlanUpgradable|Contrast|text "رقم فودافون كاش" at
        CO|AccountScreenshotTestKt.accountFreePlanUpgradable|Contrast|text "طلب حذف الحساب" at
        CO|AccountScreenshotTestKt.accountFreePlanUpgradable|Contrast|text "لغة التطبيق" at
        CO|AccountScreenshotTestKt.accountLinkPending|Contrast|text "إجراءات الحساب" at
        CO|AccountScreenshotTestKt.accountLinkPending|Contrast|text "احفظ" at
        CO|AccountScreenshotTestKt.accountLinkPending|Contrast|text "تسجيل خروج" at
        CO|AccountScreenshotTestKt.accountLinkPending|Contrast|text "حالة طلب الحذف" at
        CO|AccountScreenshotTestKt.accountLinkPending|Contrast|text "رقم فودافون كاش" at
        CO|AccountScreenshotTestKt.accountLinkPending|Contrast|text "طلب حذف الحساب" at
        CO|AccountScreenshotTestKt.accountLinkPending|Contrast|text "لغة التطبيق" at
        CO|AccountScreenshotTestKt.accountLoadingDark|Contrast|text "إجراءات الحساب" at
        CO|AccountScreenshotTestKt.accountLoadingDark|Contrast|text "احفظ" at
        CO|AccountScreenshotTestKt.accountLoadingDark|Contrast|text "تسجيل خروج" at
        CO|AccountScreenshotTestKt.accountLoadingDark|Contrast|text "حالة طلب الحذف" at
        CO|AccountScreenshotTestKt.accountLoadingDark|Contrast|text "طلب حذف الحساب" at
        CO|AccountScreenshotTestKt.accountLoadingDark|Contrast|text "لغة التطبيق" at
        CO|AccountScreenshotTestKt.accountLoadingLight|Contrast|text "إجراءات الحساب" at
        CO|AccountScreenshotTestKt.accountLoadingLight|Contrast|text "احفظ" at
        CO|AccountScreenshotTestKt.accountLoadingLight|Contrast|text "تسجيل خروج" at
        CO|AccountScreenshotTestKt.accountLoadingLight|Contrast|text "حالة طلب الحذف" at
        CO|AccountScreenshotTestKt.accountLoadingLight|Contrast|text "طلب حذف الحساب" at
        CO|AccountScreenshotTestKt.accountLoadingLight|Contrast|text "لغة التطبيق" at
        CO|AuthScreenshotTestKt.authCountryPicker|Contrast|text "+372" at
        CO|AuthScreenshotTestKt.authCountryPicker|Contrast|text "🇪🇪  إستونيا" at
        CO|AuthScreenshotTestKt.authCountryPickerDark|Contrast|text "+372" at
        CO|AuthScreenshotTestKt.authCountryPickerDark|Contrast|text "🇪🇪  إستونيا" at
        CO|AuthScreenshotTestKt.authCountryPickerSearch|Contrast|text "+213" at
        CO|AuthScreenshotTestKt.authCountryPickerSearch|Contrast|text "🇩🇿  الجزائر" at
        CO|BillingScreenshotTestKt.plansContentDark|Contrast|text "برو" at
        CO|BillingScreenshotTestKt.plansContentDark|Contrast|text "غير محدود" at
        CO|BillingScreenshotTestKt.plansContentDark|Contrast|text "غير محدود" at
        CO|BillingScreenshotTestKt.plansContentDark|Contrast|text "متاح" at
        CO|BillingScreenshotTestKt.plansContentLight|Contrast|text "برو" at
        CO|BillingScreenshotTestKt.plansContentLight|Contrast|text "غير محدود" at
        CO|BillingScreenshotTestKt.plansContentLight|Contrast|text "غير محدود" at
        CO|BillingScreenshotTestKt.plansContentLight|Contrast|text "متاح" at
        CO|BillingScreenshotTestKt.plansPurchaseOpen|Contrast|text "برو" at
        CO|BillingScreenshotTestKt.plansPurchaseOpen|Contrast|text "غير محدود" at
        CO|BillingScreenshotTestKt.plansPurchaseOpen|Contrast|text "غير محدود" at
        CO|BillingScreenshotTestKt.plansPurchaseOpen|Contrast|text "متاح" at
        CO|OrdersScreenshotTestKt.ordersBothGroupsDark|Contrast|text "جديد" at
        CO|OrdersScreenshotTestKt.ordersBothGroupsLight|Contrast|text "جديد" at
        CO|OrdersScreenshotTestKt.ordersContentDark|Contrast|text "جديد" at
        CO|OrdersScreenshotTestKt.ordersContentLight|Contrast|text "جديد" at
        CO|OrdersScreenshotTestKt.ordersErrorDark|Contrast|text "جديد" at
        CO|OrdersScreenshotTestKt.ordersErrorLight|Contrast|text "جديد" at
        CO|OrdersScreenshotTestKt.ordersFilteredToNone|Contrast|text "جديد" at
        CO|OrdersScreenshotTestKt.ordersFilteredUnpaid|Contrast|text "جديد" at
        CO|StoreGroupScreenshotTestKt.storeInfoContentDark|Contrast|text "احفظ" at
        CO|StoreGroupScreenshotTestKt.storeInfoContentDark|Contrast|text "التصنيف الفرعي" at
        CO|StoreGroupScreenshotTestKt.storeInfoContentDark|Contrast|text "الشعار" at
        CO|StoreGroupScreenshotTestKt.storeInfoContentDark|Contrast|text "صورة الغلاف" at
        CO|StoreGroupScreenshotTestKt.storeInfoContentLight|Contrast|text "احفظ" at
        CO|StoreGroupScreenshotTestKt.storeInfoContentLight|Contrast|text "التصنيف الفرعي" at
        CO|StoreGroupScreenshotTestKt.storeInfoContentLight|Contrast|text "الشعار" at
        CO|StoreGroupScreenshotTestKt.storeInfoContentLight|Contrast|text "صورة الغلاف" at
        CO|StoreGroupScreenshotTestKt.storeInfoIdentityLight|Contrast|text "احفظ" at
        CO|StoreGroupScreenshotTestKt.storeInfoIdentityLight|Contrast|text "التصنيف الفرعي" at
        CO|StoreGroupScreenshotTestKt.storeInfoIdentityLight|Contrast|text "الشعار" at
        CO|StoreGroupScreenshotTestKt.storeInfoIdentityLight|Contrast|text "صورة الغلاف" at
        CO|StoreGroupScreenshotTestKt.storeInfoSaving|Contrast|text "التصنيف الفرعي" at
        CO|StoreGroupScreenshotTestKt.storeInfoSaving|Contrast|text "الشعار" at
        CO|StoreGroupScreenshotTestKt.storeInfoSaving|Contrast|text "صورة الغلاف" at
        CO|StoreGroupScreenshotTestKt.storeInfoSlugTaken|Contrast|text "احفظ" at
        CO|StoreGroupScreenshotTestKt.storeInfoSlugTaken|Contrast|text "التصنيف الفرعي" at
        CO|StoreGroupScreenshotTestKt.storeInfoSlugTaken|Contrast|text "الشعار" at
        CO|StoreGroupScreenshotTestKt.storeInfoSlugTaken|Contrast|text "صورة الغلاف" at
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
fun auditAccessibility(rule: ComposeTestRule, preview: String): List<String> {
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
                if (a.touchBoundsInRoot.width <= 0f || a.touchBoundsInRoot.height <= 0f ||
                    b.touchBoundsInRoot.width <= 0f || b.touchBoundsInRoot.height <= 0f
                ) {
                    continue
                }
                if (a.touchBoundsInRoot.overlaps(b.touchBoundsInRoot) &&
                    !isAncestor(a, b) &&
                    !isAncestor(b, a)
                ) {
                    diagnostics += "${previewLabel(a, preview)} Target: " +
                        "${a.touchBoundsInRoot} overlaps ${b.touchBoundsInRoot}"
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
                        diagnostics += "${previewLabel(node, preview)} Contrast: text \"$content\" at $bounds " +
                            "is outside the captured image"
                    } else {
                        val ratio = try {
                            val crop = atfImage.crop(left, top, right - left, bottom - top)
                            ContrastSwatch(crop, false).contrastRatios.minOrNull()
                                ?: throw IllegalStateException("ATF returned no contrast ratio")
                        } catch (error: Throwable) {
                            throw AssertionError(
                                "${previewLabel(node, preview)} Contrast: failed to measure " +
                                    "text \"$content\" at $bounds",
                                error,
                            )
                        }
                        val threshold = if (isLargeText(node, density)) 3.0 else 4.5
                        if (ratio <= 1.0) {
                            diagnostics += "${previewLabel(node, preview)} Contrast: text \"$content\" at $bounds " +
                                "is not measurable (single-colour crop)"
                        } else if (ratio < threshold) {
                            diagnostics += "${previewLabel(node, preview)} Contrast: text \"$content\" at $bounds " +
                                "measured ${formatRatio(ratio)}:1, below ${formatRatio(threshold)}:1"
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
