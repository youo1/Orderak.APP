// AGP 9 compiles Kotlin itself, so org.jetbrains.kotlin.android is no longer
// applied here — AGP 9.0 rejects the build outright if it is. The Compose and
// serialization compiler plugins are separate and still required.
// https://kotl.in/gradle/agp-built-in-kotlin
plugins {
    alias(libs.plugins.android.application)
    alias(libs.plugins.kotlin.compose)
    alias(libs.plugins.kotlin.serialization)
    alias(libs.plugins.ksp)
    alias(libs.plugins.hilt)
    alias(libs.plugins.screenshot)
    alias(libs.plugins.firebase.crashlytics)
    alias(libs.plugins.firebase.perf)
    // Google services plugin for Firebase
    id("com.google.gms.google-services")
}

/**
 * The version code, from CI or from a developer's machine.
 *
 * A developer never edits this. It was a hand-edited literal `2`, which is a
 * problem larger than untidiness: the app sends the value as
 * `x-orderak-version-code`, and the backend uses it for force-update policy,
 * blocked-version lists and feature-flag targeting. A scheme that ever produced
 * a non-monotonic or environment-dependent number would silently mis-evaluate
 * minimums and block lists written against the old numbering.
 *
 * CI passes `-PorderakVersionCode=${{ github.run_number }}`. run_number is
 * monotonic per workflow and stable across re-runs of an older commit, which is
 * the property that matters: a re-run must never publish a value below one
 * already released. Commit count would have worked too, but all five Android
 * checkouts are shallow, so `git rev-list --count HEAD` returns 1.
 *
 * The local default is deliberately below every value CI can produce, so a
 * developer build can never be mistaken for a released one.
 */
val orderakVersionCode = (providers.gradleProperty("orderakVersionCode").orNull ?: "1").toInt()
val orderakVersionName = providers.gradleProperty("orderakVersionName").orNull ?: "0.3.0"

/**
 * Release signing material, read from the environment and never from the tree.
 *
 * Absent, the release build is simply unsigned — that is what a developer wants
 * locally, and CI supplies all four values. What must not happen is a keystore
 * living in the repository, so nothing here reads a path inside it and
 * .gitignore refuses the file extensions outright.
 */
val keystorePath: String? = System.getenv("ORDERAK_KEYSTORE_PATH")
val keystorePassword: String? = System.getenv("ORDERAK_KEYSTORE_PASSWORD")
val keyAlias: String? = System.getenv("ORDERAK_KEY_ALIAS")
val keyPassword: String? = System.getenv("ORDERAK_KEY_PASSWORD")
val hasSigningMaterial = listOf(keystorePath, keystorePassword, keyAlias, keyPassword).all { !it.isNullOrBlank() }

android {
    experimentalProperties["android.experimental.enableScreenshotTest"] = true
    namespace = "app.orderak.seller"
    // 37 because Compose BOM 2026.08.00 requires it: material-ripple-android
    // 1.12.0 refuses to link against anything older. AGP 8.13.2 capped at 36,
    // which is why the plugin, Gradle, and this all move together.
    //
    // targetSdk is 36 as of 2026-09-12. It sat at 35 as "a time-bounded
    // development baseline" (docs/guides/setup.md), and that bound expired on
    // 31 August 2026, when Google Play began requiring API 36 for new apps and
    // updates. Play refuses an upload below it, so this is not a toolchain
    // preference — every other release gate is downstream of an artifact the
    // store will not accept.
    //
    // targetSdk still opts the app into new runtime behaviour and still needs
    // its own testing: see the Android 16 regression checklist in
    // docs/guides/setup.md before releasing this.
    compileSdk = 37

    defaultConfig {
        applicationId = "app.orderak.seller"
        minSdk = 24            // low-end EG devices coverage
        targetSdk = 36
        versionCode = orderakVersionCode
        versionName = orderakVersionName
        vectorDrawables.useSupportLibrary = true
        testInstrumentationRunner = "androidx.test.runner.AndroidJUnitRunner"
        // Crashlytics: enabled in production/staging release builds only.
        // Overridden to "false" in the debug build type below.
        manifestPlaceholders["crashlyticsCollectionEnabled"] = "true"
        // Performance Monitoring follows the same rule, and for a sharper
        // reason than noise: its TransportManager calls
        // FirebaseInstallations.getId() on a background executor and lets
        // IllegalArgumentException escape. An unusable Firebase config - a
        // placeholder google-services.json, or a device with no working Play
        // Services - therefore kills the process on launch rather than
        // degrading. Off wherever the config is not guaranteed real.
        manifestPlaceholders["performanceCollectionEnabled"] = "true"
    }

    flavorDimensions += "environment"
    productFlavors {
        create("staging") {
            dimension = "environment"
            applicationIdSuffix = ".staging"
            versionNameSuffix = "-staging"
            buildConfigField("String", "DEPLOYMENT_ENVIRONMENT", "\"staging\"")
            buildConfigField("String", "DEMO_SELLER_PHONE", "\"01066971791\"")
            buildConfigField("String", "API_BASE_URL", "\"https://api.staging.orderak.app\"")
            buildConfigField("String", "SITE_BASE_URL", "\"https://staging.orderak.app\"")
        }
        create("production") {
            dimension = "environment"
            buildConfigField("String", "DEPLOYMENT_ENVIRONMENT", "\"production\"")
            // Empty, and verifyDemoDataContract fails the build if it ever is
            // not: demo data seeds a local database and suppresses sync, which
            // would silently stop a real seller's catalogue reaching the server.
            buildConfigField("String", "DEMO_SELLER_PHONE", "\"\"")
            buildConfigField("String", "API_BASE_URL", "\"https://api.orderak.app\"")
            buildConfigField("String", "SITE_BASE_URL", "\"https://orderak.app\"")
        }
    }

    signingConfigs {
        // Registered only when CI supplied the material. Declaring it
        // unconditionally with null fields makes Gradle fail at configuration
        // time on every developer machine.
        if (hasSigningMaterial) {
            create("release") {
                storeFile = file(keystorePath!!)
                storePassword = keystorePassword
                this.keyAlias = keyAlias
                this.keyPassword = keyPassword
                enableV1Signing = false
                enableV2Signing = true
                enableV3Signing = true
                enableV4Signing = true
            }
        }
    }

    buildTypes {
        debug {
            manifestPlaceholders["crashlyticsCollectionEnabled"] = "false"
            manifestPlaceholders["performanceCollectionEnabled"] = "false"
            // en-XA catches expansion/hard-coded text; ar-XB catches RTL issues.
            isPseudoLocalesEnabled = true
        }
        release {
            isMinifyEnabled = true
            isShrinkResources = true
            proguardFiles(getDefaultProguardFile("proguard-android-optimize.txt"), "proguard-rules.pro")
            // Unsigned when the material is absent, which is every local build.
            // An unsigned release artifact is obviously unreleasable; a
            // debug-signed one looks shippable and is not.
            signingConfig = signingConfigs.findByName("release")
        }
    }
    androidResources {
        // Generates LocaleConfig from the default locale and values-* folders.
        generateLocaleConfig = true

        // Keep the app's supported-language list intentional; do not expose
        // translations contributed incidentally by dependencies.
        //
        // Was defaultConfig.resourceConfigurations until 2026-08-22. That was the
        // single deprecation standing between this build and Gradle 9 — AGP
        // replaced it with androidResources.localeFilters, which also moves the
        // setting out of defaultConfig to where the rest of the resource
        // configuration already lived.
        localeFilters += listOf("ar", "en", "fr")
    }
    bundle {
        language {
            // The in-app picker must work offline even when a language was not
            // installed with the device's original Play language splits.
            enableSplit = false
        }
    }
    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }
    buildFeatures { compose = true; buildConfig = true }

    // Room exports the schema here so a future migration can be written and
    // tested against the shipped one rather than against a description of it.
    ksp { arg("room.schemaLocation", "$projectDir/schemas") }

    packaging {
        resources { excludes += "/META-INF/{AL2.0,LGPL2.1}" }
    }

    lint {
        // i18n is a launch requirement — hardcoded UI text is a build error (Plan §3.1)
        error += listOf("HardcodedText", "RtlHardcoded", "SetTextI18n", "MissingTranslation", "ExtraTranslation")
    }
}

kotlin {
    compilerOptions {
        jvmTarget.set(org.jetbrains.kotlin.gradle.dsl.JvmTarget.JVM_17)
    }
}

dependencies {
    implementation(libs.androidx.core.ktx)
    implementation(libs.androidx.appcompat) // per-app locales backport (API 21+)
    implementation(libs.androidx.activity.compose)

    val composeBom = platform(libs.compose.bom)
    implementation(composeBom)
    implementation(libs.compose.ui)
    implementation(libs.compose.ui.text.google.fonts)
    implementation(libs.compose.material3)
    implementation(libs.compose.material.icons)
    implementation(libs.compose.ui.tooling.preview)
    debugImplementation(libs.compose.ui.tooling)

    implementation(libs.lifecycle.runtime.compose)
    implementation(libs.lifecycle.viewmodel.compose)
    implementation(libs.navigation.compose)
    implementation(libs.kotlinx.serialization.json)

    implementation(libs.hilt.android)
    ksp(libs.hilt.compiler)
    implementation(libs.hilt.navigation.compose)

    implementation(libs.datastore.preferences)
    implementation(libs.androidx.security.crypto)
    implementation(libs.androidx.credentials)
    implementation(libs.androidx.credentials.play.services.auth)
    implementation(libs.coil.compose)          // product/proof images
    implementation(libs.coil.network.okhttp)   // Coil 3 split the network layer out; remote URLs fail silently without it
    implementation(libs.okhttp)                // backend API calls
    implementation(libs.work.runtime)          // background sync
    implementation(libs.androidx.hilt.work)    // Hilt + WorkManager
    ksp(libs.androidx.hilt.compiler)
    implementation(libs.mlkit.text)            // on-device OCR for payment proof (S6a)
    implementation(libs.libphonenumber)
    implementation(libs.osmdroid)
    implementation(libs.billing.ktx)

    // Room: single source of truth from Stage 2 onward (deps wired now per plan)
    implementation(libs.room.runtime)
    implementation(libs.room.ktx)
    ksp(libs.room.compiler)

    testImplementation(libs.junit)
    testImplementation(libs.coroutines.test)
    testImplementation(libs.turbine)
    androidTestImplementation(composeBom)
    androidTestImplementation(libs.androidx.test.ext.junit)
    androidTestImplementation(libs.androidx.test.runner)
    androidTestImplementation(libs.androidx.test.espresso.core)
    androidTestImplementation(libs.compose.ui.test.junit4)
    debugImplementation(libs.compose.ui.test.manifest)
    screenshotTestImplementation(libs.screenshot.validation.api)
    screenshotTestImplementation(libs.compose.ui.tooling)

    // Firebase: BoM + phone auth + analytics + crashlytics + performance.
    // (Firestore is intentionally not included — the app talks only to the
    // Cloudflare backend, never a DB directly.)
    implementation(platform(libs.firebase.bom))
    implementation(libs.firebase.auth)
    implementation(libs.firebase.analytics)
    implementation(libs.firebase.crashlytics)
    implementation(libs.firebase.perf)
    implementation(libs.kotlinx.coroutines.play.services)

    implementation(libs.play.services.auth)
}

/**
 * Screenshot rendering must not read the machine it runs on.
 *
 * `OrderCard` formats `createdAt` with `DateFormat`, which resolves the JVM's
 * default time zone. A reference rendered in Cairo shows a time three hours
 * ahead of the same reference rendered on a UTC runner, so the image compares
 * unequal and the failure looks like a rendering bug rather than what it is.
 * The app is right to show the seller local time; it is the test that has to be
 * reproducible, so the render process is pinned rather than the app changed.
 *
 * The locale is pinned for the same reason: `@Preview(locale = "ar")` sets the
 * composition locale, but anything reaching `Locale.getDefault()` during a
 * render would still read the host.
 */
tasks.withType<Test>().matching { it.name.contains("ScreenshotTest") }.configureEach {
    systemProperty("user.timezone", "UTC")
    systemProperty("user.language", "en")
    systemProperty("user.country", "US")
}

// Satisfy IDE requirement for unitTestClasses task (missing in some AGP/Studio combinations)
tasks.register("unitTestClasses") {
    description = "Compiles unit test classes for all variants"
    group = "build"
    dependsOn(tasks.matching { it.name.endsWith("UnitTestSources") })
}

val verifyLocalizationContract by tasks.registering {
    group = "verification"
    description = "Fails when Orderak's protected localization architecture drifts"

    doLast {
        val projectRoot = project.projectDir
        val resRoot = projectRoot.resolve("src/main/res")
        val buildScript = projectRoot.resolve("build.gradle.kts").readText()
        val manifest = projectRoot.resolve("src/main/AndroidManifest.xml").readText()
        val appLocales = projectRoot.resolve(
            "src/main/java/app/orderak/seller/core/locale/AppLocales.kt"
        ).readText()
        val languageSheet = projectRoot.resolve(
            "src/main/java/app/orderak/seller/feature/auth/LanguageSheet.kt"
        ).readText()
		val localizationContract = projectRoot.parentFile.parentFile.parentFile
			.resolve("docs/architecture/localization-architecture.md")
		val localizationInvariants = projectRoot.parentFile.parentFile.parentFile
			.resolve("docs/contracts/localization-invariants.md")
		val androidLocalizationProfile = projectRoot.parentFile.parentFile.parentFile
			.resolve("docs/platforms/android-localization-profile.md")

        fun requireContract(condition: Boolean, message: String) {
            if (!condition) {
                throw GradleException(
                    "LOCALIZATION ARCHITECTURE WARNING: $message\n" +
                        "Read docs/architecture/localization-architecture.md. Do not bypass this guard."
                )
            }
        }

		requireContract(
			localizationContract.exists() &&
				"**Contract version:** 3" in localizationContract.readText() &&
				"storefront_locale_definitions" in localizationContract.readText(),
			"The recognized localization contract or storefront locale registry changed."
		)
		requireContract(
			localizationInvariants.exists() && androidLocalizationProfile.exists() &&
				"**Contract version:** 1" in localizationInvariants.readText() &&
				"**Profile version:** 1" in androidLocalizationProfile.readText(),
			"Localization invariants or the Android platform profile are missing."
		)
		requireContract(
            resRoot.resolve("resources.properties").readText().trim() ==
                "unqualifiedResLocale=en",
            "The unqualified/default resource locale must remain English."
        )
        requireContract(
            "generateLocaleConfig = true" in buildScript,
            "AGP-generated LocaleConfig must remain enabled."
        )
        requireContract(
            "localeFilters += listOf(\"ar\", \"en\", \"fr\")" in buildScript,
            "The supported Android locale set must remain ar/en/fr."
        )
        requireContract(
            "enableSplit = false" in buildScript,
            "Language splitting must remain disabled for offline picker switching."
        )
        requireContract(
            !resRoot.resolve("xml/locales_config.xml").exists() &&
                !resRoot.resolve("xml/locale_config.xml").exists() &&
                "android:localeConfig" !in manifest,
            "Manual LocaleConfig conflicts with the protected generated setup."
        )
        requireContract(
            "private const val DEFAULT_TAG = \"en\"" in appLocales,
            "Unsupported system locales must resolve to English."
        )
        requireContract(
            "AppLocales.supported.forEach" in languageSheet &&
                "language_system_default" !in languageSheet &&
                "followSystem(" !in languageSheet,
            "The in-app language sheet must expose only Arabic, English, and French explicit overrides."
        )

        val resourceRegex = Regex("""<(string|plurals)\s+name="([^"]+)"""")
        val nonTranslatableRegex = Regex(
            """<string\s+name="([^"]+)"[^>]*translatable="false"""
        )
        fun resources(path: java.io.File): Map<String, String> = resourceRegex
            .findAll(path.readText())
            .associate { match -> match.groupValues[2] to match.groupValues[1] }

        val defaultFile = resRoot.resolve("values/strings.xml")
        val defaultResources = resources(defaultFile)
        val nonTranslatable = nonTranslatableRegex.findAll(defaultFile.readText())
            .map { it.groupValues[1] }
            .toSet()
        requireContract(
            nonTranslatable == setOf("app_name") &&
                defaultFile.readText().contains(
                    "<string name=\"app_name\" translatable=\"false\">Orderak</string>"
                ),
            "Orderak must remain the single canonical non-translatable app name."
        )

        val expected = defaultResources - nonTranslatable
        for (qualifier in listOf("values-ar", "values-en", "values-fr")) {
            val localizedFile = resRoot.resolve("$qualifier/strings.xml")
            requireContract(localizedFile.exists(), "Missing $qualifier/strings.xml.")
            val actual = resources(localizedFile)
            requireContract(
                actual == expected,
                "$qualifier keys or resource types differ from the English contract."
            )
        }
    }
}

val verifyAuthPhase1Contract by tasks.registering {
    group = "verification"
    description = "Fails when Orderak's protected Phase 1 authentication behavior drifts"

    doLast {
        val appRoot = project.projectDir
        val workspaceRoot = appRoot.parentFile.parentFile.parentFile
        val mainRoot = appRoot.resolve("src/main")
        val firebaseRepository = mainRoot.resolve(
            "java/app/orderak/seller/data/auth/FirebaseAuthRepository.kt"
        ).readText()
        val authRepository = mainRoot.resolve(
            "java/app/orderak/seller/data/auth/AuthRepository.kt"
        ).readText()
        val authTimingPolicy = mainRoot.resolve(
            "java/app/orderak/seller/data/auth/AuthTimingPolicy.kt"
        ).readText()
        val authViewModel = mainRoot.resolve(
            "java/app/orderak/seller/feature/auth/AuthViewModel.kt"
        ).readText()
        val authScreen = mainRoot.resolve(
            "java/app/orderak/seller/feature/auth/AuthScreen.kt"
        ).readText()
        val shopSetupViewModel = mainRoot.resolve(
            "java/app/orderak/seller/feature/shopsetup/ShopSetupViewModel.kt"
        ).readText()
        val settingsViewModel = mainRoot.resolve(
            "java/app/orderak/seller/feature/settings/SettingsScreen.kt"
        ).readText()
        val logoutSequence = mainRoot.resolve(
            "java/app/orderak/seller/feature/settings/LogoutSequence.kt"
        ).readText()
        val sessionLogoutManager = mainRoot.resolve(
            "java/app/orderak/seller/data/session/SessionLogoutManager.kt"
        ).readText()
        val backendAuth = workspaceRoot.resolve("services/backend/src/domains/stores/api-store.ts").readText()
        val backendAuthV2 = workspaceRoot.resolve("services/backend/src/domains/identity/auth-v2.ts").readText()
        val sellerSession = workspaceRoot.resolve("services/backend/src/domains/identity/seller-session.ts").readText()
        val backendApi = mainRoot.resolve(
            "java/app/orderak/seller/data/remote/BackendApi.kt"
        ).readText()
        val sessionStore = mainRoot.resolve(
            "java/app/orderak/seller/data/session/SessionStore.kt"
        ).readText()
        val contract = workspaceRoot.resolve("docs/contracts/auth-phase1-contract.md")
        val securityInvariants = workspaceRoot.resolve(
            "docs/contracts/authentication-security-invariants.md"
        )
        val androidAuthProfile = workspaceRoot.resolve(
            "docs/platforms/android-auth-profile.md"
        )
        val authV2Migration = workspaceRoot.resolve(
            "services/backend/migrations/033_auth_onboarding_v2.sql"
        ).readText()
        val birthYearMigration = workspaceRoot.resolve(
            "services/backend/migrations/039_add_private_birth_year.sql"
        ).readText()

        fun requireContract(condition: Boolean, message: String) {
            if (!condition) {
                throw GradleException(
                    "AUTH PHASE 1 CONTRACT WARNING: $message\n" +
                        "Read docs/contracts/auth-phase1-contract.md. Do not bypass this guard."
                )
            }
        }

        requireContract(contract.exists(), "The protected contract document is missing.")
        requireContract(
			"**Contract version:** 8" in contract.readText(),
            "The recognized Phase 1 contract version changed without a guard migration."
        )
        requireContract(
            securityInvariants.exists() && androidAuthProfile.exists() &&
                "**Contract version:** 1" in securityInvariants.readText() &&
                "**Profile version:** 2" in androidAuthProfile.readText(),
            "Authentication invariants or the Android platform profile are missing."
        )
        requireContract(
            "FirebaseAuthRepository" in authRepository ||
                "sendSmsOtp" in authRepository,
            "The SMS-only AuthRepository contract is missing."
        )
        requireContract(
            "private val requestState = OtpRequestState()" in firebaseRepository &&
                "requestState.begin(phoneE164" in firebaseRepository &&
                "requestState.verificationId(phoneE164" in firebaseRepository,
            "OTP send/resend/verification must remain bound to the exact phone."
        )
        requireContract(
            "attempt.generation" in firebaseRepository &&
                "acceptVerificationId" in firebaseRepository &&
                "isCurrent" in firebaseRepository,
            "Stale Firebase callbacks must remain generation-checked."
        )
        requireContract(
            "AuthTimingPolicy.SEND_OPERATION_TIMEOUT_MS" in firebaseRepository &&
                "AuthTimingPolicy.SMS_RETRIEVAL_TIMEOUT_SECONDS" in firebaseRepository &&
                "SEND_OPERATION_TIMEOUT_MS = 90_000L" in authTimingPolicy &&
                "OTP_SESSION_TTL_MS = 10 * 60 * 1_000L" in authTimingPolicy,
            "The tested Android/Firebase authentication timing profile changed."
        )
        requireContract(
            "Log.w(\"OrderakAuth\", \"OTP send failed: \${failure.failure.name}\")" in
                firebaseRepository,
            "Firebase failures must remain sanitized to stable error categories."
        )
        requireContract(
            "override fun signOut()" in firebaseRepository &&
                "auth.signOut()" in firebaseRepository,
            "Logout must sign out of Firebase."
        )
        requireContract(
            // Auth contract v8, guarantee 10. Strictly more than v7 required.
            //
            // v7 asserted that SettingsScreen called runLogoutSequence, which had
            // the effect of requiring a second copy of the sequence to exist
            // there — so "the single protected logout sequence used by every
            // account state" had two callers and only one of them was it. v8
            // asserts the opposite: the screen delegates, and the sequence lives
            // in exactly one place.
            //
            // The two new steps are pinned by name as well as the four v7 ones,
            // and the revocation is pinned at its call site, because a sequence
            // that accepts a revokeCredential lambda and is handed an empty one
            // would satisfy a shape check while revoking nothing.
            "sessionLogoutManager.logout()" in settingsViewModel &&
                "runLogoutSequence(" !in settingsViewModel &&
                "revokeCredential()" in logoutSequence &&
                "signOutProvider()" in logoutSequence &&
                "clearBusinessData()" in logoutSequence &&
                "clearEntitlements()" in logoutSequence &&
                "clearSession()" in logoutSequence &&
                "clearDeviceSecret()" in logoutSequence &&
                "backendApi.logout(" in sessionLogoutManager &&
                "fun clearDeviceSecret()" in sessionStore,
            "Logout must revoke the credential, keep provider-first local cleanup, drop the device secret, and exist in exactly one place."
        )
        requireContract(
            "completePhoneAuth(" in authViewModel &&
                "terms_accepted" !in authViewModel &&
                "PhoneCompleteReq" in backendApi &&
                "OnboardingAccountReq" in backendApi &&
                "val terms_accepted: Boolean = true" in backendApi &&
                "body.terms_accepted !== true" in backendAuthV2,
            "V6 must defer new-user legal acceptance until the account step."
        )
        requireContract(
            "if (!env.FIREBASE_WEB_API_KEY)" in backendAuth &&
                "String(result.users?.[0]?.phoneNumber ?? \"\") === phone" in backendAuth,
            "The Worker must fail closed and match the verified Firebase phone exactly."
        )
        requireContract(
            "allowPreAuthAttempt(env, request, \"session\"" in backendAuth &&
                "allowPreAuthAttempt(env, request, \"phone-complete\"" in backendAuthV2,
            "Independent pre-authentication throttling must remain enabled."
        )
        requireContract(
			"max_concurrent_devices" in sellerSession &&
			"UPDATE sellers SET secret=? WHERE id=?" in sellerSession &&
                "DELETE FROM seller_devices WHERE seller_id=?" in sellerSession &&
                "INSERT OR IGNORE INTO seller_devices" in sellerSession,
            "Single-device recovery and multi-device authorization semantics changed."
        )
        requireContract(
            "residentKey: \"required\"" in backendAuthV2 &&
                "userVerification: \"required\"" in backendAuthV2 &&
                "attestationType: \"none\"" in backendAuthV2 &&
                "WEBAUTHN_CHALLENGE_MINUTES = 5" in backendAuthV2 &&
                "expectedRPID: rpId(env)" in backendAuthV2 &&
                "requireUserVerification: true" in backendAuthV2,
            "V6 Passkey RP, discoverability, UV, attestation, or challenge guarantees changed."
        )
        requireContract(
            "ONBOARDING_TOKEN_PREFS_KEY" in sessionStore &&
                "EncryptedSharedPreferences.create" in sessionStore &&
                "ONBOARDING_ROLLING_MINUTES = 30" in backendAuthV2 &&
                "ONBOARDING_ABSOLUTE_HOURS = 24" in backendAuthV2,
            "V6 onboarding token lifetime or encrypted local storage changed."
        )
        requireContract(
            "AuthEvent.VerifyOtp -> submitOtp()" in authViewModel &&
                "canVerifyOtp(state.code, state.isVerifying)" in authScreen &&
                "enabled = !phoneLocked" in authScreen &&
                "private fun changeNumber()" in authViewModel &&
                "authRepository.clearOtpSession()" in authViewModel &&
                "PredictiveBackHandler" !in authScreen,
            "V6 OTP must remain inline, lock the phone, clear on change, and require explicit Verify."
        )
        requireContract(
            "PasskeyResult.Cancelled -> _state.value = AuthUiState.Welcome()" in authViewModel &&
                "if (state.showOtpFallback)" in authScreen &&
                "showOtpFallback = true" in authViewModel,
            "Passkey cancellation must return to Welcome; only unavailable or failed states expose OTP fallback."
        )
        requireContract(
            "val birth_year: Int" in backendApi &&
                "birth_year = requireNotNull(current.birthYear)" in shopSetupViewModel &&
                "validBirthYear(body.birth_year)" in backendAuthV2 &&
                "CREATE TABLE seller_profiles" in authV2Migration &&
                "ALTER TABLE onboarding_sessions" in birthYearMigration &&
                "ALTER TABLE seller_profiles" in birthYearMigration &&
                "ADD COLUMN birth_year INTEGER" in birthYearMigration,
            "V6 must validate and persist the private required birth year."
        )

        val shippedSource = mainRoot.walkTopDown()
            .filter { it.isFile && (it.extension == "kt" || it.extension == "java") }
            .joinToString("\n") { it.readText() }
        val forbidden = listOf(
            "setAppVerificationDisabledForTesting",
            "setAutoRetrievedSmsCodeForPhoneNumber",
            "FAKE_CODE",
            "sendWhatsAppOtp",
            "requestWhatsAppOtp",
            "+201001854507",
            "654321",
        )
        requireContract(
            forbidden.none { it in shippedSource },
            "Shipped code contains a test bypass, fictional credential, or WhatsApp OTP fallback."
        )
    }
}

val verifySellerApiContract by tasks.registering {
    group = "verification"
    description = "Verifies Android seller API versioning and request context boundaries"

    doLast {
        val appRoot = project.projectDir
        val workspaceRoot = appRoot.parentFile.parentFile.parentFile
        val mainRoot = appRoot.resolve("src/main/java/app/orderak/seller")
        val routes = mainRoot.resolve("core/network/ApiRoutes.kt").readText()
        val backendApi = mainRoot.resolve("data/remote/BackendApi.kt").readText()
        val networkJson = mainRoot.resolve("core/network/NetworkJson.kt").readText()
        val clientContext = mainRoot.resolve("core/platform/ClientContext.kt").readText()
        val apiContract = workspaceRoot.resolve(
            "docs/contracts/api-compatibility-contract.md"
        ).readText()

        fun requireContract(condition: Boolean, message: String) {
            if (!condition) throw GradleException("SELLER API CONTRACT WARNING: $message")
        }

        requireContract(
            "**Contract version:** 2" in apiContract,
            "The recognized seller API compatibility contract changed."
        )
        requireContract(
            "private const val V1_PREFIX = \"/api/v1/\"" in routes &&
                "Seller API routes must start with" in routes &&
                ".url(Backend.BASE_URL + ApiRoutes.versioned(path))" in backendApi,
            "Seller calls must cross the central v1-only routing boundary."
        )
        // Correlation is the property, not the expression.
        //
        // This used to pin one exact inlined call:
        //     .header("x-request-id", clientContextProvider.newRequestId())
        // which held the right behaviour in place right up until the id had to
        // be used twice — once on the header and once handed to the crash
        // reporter, so a Crashlytics report names the request a Sentry event can
        // be found by. Binding it to a local is the same behaviour and did not
        // match the literal.
        //
        // So the check now accepts either shape, and in the local-variable form
        // requires the value sent as the header to be the one that came from the
        // provider — the two stay welded together, which is the thing actually
        // worth protecting. It is not looser about that; it is looser only about
        // whether the call is written on one line or two.
        val correlationInline =
            ".header(\"x-request-id\", clientContextProvider.newRequestId())" in backendApi
        val correlationViaLocal = Regex(
            """val requestId = clientContextProvider\.newRequestId\(\)[\s\S]{0,800}?\.header\("x-request-id", requestId\)"""
        ).containsMatchIn(backendApi)
        requireContract(
            "interface ClientContextProvider" in clientContext &&
                (correlationInline || correlationViaLocal) &&
                "x-orderak-platform" in backendApi,
            "Request correlation or the platform-neutral client context is missing."
        )
        requireContract(
            "ignoreUnknownKeys = true" in networkJson &&
                "NetworkJson.decoder" in backendApi,
            "All backend response decoding must keep the central forward-compatible decoder."
        )
        val disallowedApiLiterals = mainRoot.walkTopDown()
            .filter { it.isFile && it.extension == "kt" }
            .flatMap { file ->
                file.readLines().asSequence().mapIndexedNotNull { index, line ->
                    val hasDisallowedApi = Regex("""/api/(?!v1/)""").containsMatchIn(line)
                    if (hasDisallowedApi) {
                        "${file.relativeTo(mainRoot)}:${index + 1}"
                    } else null
                }
            }
            .toList()
        requireContract(
            disallowedApiLiterals.isEmpty(),
            "Unversioned or non-v1 API literals bypass the route policy: $disallowedApiLiterals"
        )
    }
}

val verifyDesignSystemContract by tasks.registering {
    group = "verification"
    description = "Verifies the generated design system is complete, accessible and code-only"

    doLast {
        val appRoot = project.projectDir
        val workspaceRoot = appRoot.parentFile.parentFile.parentFile
        val themeRoot = appRoot.resolve("src/main/java/app/orderak/seller/core/ui/theme")
        val theme = themeRoot.resolve("Theme.kt").readText()
        val type = themeRoot.resolve("Type.kt").readText()
        val contract = themeRoot.resolve("DesignSystemContract.kt").readText()
        val generated = themeRoot.resolve("GeneratedDesignSystem.kt").readText()
        val fixture = workspaceRoot.resolve("design/design-system.default.json").readText()
        val legacy = workspaceRoot.resolve("design/tokens.json").readText()

        fun requireContract(condition: Boolean, message: String) {
            if (!condition) {
                throw GradleException(
                    "DESIGN SYSTEM CONTRACT WARNING: $message" +
                        "\n" +
                        "Run services/backend/npm run design-system:generate; do not bypass this guard."
                )
            }
        }

        requireContract(
            "const val SCHEMA_VERSION = 2" in contract &&
                "\"schemaVersion\": 2" in fixture,
            "The schema-v2 fallback contract drifted."
        )

        // The generator writes the hash into two files. If they disagree, one of
        // them was edited by hand.
        val hash = Regex("""const val DEFAULT_FALLBACK_HASH = "([a-f0-9]{64})"""")
            .find(contract)?.groupValues?.get(1)
        requireContract(
            hash != null && "\"contentHash\": \"$hash\"" in fixture,
            "Android and canonical fallback hashes differ."
        )
        requireContract(
            hash != null && "const val CONTENT_HASH = \"$hash\"" in generated,
            "GeneratedDesignSystem.kt was not produced by the same generator run as the fixture."
        )

        // Completeness. These used to be validated on the remote payload as it
        // arrived; the payload is gone, so they are asserted on the generated
        // source that replaced it. Same coverage, different source of truth.
        val contrastModes = listOf("standard", "medium", "high").flatMap { contrast ->
            listOf("light", "dark").map { mode -> "\"$mode\" to \"$contrast\"" }
        }
        requireContract(
            contrastModes.all { it in generated },
            "The generated schemes no longer cover every contrast and mode."
        )
        requireContract(
            listOf(
                "displayLarge", "displayMedium", "displaySmall",
                "headlineLarge", "headlineMedium", "headlineSmall",
                "titleLarge", "titleMedium", "titleSmall",
                "bodyLarge", "bodyMedium", "bodySmall",
                "labelLarge", "labelMedium", "labelSmall",
            ).all { "\"$it\" to GeneratedTypeRole(" in generated },
            "The complete 15-role typography scale is no longer generated."
        )
        requireContract(
            Regex("""const val MINIMUM_TOUCH_TARGET_DP = (\d+(?:\.\d+)?)f""")
                .find(generated)?.groupValues?.get(1)?.toDoubleOrNull()?.let { it >= 48.0 } == true,
            "The 48dp minimum touch target constraint changed."
        )
        requireContract(
            listOf("cairo", "tajawal", "noto-arabic").any {
                "const val FONT_FAMILY = \"$it\"" in generated
            },
            "The generated font family is not an approved Orderak font."
        )

        // Colour must reach the UI only through the generator, because
        // generateDesignSystem() is where contrast is validated. A theme that
        // reads colour from anywhere else is unguarded by construction.
        requireContract(
            "GeneratedDesignSystem.colorScheme(" in theme &&
                "GeneratedDesignSystem.extendedColors(" in theme,
            "Theme.kt no longer sources its colours from the generated design system."
        )
        requireContract(
            "BrandingRepository" !in theme && "remoteConfig" !in theme,
            "Runtime theming was reintroduced; colour must stay code-only and contrast-gated."
        )

        requireContract(
            "dynamicColorEnabled = false" in
                appRoot.resolve("src/main/java/app/orderak/seller/data/theme/ThemePreferencesRepository.kt").readText() &&
                "dynamicDarkColorScheme" !in theme,
            "Material You must remain disabled; published Orderak colors have precedence."
        )
        requireContract(
            "OrderakTypography.withGenerated" in theme &&
                "LocalOrderakSpacing provides spacing" in theme &&
                "generatedShapes" in theme &&
                "Surface(" in theme,
            "Compose token mapping is incomplete."
        )

        // Brand identity. The seed lives in the fixture; the tone-anchored light
        // primary is what the app actually renders, so both are pinned. Migrated
        // 2026-08-28 from #0A9A8E/#006A62 to Dark Teal #014D4E: the seed is now
        // rendered literally, because `primaryLightTones` pins the role to the
        // tone the seed occupies. Changing these three lines is how an approved
        // rebrand lands; changing them without one is how a rebrand escapes.
        requireContract(
            "\"primary\": \"#014D4E\"" in fixture &&
                "\"primary\": \"#014D4E\"" in legacy &&
                "0xFF014D4E" in generated,
            "The protected default brand source or legacy projection changed."
        )

        // Monetisation is its own role. Without it, "locked by plan" has to
        // borrow a status colour, and the seller cannot tell an upsell from a
        // warning - the collision this migration exists to remove.
        requireContract(
            "\"commerce\"" in fixture && "commerceContainerOutline" in generated,
            "The commerce role or its container outline is no longer generated."
        )

        // Every semantic container carries an outline. A container on a near-white
        // surface separates by hue alone, which fails a colour-blind reader.
        requireContract(
            listOf("warningContainerOutline", "successContainerOutline",
                "informationContainerOutline", "commerceContainerOutline")
                .all { it in generated },
            "A semantic container lost its outline role."
        )
        requireContract(
            "Tajawal" in type && "Noto Sans Arabic" in type,
            "Approved Android font fallbacks are incomplete."
        )
    }
}

/**
 * Demo data must never be reachable in a production build.
 *
 * `DemoDataSeeder` writes a shop into the local database and switches sync off
 * for that account. The second half is the dangerous one: the product push is a
 * full mirror, so a production build that entered demo mode would replace a
 * real seller's catalogue with a demo shop, or — with sync suppressed — quietly
 * stop uploading their real one.
 *
 * The whole guarantee rests on the production flavour's DEMO_SELLER_PHONE being
 * empty, which is one careless edit away from not being true. This asserts it.
 */
val verifyDemoDataContract by tasks.registering {
    group = "verification"
    description = "Fails when demo data could reach a production build"

    val buildScript = project.projectDir.resolve("build.gradle.kts")
    val seeder = project.projectDir.resolve(
        "src/main/java/app/orderak/seller/data/demo/DemoDataSeeder.kt",
    )
    inputs.files(buildScript, seeder)

    doLast {
        val script = buildScript.readText()

        val production = script
            .substringAfter("""create("production")""", "")
            // production is the last flavour declared, so its block ends where
            // productFlavors does. This used to slice to create("mock"); that
            // anchor left with the mock flavour, and substringBefore's default
            // would have returned "" — a guard passing by reading nothing.
            // Passing "" here too keeps the isNotBlank check below as the thing
            // that notices when an anchor stops matching.
            .substringBefore("signingConfigs", "")
        check(production.isNotBlank()) { "Could not read the production flavour block." }

        val declaration = production.lineSequence()
            .firstOrNull { "DEMO_SELLER_PHONE" in it }
            ?: error("The production flavour must declare DEMO_SELLER_PHONE explicitly.")
        // A phone number is digits. An empty constant has none.
        check(declaration.none(Char::isDigit)) {
            "The production flavour's DEMO_SELLER_PHONE must be empty, but reads: " +
                declaration.trim() + ". " +
                "Demo data suppresses sync, which would stop a real seller's " +
                "catalogue reaching the server."
        }

        val source = seeder.readText()
        check("BuildConfig.DEMO_SELLER_PHONE.isEmpty()) return false" in source) {
            "DemoDataSeeder.isDemoSeller must return false on an empty " +
                "DEMO_SELLER_PHONE before looking at the signed-in phone. " +
                "That check is what makes the production flavour's empty " +
                "constant sufficient."
        }

        val sync = project.projectDir.resolve(
            "src/main/java/app/orderak/seller/data/remote/SyncRepository.kt",
        ).readText()
        check("if (demoDataSeeder.isDemoSeller()) return false" in sync) {
            "SyncRepository.doSync must refuse to run for the demo account. " +
                "Its product push is a full mirror: syncing a seeded device " +
                "would delete the account's real catalogue."
        }
    }
}

tasks.named("preBuild") {
    dependsOn(verifyDemoDataContract)
    dependsOn(verifyLocalizationContract)
    dependsOn(verifyAuthPhase1Contract)
    dependsOn(verifySellerApiContract)
    dependsOn(verifyDesignSystemContract)
}

// ============================================================
// WHY THIS SITS BELOW tasks.named("preBuild") AND NOT NEXT TO THE CONTRACT TASKS
//
// tooling/repository/verify-contract-guards.mjs scans each protected contract
// task by slicing this file from the task's declaration to the next declaration
// named in its `protectedTasks` table — for verifyDesignSystemContract, that
// boundary is `tasks.named("preBuild")`. Anything written in between is read as
// part of that task's body and checked for bypass patterns.
//
// This block legitimately uses `return@doLast` and `System.getenv`, both of
// which that guard forbids, so placing it in between made the guard fail on
// verifyDesignSystemContract — code the guard was never looking at.
//
// It belongs outside the protected set rather than inside it. A contract task
// must have no environment-dependent path, because that path is how enforcement
// gets switched off. This check is the opposite: it exists to describe the
// environment, and CI genuinely does build with the placeholder on purpose.
// Below the boundary is where a task like that goes; nothing about the contract
// guard is weakened by it, and the scanned ranges are exactly what they were.
// ============================================================

/**
 * google-services.json is a Firebase secret, so it is gitignored and CI
 * synthesizes a placeholder (.github/scripts/write-ci-google-services.sh) just
 * to give the Google Services plugin something well-formed to parse. That file
 * compiles perfectly and runs not at all: Firebase rejects its API key, and
 * Performance Monitoring surfaces the rejection as an uncaught
 * IllegalArgumentException on a background executor, so the process dies a few
 * seconds after launch on every Android version alike.
 *
 * Nothing about that failure points at Firebase from the outside - it reads as
 * an OS-compatibility problem - which is what earns it a build check. The
 * manifest now also keeps Performance Monitoring off in debug builds, so a
 * placeholder config degrades instead of crashing; this task makes sure nobody
 * has to discover the degradation by hand.
 *
 * CI builds with the placeholder deliberately, so CI is exempt.
 */
// The placeholder's project_id. A real console download never carries it.
private val CI_FIREBASE_PLACEHOLDER_MARKER = "orderak-ci"

/**
 * The google-services.json the Google Services plugin will actually read for a
 * variant, most specific source set first. Checking every file in the module
 * instead would fail a staging build over an unrelated placeholder sitting at
 * the production path, which is a normal state for a developer who only holds
 * staging credentials.
 */
fun firebaseConfigFor(moduleRoot: java.io.File, flavor: String, buildType: String): java.io.File? = listOf(
    "src/$buildType/$flavor/google-services.json",
    "src/$flavor/$buildType/google-services.json",
    "src/$buildType/google-services.json",
    "src/$flavor/google-services.json",
    "google-services.json",
).asSequence()
    .map { moduleRoot.resolve(it) }
    .firstOrNull { it.isFile }

androidComponents {
    onVariants { variant ->
        val suffix = variant.name.replaceFirstChar(Char::uppercaseChar)
        val flavor = variant.flavorName.orEmpty()
        val buildType = variant.buildType.orEmpty()
        val shippable = buildType == "release"
        val projectRoot = project.projectDir
        val runningInCi = System.getenv("CI") != null

        val verify = tasks.register("verifyFirebaseConfiguration$suffix") {
            group = "verification"
            description = "Checks that ${variant.name} is not built against the CI placeholder Firebase configuration"

            doLast {
                // A missing file is processGoogleServices' error to report, not this one.
                val config = firebaseConfigFor(projectRoot, flavor, buildType) ?: return@doLast
                if (runningInCi || CI_FIREBASE_PLACEHOLDER_MARKER !in config.readText()) return@doLast

                val detail = buildString {
                    appendLine("Firebase configuration for ${variant.name} is the CI placeholder, not a real project:")
                    appendLine("  " + config.relativeTo(projectRoot).invariantSeparatorsPath)
                    appendLine()
                    appendLine("An app built against it launches and then dies within seconds on every")
                    appendLine("Android version, and Phone Auth never works at all.")
                    appendLine()
                    appendLine("Fix: download google-services.json from the Firebase console. Production")
                    appendLine("config goes at app/google-services.json, staging config at")
                    appendLine("app/src/staging/google-services.json - docs/guides/setup.md, section 6.")
                }

                // Debug builds warn: driving screens against a dead Firebase is a
                // legitimate way to work on UI. Anything shippable fails.
                if (shippable) throw GradleException(detail)
                logger.warn("\nWARNING: $detail")
            }
        }

        // Not the shared preBuild: the check has to know which variant, and so
        // which configuration file, is in play.
        tasks.matching { it.name == "pre${suffix}Build" }.configureEach { dependsOn(verify) }
    }
}
