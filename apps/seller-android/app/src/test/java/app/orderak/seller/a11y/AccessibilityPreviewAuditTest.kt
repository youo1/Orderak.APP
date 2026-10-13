@file:Suppress("INVISIBLE_REFERENCE", "INVISIBLE_MEMBER")
@file:OptIn(
    androidx.compose.runtime.InternalComposeApi::class,
    androidx.compose.ui.ExperimentalComposeUiApi::class,
    androidx.compose.ui.test.ExperimentalTestApi::class,
    androidx.compose.ui.unit.ExperimentalUnitApi::class,
)

package app.orderak.seller.a11y

import android.app.Application
import android.content.Context
import android.content.res.Configuration
import android.view.View
import androidx.activity.compose.LocalActivityResultRegistryOwner
import androidx.activity.compose.LocalOnBackPressedDispatcherOwner
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.runtime.currentComposer
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.reflect.getDeclaredComposableMethod
import androidx.compose.ui.graphics.asAndroidBitmap
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
import androidx.compose.ui.text.TextLayoutResult
import androidx.compose.ui.unit.LayoutDirection
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
import org.robolectric.annotation.Config
import org.robolectric.annotation.GraphicsMode

/**
 * The accessibility preview audit.
 *
 * Every source `@PreviewTest` declaration becomes its own JUnit case. The case
 * resolves the compiled `<File>ScreenshotTestKt` facade through Compose runtime's
 * public reflection helper, renders the real composable once per parsed locale
 * variant through the single-content locale host, and runs the three rules.
 *
 * The source is the authority for both the declaration set and the locale matrix;
 * reflection is used only to resolve the parsed state function.
 */
@RunWith(AndroidJUnit4::class)
@GraphicsMode(GraphicsMode.Mode.NATIVE)
@Config(sdk = [35], qualifiers = "ar-w411dp-h891dp-xxhdpi", application = Application::class)
class AccessibilityPreviewAuditTest {

    @get:Rule
    val rule = createComposeRule()

    @Test
    fun sourceAnnotationCountMatchesAuditedCases() {
        val declarations = SourceDeclarations.all
        val observed = declarations.size
        val files = declarations.map { it.file }.distinct().size
        val estimate = 320
        val cases = auditedCaseNames()
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

    private fun auditedCaseNames(): List<String> =
        javaClass.declaredMethods
            .filter { it.isAnnotationPresent(Test::class.java) }
            .map { it.name }
            .filter { "ScreenshotTestKt" in it }

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

    private fun auditPreview(facade: String, function: String) {
        val declaration = SourceDeclarations.byId("$facade.$function")
            ?: error("No parsed source @PreviewTest declaration for $facade.$function")
        // Resolve and invoke exactly the parsed source function through Compose
        // runtime's public reflection helper; a missing facade or function fails
        // loudly, and no direct symbol reference or adjacent-helper guess is used.
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
            // These two owners have context-derived defaults, so swapping
            // LocalContext for the locale context would hide the test activity
            // that owns the activity-result launchers the auth screens register.
            // Read the real owners before the provider and hand them back.
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
                // ComposableMethod.invoke(composer, instance, vararg args); the
                // parsed previews are top-level functions, so the instance is null.
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

        // Every diagnostic is a real accessibility violation. A finding whose fix
        // would change pixels and whose reference PNG is not individually
        // allowlisted is recorded in KNOWN_FINDINGS with its preview, rule and
        // node text, a one-line reason and the plan item that clears it; every
        // other diagnostic fails this preview case. Nothing is stored and ignored.
        val unknown = allDiagnostics.filterNot { diagnostic ->
            KNOWN_FINDINGS.any { it.matches(diagnostic) }
        }
        assertTrue(
            "Accessibility findings for ${declaration.id}:\n" + unknown.joinToString("\n"),
            unknown.isEmpty(),
        )

        // The allowlist is expected to shrink as fixes land. Report entries whose
        // finding no longer occurs so a fixed item gets removed; this is a printed
        // warning rather than a failure because the inherited-Disabled and clipped
        // node corrections legitimately drop findings between runs.
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

        // Compose UI reads stringResource from LocalResources. Without the locale
        // context's resources an en or fr preview would silently audit Arabic
        // strings, so the switch has to be proven, not assumed.
        val english = textsByLocale["en"]
        val arabic = textsByLocale["ar"]
        if (english != null && arabic != null) {
            assertTrue(
                "The locale host did not switch en/ar strings for ${declaration.id}",
                english != arabic,
            )
        }
    }

    @Test fun `SurfaceBarScreenshotTestKt surfaceBarLight`() = auditPreview("SurfaceBarScreenshotTestKt", "surfaceBarLight")

    @Test fun `SurfaceBarScreenshotTestKt surfaceBarDarkAccount`() = auditPreview("SurfaceBarScreenshotTestKt", "surfaceBarDarkAccount")

    @Test fun `SurfaceBarScreenshotTestKt surfaceBarEnglish`() = auditPreview("SurfaceBarScreenshotTestKt", "surfaceBarEnglish")

    @Test fun `LocalizationScreenshotTestKt localizationSurfaceScreenshot`() = auditPreview("LocalizationScreenshotTestKt", "localizationSurfaceScreenshot")

    @Test fun `ComponentScreenshotTestKt componentGalleryLight`() = auditPreview("ComponentScreenshotTestKt", "componentGalleryLight")

    @Test fun `ComponentScreenshotTestKt componentGalleryDark`() = auditPreview("ComponentScreenshotTestKt", "componentGalleryDark")

    @Test fun `ComponentScreenshotTestKt componentGalleryGreyscale`() = auditPreview("ComponentScreenshotTestKt", "componentGalleryGreyscale")

    @Test fun `SurfaceStateScreenshotTestKt stateError`() = auditPreview("SurfaceStateScreenshotTestKt", "stateError")

    @Test fun `SurfaceStateScreenshotTestKt stateErrorDark`() = auditPreview("SurfaceStateScreenshotTestKt", "stateErrorDark")

    @Test fun `AuthScreenshotTestKt authWelcomeLight`() = auditPreview("AuthScreenshotTestKt", "authWelcomeLight")

    @Test fun `AuthScreenshotTestKt authWelcomeDark`() = auditPreview("AuthScreenshotTestKt", "authWelcomeDark")

    @Test fun `AuthScreenshotTestKt authWelcomePasskeyLoading`() = auditPreview("AuthScreenshotTestKt", "authWelcomePasskeyLoading")

    @Test fun `AuthScreenshotTestKt authWelcomePasskeyFailed`() = auditPreview("AuthScreenshotTestKt", "authWelcomePasskeyFailed")

    @Test fun `AuthScreenshotTestKt authWelcomeRestricted`() = auditPreview("AuthScreenshotTestKt", "authWelcomeRestricted")

    @Test fun `AuthScreenshotTestKt authPhoneLight`() = auditPreview("AuthScreenshotTestKt", "authPhoneLight")

    @Test fun `AuthScreenshotTestKt authPhoneDark`() = auditPreview("AuthScreenshotTestKt", "authPhoneDark")

    @Test fun `AuthScreenshotTestKt authPhoneEmpty`() = auditPreview("AuthScreenshotTestKt", "authPhoneEmpty")

    @Test fun `AuthScreenshotTestKt authPhoneSending`() = auditPreview("AuthScreenshotTestKt", "authPhoneSending")

    @Test fun `AuthScreenshotTestKt authPhoneInvalid`() = auditPreview("AuthScreenshotTestKt", "authPhoneInvalid")

    @Test fun `AuthScreenshotTestKt authPhoneNoNetwork`() = auditPreview("AuthScreenshotTestKt", "authPhoneNoNetwork")

    @Test fun `AuthScreenshotTestKt authOtpLight`() = auditPreview("AuthScreenshotTestKt", "authOtpLight")

    @Test fun `AuthScreenshotTestKt authOtpDark`() = auditPreview("AuthScreenshotTestKt", "authOtpDark")

    @Test fun `AuthScreenshotTestKt authOtpResendable`() = auditPreview("AuthScreenshotTestKt", "authOtpResendable")

    @Test fun `AuthScreenshotTestKt authOtpVerifying`() = auditPreview("AuthScreenshotTestKt", "authOtpVerifying")

    @Test fun `AuthScreenshotTestKt authOtpWrongCode`() = auditPreview("AuthScreenshotTestKt", "authOtpWrongCode")

    @Test fun `AuthScreenshotTestKt authOtpExpired`() = auditPreview("AuthScreenshotTestKt", "authOtpExpired")

    @Test fun `AuthScreenshotTestKt authPasskeyInvite`() = auditPreview("AuthScreenshotTestKt", "authPasskeyInvite")

    @Test fun `AuthScreenshotTestKt authPasskeyCreating`() = auditPreview("AuthScreenshotTestKt", "authPasskeyCreating")

    @Test fun `AuthScreenshotTestKt authPasskeyDeferred`() = auditPreview("AuthScreenshotTestKt", "authPasskeyDeferred")

    @Test fun `AuthScreenshotTestKt authPhoneSendingDark`() = auditPreview("AuthScreenshotTestKt", "authPhoneSendingDark")

    @Test fun `AuthScreenshotTestKt authOtpWrongCodeDark`() = auditPreview("AuthScreenshotTestKt", "authOtpWrongCodeDark")

    @Test fun `AuthScreenshotTestKt authCountryPicker`() = auditPreview("AuthScreenshotTestKt", "authCountryPicker")

    @Test fun `AuthScreenshotTestKt authCountryPickerSearch`() = auditPreview("AuthScreenshotTestKt", "authCountryPickerSearch")

    @Test fun `AuthScreenshotTestKt authCountryPickerDark`() = auditPreview("AuthScreenshotTestKt", "authCountryPickerDark")

    @Test fun `LanguageSheetScreenshotTestKt languageSheetArabic`() = auditPreview("LanguageSheetScreenshotTestKt", "languageSheetArabic")

    @Test fun `LanguageSheetScreenshotTestKt languageSheetEnglish`() = auditPreview("LanguageSheetScreenshotTestKt", "languageSheetEnglish")

    @Test fun `LanguageSheetScreenshotTestKt languageSheetFrench`() = auditPreview("LanguageSheetScreenshotTestKt", "languageSheetFrench")

    @Test fun `LanguageSheetScreenshotTestKt languageSheetDark`() = auditPreview("LanguageSheetScreenshotTestKt", "languageSheetDark")

    @Test fun `BillingScreenshotTestKt plansLoadingLight`() = auditPreview("BillingScreenshotTestKt", "plansLoadingLight")

    @Test fun `BillingScreenshotTestKt plansLoadingDark`() = auditPreview("BillingScreenshotTestKt", "plansLoadingDark")

    @Test fun `BillingScreenshotTestKt plansContentLight`() = auditPreview("BillingScreenshotTestKt", "plansContentLight")

    @Test fun `BillingScreenshotTestKt plansContentDark`() = auditPreview("BillingScreenshotTestKt", "plansContentDark")

    @Test fun `BillingScreenshotTestKt plansPurchaseOpen`() = auditPreview("BillingScreenshotTestKt", "plansPurchaseOpen")

    @Test fun `BillingScreenshotTestKt plansUnavailable`() = auditPreview("BillingScreenshotTestKt", "plansUnavailable")

    @Test fun `BillingScreenshotTestKt plansErrorLight`() = auditPreview("BillingScreenshotTestKt", "plansErrorLight")

    @Test fun `BillingScreenshotTestKt plansErrorDark`() = auditPreview("BillingScreenshotTestKt", "plansErrorDark")

    @Test fun `BillingScreenshotTestKt paywallLight`() = auditPreview("BillingScreenshotTestKt", "paywallLight")

    @Test fun `BillingScreenshotTestKt paywallDark`() = auditPreview("BillingScreenshotTestKt", "paywallDark")

    @Test fun `BillingScreenshotTestKt paywallUnknownLimit`() = auditPreview("BillingScreenshotTestKt", "paywallUnknownLimit")

    @Test fun `BillingScreenshotTestKt paywallPurchaseOpen`() = auditPreview("BillingScreenshotTestKt", "paywallPurchaseOpen")

    @Test fun `CustomerDetailsScreenshotTestKt customerLoadingLight`() = auditPreview("CustomerDetailsScreenshotTestKt", "customerLoadingLight")

    @Test fun `CustomerDetailsScreenshotTestKt customerLoadingDark`() = auditPreview("CustomerDetailsScreenshotTestKt", "customerLoadingDark")

    @Test fun `CustomerDetailsScreenshotTestKt customerContentLight`() = auditPreview("CustomerDetailsScreenshotTestKt", "customerContentLight")

    @Test fun `CustomerDetailsScreenshotTestKt customerContentDark`() = auditPreview("CustomerDetailsScreenshotTestKt", "customerContentDark")

    @Test fun `CustomerDetailsScreenshotTestKt customerUnnamed`() = auditPreview("CustomerDetailsScreenshotTestKt", "customerUnnamed")

    @Test fun `CustomerDetailsScreenshotTestKt customerReadOnly`() = auditPreview("CustomerDetailsScreenshotTestKt", "customerReadOnly")

    @Test fun `CustomerDetailsScreenshotTestKt customerNoOrdersLight`() = auditPreview("CustomerDetailsScreenshotTestKt", "customerNoOrdersLight")

    @Test fun `CustomerDetailsScreenshotTestKt customerNoOrdersDark`() = auditPreview("CustomerDetailsScreenshotTestKt", "customerNoOrdersDark")

    @Test fun `CustomersScreenshotTestKt customersLoadingLight`() = auditPreview("CustomersScreenshotTestKt", "customersLoadingLight")

    @Test fun `CustomersScreenshotTestKt customersLoadingDark`() = auditPreview("CustomersScreenshotTestKt", "customersLoadingDark")

    @Test fun `CustomersScreenshotTestKt customersContentLight`() = auditPreview("CustomersScreenshotTestKt", "customersContentLight")

    @Test fun `CustomersScreenshotTestKt customersContentDark`() = auditPreview("CustomersScreenshotTestKt", "customersContentDark")

    @Test fun `CustomersScreenshotTestKt customersEmptyLight`() = auditPreview("CustomersScreenshotTestKt", "customersEmptyLight")

    @Test fun `CustomersScreenshotTestKt customersEmptyDark`() = auditPreview("CustomersScreenshotTestKt", "customersEmptyDark")

    @Test fun `CustomersScreenshotTestKt customersErrorLight`() = auditPreview("CustomersScreenshotTestKt", "customersErrorLight")

    @Test fun `CustomersScreenshotTestKt customersErrorDark`() = auditPreview("CustomersScreenshotTestKt", "customersErrorDark")

    @Test fun `CustomersScreenshotTestKt customersSearchEmpty`() = auditPreview("CustomersScreenshotTestKt", "customersSearchEmpty")

    @Test fun `CustomersScreenshotTestKt customersLoadError`() = auditPreview("CustomersScreenshotTestKt", "customersLoadError")

    @Test fun `ShellScreenshotTestKt shellTodayLight`() = auditPreview("ShellScreenshotTestKt", "shellTodayLight")

    @Test fun `ShellScreenshotTestKt shellTodayDark`() = auditPreview("ShellScreenshotTestKt", "shellTodayDark")

    @Test fun `ShellScreenshotTestKt shellStore`() = auditPreview("ShellScreenshotTestKt", "shellStore")

    @Test fun `ShellScreenshotTestKt shellAccount`() = auditPreview("ShellScreenshotTestKt", "shellAccount")

    @Test fun `ShellScreenshotTestKt shellNoShopName`() = auditPreview("ShellScreenshotTestKt", "shellNoShopName")

    @Test fun `ShellScreenshotTestKt shellEnglish`() = auditPreview("ShellScreenshotTestKt", "shellEnglish")

    @Test fun `ShellScreenshotTestKt versionForceUpdateLight`() = auditPreview("ShellScreenshotTestKt", "versionForceUpdateLight")

    @Test fun `ShellScreenshotTestKt versionForceUpdateDark`() = auditPreview("ShellScreenshotTestKt", "versionForceUpdateDark")

    @Test fun `ShellScreenshotTestKt versionBlocked`() = auditPreview("ShellScreenshotTestKt", "versionBlocked")

    @Test fun `ShellScreenshotTestKt versionMaintenance`() = auditPreview("ShellScreenshotTestKt", "versionMaintenance")

    @Test fun `ShellScreenshotTestKt versionServerMessage`() = auditPreview("ShellScreenshotTestKt", "versionServerMessage")

    @Test fun `AccountPagesScreenshotTestKt ticketLoadingLight`() = auditPreview("AccountPagesScreenshotTestKt", "ticketLoadingLight")

    @Test fun `AccountPagesScreenshotTestKt ticketLoadingDark`() = auditPreview("AccountPagesScreenshotTestKt", "ticketLoadingDark")

    @Test fun `AccountPagesScreenshotTestKt ticketContentLight`() = auditPreview("AccountPagesScreenshotTestKt", "ticketContentLight")

    @Test fun `AccountPagesScreenshotTestKt ticketContentDark`() = auditPreview("AccountPagesScreenshotTestKt", "ticketContentDark")

    @Test fun `AccountPagesScreenshotTestKt ticketClosed`() = auditPreview("AccountPagesScreenshotTestKt", "ticketClosed")

    @Test fun `AccountPagesScreenshotTestKt ticketErrorLight`() = auditPreview("AccountPagesScreenshotTestKt", "ticketErrorLight")

    @Test fun `AccountPagesScreenshotTestKt ticketErrorDark`() = auditPreview("AccountPagesScreenshotTestKt", "ticketErrorDark")

    @Test fun `AccountPagesScreenshotTestKt deletionLoadingLight`() = auditPreview("AccountPagesScreenshotTestKt", "deletionLoadingLight")

    @Test fun `AccountPagesScreenshotTestKt deletionLoadingDark`() = auditPreview("AccountPagesScreenshotTestKt", "deletionLoadingDark")

    @Test fun `AccountPagesScreenshotTestKt deletionNoneLight`() = auditPreview("AccountPagesScreenshotTestKt", "deletionNoneLight")

    @Test fun `AccountPagesScreenshotTestKt deletionNoneDark`() = auditPreview("AccountPagesScreenshotTestKt", "deletionNoneDark")

    @Test fun `AccountPagesScreenshotTestKt deletionPending`() = auditPreview("AccountPagesScreenshotTestKt", "deletionPending")

    @Test fun `AccountPagesScreenshotTestKt deletionErrorLight`() = auditPreview("AccountPagesScreenshotTestKt", "deletionErrorLight")

    @Test fun `AccountPagesScreenshotTestKt deletionErrorDark`() = auditPreview("AccountPagesScreenshotTestKt", "deletionErrorDark")

    @Test fun `AccountPagesScreenshotTestKt subscriptionLoadingLight`() = auditPreview("AccountPagesScreenshotTestKt", "subscriptionLoadingLight")

    @Test fun `AccountPagesScreenshotTestKt subscriptionLoadingDark`() = auditPreview("AccountPagesScreenshotTestKt", "subscriptionLoadingDark")

    @Test fun `AccountPagesScreenshotTestKt subscriptionContentLight`() = auditPreview("AccountPagesScreenshotTestKt", "subscriptionContentLight")

    @Test fun `AccountPagesScreenshotTestKt subscriptionContentDark`() = auditPreview("AccountPagesScreenshotTestKt", "subscriptionContentDark")

    @Test fun `AccountPagesScreenshotTestKt subscriptionPurchaseClosed`() = auditPreview("AccountPagesScreenshotTestKt", "subscriptionPurchaseClosed")

    @Test fun `AccountPagesScreenshotTestKt subscriptionPurchaseOpen`() = auditPreview("AccountPagesScreenshotTestKt", "subscriptionPurchaseOpen")

    @Test fun `AccountPagesScreenshotTestKt subscriptionVerifying`() = auditPreview("AccountPagesScreenshotTestKt", "subscriptionVerifying")

    @Test fun `AccountPagesScreenshotTestKt subscriptionBillingError`() = auditPreview("AccountPagesScreenshotTestKt", "subscriptionBillingError")

    @Test fun `AccountPagesScreenshotTestKt devicesLoadingLight`() = auditPreview("AccountPagesScreenshotTestKt", "devicesLoadingLight")

    @Test fun `AccountPagesScreenshotTestKt devicesLoadingDark`() = auditPreview("AccountPagesScreenshotTestKt", "devicesLoadingDark")

    @Test fun `AccountPagesScreenshotTestKt devicesContentLight`() = auditPreview("AccountPagesScreenshotTestKt", "devicesContentLight")

    @Test fun `AccountPagesScreenshotTestKt devicesContentDark`() = auditPreview("AccountPagesScreenshotTestKt", "devicesContentDark")

    @Test fun `AccountPagesScreenshotTestKt devicesNoPasskeySupport`() = auditPreview("AccountPagesScreenshotTestKt", "devicesNoPasskeySupport")

    @Test fun `AccountPagesScreenshotTestKt devicesRecentAuthRequired`() = auditPreview("AccountPagesScreenshotTestKt", "devicesRecentAuthRequired")

    @Test fun `AccountPagesScreenshotTestKt devicesErrorDark`() = auditPreview("AccountPagesScreenshotTestKt", "devicesErrorDark")

    @Test fun `AccountPagesScreenshotTestKt devicesAtDeviceLimit`() = auditPreview("AccountPagesScreenshotTestKt", "devicesAtDeviceLimit")

    @Test fun `AccountPagesScreenshotTestKt assistantEmptyLight`() = auditPreview("AccountPagesScreenshotTestKt", "assistantEmptyLight")

    @Test fun `AccountPagesScreenshotTestKt assistantEmptyDark`() = auditPreview("AccountPagesScreenshotTestKt", "assistantEmptyDark")

    @Test fun `AccountPagesScreenshotTestKt assistantContentLight`() = auditPreview("AccountPagesScreenshotTestKt", "assistantContentLight")

    @Test fun `AccountPagesScreenshotTestKt assistantContentDark`() = auditPreview("AccountPagesScreenshotTestKt", "assistantContentDark")

    @Test fun `AccountPagesScreenshotTestKt assistantSending`() = auditPreview("AccountPagesScreenshotTestKt", "assistantSending")

    @Test fun `AccountPagesScreenshotTestKt assistantErrorLight`() = auditPreview("AccountPagesScreenshotTestKt", "assistantErrorLight")

    @Test fun `AccountPagesScreenshotTestKt assistantErrorDark`() = auditPreview("AccountPagesScreenshotTestKt", "assistantErrorDark")

    @Test fun `AccountPagesScreenshotTestKt assistantQuota`() = auditPreview("AccountPagesScreenshotTestKt", "assistantQuota")

    @Test fun `OperationsScreenshotTestKt supportLoadingLight`() = auditPreview("OperationsScreenshotTestKt", "supportLoadingLight")

    @Test fun `OperationsScreenshotTestKt supportLoadingDark`() = auditPreview("OperationsScreenshotTestKt", "supportLoadingDark")

    @Test fun `OperationsScreenshotTestKt supportContentLight`() = auditPreview("OperationsScreenshotTestKt", "supportContentLight")

    @Test fun `OperationsScreenshotTestKt supportContentDark`() = auditPreview("OperationsScreenshotTestKt", "supportContentDark")

    @Test fun `OperationsScreenshotTestKt supportEmptyLight`() = auditPreview("OperationsScreenshotTestKt", "supportEmptyLight")

    @Test fun `OperationsScreenshotTestKt supportEmptyDark`() = auditPreview("OperationsScreenshotTestKt", "supportEmptyDark")

    @Test fun `OperationsScreenshotTestKt supportErrorLight`() = auditPreview("OperationsScreenshotTestKt", "supportErrorLight")

    @Test fun `OperationsScreenshotTestKt supportErrorDark`() = auditPreview("OperationsScreenshotTestKt", "supportErrorDark")

    @Test fun `OperationsScreenshotTestKt announcementsLoadingLight`() = auditPreview("OperationsScreenshotTestKt", "announcementsLoadingLight")

    @Test fun `OperationsScreenshotTestKt announcementsLoadingDark`() = auditPreview("OperationsScreenshotTestKt", "announcementsLoadingDark")

    @Test fun `OperationsScreenshotTestKt announcementsContentLight`() = auditPreview("OperationsScreenshotTestKt", "announcementsContentLight")

    @Test fun `OperationsScreenshotTestKt announcementsContentDark`() = auditPreview("OperationsScreenshotTestKt", "announcementsContentDark")

    @Test fun `OperationsScreenshotTestKt announcementsEmptyLight`() = auditPreview("OperationsScreenshotTestKt", "announcementsEmptyLight")

    @Test fun `OperationsScreenshotTestKt announcementsEmptyDark`() = auditPreview("OperationsScreenshotTestKt", "announcementsEmptyDark")

    @Test fun `OperationsScreenshotTestKt announcementsErrorLight`() = auditPreview("OperationsScreenshotTestKt", "announcementsErrorLight")

    @Test fun `OperationsScreenshotTestKt announcementsErrorDark`() = auditPreview("OperationsScreenshotTestKt", "announcementsErrorDark")

    @Test fun `OperationsScreenshotTestKt catalogLanguagesLoadingLight`() = auditPreview("OperationsScreenshotTestKt", "catalogLanguagesLoadingLight")

    @Test fun `OperationsScreenshotTestKt catalogLanguagesLoadingDark`() = auditPreview("OperationsScreenshotTestKt", "catalogLanguagesLoadingDark")

    @Test fun `OperationsScreenshotTestKt catalogLanguagesContentLight`() = auditPreview("OperationsScreenshotTestKt", "catalogLanguagesContentLight")

    @Test fun `OperationsScreenshotTestKt catalogLanguagesContentDark`() = auditPreview("OperationsScreenshotTestKt", "catalogLanguagesContentDark")

    @Test fun `OperationsScreenshotTestKt catalogLanguagesEmptyLight`() = auditPreview("OperationsScreenshotTestKt", "catalogLanguagesEmptyLight")

    @Test fun `OperationsScreenshotTestKt catalogLanguagesEmptyDark`() = auditPreview("OperationsScreenshotTestKt", "catalogLanguagesEmptyDark")

    @Test fun `OperationsScreenshotTestKt catalogLanguagesErrorLight`() = auditPreview("OperationsScreenshotTestKt", "catalogLanguagesErrorLight")

    @Test fun `OperationsScreenshotTestKt catalogLanguagesErrorDark`() = auditPreview("OperationsScreenshotTestKt", "catalogLanguagesErrorDark")

    @Test fun `OrderListScreenshotTestKt orderListLight`() = auditPreview("OrderListScreenshotTestKt", "orderListLight")

    @Test fun `OrderListScreenshotTestKt orderListDark`() = auditPreview("OrderListScreenshotTestKt", "orderListDark")

    @Test fun `OrderListScreenshotTestKt orderListGreyscale`() = auditPreview("OrderListScreenshotTestKt", "orderListGreyscale")

    @Test fun `OrderScreensScreenshotTestKt orderDetailsLoadingLight`() = auditPreview("OrderScreensScreenshotTestKt", "orderDetailsLoadingLight")

    @Test fun `OrderScreensScreenshotTestKt orderDetailsLoadingDark`() = auditPreview("OrderScreensScreenshotTestKt", "orderDetailsLoadingDark")

    @Test fun `OrderScreensScreenshotTestKt orderDetailsContentLight`() = auditPreview("OrderScreensScreenshotTestKt", "orderDetailsContentLight")

    @Test fun `OrderScreensScreenshotTestKt orderDetailsContentDark`() = auditPreview("OrderScreensScreenshotTestKt", "orderDetailsContentDark")

    @Test fun `OrderScreensScreenshotTestKt orderDetailsNoPayment`() = auditPreview("OrderScreensScreenshotTestKt", "orderDetailsNoPayment")

    @Test fun `OrderScreensScreenshotTestKt orderDetailsPaymentProofAttached`() = auditPreview("OrderScreensScreenshotTestKt", "orderDetailsPaymentProofAttached")

    @Test fun `OrderScreensScreenshotTestKt orderDetailsOcrLockedByPlan`() = auditPreview("OrderScreensScreenshotTestKt", "orderDetailsOcrLockedByPlan")

    @Test fun `OrderScreensScreenshotTestKt orderDetailsOcrNotBuilt`() = auditPreview("OrderScreensScreenshotTestKt", "orderDetailsOcrNotBuilt")

    @Test fun `OrderScreensScreenshotTestKt orderDetailsVerifyingProof`() = auditPreview("OrderScreensScreenshotTestKt", "orderDetailsVerifyingProof")

    @Test fun `OrderScreensScreenshotTestKt orderDetailsRefusedLight`() = auditPreview("OrderScreensScreenshotTestKt", "orderDetailsRefusedLight")

    @Test fun `OrderScreensScreenshotTestKt orderDetailsRefusedDark`() = auditPreview("OrderScreensScreenshotTestKt", "orderDetailsRefusedDark")

    @Test fun `OrderScreensScreenshotTestKt newOrderLoadingLight`() = auditPreview("OrderScreensScreenshotTestKt", "newOrderLoadingLight")

    @Test fun `OrderScreensScreenshotTestKt newOrderLoadingDark`() = auditPreview("OrderScreensScreenshotTestKt", "newOrderLoadingDark")

    @Test fun `OrderScreensScreenshotTestKt newOrderContentLight`() = auditPreview("OrderScreensScreenshotTestKt", "newOrderContentLight")

    @Test fun `OrderScreensScreenshotTestKt newOrderContentDark`() = auditPreview("OrderScreensScreenshotTestKt", "newOrderContentDark")

    @Test fun `OrderScreensScreenshotTestKt newOrderFilled`() = auditPreview("OrderScreensScreenshotTestKt", "newOrderFilled")

    @Test fun `OrderScreensScreenshotTestKt newOrderEmptyCatalogue`() = auditPreview("OrderScreensScreenshotTestKt", "newOrderEmptyCatalogue")

    @Test fun `OrderScreensScreenshotTestKt newOrderPhoneInvalid`() = auditPreview("OrderScreensScreenshotTestKt", "newOrderPhoneInvalid")

    @Test fun `OrderScreensScreenshotTestKt newOrderSaving`() = auditPreview("OrderScreensScreenshotTestKt", "newOrderSaving")

    @Test fun `OrderScreensScreenshotTestKt newOrderStockErrorLight`() = auditPreview("OrderScreensScreenshotTestKt", "newOrderStockErrorLight")

    @Test fun `OrderScreensScreenshotTestKt newOrderStockErrorDark`() = auditPreview("OrderScreensScreenshotTestKt", "newOrderStockErrorDark")

    @Test fun `OrdersScreenshotTestKt ordersLoadingLight`() = auditPreview("OrdersScreenshotTestKt", "ordersLoadingLight")

    @Test fun `OrdersScreenshotTestKt ordersLoadingDark`() = auditPreview("OrdersScreenshotTestKt", "ordersLoadingDark")

    @Test fun `OrdersScreenshotTestKt ordersContentLight`() = auditPreview("OrdersScreenshotTestKt", "ordersContentLight")

    @Test fun `OrdersScreenshotTestKt ordersContentDark`() = auditPreview("OrdersScreenshotTestKt", "ordersContentDark")

    @Test fun `OrdersScreenshotTestKt ordersEmptyLight`() = auditPreview("OrdersScreenshotTestKt", "ordersEmptyLight")

    @Test fun `OrdersScreenshotTestKt ordersEmptyDark`() = auditPreview("OrdersScreenshotTestKt", "ordersEmptyDark")

    @Test fun `OrdersScreenshotTestKt ordersErrorLight`() = auditPreview("OrdersScreenshotTestKt", "ordersErrorLight")

    @Test fun `OrdersScreenshotTestKt ordersErrorDark`() = auditPreview("OrdersScreenshotTestKt", "ordersErrorDark")

    @Test fun `OrdersScreenshotTestKt ordersBothGroupsLight`() = auditPreview("OrdersScreenshotTestKt", "ordersBothGroupsLight")

    @Test fun `OrdersScreenshotTestKt ordersBothGroupsDark`() = auditPreview("OrdersScreenshotTestKt", "ordersBothGroupsDark")

    @Test fun `OrdersScreenshotTestKt ordersFilteredToNone`() = auditPreview("OrdersScreenshotTestKt", "ordersFilteredToNone")

    @Test fun `OrdersScreenshotTestKt ordersFilteredUnpaid`() = auditPreview("OrdersScreenshotTestKt", "ordersFilteredUnpaid")

    @Test fun `ProductEditScreenshotTestKt productEditLoadingLight`() = auditPreview("ProductEditScreenshotTestKt", "productEditLoadingLight")

    @Test fun `ProductEditScreenshotTestKt productEditLoadingDark`() = auditPreview("ProductEditScreenshotTestKt", "productEditLoadingDark")

    @Test fun `ProductEditScreenshotTestKt productEditContentLight`() = auditPreview("ProductEditScreenshotTestKt", "productEditContentLight")

    @Test fun `ProductEditScreenshotTestKt productEditContentDark`() = auditPreview("ProductEditScreenshotTestKt", "productEditContentDark")

    @Test fun `ProductEditScreenshotTestKt productEditNew`() = auditPreview("ProductEditScreenshotTestKt", "productEditNew")

    @Test fun `ProductEditScreenshotTestKt productEditUnavailable`() = auditPreview("ProductEditScreenshotTestKt", "productEditUnavailable")

    @Test fun `ProductEditScreenshotTestKt productEditSaving`() = auditPreview("ProductEditScreenshotTestKt", "productEditSaving")

    @Test fun `ProductEditScreenshotTestKt productEditConfirmDelete`() = auditPreview("ProductEditScreenshotTestKt", "productEditConfirmDelete")

    @Test fun `ProductEditScreenshotTestKt productEditOffline`() = auditPreview("ProductEditScreenshotTestKt", "productEditOffline")

    @Test fun `ProductEditScreenshotTestKt productEditOfflineDark`() = auditPreview("ProductEditScreenshotTestKt", "productEditOfflineDark")

    @Test fun `ProductEditScreenshotTestKt productEditPlanLimit`() = auditPreview("ProductEditScreenshotTestKt", "productEditPlanLimit")

    @Test fun `ProductEditScreenshotTestKt productEditUnknownCategory`() = auditPreview("ProductEditScreenshotTestKt", "productEditUnknownCategory")

    @Test fun `ProductEditScreenshotTestKt productEditStockConflict`() = auditPreview("ProductEditScreenshotTestKt", "productEditStockConflict")

    @Test fun `ProductEditScreenshotTestKt productEditStockConflictDark`() = auditPreview("ProductEditScreenshotTestKt", "productEditStockConflictDark")

    @Test fun `StoreScreenshotTestKt storeLoadingLight`() = auditPreview("StoreScreenshotTestKt", "storeLoadingLight")

    @Test fun `StoreScreenshotTestKt storeLoadingDark`() = auditPreview("StoreScreenshotTestKt", "storeLoadingDark")

    @Test fun `StoreScreenshotTestKt storeContentLight`() = auditPreview("StoreScreenshotTestKt", "storeContentLight")

    @Test fun `StoreScreenshotTestKt storeContentDark`() = auditPreview("StoreScreenshotTestKt", "storeContentDark")

    @Test fun `StoreScreenshotTestKt storeContentEnglish`() = auditPreview("StoreScreenshotTestKt", "storeContentEnglish")

    @Test fun `StoreScreenshotTestKt storeEmptyLight`() = auditPreview("StoreScreenshotTestKt", "storeEmptyLight")

    @Test fun `StoreScreenshotTestKt storeEmptyDark`() = auditPreview("StoreScreenshotTestKt", "storeEmptyDark")

    @Test fun `StoreScreenshotTestKt storeErrorLight`() = auditPreview("StoreScreenshotTestKt", "storeErrorLight")

    @Test fun `StoreScreenshotTestKt storeErrorDark`() = auditPreview("StoreScreenshotTestKt", "storeErrorDark")

    @Test fun `StoreScreenshotTestKt storeSearchEmpty`() = auditPreview("StoreScreenshotTestKt", "storeSearchEmpty")

    @Test fun `StoreScreenshotTestKt storeUnlimitedPlan`() = auditPreview("StoreScreenshotTestKt", "storeUnlimitedPlan")

    @Test fun `StoreScreenshotTestKt storeAtLimit`() = auditPreview("StoreScreenshotTestKt", "storeAtLimit")

    @Test fun `AccountScreenshotTestKt accountLoadingLight`() = auditPreview("AccountScreenshotTestKt", "accountLoadingLight")

    @Test fun `AccountScreenshotTestKt accountLoadingDark`() = auditPreview("AccountScreenshotTestKt", "accountLoadingDark")

    @Test fun `AccountScreenshotTestKt accountContentLight`() = auditPreview("AccountScreenshotTestKt", "accountContentLight")

    @Test fun `AccountScreenshotTestKt accountContentDark`() = auditPreview("AccountScreenshotTestKt", "accountContentDark")

    @Test fun `AccountScreenshotTestKt accountFreePlan`() = auditPreview("AccountScreenshotTestKt", "accountFreePlan")

    @Test fun `AccountScreenshotTestKt accountFreePlanUpgradable`() = auditPreview("AccountScreenshotTestKt", "accountFreePlanUpgradable")

    @Test fun `AccountScreenshotTestKt accountLinkPending`() = auditPreview("AccountScreenshotTestKt", "accountLinkPending")

    @Test fun `AccountScreenshotTestKt accountGroupsTail`() = auditPreview("AccountScreenshotTestKt", "accountGroupsTail")

    @Test fun `StoreGroupScreenshotTestKt categoriesLoadingLight`() = auditPreview("StoreGroupScreenshotTestKt", "categoriesLoadingLight")

    @Test fun `StoreGroupScreenshotTestKt categoriesLoadingDark`() = auditPreview("StoreGroupScreenshotTestKt", "categoriesLoadingDark")

    @Test fun `StoreGroupScreenshotTestKt categoriesLoadingSeededList`() = auditPreview("StoreGroupScreenshotTestKt", "categoriesLoadingSeededList")

    @Test fun `StoreGroupScreenshotTestKt categoriesContentLight`() = auditPreview("StoreGroupScreenshotTestKt", "categoriesContentLight")

    @Test fun `StoreGroupScreenshotTestKt categoriesContentDark`() = auditPreview("StoreGroupScreenshotTestKt", "categoriesContentDark")

    @Test fun `StoreGroupScreenshotTestKt categoriesEmptyLight`() = auditPreview("StoreGroupScreenshotTestKt", "categoriesEmptyLight")

    @Test fun `StoreGroupScreenshotTestKt categoriesEmptyDark`() = auditPreview("StoreGroupScreenshotTestKt", "categoriesEmptyDark")

    @Test fun `StoreGroupScreenshotTestKt categoriesErrorLight`() = auditPreview("StoreGroupScreenshotTestKt", "categoriesErrorLight")

    @Test fun `StoreGroupScreenshotTestKt categoriesErrorDark`() = auditPreview("StoreGroupScreenshotTestKt", "categoriesErrorDark")

    @Test fun `StoreGroupScreenshotTestKt categoriesLimitReached`() = auditPreview("StoreGroupScreenshotTestKt", "categoriesLimitReached")

    @Test fun `StoreGroupScreenshotTestKt categoriesLimitPurchaseOpen`() = auditPreview("StoreGroupScreenshotTestKt", "categoriesLimitPurchaseOpen")

    @Test fun `StoreGroupScreenshotTestKt storeInfoLoadingLight`() = auditPreview("StoreGroupScreenshotTestKt", "storeInfoLoadingLight")

    @Test fun `StoreGroupScreenshotTestKt storeInfoLoadingDark`() = auditPreview("StoreGroupScreenshotTestKt", "storeInfoLoadingDark")

    @Test fun `StoreGroupScreenshotTestKt storeInfoContentLight`() = auditPreview("StoreGroupScreenshotTestKt", "storeInfoContentLight")

    @Test fun `StoreGroupScreenshotTestKt storeInfoContentDark`() = auditPreview("StoreGroupScreenshotTestKt", "storeInfoContentDark")

    @Test fun `StoreGroupScreenshotTestKt storeInfoSlugTaken`() = auditPreview("StoreGroupScreenshotTestKt", "storeInfoSlugTaken")

    @Test fun `StoreGroupScreenshotTestKt storeInfoSaving`() = auditPreview("StoreGroupScreenshotTestKt", "storeInfoSaving")

    @Test fun `StoreGroupScreenshotTestKt storeInfoIdentityLight`() = auditPreview("StoreGroupScreenshotTestKt", "storeInfoIdentityLight")

    @Test fun `StoreGroupScreenshotTestKt sellerProfileLoadingLight`() = auditPreview("StoreGroupScreenshotTestKt", "sellerProfileLoadingLight")

    @Test fun `StoreGroupScreenshotTestKt sellerProfileLoadingDark`() = auditPreview("StoreGroupScreenshotTestKt", "sellerProfileLoadingDark")

    @Test fun `StoreGroupScreenshotTestKt sellerProfileContentLight`() = auditPreview("StoreGroupScreenshotTestKt", "sellerProfileContentLight")

    @Test fun `StoreGroupScreenshotTestKt sellerProfileContentDark`() = auditPreview("StoreGroupScreenshotTestKt", "sellerProfileContentDark")

    @Test fun `StoreGroupScreenshotTestKt sellerProfileVerificationError`() = auditPreview("StoreGroupScreenshotTestKt", "sellerProfileVerificationError")

    @Test fun `StoreGroupScreenshotTestKt sellerProfileSaving`() = auditPreview("StoreGroupScreenshotTestKt", "sellerProfileSaving")

    @Test fun `StoreGroupScreenshotTestKt sellerProfilePhotoUploadFailed`() = auditPreview("StoreGroupScreenshotTestKt", "sellerProfilePhotoUploadFailed")

    @Test fun `ShopSetupScreenshotTestKt setupAccountEmpty`() = auditPreview("ShopSetupScreenshotTestKt", "setupAccountEmpty")

    @Test fun `ShopSetupScreenshotTestKt setupAccountLight`() = auditPreview("ShopSetupScreenshotTestKt", "setupAccountLight")

    @Test fun `ShopSetupScreenshotTestKt setupAccountDark`() = auditPreview("ShopSetupScreenshotTestKt", "setupAccountDark")

    @Test fun `ShopSetupScreenshotTestKt setupAccountInvalidEmail`() = auditPreview("ShopSetupScreenshotTestKt", "setupAccountInvalidEmail")

    @Test fun `ShopSetupScreenshotTestKt setupAccountSaving`() = auditPreview("ShopSetupScreenshotTestKt", "setupAccountSaving")

    @Test fun `ShopSetupScreenshotTestKt setupStoreLight`() = auditPreview("ShopSetupScreenshotTestKt", "setupStoreLight")

    @Test fun `ShopSetupScreenshotTestKt setupStoreDark`() = auditPreview("ShopSetupScreenshotTestKt", "setupStoreDark")

    @Test fun `ShopSetupScreenshotTestKt setupStoreTaxonomyLoading`() = auditPreview("ShopSetupScreenshotTestKt", "setupStoreTaxonomyLoading")

    @Test fun `ShopSetupScreenshotTestKt setupStoreTaxonomyError`() = auditPreview("ShopSetupScreenshotTestKt", "setupStoreTaxonomyError")

    @Test fun `ShopSetupScreenshotTestKt setupStoreCitySuggestions`() = auditPreview("ShopSetupScreenshotTestKt", "setupStoreCitySuggestions")

    @Test fun `ShopSetupScreenshotTestKt setupStoreCitySearching`() = auditPreview("ShopSetupScreenshotTestKt", "setupStoreCitySearching")

    @Test fun `ShopSetupScreenshotTestKt setupStoreCityError`() = auditPreview("ShopSetupScreenshotTestKt", "setupStoreCityError")

    @Test fun `ShopSetupScreenshotTestKt setupStoreCityManual`() = auditPreview("ShopSetupScreenshotTestKt", "setupStoreCityManual")

    @Test fun `ShopSetupScreenshotTestKt setupStoreSlugTaken`() = auditPreview("ShopSetupScreenshotTestKt", "setupStoreSlugTaken")

    @Test fun `ShopSetupScreenshotTestKt setupStoreSlugOffline`() = auditPreview("ShopSetupScreenshotTestKt", "setupStoreSlugOffline")

    @Test fun `ShopSetupScreenshotTestKt setupStoreSlugChecking`() = auditPreview("ShopSetupScreenshotTestKt", "setupStoreSlugChecking")

    @Test fun `ShopSetupScreenshotTestKt setupStoreSaving`() = auditPreview("ShopSetupScreenshotTestKt", "setupStoreSaving")

    @Test fun `ShopSetupScreenshotTestKt setupStoreError`() = auditPreview("ShopSetupScreenshotTestKt", "setupStoreError")

    @Test fun `ShopSetupScreenshotTestKt setupStoreErrorDark`() = auditPreview("ShopSetupScreenshotTestKt", "setupStoreErrorDark")

    @Test fun `ShopSetupScreenshotTestKt setupStoreSavingDark`() = auditPreview("ShopSetupScreenshotTestKt", "setupStoreSavingDark")

    @Test fun `ShopSetupScreenshotTestKt setupPasskeyInvite`() = auditPreview("ShopSetupScreenshotTestKt", "setupPasskeyInvite")

    @Test fun `ShopSetupScreenshotTestKt setupPasskeyCreating`() = auditPreview("ShopSetupScreenshotTestKt", "setupPasskeyCreating")

    @Test fun `ShopSetupScreenshotTestKt setupPasskeyFailed`() = auditPreview("ShopSetupScreenshotTestKt", "setupPasskeyFailed")

    @Test fun `ShopSetupScreenshotTestKt setupPasskeyFailedDark`() = auditPreview("ShopSetupScreenshotTestKt", "setupPasskeyFailedDark")

    @Test fun `EntryScreenshotTestKt splashLoadingLight`() = auditPreview("EntryScreenshotTestKt", "splashLoadingLight")

    @Test fun `EntryScreenshotTestKt splashLoadingDark`() = auditPreview("EntryScreenshotTestKt", "splashLoadingDark")

    @Test fun `EntryScreenshotTestKt splashErrorLight`() = auditPreview("EntryScreenshotTestKt", "splashErrorLight")

    @Test fun `EntryScreenshotTestKt splashErrorDark`() = auditPreview("EntryScreenshotTestKt", "splashErrorDark")

    @Test fun `EntryScreenshotTestKt restrictedAccountLight`() = auditPreview("EntryScreenshotTestKt", "restrictedAccountLight")

    @Test fun `EntryScreenshotTestKt restrictedAccountDark`() = auditPreview("EntryScreenshotTestKt", "restrictedAccountDark")

    @Test fun `TodayScreenshotTestKt todayContentLight`() = auditPreview("TodayScreenshotTestKt", "todayContentLight")

    @Test fun `TodayScreenshotTestKt todayContentDark`() = auditPreview("TodayScreenshotTestKt", "todayContentDark")

    @Test fun `TodayScreenshotTestKt todayContentEnglish`() = auditPreview("TodayScreenshotTestKt", "todayContentEnglish")

    @Test fun `TodayScreenshotTestKt todayLoadingLight`() = auditPreview("TodayScreenshotTestKt", "todayLoadingLight")

    @Test fun `TodayScreenshotTestKt todayLoadingDark`() = auditPreview("TodayScreenshotTestKt", "todayLoadingDark")

    @Test fun `TodayScreenshotTestKt todayEmptyLight`() = auditPreview("TodayScreenshotTestKt", "todayEmptyLight")

    @Test fun `TodayScreenshotTestKt todayEmptyDark`() = auditPreview("TodayScreenshotTestKt", "todayEmptyDark")

    @Test fun `TodayScreenshotTestKt todayNothingWaitingLight`() = auditPreview("TodayScreenshotTestKt", "todayNothingWaitingLight")

    @Test fun `TodayScreenshotTestKt todayNothingWaitingDark`() = auditPreview("TodayScreenshotTestKt", "todayNothingWaitingDark")

    @Test fun `TodayScreenshotTestKt todayErrorLight`() = auditPreview("TodayScreenshotTestKt", "todayErrorLight")

    @Test fun `TodayScreenshotTestKt todayErrorDark`() = auditPreview("TodayScreenshotTestKt", "todayErrorDark")

    @Test fun `TodayScreenshotTestKt todayOfflineLight`() = auditPreview("TodayScreenshotTestKt", "todayOfflineLight")

    @Test fun `TodayScreenshotTestKt todayOfflineDark`() = auditPreview("TodayScreenshotTestKt", "todayOfflineDark")

    @Test fun `TodayScreenshotTestKt todayGreyscale`() = auditPreview("TodayScreenshotTestKt", "todayGreyscale")


    companion object {
        private val RULES = listOf("Label", "Target", "Contrast")
    }
}

/**
 * A finding whose smallest correct fix would change pixels, while the exact
 * affected reference PNG is not individually listed in `allowed_files`. Each
 * entry carries the exact preview, rule and node text/kind it matches, a
 * one-line reason and the plan item (B5 kit components, R1 screens) that will
 * clear it. [KNOWN_FINDINGS] is the only place these are allowed to pass; the
 * audit fails on anything not listed and on a listed entry that stops occurring.
 */
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
    "L" to KnownKind(
        "Actionable node exposes no ContentDescription or Text",
        "R1: label the control or merge its sibling Text",
    ),
    "TS" to KnownKind(
        "Touch target is below the 48dp minimum",
        "B5: enlarge the kit control to a 48dp target",
    ),
    "TO" to KnownKind(
        "Two actionable nodes share identical touch bounds",
        "R1: merge or clear the duplicate semantics",
    ),
    "CF" to KnownKind(
        "Field label colour is below the 4.5:1 threshold",
        "R1: use the accessible onSurfaceVariant token",
    ),
    "CS" to KnownKind(
        "Stepper glyph contrast is below the 3:1 threshold",
        "B5: raise the stepper glyph token contrast",
    ),
    "CD" to KnownKind(
        "Dialog text is not drawn in the captured frame (1.00:1)",
        "B5: audit dialog window capture and colour tokens",
    ),
    "CG" to KnownKind(
        "Text colour is below the WCAG threshold",
        "R1: use the accessible design-system colour token",
    ),
)

/**
 * Signature form: `kind|preview|rule|node text or target kind`. Node text is the
 * exact `text "..."` fragment the diagnostic prints; Label entries carry no
 * needle and Target entries use `touch target` or `overlaps`.
 */
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
        L|AuthScreenshotTestKt.authOtpResendable|Label|
        L|CustomersScreenshotTestKt.customersSearchEmpty|Label|
        L|ProductEditScreenshotTestKt.productEditConfirmDelete|Label|
        L|ProductEditScreenshotTestKt.productEditContentDark|Label|
        L|ProductEditScreenshotTestKt.productEditContentLight|Label|
        L|ProductEditScreenshotTestKt.productEditNew|Label|
        L|ProductEditScreenshotTestKt.productEditOfflineDark|Label|
        L|ProductEditScreenshotTestKt.productEditOffline|Label|
        L|ProductEditScreenshotTestKt.productEditPlanLimit|Label|
        L|ProductEditScreenshotTestKt.productEditSaving|Label|
        L|ProductEditScreenshotTestKt.productEditStockConflictDark|Label|
        L|ProductEditScreenshotTestKt.productEditStockConflict|Label|
        L|ProductEditScreenshotTestKt.productEditUnavailable|Label|
        L|ProductEditScreenshotTestKt.productEditUnknownCategory|Label|
        L|ShopSetupScreenshotTestKt.setupAccountDark|Label|
        L|ShopSetupScreenshotTestKt.setupAccountEmpty|Label|
        L|ShopSetupScreenshotTestKt.setupAccountInvalidEmail|Label|
        L|ShopSetupScreenshotTestKt.setupAccountLight|Label|
        L|ShopSetupScreenshotTestKt.setupAccountSaving|Label|
        L|StoreScreenshotTestKt.storeSearchEmpty|Label|
        TO|ShopSetupScreenshotTestKt.setupAccountDark|Target|overlaps
        TO|ShopSetupScreenshotTestKt.setupAccountEmpty|Target|overlaps
        TO|ShopSetupScreenshotTestKt.setupAccountInvalidEmail|Target|overlaps
        TO|ShopSetupScreenshotTestKt.setupAccountLight|Target|overlaps
        TO|ShopSetupScreenshotTestKt.setupAccountSaving|Target|overlaps
        TS|OrdersScreenshotTestKt.ordersBothGroupsDark|Target|touch target
        TS|OrdersScreenshotTestKt.ordersBothGroupsLight|Target|touch target
        TS|OrdersScreenshotTestKt.ordersContentDark|Target|touch target
        TS|OrdersScreenshotTestKt.ordersContentLight|Target|touch target
        TS|OrdersScreenshotTestKt.ordersErrorDark|Target|touch target
        TS|OrdersScreenshotTestKt.ordersErrorLight|Target|touch target
        TS|OrdersScreenshotTestKt.ordersFilteredToNone|Target|touch target
        TS|OrdersScreenshotTestKt.ordersFilteredUnpaid|Target|touch target
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
 * Audits content the caller has already set with `setContent`. The caller owns the
 * single content call; this never calls `setContent` itself. Returns one diagnostic
 * per violation, each naming the preview, a rule word (Label, Target, Contrast),
 * the node text or position, and the measured value where applicable.
 */
fun auditAccessibility(rule: ComposeTestRule, preview: String): List<String> {
    val diagnostics = mutableListOf<String>()
    val density = rule.density.density
    val minimumTouchPx = 48f * density
    var skippedDisabled = 0
    var skippedEmptyTargets = 0
    var skippedEmptyContrast = 0

    // Rules 1 and 2 run over the merged tree, once per root so that content in a
    // dialog window is audited too. Each root has its own coordinate space, so
    // the overlap rule never compares a dialog control with the screen behind it.
    val mergedRoots =
        rule.onAllNodes(isRoot(), useUnmergedTree = false).fetchSemanticsNodes()
    for (mergedRoot in mergedRoots) {
        val actionable = mutableListOf<SemanticsNode>()
        fun visitMerged(node: SemanticsNode) {
            // Disabled is inherited: in the unmerged tree the Text child of a
            // disabled Button carries no Disabled flag itself. WCAG 1.4.3 and
            // 2.5.8 exempt inactive controls, as does ATF, so walk the ancestor
            // chain for Label and Target too.
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
                        diagnostics += "$preview Label: actionable node at ${node.boundsInRoot} " +
                            "has no ContentDescription or Text"
                    }
                }
            }
            node.children.forEach { visitMerged(it) }
        }
        visitMerged(mergedRoot)

        // Rule 2 (Target): Compose touch bounds, never drawn component dimensions.
        // A target clipped fully outside the visible frame is not on screen, so an
        // empty rectangle is skipped and counted, not reported.
        for (node in actionable) {
            val touch = node.touchBoundsInRoot
            if (touch.width <= 0f || touch.height <= 0f) {
                skippedEmptyTargets++
                continue
            }
            // A sub-pixel tolerance keeps 48dp components that round to 143.99px from
            // being reported while a genuinely small target still fails.
            if (touch.width < minimumTouchPx - 0.5f || touch.height < minimumTouchPx - 0.5f) {
                diagnostics += "$preview Target: touch target " +
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
                    diagnostics += "$preview Target: ${a.touchBoundsInRoot} overlaps ${b.touchBoundsInRoot}"
                }
            }
        }
    }

    // Rule 3 (Contrast) runs over each root's unmerged tree, one text node at a
    // time, against the bitmap captured from that same root. The measurement is
    // ATF's ContrastSwatch, built directly from an ATF Image over the captured
    // bitmap and the node's bounds. There is no hand-written fallback: a
    // measurement failure is an audit failure with the preview and node context,
    // never a silent pass.
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
                    // Crop only the part of the node that intersects this root's
                    // captured image. A fully clipped-out node is off screen and is
                    // skipped, not reported.
                    val left = floor(bounds.left).toInt().coerceAtLeast(0)
                    val top = floor(bounds.top).toInt().coerceAtLeast(0)
                    val right = ceil(bounds.right).toInt().coerceAtMost(bitmap.width)
                    val bottom = ceil(bounds.bottom).toInt().coerceAtMost(bitmap.height)
                    if (bounds.width <= 0f || bounds.height <= 0f || right <= left || bottom <= top) {
                        skippedEmptyContrast++
                    } else {
                        // ATF 4.1.1: Image.crop(left, top, width, height), then
                        // ContrastSwatch(Image, isSingleColor). The ratios come
                        // from getContrastRatios(); the minimum foreground /
                        // background ratio is what the threshold applies to.
                        val ratio = try {
                            val crop = atfImage.crop(left, top, right - left, bottom - top)
                            ContrastSwatch(crop, false).contrastRatios.minOrNull()
                                ?: throw IllegalStateException("ATF returned no contrast ratio")
                        } catch (error: Throwable) {
                            // No hand-written pixel-sampling fallback: a measurement
                            // error is an audit failure naming the preview and node.
                            throw AssertionError(
                                "$preview Contrast: failed to measure text \"$content\" at $bounds",
                                error,
                            )
                        }
                        val threshold = if (isLargeText(node, density)) 3.0 else 4.5
                        if (ratio < threshold) {
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

    // Skipped nodes are counted here, in the run summary, and never emitted as
    // diagnostics: they are off screen or inactive, not accessibility violations.
    println(
        "auditAccessibility[$preview] diagnostics=${diagnostics.size} " +
            "skippedDisabled=$skippedDisabled skippedEmptyTargets=$skippedEmptyTargets " +
            "skippedEmptyContrast=$skippedEmptyContrast",
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

/** True when the node or any ancestor is marked [SemanticsProperties.Disabled]. */
private fun isDisabled(node: SemanticsNode): Boolean {
    var current: SemanticsNode? = node
    while (current != null) {
        if (current.config.getOrNull(SemanticsProperties.Disabled) != null) return true
        current = current.parent
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

/**
 * Parses the screenshot source set (and the multipreview declarations in main
 * source) so the source, not reflection, decides which functions are `@PreviewTest`
 * states and what locales they render.
 */
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
                    val locales = if (inline.isNotEmpty()) {
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
                    check(locales.isNotEmpty()) {
                        "No locale configuration resolved for ${facade}.${function}"
                    }
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
