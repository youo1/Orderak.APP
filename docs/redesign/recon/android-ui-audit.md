---
status: draft
generated: false
owner: android
applies_to: [internal]
---

# Android seller app — UI/UX and front-end architecture audit

**Audited:** `apps/seller-android/` (Kotlin, Jetpack Compose, `app.orderak.seller`).
**Purpose:** baseline UI/UX, visual-consistency and front-end-architecture
inventory for a full Android seller-app redesign.

Read-only audit of `apps/seller-android/`. Every claim is cited as `path:line`. Nothing in the repo
was modified, created, deleted or built to produce this document. Items that could not be confirmed by
static reading are marked **unverified** (see §11). Line numbers come from `read`/`grep` output; where a
file's total length reported by tooling disagreed with a full read, the full-read length is used
(`feature/operations/OperationsScreens.kt` is **1446** lines).

Path abbreviations used below:

| Short | Full path |
| --- | --- |
| `A/` | `apps/seller-android/app/src/main/java/app/orderak/seller/` |
| `T/` | `A/core/ui/theme/` |
| `CUI/` | `A/core/ui/` |
| `RES/` | `apps/seller-android/app/src/main/res/` |
| `SHOT/` | `apps/seller-android/app/src/screenshotTest/java/app/orderak/seller/` |
| `UX/` | `tooling/ux/` |
| `B/` | `services/backend/src/domains/` |

---

> **Citations and the fix rounds.** Every `file:line` in this report was taken in
> a read-only pass, before any change was made. The fixes that followed edited
> those same files, so line numbers have shifted and some rows now describe code
> that has moved or gone. Treat the **Verification pass** section below as the
> authoritative record of what was still true when it was acted on, and the
> source itself as the truth about where anything is now. The file paths remain
> correct throughout.

## 1. Screen inventory

### 1.1 Counts

| Unit | Count | Source |
| --- | --- | --- |
| Kotlin routes declared | **22** | `A/app/navigation/Routes.kt:5-44` |
| Screen contracts (design source of truth) | **28** | `UX/screen-contracts.mjs:61-717`; `docs/ux/screen-contracts.md:13` |
| Routes covered by a contract | 22 + 5 hosted surfaces + 1 overlay = 28 | `docs/ux/screen-contracts.md:13-15` |
| Top-level tabs (surfaces) | **5** | `A/app/navigation/SellerSurface.kt:30-54` |
| Screens registered in the backend manifest | **27** | `B/design/app-screen-manifest.ts:66-94` (entry list) |
| Composable screens inside `OperationsScreens.kt` | **9** (+ shared shell + 3 ViewModels) | `A/feature/operations/OperationsScreens.kt:423,519,599,677,767,1066,1206,1329,1393` |
| Screenshot test classes / reference PNGs | **21 / 256** (staging) + 3 (debug) | `SHOT/**`; `apps/seller-android/app/src/screenshotTestStagingDebug/reference/**` |

Route → contract → manifest is a one-to-one chain guarded by three separate tools (§8).
Contracts split by surface: today 5, orders 3, store 5, customers 2, account 13
(`docs/ux/screen-contracts.md:20-26`).

### 1.2 Screen table

"States (declared)" is the contract; "State gaps in code" is what the composables actually render.

| # | Screen (contract id) | Route | Primary files (& main composables) | ViewModel | Data shown | States (declared) | State gaps found in code |
| --- | --- | --- | --- | --- | --- | --- | --- |
| 1 | splash | `SplashRoute` | `A/feature/splash/SplashScreen.kt:39`; routing in `A/feature/splash/EntryRouting.kt:115` | `SplashViewModel.kt:20` | Entry decision, error category | loading, error | No branding; error text (`operations_error`, `RES/values/strings.xml:255`) blames connectivity for a local-storage timeout (`EntryRouting.kt:142`) |
| 2 | auth | `AuthRoute` | `A/feature/auth/AuthScreen.kt:146` (`AuthScreenContent:278`), `AuthPhoneForm.kt:72`, `AuthOtpForm.kt:64`, `LanguageSheet.kt:33` | `AuthViewModel.kt` (601l) | Passkey availability, country catalogue, OTP state, terms | content, loading, error | Two stacked headings on OTP page (`AuthScreen.kt:402-436`); `AuthError.UNSUPPORTED_COUNTRY`/`INVALID_PHONE` unreachable (`AuthViewModel.kt:239-247`) |
| 3 | shop-setup | `ShopSetupRoute` | `A/feature/shopsetup/ShopSetupScreen.kt:104` | `ShopSetupViewModel.kt:44-97` | 2-step draft, taxonomy, city catalogue, slug availability | content, loading, error | Validation only on submit (`ShopSetupViewModel.kt:272-278`); subcategory state exists with **no UI** (`ShopSetupScreen.kt:158-172`, `business_subcategory_id = null` at `:333`); slug `OFFLINE` has no retry |
| 4 | restricted-account | `RestrictedAccountRoute` | `OperationsScreens.kt:1393` (`RestrictedAccountContent:1425`) | `RestrictedAccountViewModel` (`OperationsScreens.kt:340`) | Restriction reason, support entry | content | 3 stacked full-width buttons, no hierarchy (`:1435-1444`); `mailto:` fails silently (`:1405-1409`) |
| 5 | main-shell | `MainRoute` | `MainScreen.kt:98`, `MainShellContent:246` | `MainViewModel.kt:25` | Shop name, surface, FAB, plan notices | content | Top bar shows shop name only — no surface title, no actions (`MainScreen.kt:257-261`) |
| 6 | version-governance | (overlay in `MainRoute`) | `MainScreen.kt:417` `VersionBlockingScreen` | `MainViewModel` + `AppVersionGovernance.kt` | 5 governance modes, store URL | content | Only `FORCE_UPDATE` offers an action (`:439-442`) |
| 7 | today | hosted tab | `A/feature/today/TodayScreen.kt:106`, hosted by `MainScreen.kt:300` `DashboardTab` | `MainViewModel.kt:95-104` | 3 counters, plan usage, catalog share, notices, footer ad | loading, content, empty, error, offline overlay | Empty state has **no CTA** (`:185-195`); `unreadAnnouncements`, `hasPlanSnapshot`, `usingOfflinePlan` are set but never read (`TodayScreen.kt:88-92`); `onOpenAnnouncements` unused (`:110`) |
| 8 | orders | hosted tab | `A/feature/orders/OrdersScreen.kt:34`, `OrdersContent.kt:44` | `OrdersViewModel.kt:33-86` | Order list, 9 filters, refused pushes | loading, content, empty, error, offline overlay | Error state has **no retry** and cannot self-heal (`OrdersContent.kt:72` + `OrdersViewModel.kt:65-70`); `CANCELLED` unfilterable (`OrdersContent.kt:125`); no offline state |
| 9 | order-details | `OrderDetailsRoute` | `A/feature/orders/OrderDetailsScreen.kt:74` (`OrderDetailsContent` from `:133`) | `OrderDetailsViewModel.kt:36-189` | Order, items, customer, payments, proof OCR | loading, content, error, offline overlay | `null` order = "loading" forever (`:178-181`); no empty state; payment card removed once PAID/SHIPPED (`:324`); 4 different error channels (spinner/snackbar/banner/dialog) |
| 10 | new-order | `NewOrderRoute` | `A/feature/orders/NewOrderScreen.kt:62` (`NewOrderContent:113`) | `NewOrderViewModel.kt:25-199` | Product catalogue, qty, pay method, note, total | content, loading, error, offline overlay | No save-failure state; stock-only error banner (`:225-235`); empty catalogue is one grey line (`:161-163`); no `imePadding` |
| 11 | store | hosted tab | `A/feature/products/ProductsScreen.kt:41`, `StoreContent.kt:86` | `ProductsViewModel.kt:27-125` | Products, quota meter, stuck pushes, share | loading, content, empty, error, offline overlay | Empty catalogue **dead end** (`StoreContent.kt:115-127` returns before the FAB at `:211`); load error has no retry (`:105`) |
| 12 | product-edit | `ProductEditRoute` | `A/feature/products/ProductEditScreen.kt:69` (`ProductEditContent:136`) | `ProductEditViewModel.kt:35-313` | Name, description, price, stock, photo, category, availability | loading, content, error, offline overlay | No per-field validation (`:169-171`); missing product yields a blank ADD form (`ProductEditViewModel.kt:121`); `state.writeError`/`stockConflict` are guard-pinned (§10) |
| 13 | categories | `CategoriesRoute` | `A/feature/settings/CategoriesScreen.kt:170` (`CategoriesContent:274`) | in-file VM (`:86-87`) | Categories, product counts, quota | loading, content, empty, error, offline overlay | Spinner and "nothing yet" render **simultaneously** (`:315`, `:347-353`) because the list is non-null (`:86-87`); `clearError()` has no caller (`:94`); 4 icon buttons in one 12dp-padded card (`:379-407`) |
| 14 | store-info | `StoreInfoRoute` | `A/feature/settings/StoreInfoScreen.kt:244` (`:363`) | in-file VM (`refresh:112-122`) | Store profile, public id, slug, subcategory, logo/cover | loading, content, error | Save failures silent (`:144-157`); offline renders identically to live (`:112-122`); title duplicated in bar and body (`:386` vs `:435`); public id printed twice (`:415-416`) |
| 15 | catalog-languages | `CatalogLanguagesRoute` | `OperationsScreens.kt:677` (`:730`) | `OperationsViewModel:103` | Per-language product text, provenance | loading, content, empty, error | Language toggle has **no selected state** (`:747-750`); `editing` not saveable (`:682`); dialog drops description edits (`:711`) |
| 16 | customers | hosted tab | `A/feature/customers/CustomersScreen.kt:65`, `CustomersContent.kt:40` | `CustomersViewModel` (`CustomersScreen.kt:40`) | Customer list, order count, LTV | loading, content, empty, error, offline overlay | Error has no retry (`CustomersContent.kt:60`); phone hidden when a name exists (`:95`); LTV ordered by a cross-currency sum it refuses to print (`data/db/Daos.kt:255`) |
| 17 | customer-details | `CustomerRoute` | `A/feature/customers/CustomerDetailsScreen.kt:155` (`:223`) | `CustomerDetailsViewModel:84-145` | Profile fields, order history, edit gate | loading, content, error, offline overlay | **No loading and no error state**; `saveFailed` never collected (`:162`); locked edit offers no upgrade path (`:413-429`) |
| 18 | account | hosted tab | `A/feature/settings/SettingsScreen.kt:232`, `AccountContent.kt:77` | in-file VM (`SettingsScreen.kt:257-263`) | Plan, store, tools, payout handles, slug, danger zone | content, loading, offline overlay | Nested `Scaffold`+`TopAppBar` inside the shell's (`SettingsScreen.kt:274-285` vs `MainScreen.kt:254-262`); daily actions buried (§4.3) |
| 19 | seller-profile | `SellerProfileRoute` | `A/feature/settings/SellerProfileScreen.kt:216` (`:279`) | in-file VM | Name, email, birth year, photo | loading, content, error | Photo has no preview, no upload progress/failure (`:390-410`); no error state |
| 20 | devices | `DevicesRoute` | `OperationsScreens.kt:767` (`:872`) | `OperationsViewModel` | Devices, passkeys, device limit | loading, content, error | Device revoke has **no confirmation** (`:986-988`) while passkey revoke does (`:837-858`); list-detail only ≥720dp (`:902-903`) |
| 21 | support | `SupportRoute` | `OperationsScreens.kt:423` (`:472`) | `OperationsViewModel` | Tickets | loading, content, empty, error | Tickets rendered eagerly in a `verticalScroll` `forEach` (`:501-514`); raw status/priority enums printed (`:508`); "New ticket" duplicated as body button + empty action (`:492-498`) |
| 22 | support-ticket | `SupportTicketRoute` | `OperationsScreens.kt:519` (`:547`) | `SupportTicketViewModel:289` | Thread messages, reply | loading, content, error | Reply failures swallowed (`:334-337`); field clears immediately (`:535`); raw `"closed"` comparison (`:576`) |
| 23 | announcements | `AnnouncementsRoute` | `OperationsScreens.kt:599` (`:616`), dashboard indicator `:658` | `OperationsViewModel` | Announcements, read state | loading, content, empty, error | Whole-card tap is the only write, no undo (`:636-638`); bodies always expanded (`:635-653`); second entry point on Today (`MainScreen.kt:360`) |
| 24 | deletion-status | `DeletionStatusRoute` | `OperationsScreens.kt:1329` (`:1354`) | `OperationsViewModel` | Request status, deadlines | loading, content, error | Read-only dead end — no withdraw, no support link (`:1369-1389`); raw ISO timestamps |
| 25 | ai-assistant | `AiAssistantRoute` | `OperationsScreens.kt:1206` (`:1238`) | `OperationsViewModel` | Chat, quota | loading, content, empty, error | "Retry" is wired to `resetChat` (`:1255`) — the button deletes the conversation; quota line uses the raw key `"max_ai_requests_per_month"` (`:1258`) |
| 26 | subscription | `SubscriptionRoute` | `OperationsScreens.kt:1066` (`:1097`) | `OperationsViewModel` | Plan, status, usage meters, billing flags | loading, content, error, offline overlay | `subscriptionStatus ?: "active"` (`:1124`); usage section silently absent when empty (`:1157`); recover-purchases hidden while purchase is closed (`:1171-1177`) |
| 27 | plans | `PlansRoute` | `A/feature/billing/PlansScreen.kt:107` (`PlansContent:126`) | in-file VM | 4-plan comparison matrix | loading, content, error | ~600dp of fixed-width columns in a ~360dp viewport with no scroll affordance (`:201-241`); `FullScreenLoading()` without the Scaffold padding (`:144`) |
| 28 | paywall | `PaywallRoute` | `A/feature/billing/PaywallScreen.kt:117` (`PaywallContent:135`) | in-file VM | Limit key, used/limit, next-plan value | content | No `verticalScroll` (`:152-155`); limit parsed as `toIntOrNull()` so `unlimited` shows the "unknown" copy (`:78`, `:182`); next-plan value interpolated **raw** (`:99`) |

### 1.3 Non-screen user-visible surfaces (sheets, dialogs, overlays)

| Surface | File:line | Notes |
| --- | --- | --- |
| Language sheet | `A/feature/auth/LanguageSheet.kt:33` | Only entry point is Welcome's top-end button (`AuthScreen.kt:291`) |
| Passkey invite sheet (auth) | `AuthScreen.kt:440` | `onDismissRequest = onSkip` (`:447`) — swipe = skip |
| Country picker sheet | `AuthScreen.kt:492` | Fixed `height(420.dp)` list (`:525`); no no-results message |
| Birth-year dialog | `ShopSetupScreen.kt:369` | 3-column grid, no confirm/cancel (`:408`) |
| Passkey invite sheet (setup) | `ShopSetupScreen.kt:749` | — |
| Products limit dialog | `ProductsScreen.kt:74-131` | Confirm only when `upgradePlanKey != null` |
| Stock conflict dialog | `ProductEditScreen.kt:350-385` | Shows both figures; dismiss = take the shop's |
| Delete / logout / deletion-result dialogs | `SettingsScreen.kt:325-358` | Destructive labels reuse the title string |
| Announcements dashboard indicator | `OperationsScreens.kt:658` | Rendered inside the Today surface (`MainScreen.kt:360`) |
| Ad banner footer | `core/ads/AdManagerImpl.kt:105` | `height(96.dp)`, hardcoded |

---

## 2. Design system in code

### 2.1 How theming works today

There is **no runtime or remote theming**. The design system is generated by a backend script and
committed as Kotlin source; a token change is a code change plus a release.

1. **Intent lives in TypeScript.** `B/design/design-system.ts:147-161` defines
   `DEFAULT_DESIGN_SYSTEM_SOURCE`: seed `primary: "#014D4E"`, `primaryChromaFloor: 28.7`,
   `primaryLightTones: [29.1, 22, 14]`, `variant: "tonal-spot"`, `defaultContrast: "standard"`,
   typography `family: "cairo"`, spacing `baseUnit: 4` / `density: "comfortable"`, shapes
   `preset: "balanced"`.
2. **The generator derives and contrast-validates every value.**
   `generateDesignSystem()` maps hue/chroma through an MCU `TonalPalette`
   (`B/design/design-system.ts:327`), pins the light primary to `primaryLightTones[0]` so brand hex and
   action colour coincide (`:352-356`), and re-validates the legacy projection at 4.5:1, reverting on
   failure (`:693-702`).
3. **Compilation is a developer step.** `services/backend/scripts/generate-design-system-fixture.ts`
   emits three files together: `design/design-system.default.json:10`, `T/DesignSystemContract.kt:26`,
   `T/GeneratedDesignSystem.kt:27`, via `pnpm run design-system:generate`
   (referenced at `T/GeneratedDesignSystem.kt:14` and in the guard message
   `apps/seller-android/app/build.gradle.kts:744`).
4. **Nothing is fetched at runtime.** `A/app/MainActivity.kt:111-113`: *"The design system is compiled
   into the app, so there is nothing to wait for: no revision to promote and no network round trip
   before the first frame can be themed correctly."* There is no design-system DTO, repository or API
   call in `A/data/` (only `data/theme/ThemePreferencesRepository.kt` and
   `data/theme/DesignSystemPolicy.kt`). The admin Theme Builder's immutable D1 revisions
   (`docs/domains/design-system.md:44-78`) currently have **no delivery path to Android**. A guard
   enforces this: `build.gradle.kts:808-811` fails the build if `BrandingRepository`/`remoteConfig`
   appears in `Theme.kt` ("Runtime theming was reintroduced; colour must stay code-only and
   contrast-gated.").
5. **Scheme matrix = 3 contrasts × 2 modes = 6 `ColorScheme`s plus 6 extended sets.**
   `T/GeneratedDesignSystem.kt:35` (`contrasts = ["standard","medium","high"]`); selection at
   `:37-48` (`colorScheme`) and `:50-61` (`extendedColors`). Objects: `LightStandard:106`,
   `DarkStandard:157`, `LightMedium:208`, `DarkMedium:259`, `LightHigh:310`, `DarkHigh:361`;
   extended `:412`, `:438`, `:464`, `:490`, `:516`, `:542`.
6. **One Compose adapter.** `T/Theme.kt:116-155` `OrderakTheme(darkTheme, contrastLevel)`: normalises
   contrast (`:121`), resolves colours (`:122-123`), builds spacing (`:124`), provides
   `LocalOrderakExtendedColors` + `LocalOrderakSpacing` (`:139-142`), then
   `MaterialTheme(colorScheme, typography = OrderakTypography.withGenerated(), shapes = generatedShapes())`
   (`:143-147`) inside a `Surface(color = colorScheme.background)` (`:148-152`). System-bar icon
   polarity is derived from `background.luminance() > 0.5f` (`:133-135`).
7. **Contrast resolution: highest wins.** `MainActivity.kt:64-80` reads `UiModeManager.contrast`
   (API 34+) and `Settings.Secure "high_text_contrast_enabled"` through
   `data/theme/DesignSystemPolicy.kt:17-25` (≥0.66 → `high`, ≥0.33 → `medium`, legacy flag → `high`),
   then `selectHighestContrast(DEFAULT_CONTRAST, userPref, systemContrast)` (`:4-7`, precedence
   `standard < medium < high`).
8. **Dark/light** comes from `ThemePreferencesRepository.ThemeMode` (System/Light/Dark) or
   `isSystemInDarkTheme()` (`MainActivity.kt:59-63`).
9. **Preferences are persisted but unreachable.** DataStore file `theme_preferences` with keys
   `theme_mode`, `contrast_level`, `dynamic_color_enabled` (`data/theme/ThemePreferencesRepository.kt:20,61-63`).
   `setThemeMode`/`setContrastLevel`/`setDynamicColorEnabled` (`:84-94`) have **zero call sites** — there
   is no appearance screen anywhere in `A/feature/settings/`. So a seller cannot choose light/dark or
   contrast inside the app; the model also cannot request *less* than `standard` because
   `DEFAULT_CONTRAST` is always one of the compared values (`MainActivity.kt:76-80`).
10. **Material You is disabled twice, deliberately.** `ThemePreferencesRepository.kt:73` hardcodes
    `false`, and `setDynamicColorEnabled(enabled)` ignores its argument and writes `false` (`:92-94`).
    `build.gradle.kts:813-818` requires `"dynamicColorEnabled = false"` and forbids
    `dynamicDarkColorScheme` in `Theme.kt` ("Material You must remain disabled; published Orderak colours
    have precedence.").
11. **`designSystemReady` is vestigial** (`MainActivity.kt:35,57,88,114`): flipped true in `onStart()`
    with nothing to wait for.

**Fallback behaviour (verified paths).**

| Condition | Result | Source |
| --- | --- | --- |
| No backend theme | Irrelevant — there is no fetch | `MainActivity.kt:111-114` |
| Unknown contrast string | `LightStandard` / `LightStandardExtended` | `T/GeneratedDesignSystem.kt:46,59`; `normalizeContrast:63-64` |
| Unparseable stored key | `System` / `Standard` | `data/theme/ThemePreferencesRepository.kt:44-46,55-57` |
| Shape token missing or outside `0f..40f` | Per-role fallback 4/8/12/16/24dp | `T/Theme.kt:82-90` |
| Spacing token missing or outside `0f..144f` | `OrderakSpacing` default for that name | `T/Theme.kt:95-107` |
| `MINIMUM_TOUCH_TARGET_DP < 48` | Silently raised to 48 | `T/Theme.kt:108` |
| Generated typography map ≠ 15 roles | **Entire** static `OrderakTypography` used | `T/Type.kt:185` |
| One role missing / non-positive size or lineHeight | That role falls back to static value | `T/Type.kt:188-189` |
| Extended colours read outside `OrderakTheme` | Light/standard values even in dark mode | `T/Theme.kt:50-52` |

### 2.2 Token inventory

**Colour — Material 3 roles: 48 roles × 6 schemes = 288 literals** (all in one generated file).
Standard/light values: `T/GeneratedDesignSystem.kt:106-155`. Full role list (standard/light):

| Role | Value | Role | Value | Role | Value | Role | Value |
| --- | --- | --- | --- | --- | --- | --- | --- |
| primary | `#014D4E` | onPrimary | `#FFFFFF` | primaryContainer | `#B0EEEE` | onPrimaryContainer | `#054F50` |
| inversePrimary | `#95D1D2` | secondary | `#9B4500` | onSecondary | `#FFFFFF` | secondaryContainer | `#FFDBC9` |
| onSecondaryContainer | `#763300` | tertiary | `#005AC2` | onTertiary | `#FFFFFF` | tertiaryContainer | `#D8E2FF` |
| onTertiaryContainer | `#004395` | background | `#F3FBFC` | onBackground | `#151D1E` | surface | `#F3FBFC` |
| onSurface | `#151D1E` | surfaceVariant | `#D6E5E7` | onSurfaceVariant | `#3B494B` | surfaceTint | `#296768` |
| inverseSurface | `#2A3233` | inverseOnSurface | `#EAF2F3` | error | `#BA1A1A` | onError | `#FFFFFF` |
| errorContainer | `#FFDAD5` | onErrorContainer | `#930009` | outline | `#6B7A7C` | outlineVariant | `#BAC9CB` |
| scrim | `#000000` | surfaceBright | `#F3FBFC` | surfaceDim | `#D4DBDC` | surfaceContainer | `#E7EFF0` |
| surfaceContainerHigh | `#E2EAEA` | surfaceContainerHighest | `#DCE4E5` | surfaceContainerLow | `#EDF5F6` | surfaceContainerLowest | `#FFFFFF` |
| primaryFixed | `#B0EEEE` | primaryFixedDim | `#95D1D2` | onPrimaryFixed | `#002020` | onPrimaryFixedVariant | `#054F50` |
| secondaryFixed | `#FFDBC9` | secondaryFixedDim | `#FFB68E` | onSecondaryFixed | `#331200` | onSecondaryFixedVariant | `#763300` |
| tertiaryFixed | `#D8E2FF` | tertiaryFixedDim | `#ADC6FF` | onTertiaryFixed | `#001A42` | onTertiaryFixedVariant | `#004395` |

**28 of 48 roles are never read by a composable** (all `*Fixed*`, all `tertiary*`, `secondary`,
`onSecondary`, `surfaceTint`, `inverse*`, `surfaceBright/Dim`, `surfaceContainer/*` except
`Lowest`). A redesign can change 28 values and move no pixel. Most-read role:
`onSurfaceVariant` (~60 sites, e.g. `TodayScreen.kt:194`).

**Colour — extended semantic roles: 23 × 6 = 138 literals.** Type: `T/Color.kt:22-52` (no defaults, by
design). Standard/light: `T/GeneratedDesignSystem.kt:412-436`.

| Token | Value | Consumed at | Token | Value | Consumed at |
| --- | --- | --- | --- | --- | --- |
| warning | `#755B00` | `CUI/SemanticRole.kt:89` | warningSoft | `#FFDF91` | `:86` |
| onWarning | `#FFFFFF` | `:90` | onWarningContainer | `#241A00` | `:87` |
| success | `#1B6D24` | `:82` | successSoft | `#A3F69C` | `:79` |
| onSuccess | `#FFFFFF` | `:83` | onSuccessContainer | `#002204` | `:80` |
| information | `#0061A4` | `:107` | informationSoft | `#D1E4FF` | `:104` |
| onInformation | `#FFFFFF` | `:108` | onInformationContainer | `#001D36` | `:105` |
| commerce | `#6D509A` | `:114` | commerceSoft | `#ECDCFF` | `:111` |
| onCommerce | `#FFFFFF` | `:115` | onCommerceContainer | `#270452` | `:112` |
| warningContainerOutline | `#937309` | `:88` | successContainerOutline | `#38873A` | `:81` |
| informationContainerOutline | `#327ABF` | `:106` | commerceContainerOutline | `#8669B5` | `:113` |
| accent | `#9B4500` | **unused** | onAccent | `#FFFFFF` | **unused** |
| primaryTint | `#95D1D2` | **unused** |  |  |  |

**Typography — 15 roles.** Two live scales: static `T/Type.kt:50-161` and generated
`T/GeneratedDesignSystem.kt:66-82`, merged at runtime by `OrderakTypography.withGenerated()`
(`T/Type.kt:183-215`, applied at `T/Theme.kt:145`).

| Role | Static (size/lh/weight)`Type.kt` | Generated (size/lh/weight) | Effective difference |
| --- | --- | --- | --- |
| displayLarge | 57/64/**Bold** `:52-58` | 57/4rem/400 `:67` | weight Bold→400 |
| displayMedium | 45/52/**Bold** `:59-65` | 45/3.25/400 `:68` | weight Bold→400 |
| displaySmall | 36/44/**Bold** `:66-72` | 36/2.75/400 `:69` | weight Bold→400 |
| headlineLarge | 32/40/**Bold** `:74-80` | 32/2.5/400 `:70` | weight Bold→400 |
| headlineMedium | 28/36/**Bold** `:81-87` | 28/2.25/400 `:71` | weight Bold→400 |
| headlineSmall | 24/32/**SemiBold** `:88-94` | 24/2/400 `:72` | weight SemiBold→400 |
| titleLarge | 22/28/**Bold** `:96-102` | 22/1.75/400 `:73` | weight Bold→400 |
| titleMedium | 16/24/**SemiBold** `:103-109` | 16/1.5/500 `:74` | weight SemiBold→500 |
| titleSmall | 14/20/Medium `:110-116` | 14/1.25/500 `:75` | matches |
| bodyLarge | 16/24/Normal `:118-124` | 16/1.5/400 `:76` | matches |
| bodyMedium | 14/20/Normal `:125-131` | 14/1.25/400 `:77` | matches |
| bodySmall | 12/16/Normal `:132-138` | 12/1/400 `:78` | matches |
| labelLarge | 14/20/Medium `:140-146` | 14/1.25/500 `:79` | matches |
| labelMedium | 12/16/Medium `:147-153` | 12/1/500 `:80` | matches |
| labelSmall | **12**/16/Medium `:154-160` | **11**/1/500 `:81` | **size 12→11sp** |

8 of 15 roles disagree on weight; `labelSmall` disagrees on size. Generated weights are only
{400, 500}, so the SemiBold/Bold faces downloaded at `T/Type.kt:41-42` are never selected — while the
static scale that *does* use them is exactly what renders if the generated map is not 15 entries
(`T/Type.kt:185`). The generated `lineHeight` is a **rem multiplier × 16f** (`T/Type.kt:194`), an
unguarded unit assumption. `withGenerated()` also treats `fontFamily` as `cairo` today
(`design/design-system.default.json:525`); `tajawal` / `noto-arabic` are accepted
(`T/Type.kt:163-167`) but unreachable, and the guard requires the approved set
(`build.gradle.kts:793-798`).

**Spacing — 11 tokens** (`T/Theme.kt:54-66`, generated override `:97-109`):

| Token | Value | Read? | Token | Value | Read? |
| --- | --- | --- | --- | --- | --- |
| space0 | 0dp | no | space1 | 4dp | yes (`CUI/OrderakComponents.kt:87`) |
| space2 | 8dp | yes (`TodayScreen.kt:150`) | space3 | 12dp | yes (`CUI/FeatureGate.kt:100`) |
| space4 | 16dp | yes (`TodayScreen.kt:120`) | space6 | 24dp | yes (`TodayScreen.kt:181`) |
| space8 | 32dp | yes (`TodayScreen.kt:305`) | space10 | 40dp | no |
| space12 | 48dp | no | space16 | 64dp | no |
| minimumTouchTarget | 48dp (`maxOf(48f, generated)`) | yes (`TodayScreen.kt:201`) |  |  |  |

`LocalOrderakSpacing` is read in 12 files (`TodayScreen.kt:117`, `StoreContent.kt:97`,
`CustomersScreen.kt:69`, `CustomersContent.kt:47`, `OrdersContent.kt:62`, `OrdersScreen.kt:42`,
`ProductsScreen.kt:49`, `AccountContent.kt:101`, `SplashScreen.kt:44`, `MainScreen.kt:358`,
`CUI/OrderakComponents.kt:73`, `CUI/FeatureGate.kt:89`). Note there is no `space5`/`space7`/`space9`.

**Shape — 5 tokens** (`T/Theme.kt:37-43` static, `:80-91` generated):

| Token | Value | Read? |
| --- | --- | --- |
| extraSmall | 4dp | never read via `shapes.extraSmall` (raw `RoundedCornerShape(4.dp)` used instead, `CUI/OrderakComponents.kt:131,138`) |
| small | 8dp | `CUI/SemanticChip.kt:37` |
| medium | 12dp | `CUI/StateComponents.kt:157` |
| large | 16dp | `CUI/OrderakComponents.kt:172,224`, `CUI/FeatureGate.kt:93,137` |
| extraLarge | 24dp | never read |

`val OrderakShapes` (`T/Theme.kt:37-43`) is dead code; the live value is `generatedShapes()`
(`:80-91`, used at `:146`).

**Component token — 1:** `minimumTouchTargetDp: 48` (`design/design-system.default.json:668-670`).

**Legacy projection — 14 tokens, zero Android consumers:** `design/tokens.json:3-16`
(`primary`, `primary_strong`, `primary_soft`, `primary_tint`, `canvas`, `surface`, `ink`, `muted`,
`line`, `danger`, `danger_soft`, `warning`, `warning_soft`, `accent`). Only the Gradle guard reads the
file (`build.gradle.kts:737,833-838`).

**Token groups that do not exist at all:**

| Group | Status and evidence |
| --- | --- |
| Elevation | **No token** — docs say the phone app has no shadows (`docs/domains/design-system-reference.md:111-113`) yet `tonalElevation = 2.dp` is hardcoded twice (`AuthScreen.kt:220`, `ShopSetupScreen.kt:214`) |
| Motion / duration | **No token** — only web prose (150/180/200 ms, `design-system-reference.md:116-122`); Android hardcodes `tween(300)` at 6 sites (`AuthHeader.kt:70-71`, `AuthPhoneForm.kt:130-131`, `AuthSharedUi.kt:181-182`) |
| Opacity / state layers | **No token** — 9 distinct hardcoded `.copy(alpha = …)` (e.g. `AuthOtpForm.kt:231,232,240`, `OrderakComponents.kt:243`) |
| Pill radius | **No token** — `RoundedCornerShape(100.dp)` twice (`AuthSharedUi.kt:105,146`) |
| Control heights | **No token** — 48/50/54/56/64dp (`AuthSharedUi.kt:104,145`, `AuthScreen.kt:352`, `AuthOtpForm.kt:249`, `core/ads/Providers.kt:58`) |
| Icon sizes | **No token** — 14/16/18/20/24/40/44/48/88dp scattered (`SemanticChip.kt:51`, `TodayScreen.kt:271,281`, `CUI/FeatureGate.kt:104`, `AuthHeader.kt:50`) |
| Breakpoints / window size class | **None** — no `WindowSizeClass` anywhere; only `LocalConfiguration.current.screenHeightDp < 600` (`AuthScreen.kt:285`) and `widthIn(max = 560.dp)` (`AuthScreen.kt:449`, `ShopSetupScreen.kt:758`), plus a `≥720dp` list-detail switch in devices (`OperationsScreens.kt:902-903`) |
| Grid / layout tokens | **None** |

### 2.3 What is hardcoded instead of tokenized

Colour is the one dimension held clean: **all 426 `Color(0x…)` literals live in
`T/GeneratedDesignSystem.kt`** (288 scheme + 138 extended), and the only colour literal in the feature
tree is `Color.Transparent` (`A/feature/auth/AuthOtpForm.kt:203`). `verify-no-hardcoded-colors.mjs`
runs in CI (`docs-ci.yml:82-83`). Everything else leaks:

| Kind | Count / sites | Examples |
| --- | --- | --- |
| Raw `dp` padding / `spacedBy` | ~105 sites | `StateComponents.kt:64,111` (`32.dp` = `space8`), `StateComponents.kt:161` (`12.dp` = `space3`), `SemanticChip.kt:43` (`8.dp` + off-scale `2.dp`), `OrderDetailsScreen.kt:252-255`, `ProductEditScreen.kt:169-171` |
| Raw size/height/width/alpha | ~134 sites | `ProductEditScreen.kt:176` (`height(180.dp)`), `AuthOtpForm.kt:249` (`height(64.dp)`), `AuthScreen.kt:352,360` (`height(54.dp)`), `OrdersContent.kt:150` & `StoreContent.kt:208` (`80.dp` FAB clearance), `AdManagerImpl.kt:105-106` |
| Raw `RoundedCornerShape(` | 19 sites | `AuthSharedUi.kt:105,146` (100dp), `AuthPhoneForm.kt:146` (20dp), `AuthPhoneForm.kt:256` (14dp), `AuthHeader.kt:51` (28dp), `StoreContent.kt:241,245` (10dp), `ShopSetupScreen.kt:265` (3dp), `OrderakComponents.kt:238` (2dp) |
| Token + literal arithmetic | 3 sites | `OrderakComponents.kt:87` (`space1 + 2.dp`), `:178,230` (`space3 + 2.dp`), `:237` (`space6 + 8.dp`) |
| `FontWeight.` literals outside `Type.kt` | 6 sites | `OrderakComponents.kt:122` (Bold), `PlansScreen.kt:207` (Bold/Normal), `ShopSetupScreen.kt:274,693`, `AuthSharedUi.kt:252` (SemiBold — a weight the generated scale never produces) |
| `tween(300)` motion | 6 sites | `AuthHeader.kt:70-71`, `AuthPhoneForm.kt:130-131`, `AuthSharedUi.kt:181-182` |
| `fontSize =` literals | 0 in feature tree | only `T/Type.kt` |
| `MaterialTheme.typography.*` reads | 181 across 30 files | top: `OperationsScreens.kt` 34, `OrderDetailsScreen.kt` 18 |

Files that use **no** spacing tokens at all and are the visual outliers:
`ProductEditScreen.kt` (does not import `LocalOrderakSpacing`), `CustomerDetailsScreen.kt`,
`OrderDetailsScreen.kt`, `NewOrderScreen.kt` — while `TodayScreen.kt`, `StoreContent.kt`,
`CustomersScreen.kt`, `MainScreen.kt` use them consistently. The two halves of the same feature
therefore do not share a spacing vocabulary.

---

## 3. Shared component library

### 3.1 Reusable components

| Component | File:line | Purpose | Used at | Not used at |
| --- | --- | --- | --- | --- |
| `UsageMeter` | `CUI/OrderakComponents.kt:66-143` | Label + "used / limit" pair + 6dp bar; severity from `usageRole` (≥70% warning, at-limit danger); LTR-pinned digits inside RTL | `StoreContent.kt:161`; via `PlanUsageRowItem` (`CUI/PlanUsage.kt:90`) → `MainScreen.kt:489`, `OperationsScreens.kt:1162` | Orders, Customers, Paywall (no meter there) |
| `NoticeBanner` | `CUI/OrderakComponents.kt:153-202` | Route-neutral inline notice (icon + title + message + optional action) for every semantic role | `TodayScreen.kt:137`, `MainScreen.kt:388,463`, `StoreContent.kt:141`, `NewOrderScreen.kt:229`, `CategoriesScreen.kt:321,336`, `LocalOnlyOrder.kt:89,97`, `OperationsScreens.kt:1137,1179` | Order list rows, OrderDetails (uses the order-specific banner), Customers, ProductEdit |
| `PriorityListRow` | `CUI/OrderakComponents.kt:213-262` | List row with a 4dp "needs me" rail, title/subtitle, trailing slot; `defaultMinSize(48dp)` | `OrdersScreen.kt:84` (via `OrderCard`), `CustomersScreen.kt:94` | Every operations list uses eager `Card` + `forEach` instead (`OperationsScreens.kt:501-514, 635-653, 1286-1306`) |
| `FullScreenLoading` | `CUI/StateComponents.kt:38-47` | Centred `CircularProgressIndicator` | `CustomersContent.kt:64`, `StoreContent.kt:112`, `ProductEditScreen.kt:166`, `StoreInfoScreen.kt:402`, `SellerProfileScreen.kt:318`, `PlansScreen.kt:144`, `OperationsScreens.kt:399`, `NewOrderScreen.kt:160` (as a list item) | Nothing uses a skeleton except Today (`TodayScreen.kt:287,301-309`) and Account (`AccountContent.kt:105,252-262`) |
| `FullScreenError` | `CUI/StateComponents.kt:57-92` | Centred icon + message + optional retry | `PlansScreen.kt:145`, `OperationsScreens.kt:401`, and **without** retry at `OrdersContent.kt:72`, `StoreContent.kt:105`, `CustomersContent.kt:60` | OrderDetails, ProductEdit, NewOrder, StoreInfo, SellerProfile, Categories, Paywall have no error state via this component |
| `FullScreenEmpty` | `CUI/StateComponents.kt:103-139` | Centred icon + message + optional CTA | `OrdersContent.kt:82,137`, `CustomersContent.kt:68,91`, `StoreContent.kt:122,185`, `OperationsScreens.kt:491,632,752,899` | Store's catalogue-empty state calls it **without** `actionLabel` (`StoreContent.kt:122-126`) |
| `SyncStatusBanner` | `CUI/StateComponents.kt:148-186` | "pending"/"failed" sync banner with retry | `MainScreen.kt:362` **only** | Orders, Store, Customers surfaces have no sync affordance |
| `SemanticChip` | `CUI/SemanticChip.kt:28-57` | outlined chip = colour + glyph + label; `clearAndSetSemantics` merges to one node | `OrdersScreen.kt:135`, `StoreContent.kt:268`, `LocalOnlyOrder.kt:65`, `FeatureGate.kt:120,159`, `ComponentScreenshotTest.kt:52-57` | Not clickable by construction (no `onClick` parameter) — see §5.6 |
| `FeatureAvailabilityChip` | `CUI/SemanticChip.kt:89-102` | Badge for `Available`/`LockedByPlan`/`NotBuilt` | **Only** `ComponentScreenshotTest.kt:62-63` | No production call site |
| `SemanticRole` / `.colors()` / `.icon` | `CUI/SemanticRole.kt:27-143` | 6-role semantic layer; brand deliberately excluded; every role pairs a colour with a glyph | Everywhere chips/banners/meters are drawn | — |
| `planUsageRows` / `PlanUsageRowItem` / `PLAN_USAGE_KEYS` | `CUI/PlanUsage.kt:36-103` | One key list, one filter, one renderer for plan usage | `MainScreen.kt:483-489`, `OperationsScreens.kt:1078,1162` | Paywall does its own limit-key mapping (`PaywallScreen.kt:233-239`) |
| `SearchField` | `CUI/SearchField.kt:31-56` | In-memory list filter with a clear button; offline-capable | `StoreContent.kt:174`, `CustomersContent.kt:80` | Orders has **no search** (`OrdersContent.kt:88-153`) |
| `SearchableAutocompleteField` | `CUI/SearchableAutocompleteField.kt:13` | Generic autocomplete field | **No call site found** in main or test source | — |
| `backendErrorResource` + `MAPPED_CODES` + `INTENTIONALLY_GENERIC` | `CUI/BackendErrors.kt:34-216` | Backend code → localized sentence, coverage-tested | `PlansScreen.kt:146`, `LocalOnlyOrder.kt:102` | `OperationsScreens.kt:403` passes a raw code; `CategoriesScreen.kt:116,138,155,163` and `ProductEditViewModel.kt:305-313` use private parallel mappings |
| `FeatureGate` (resolver + drawing overloads) + `LockedByPlanNotice` + `NotBuiltNotice` | `CUI/FeatureGate.kt:37-161` | Three-state gate: available / locked-by-plan / not-built | `OrderDetailsScreen.kt:336` **only** | Account, billing, operations, store and customer screens use ad-hoc banners or `PaywallRoute` instead |
| `OrderakLocalePreviews` | `CUI/OrderakPreviews.kt:6-11` | en/ar/fr + `en-rXA`/`ar-rXB` preview matrix | **No call site** | — |
| `OrderakShippedLocalePreviews` | `CUI/OrderakPreviews.kt:14-17` | en/ar/fr shipped matrix | `LocalizationScreenshotTest.kt:23`, `AuthScreen.kt:550` | Not applied to any other screen |
| `OrderCard` | `A/feature/orders/OrdersScreen.kt:68-111` | Order row (rail + amount + status chip + local-only chip) | `OrdersContent.kt`, `CustomerDetailsScreen.kt:315` | — |
| Private one-offs | `CounterCard` (`TodayScreen.kt:228`), `ProductCard` (`StoreContent.kt:232`), `SettingsListItem`/`SettingsSectionHeader` (`SettingsScreen.kt:362-394`), `OperationPage` (`OperationsScreens.kt:356`), `ReadOnlyRow`/`Field` (`StoreInfoScreen.kt:541-555`), `AuthButton`/`AuthErrorText` (`AuthSharedUi.kt:64,99`), `PasskeyHeader`/`PasskeyDetailCard` (`OperationsScreens.kt:1003,1023`) | Serve one screen each | — | — |
| Dead code (declared, never called) | `AuthHeader.kt:39`; `AuthOutlinedButton` `AuthSharedUi.kt:133`; `AuthLoadingOverlay` `:175`; `AuthDivider` `:207`; `AuthTermsAndPrivacyText` `:243`; `MarketingOptInSwitch` `AuthPhoneForm.kt:278` | — | Nothing | All unused |

### 3.2 Duplicated patterns that should become components

| Duplicated pattern | Sites | Why it should be one component |
| --- | --- | --- |
| Status chip vs ad-hoc chips/badges | `SemanticChip` (`OrdersScreen.kt:135`, `StoreContent.kt:268`, `LocalOnlyOrder.kt:65`) vs inline `Text` with `colorScheme.primary`/`error` (`OrderDetailsScreen.kt:372-373`, `OperationsScreens.kt:644-650`) | Two vocabularies for "state as a badge"; the inline one drops the greyscale glyph |
| Section header | `SettingsSectionHeader` (`SettingsScreen.kt:362-373`, labelLarge + primary + divider), `titleLarge` headings (`OperationsScreens.kt:966-970,1004-1008`), `titleMedium` headings (`AccountContent.kt:178-182`, `StoreInfoScreen.kt:435`, `SellerProfileScreen.kt:392-395`) | Three typographic treatments, one of which is the only one with `heading()` |
| List row | `PriorityListRow` (orders, customers) vs `Card(onClick)` + `forEach` (support/announcements/devices/ai) | The operations rows lose the priority rail and the 48dp floor by re-implementing the row |
| Loading | Spinner (`FullScreenLoading`), skeletons (`TodayScreen.kt:301`, `AccountContent.kt:252`), inline spinner (`CategoriesScreen.kt:315`) | Three meanings for "not known yet", one of which (Categories) renders alongside an empty message |
| Empty state | `FullScreenEmpty` with CTA (`OrdersContent.kt:82`), without CTA (`StoreContent.kt:122`, `CustomersContent.kt:68`), inline `Text` (`NewOrderScreen.kt:161`, `CategoriesScreen.kt:347`), centred `Column` (`PlansScreen.kt:149-155`) | Four shapes for one state; only some have a way out |
| Destructive confirmation | Confirm (`ProductEditScreen.kt:324`, `CategoriesScreen.kt:206-218`, `OrderDetailsScreen.kt:427-463`, `OperationsScreens.kt:837-858`) vs no confirm (`OperationsScreens.kt:986-988` device revoke, `:1318` AI reset) | Inconsistent safety for irreversible actions |
| Form field | `OutlinedTextField` with `supportingText` (`StoreInfoScreen.kt:541-547`), with `isError` but no text (`ShopSetupScreen.kt:343`), with neither (`ProductEditScreen.kt:169-171`), with a custom pill shape (`AuthPhoneForm.kt:146`) | No single field component means validation is presented four different ways |
| Language picker | `LanguageSheet.kt:33` (guarded, single source) vs `OperationsScreens.kt:747-750` (two unstyled buttons, no selected state, hardcoded labels) | The second picker is unguarded and visually unrelated |

### 3.3 Components that are one-off where a system component exists

- `PaywallScreen` re-implements limit-name mapping instead of `PLAN_USAGE_KEYS` (`PaywallScreen.kt:233-239` vs `CUI/PlanUsage.kt:51-57`).
- `CategoriesScreen` builds its own commerce banner + paywall action instead of `FeatureGate` (`CategoriesScreen.kt:321-335`).
- `CustomerDetailsScreen` builds its own locked-state row with no upgrade path instead of `FeatureGate.LockedByPlanNotice` (`CustomerDetailsScreen.kt:413-429`).
- `ProductEditScreen` maps write errors through a private enum instead of `backendErrorResource` (`ProductEditViewModel.kt:80,305-313`).
- Four private ViewModel wrappers exist only to reach Hilt state (`EntitlementHolderViewModel` at `ProductsScreen.kt:243-246`).

---

## 4. Navigation and information architecture

### 4.1 Graph shape

- **One flat `NavHost`, 22 destinations** (`A/app/navigation/OrderakNavHost.kt:74-220`), typed
  serializable routes (`Routes.kt:5-44`), start destination `SplashRoute` (`:74`).
- **Five surfaces are not routes.** `SellerSurface` (`SellerSurface.kt:30-54`) is held in
  `rememberSaveable` string state inside `MainScreen.kt:146`, switched by the bottom `NavigationBar`
  (`:272-291`). Result: no `NavBackStackEntry` per tab, no `saveState/restoreState`, no deep link to a
  tab. The file itself records the gap: `TODO(polish): nested NavHost with saveState/restoreState per tab (Plan §3.4)` (`MainScreen.kt:94`).
- **No `SaveableStateHolder` and no nested `NavHost` anywhere** (grep across `A/`): switching surface
  discards the leaving surface's `rememberSaveable` state, so the product search query
  (`ProductsScreen.kt:54`), customer query (`CustomersScreen.kt:72`), list scroll position and dialogs
  are lost on every tab switch. The orders filter is deliberately not saveable
  (`MainScreen.kt:147-150`), but the *state* loss is not deliberate.
- **Back-stack behaviour:** depth is 1 for surfaces (they are not pushed), so **system back on a
  non-Today surface leaves the app** — there is no `BackHandler` outside Auth (`AuthScreen.kt:161`) and
  ShopSetup (`ShopSetupScreen.kt:115`). Every detail route is a pushed destination (`:138-213`) and
  `popBackStack()` is used correctly; `navigateAsRoot` clears the whole stack for entry/exit
  (`:229-234`).
- **Deepest chains:** `MainRoute → CustomerRoute → OrderDetailsRoute → CustomerRoute` (order details can
  open a customer, whose order list opens order details again — `:158,165`), and
  `MainRoute → PaywallRoute → PlansRoute` (`:176`).
- **Entry gate:** `EntryRouteResolver.resolve()` (`EntryRouting.kt:121-190`) timeout-boxes local storage
  at 5 s (`:240`) and the account-status call at 3 s (`:241`), then `EntryDecisionPolicy.decide()`
  (`:50-89`) returns `Auth | Restricted | ShopSetup(resumeStep) | Main(offline) | Error`. The nav host
  **ignores `resumeStep`** (`OrderakNavHost.kt:83`); real resume comes from `SessionStore`
  (`ShopSetupViewModel.kt:121`). Restricted accounts are routed to `RestrictedAccountRoute` (`:85`).
  Mid-session `SessionRouteSignal` re-routes to Splash except on auth/onboarding (`:60-72`), and a
  rejected credential clears the local session before Auth is reached (`EntryRouting.kt:111-112,201-217`).

### 4.2 Chrome ownership (visual + IA consequence)

| Level | Who draws it |
| --- | --- |
| Shell (all 5 surfaces) | `MainShellContent` `Scaffold` + `TopAppBar` (title = shop name **only**) + `NavigationBar` + FAB (`MainScreen.kt:246-295`). The app-bar title is the only `heading()` in the shell (`:260`). No actions, no surface title, no announcements badge, no sync indicator |
| Hosted surfaces | Today / Orders / Store / Customers draw **no** bar of their own (`TodayScreen.kt`, `OrdersContent.kt:66`, `StoreContent.kt:135`, `CustomersContent.kt:79`) |
| Account surface | Draws its **own** `Scaffold` + `TopAppBar` **inside** the shell's (`SettingsScreen.kt:274-285`) → two stacked app bars and two `SnackbarHost`s |
| Every detail route | Own `Scaffold` + `TopAppBar` with back arrow (e.g. `OrderDetailsScreen.kt:223-226`, `ProductEditScreen.kt:146-148`, `PlansScreen.kt:131-133`, `OperationsScreens.kt:375-387`) |

### 4.3 IA problems

1. **Daily actions live two levels deep in the Account tab.** Support, subscription, AI assistant,
   devices, seller profile, deletion status are all "Account → row" (`MainScreen.kt:219-231` →
   `AccountContent.kt:152-174`). Only announcements has a second, prominent entry (`MainScreen.kt:360`).
2. **Settings hides primary actions.** Payout handles (`instapay`, `vfcash`) and the catalog slug —
   money-affecting for every buyer checkout — sit *below* device management at the bottom of a settings
   scroll (`AccountContent.kt:177-222`). The only purchase control in the whole app is there too
   (`:117-139`), and it prints the raw Play `base_plan_id` in the button label.
3. **A gated feature can vanish instead of being explained.** `aiAvailable == false` removes the AI row
   entirely with no explanation (`AccountContent.kt:165`), which is exactly what
   `FeatureGate.NotBuilt`/`LockedByPlan` exists to prevent — and `FeatureGate` is used on one screen.
4. **Section headers name one member of their group.** `SettingsSectionHeader(store_info_title)` heads a
   group whose first row is also `store_info_title` (`AccountContent.kt:144-145`);
   `devices_title` heads a group containing Subscription and Deletion (`:170-173`);
   `support_title` heads Support + Announcements + AI (`:152-153`).
5. **No path from the account surface to Plans.** `SubscriptionRoute` → `PlansRoute` is the only route
   (`OperationsScreens.kt:1198`, `OrderakNavHost.kt:210`); with purchase closed, `recover purchases` is
   hidden (`:1171-1177`), so a reinstalling paying seller has no in-app route to restore.
6. **Browser-back/depth fairness:** five of the ten "account" destinations are single-purpose screens
   that could be sections of one scrollable account page; conversely `TodayScreen`'s counters are the
   only cross-surface navigation shortcut (counter → Orders with a filter, `MainScreen.kt:190-197`).
7. **Dead-end states are the IA's real cost** (see §5.1): Store empty (no add control), Orders error
   (no retry), OrderDetails local-only unrefused (no action), NewOrder empty catalogue (no CTA),
   OrderDetails missing order (spins forever).

### 4.4 Verification pass — what §4.1 and §4.3 found when acted on

| Claim | Outcome |
| --- | --- |
| Five surfaces are not routes; no nested `NavHost`; no `BackHandler` outside Auth and ShopSetup | **Confirmed and fixed.** The shell's five surfaces are now destinations of a `NavHost` inside `MainShellContent`'s content slot, navigated with `popUpTo(start) { saveState = true }` / `restoreState = true`, so each surface's `rememberSaveable` state — the product and customer queries, scroll position, open dialogs — survives a tab switch. A `BackHandler` on every surface but اليوم returns to it instead of leaving the app. `shellOwnsBack()` and `surfaceFor()` are extracted so `MainShellNavigationTest` asserts the rule rather than a reader re-deriving it. The TODO this audit quoted is gone. |
| The screen manifest models the surfaces | **Confirmed, with one correction the fix exposed.** The manifest already named four of the five as `MainRoute#<surface>` keys, but the fifth — the surface the shell starts on — had no entry, and the entry standing in for it was named "Dashboard" at route `MainRoute`, which is the shell rather than a surface. The store surface was also still called `products` there, a name the seller has not seen since `nav_products` became "Store" / "المتجر" / "Boutique". All three are corrected, and `verify-screen-manifest.mjs` now ties `MainRoute#<x>` to the `SellerSurface` entries so a surface renamed in Kotlin cannot leave the admin panel's screen tree describing a screen that no longer exists. |
| Daily actions live two levels deep in the Account tab, and should move | **Not confirmed, and the correction is the interesting part.** The feature-surface map assigns `support_service.in_app_support_tickets`, `team_security.multiple_owner_devices` and `ai_capabilities.basic_ai_assistance` to the **account** surface, so moving them elsewhere would contradict the map RD-02 makes authoritative. An earlier version of this table then proposed reordering instead — `payments_finance.instapay_vodafone_cash_instructions` is L1 and sat below `team_security.session_and_device_management`, which is L2. **That was also wrong**, and reading the screen's own contract is what settled it: `account`'s purpose is "ست مجموعات: الخطة · المتجر والهوية · الدعم · الأجهزة والاشتراك · **بيانات التحصيل** · إجراءات الحساب", so payout is the fifth of six groups by the contract's own order and the code already matched it. A map level ranks a feature's importance across the product; it does not reorder a screen whose group order the contract states. No change was made. |
| Settings hides primary actions; a gated feature vanishes; section headers name one member; no path to Plans | **All four settled, three fixed and one refused.** *A gated feature vanishes* was real: `aiAvailable == false` omitted the AI row, so a plan without AI saw nothing and could not tell "your plan does not include this" from "this product has no AI". It draws `FeatureGate(LockedByPlan)` now, with the upgrade control present only when `purchaseOpen` says there is somewhere for it to go. *Section headers name one member* was real in two places: the store group's header was also the label of the row directly beneath it, and the devices group named one of its three. Both headers now use the contract's own names for those groups — "المتجر والهوية" and "الأجهزة والاشتراك" — and deletion status moved out of the devices group into account actions, where the control that creates a deletion request already lived. *No path to Plans* is **refused as stated**: the closed-purchase banner carries a "view plans" action, so the route this screen declares as an exit is reachable from it, and `PlansRoute` is what that action opens. *Settings hides primary actions* is **refused**, for the reason the row above gives: the contract fixes the group order and puts payout fifth of six. |
| A reinstalling paying seller has no in-app route to restore | **Confirmed, and it was worse than "no route" — the screen's own copy promised the opposite.** `subscription_play_guidance` says "Use purchase recovery after reinstalling or changing devices" and the closed-purchase banner says "Nothing you have changes", but both the guidance line and the Recover Play purchases button were inside `if (purchaseOpen)`. That flag is the backend's `BILLING_ENABLED` launch gate, and recovery does not go through it: recovery re-queries Play and re-verifies on `/api/v1/billing/google/verify`, which is absent from `BILLING_ACQUISITION_ROUTES`, while Play itself connects on `GOOGLE_PLAY_LIFECYCLE_ENABLED` — a separate flag. So the machinery could be running and open while the only control that used it was hidden. The guidance and the recover button now render in both purchase states; only the banner and the buy affordance stay gated. `PurchaseEntryPointsTest` pins it with a brace-matched assertion that no `if (purchaseOpen)` branch may contain the recovery control — verified to fail when the control is put back inside the gate. |
| The catalog slug is set on the account surface | **Two authorities disagreed, the code broke the tie, and the answer was RD-19.** The feature-surface map files `products_catalog.custom_catalog_slug` under **store**; the `account` contract claimed "public slug" as its own data. Reading the code settled it: there were **two editors and only one could work**. `StoreInfoScreen` queries `/api/v1/slug/check`, reports available / taken / reserved, and keeps Save disabled until the name is free. The account surface's field had no check: it wrote locally, `savePayout` triggered a refresh, and `SellerRefresher` pushed the value through `api.register`, which returns early on `!reg.ok` — so a **taken name failed the whole registration and stopped every pull and push behind it**, while the snackbar said "Payout details saved". The field is gone; the account surface keeps the published link as a read-only display. `verify-slug-authority.mjs` now pins all three facts. |
| The account surface draws its own app bar inside the shell's | **Confirmed and fixed.** §4.2's table already said hosted surfaces draw no chrome of their own; the account surface drew a `Scaffold` and a `TopAppBar` inside the shell's, so the seller saw the shop's name above the word "Settings", with two snackbar hosts under them. The inner bar is gone, and the one thing it carried — the language switch — is a row in the account-actions group. |

---

## 5. Visual / layout quality issues

### 5.1 Dead ends and unrecoverable states (highest impact)

| Finding | Evidence |
| --- | --- |
| Orders load error has **no retry** and cannot self-heal: `catch` emits an empty list and completes the upstream flow, and `stateIn` never restarts a completed upstream | `OrdersContent.kt:72`, `OrdersViewModel.kt:65-70` |
| Store's empty catalogue returns **before** the `Column` that owns the FAB, and `FullScreenEmpty` gets no `actionLabel`, while the copy says "tap ➕" | `StoreContent.kt:115-127` (return) vs `:211` (FAB), `RES/values/strings.xml:84` |
| Customers load error has no retry | `CustomersContent.kt:57-62` |
| OrderDetails for an absent order renders the loading spinner **forever** (null = loading) | `OrderDetailsScreen.kt:178-181` |
| OrderDetails for a local-only, un-refused order disables both pipeline buttons while its banner carries no action — **checked, and this row is wrong.** `LocalOnlyOrderBanner` does explain the state, and the design is deliberate: the disabled buttons are documented at the call site, and the waiting case has nothing useful to press. See the verification note below. | `OrderDetailsScreen.kt:404-422`, `LocalOnlyOrder.kt:88-95` |
| NewOrder empty catalogue is one grey line with no route to the Store surface | `NewOrderScreen.kt:161-163` |
| Customer-edit save failure is invisible: `saveFailed` is set but never collected | `CustomerDetailsScreen.kt:142` vs `:162` |
| StoreInfo save failures are silent (no error state at all) | `StoreInfoScreen.kt:144-157` |
| Support ticket reply failures are swallowed and the field clears immediately | `OperationsScreens.kt:334-337`, `:535` |
| Deletion status is a read-only dead end with no withdraw and no support link | `OperationsScreens.kt:1369-1389` |
| Paywall → Plans is a dead end when billing is open: neither screen has a purchase control | `PaywallScreen.kt:201-204`, `PlansScreen.kt` (no buy control), `AccountContent.kt:117-139` only |
| `FeatureGate`'s "Upgrade" chip is inert: `onUpgrade` is never invoked and `SemanticChip` has no click parameter | `CUI/FeatureGate.kt:119-121`, `CUI/SemanticChip.kt:28-57` |

#### Verification pass — what the fix round found

Each row below was re-read against the source before acting on it. Two rows did
not survive that.

| Finding | Outcome |
| --- | --- |
| Orders / Store / Customers load errors have no retry and cannot self-heal | **Confirmed, and worse than stated.** `catch` ends the stream, so the empty list it emits is the last value the `stateIn` will ever hold: the surface stays empty for the life of the process. Fixed with `core/read/RestartableRead.kt` and a wired `onRetry`. |
| Store's empty catalogue returns before the FAB while the copy says "tap ➕" | **Confirmed.** The branch returned at `:137` and the FAB is drawn at `:221`, and `products_empty` names ➕ in all three locales. Fixed by drawing the FAB in every remaining state; two of 256 baselines changed. |
| OrderDetails for an absent order spins for ever | **Confirmed.** Fixed by separating "not read yet" from "answered with no row". The state also had no top bar — the `Scaffold` is drawn after the null check — so the only way out was the system back gesture; the not-found state now carries its own bar and back control. |
| OrderDetails local-only, un-refused order disables both buttons "while its banner offers nothing" | **Rejected.** `LocalOnlyOrderBanner` draws a Warning notice with a title and a body whenever `refusalCode` is null (`LocalOnlyOrder.kt:88-95`), and the disabled buttons carry a comment explaining exactly why they are disabled (`OrderDetailsScreen.kt:435-444`). For an order that is merely waiting to be posted there is nothing useful to press; the sync retry lives on the shell. This is a deliberate documented design, not a dead end. |
| OrderDetails payment section disappears once paid | **Half confirmed, and the intent is deliberate.** The *controls* are gated to NEW/CONFIRMED on purpose ("only until Paid", `:363`), and the payment *history* still renders whenever a payment row exists (`:396`). The real loss is narrower: `payMethodLabel` is drawn inside the gated card, so a PAID order shows no payment method at all. Recorded rather than changed — it is a content decision, not a defect. |
| StoreInfo save failures are silent (no error state at all) | **Confirmed.** `save` handled only `ok && store != null`: a refusal changed nothing, called no callback, and left the form exactly as it was, so a taken slug or a rejected field was indistinguishable from a saved store. Fixed with a `saveError` code rendered through `backendErrorResource`, on a banner above the save button. **The image upload had the same shape and is now fixed too**: `uploadImage`'s callback only ran its success branch, so a chosen logo that never reached R2 left no trace — the seller picked an image, watched nothing appear, and could not tell a failed upload from a slow one. It has its own state rather than sharing the save error, because nothing the seller typed is at risk in that case. |
| Support ticket reply failures are swallowed and the field clears immediately | **Confirmed, and worse than stated.** `reply` was `if (ok) refresh()` with no else, and the screen cleared the box on the press — so a refused reply lost what the seller wrote about a complaint they were still making, with nothing said. Fixed: `reply(message, onSent)` reports the refusal through its own code (kept apart from the full-page load error, so the thread stays on screen), and the field clears only once the server has it. |
| Customer-edit save failure is invisible | **Confirmed.** `saveFailed` was set and `saveFailureShown` existed with no caller. Fixed: the flag is collected, a snackbar names the remedy and reassures about the data, and Retry re-sends the same values. |
| Device revoke has no confirmation while passkey revoke does | **Confirmed.** Both now confirm, and the device dialog names the device being cut off. |
| AI reset has no confirmation | **Confirmed, and the audited symptom was not the worst of it.** The error card's retry was wired to `resetChat`, so the control labelled "try again" destroyed the conversation. Retry now re-asks the last question; clearing has its own confirmed control. |
| NewOrder mixed-currency save crashes | **Confirmed.** `OrderRepository.create` refuses a mixed order with `error(...)` and its comment claims "the caller filters to a single currency before it gets here" — no caller did. Fixed at the screen and in `save`. |

### 5.2 Layout structure patterns (per screen family)

| Family | Root / scroll | Notes |
| --- | --- | --- |
| Today | `LazyColumn`, `contentPadding 16dp`, gap 16dp (`TodayScreen.kt:118-122`), wrapped in `PullToRefreshBox` at the shell (`MainScreen.kt:326-334`) | The only pull-to-refresh in the app; counters are a `Row` of three `weight(1f)` cards ≥88dp, whole card clickable |
| Orders | `Box(fillMaxSize)` → branch → `Column { LazyRow(chips); LazyColumn }` (`OrdersContent.kt:66-153`) | FAB drawn **outside** all branches (`:155-158`); 80dp trailing spacer only in the non-empty branch (`:150`) |
| OrderDetails | `Scaffold` → `Column(verticalScroll)`, gap 12dp, four `Card` sections (`OrderDetailsScreen.kt:252-423`) | Not lazy: items are a `forEach` (`:300-311`), so a 200-line order composes 200 rows |
| NewOrder | `Scaffold` → `LazyColumn`, `contentPadding 16dp`, gap 12dp (`NewOrderScreen.kt:136-140`) | No `imePadding`; the whole catalogue renders as form rows — the seller scrolls past all products to reach pay method and Save (`:164-206` vs `:208-254`) |
| Store | `Column(fillMaxSize)` → banner/meter/search **then** `Box(weight(1f))` with `LazyColumn` + overlay FAB (`StoreContent.kt:135-213`) | Search is effectively pinned; share is the first scrolling item (`:195-204`); 80dp FAB spacer (`:208`) |
| ProductEdit | `Scaffold` → `Column(16dp).verticalScroll`, gap 16dp (`ProductEditScreen.kt:169-171`) | Photo box is a 180dp `Box` (`:176`); the price/stock row is a hardcoded LTR island (`:210`) |
| Customers | `Column(fillMaxSize)` → search → `LazyColumn` 16dp/8dp (`CustomersContent.kt:79`, `CustomersScreen.kt:89`) | Empty-catalogue check runs before the search box (`CustomersContent.kt:57-70`) |
| CustomerDetails | `Scaffold` → single `LazyColumn`, `contentPadding(top = insets + 8dp)` (`CustomerDetailsScreen.kt:261-267`) | Mixes an inset with a literal |
| Account | `Scaffold` → `Column(verticalScroll)` (`AccountContent.kt:102`), 12 entries | Nested inside the shell Scaffold; skeletons are 20dp/24dp bars (`:252-262,266-275`) |
| StoreInfo / SellerProfile | `Scaffold` → `Column(16dp).verticalScroll`, gap 12dp (`StoreInfoScreen.kt:405-408`, `SellerProfileScreen.kt:321-328`) | All-literal spacing |
| Categories | `Scaffold` → `Column(16dp)` → `LazyColumn` gap 8dp (`CategoriesScreen.kt:303,355`) | Inline spinner is top-left, not centred (`:315`) |
| Plans | `Scaffold` → `LazyColumn` of horizontally-scrolling `Row`s, fixed 160dp + 4×110dp columns (`PlansScreen.kt:163-255`) | Always needs horizontal scrolling on a phone, with no affordance (`:201,208,220,241`) |
| Paywall | `Scaffold` → `Column(24dp)`, gap 16dp, **no scroll** (`PaywallScreen.kt:152-155`) | Content can overflow on small screens at large font scale (**unverified**) |
| Operations | Shared `OperationPage`: `Scaffold` → `when { busy → spinner; error → FullScreenError; empty → empty(); else → Column(verticalScroll) }` (`OperationsScreens.kt:354-417`) | `FullScreenEmpty` called inside a scrolling parent (`:752,899`) whose `fillMaxSize` collapses to content height (**unverified**) |

### 5.3 Spacing, typography, radius, elevation

- Token adoption is split: see §2.3 — `ProductEditScreen.kt`, `CustomerDetailsScreen.kt`,
  `OrderDetailsScreen.kt`, `NewOrderScreen.kt`, `StoreInfoScreen.kt`, `CategoriesScreen.kt`,
  `OperationsScreens.kt` are literal-driven.
- Icon sizes vary by screen with no token: 14dp chip glyphs, 16/18dp counter glyphs, 20dp banner glyph,
  24dp Paywall icon, 40dp photo placeholder, 44dp sheet glyphs, 48dp state icons, 56dp product
  thumbnail, 88dp (unused) auth mark.
- Elevation: only two explicit values (`tonalElevation = 2.dp` at `AuthScreen.kt:220`,
  `ShopSetupScreen.kt:214`) plus one `scrim.copy(alpha = 0.32f)` overlay (`AuthSharedUi.kt:187`);
  every other surface uses M3 defaults (**exact defaults unverified**).
- Card usage is uneven: `Card` appears 35 times; OrderDetails uses four stacked Cards, Categories uses
  one Card per row with up to four 48dp `IconButton`s inside a 12dp-padded card (`CategoriesScreen.kt:357-407`).

### 5.4 Form validation presentation

| Field | Error surface | Submit gate |
| --- | --- | --- |
| Auth phone | `isError` + inline `AuthErrorText` under the field (`AuthPhoneForm.kt:140,159`); the error clears on the next keystroke (`AuthViewModel.kt:233`) | `state.isValid && !state.isSending` (`AuthScreen.kt:207-211`); the disabled state carries no reason |
| Auth OTP | Red boxes + inline error (`AuthOtpForm.kt:104,111`) | enabled only at 6 digits (`AuthScreen.kt:212-216`); `onDone` is a no-op (`AuthOtpForm.kt:208-210`); a paste >6 chars is dropped (`:191`) |
| ShopSetup step 1 | Full name/email get `isError`, but the reason appears in a detached global line (`ShopSetupScreen.kt:311,350,352`); the email field's `supportingText` is an unrelated privacy sentence (`:343`) | CTA is always enabled (`:225-227`) |
| ShopSetup step 2 | Slug status is one `bodySmall` line, error-coloured only for TAKEN/INVALID (`:470-486`); `OFFLINE` has no retry | Gated by `canFinishStore` (`ShopSetupViewModel.kt:85-91`) |
| NewOrder | Phone gets `isError` with **no** `supportingText` (`NewOrderScreen.kt:145-146`) | Silent disabled Save (`:252`) |
| ProductEdit | No per-field error at all; one `bodySmall` error line below the fold (`ProductEditScreen.kt:270-285`) | Silent disabled Save, reason invisible (`ProductEditViewModel.kt:72-77`) |
| CustomerDetails | No validation, no busy state, double submission possible (`CustomerDetailsScreen.kt:138-145`) | Save always enabled when editable |
| Account payout | No validation beyond filters (`AccountContent.kt:186,204-217`) | Save has no busy/disabled state (`:218-221`) |

### 5.5 Lists: pagination, density, tap targets

- **No pagination anywhere.** Every list is a full Room read: orders `SELECT * … ORDER BY createdAt DESC`
  with no LIMIT (`Daos.kt:136`, `OrderRepository.kt:62`), products (`CatalogRepository.kt:21`,
  `Daos.kt:13-14`), customers via a `LEFT JOIN` `GROUP BY` summary (`Daos.kt:247-255`), a customer's
  orders (`Daos.kt:150`), and the NewOrder catalogue list rendered as form rows
  (`NewOrderScreen.kt:164`). Counts are unbounded.
- **Keys** are stable (`items(list, key = { it.id })` — `OrdersContent.kt:147`, `StoreContent.kt:205`),
  but there is **no** `animateItem`, no sticky headers, no nested scroll, no dividers anywhere
  (grep: 0 hits for `animateItem`, `stickyHeader`, `nestedScroll` in `src/main`).
- **Tap targets:** icon-only controls use Material defaults (48dp); `PriorityListRow` enforces
  `defaultMinSize(48dp)` (`OrderakComponents.kt:229`); counters are ≥88dp. Two components are below
  the app's own token: the Account danger rows are ~44dp **and** role-less `Text` + `clickable`
  (`AccountContent.kt:225-240`), and `SemanticChip` is ~22dp tall while looking like the "Upgrade"
  affordance (`SemanticChip.kt:42-45`, `FeatureGate.kt:119-121`). `minimumInteractiveComponentSize` is
  used nowhere in `src/main`.
- **Search exists on 2 of 5 list surfaces** (Store, Customers) and never on Orders or Operations lists.

### 5.6 Error presentation vocabulary

Five different mechanisms coexist: full-screen state (`FullScreenError`), inline banner
(`NoticeBanner`), snackbar (`OrdersContent` transitions via `OrderDetailsScreen.kt:96-98`), dialog
(`OrderDetailsScreen.kt:186-221`), and field-level text. Raw backend codes reach the UI in
`OperationsScreens.kt:403` (error string passed unmapped) while `PlansScreen.kt:146` maps through
`backendErrorResource` — so the same failure reads differently on two screens. `OrderDetailsViewModel`
uses `MutableSharedFlow(extraBufferCapacity = 1)` (`:121-122`), so a failure emitted with no collector
is dropped.

---

## 6. Localization and RTL

### 6.1 Locale contract

| Locale | Directory | Strings | Plurals | Coverage |
| --- | --- | --- | --- | --- |
| en (default, `unqualifiedResLocale=en`) | `RES/values/strings.xml` | 433 (432 translatable + `app_name` `translatable="false"`) | 3 | baseline |
| en (explicit) | `RES/values-en/strings.xml` | 432 | 3 | 100% exact key+type parity |
| ar | `RES/values-ar/strings.xml` | 432 | 3 | 100% |
| fr | `RES/values-fr/strings.xml` | 432 | 3 | 100% |
| — | `RES/values-night/themes.xml` | 0 | — | window background only (`:4-6`) |

Declared in `A/core/locale/AppLocales.kt:20-24` (ar/en/fr) with `private const val DEFAULT_TAG = "en"`
(`:45`, pinned by the guard at `build.gradle.kts:356-359`); build config at
`apps/seller-android/app/build.gradle.kts:149,159,161-167` (`generateLocaleConfig = true`,
`localeFilters += listOf("ar","en","fr")`, `enableSplit = false`). Per-app override via
`AppCompatDelegate` with `autoStoreLocales=true` (`AndroidManifest.xml:66-74`), which is why
`MainActivity` must stay an `AppCompatActivity` (`MainActivity.kt:29-34`). French is an interface-only
language (`docs/architecture/localization-architecture.md:40-45`). There is **no** `locale_config.xml`
and no `android:localeConfig`; their absence is asserted (`build.gradle.kts:350-355`).

Numerals: quantities are formatted with the composition locale from
`LocalConfiguration.current.locales[0]` (`StoreContent.kt:98`, `OrderakComponents.kt:74`,
`OrdersScreen.kt:71`), never `Locale.getDefault()`; `%s` is required for quantities in resources
(`docs/platforms/android-localization-profile.md:32-51`, exactly three `%d` resources listed `:48-51`).
`core/text/Counts.kt:75-92` carries the bidi marks that keep "14 / 20" from reordering in Arabic, and
`UsageMeter` additionally pins `TextDirection.Ltr` (`OrderakComponents.kt:120-123`).

### 6.2 Hardcoded strings

The app is **essentially fully localized**: ≈480 `stringResource(` call sites (478 matched lines by
grep, 482 matches by occurrence count), and `HardcodedText`,
`RtlHardcoded`, `SetTextI18n`, `MissingTranslation`, `ExtraTranslation` are configured as **lint errors**
(`apps/seller-android/app/build.gradle.kts:182-185`). The complete set of production-visible literals:

| file:line | String | Screen |
| --- | --- | --- |
| `A/feature/settings/SettingsScreen.kt:125` | `it?.plan_name ?: "Free"` | Account — hardcoded English plan name |
| `A/feature/operations/OperationsScreens.kt:508` | `"${ticket.status} · ${ticket.priority}"` | Support — raw backend enums |
| `OperationsScreens.kt:759` | `Text(item.translation_status)` | Catalog languages — raw status code |
| `OperationsScreens.kt:748,749` | `"العربية"`, `"English"` | Catalog languages — second, unguarded picker |
| `OperationsScreens.kt:979` | `joinToString(" · ")` | Devices — raw separator |
| `OperationsScreens.kt:1124` | `subscriptionStatus ?: "active"` | Subscription — English status fallback |
| `OperationsScreens.kt:1261` | `stringResource(...) + ": " + …` | AI assistant — manual concatenation |
| `OperationsScreens.kt:1407` | `"mailto:support@orderak.app"` | Restricted account |
| `A/feature/orders/OrderDetailsScreen.kt:384` | `Text("📎")` | Proof marker, no `contentDescription` |
| `A/feature/auth/AuthScreen.kt:534-535` | `"${country.flag}  ${country.name}"`, `"+${dialCode}  ✓"` | Country picker |
| `A/feature/billing/PlansScreen.kt:234,238` | `"—"` ×2 | "not included" cell |
| `A/feature/orders/NewOrderScreen.kt:186,197` | `"−"`, `"+"` | Stepper (paired with resource descriptions `:187,195`) |
| `A/feature/auth/AuthScreen.kt:187,194,289` | help/mailto URLs, `"English"` fallback | Auth |

`AppLocales.kt:21-23` native names are deliberately not localized (`:16-18`). Everything else the
seller reads comes from resources; further literals are `@Preview`-only (`T/Theme.kt:182-208`) or
non-rendered (`core/share/LinkSharing.kt:33`).

### 6.3 RTL

- `android:supportsRtl="true"` (`AndroidManifest.xml:21`); direction is asserted on device for
  en/ar/fr/en-XA/ar-XB in `LocaleUiTest.kt:49-53,77-110`.
- **16 `Icons.AutoMirrored.*` usages** and **zero** direction-unaware padding/alignment
  (no `padding(left=`, `padding(right=`, `align(Alignment.Start/End`). Correct by construction.
- Direction handling helpers: `TextDirection.Content` for user-typed names
  (`StoreContent.kt:254`, `NewOrderScreen.kt:172`, `CategoriesScreen.kt:366`,
  `ProductEditScreen.kt:253`); `TextDirection.Ltr` for numeric/URL runs (`OrderakComponents.kt:121`,
  `ShopSetupScreen.kt:465`); five `CompositionLocalProvider(LocalLayoutDirection provides Ltr)` islands
  for phone/OTP/stepper/price rows (`AuthPhoneForm.kt:317`, `AuthOtpForm.kt:308`,
  `ProductEditScreen.kt:210`, `NewOrderScreen.kt:141,182`).
- `BidiFormatter` is used **nowhere** (0 matches) although invariant 9 permits it; fencing is done by
  hand in `core/text/Counts.kt`.
- **RTL risks:** raw-literal rows that mix scripts (`OperationsScreens.kt:508,759`), the hardcoded `✓`
  and dial-code prefix (`AuthScreen.kt:534-535`), `Icons.Outlined.LocalShipping` left unmirrored
  (`TodayScreen.kt:268`), and the hardcoded LTR price/stock row whose Arabic labels will draw
  left-aligned inside the island (`ProductEditScreen.kt:210`). **No automated check counts
  AutoMirrored usage**, so a redesign can silently regress this.

### 6.4 What a redesign must preserve

1. `values/`, `values-ar/`, `values-en/`, `values-fr/` at exact key **and type** parity
   (`docs/contracts/localization-invariants.md:20-22`); default `en`; `app_name` the only
   non-translatable key (`build.gradle.kts:380-386`).
2. `LanguageSheet.kt` must stay at `A/feature/auth/LanguageSheet.kt`, keep
   `AppLocales.supported.forEach`, and must not introduce `language_system_default` or `followSystem(`
   (`build.gradle.kts:302-304,360-365` — the path is hardcoded).
3. No manual locale XML, no `android:localeConfig`, `generateLocaleConfig = true`,
   `enableSplit = false` (`build.gradle.kts:338-355`).
4. Arabic-Indic numerals from the composition locale on every quantity, money and count
   (`docs/platforms/android-localization-profile.md:32-51`), and never two numeral systems in one
   string (invariant 9).
5. The localized language names in `AppLocales` stay native, not translated.
6. Any locale addition/deletion is a documented architecture change
   (`docs/architecture/localization-architecture.md:163-178`), not a redesign side effect.

---

## 7. Accessibility and motion

### 7.1 Inventory (grep over `A/`)

| Signal | Count | Notes |
| --- | --- | --- |
| `contentDescription` | 69 (74 lines incl. imports) | 22 from `stringResource`; 3 composed (all justified in-file: `OrderakComponents.kt:86`, `AuthSharedUi.kt:77`, `TodayScreen.kt:248`); **35 `= null`**, i.e. decorative |
| Non-resource string as `contentDescription` | **0** | Server copy used as an ad alt at `AdManagerImpl.kt:105` is the only data-driven case |
| `heading()` | 14 | Top bars (`MainScreen.kt:260`, `OrderDetailsScreen.kt:227`, `NewOrderScreen.kt:127`, `SettingsScreen.kt:278`, `StoreInfoScreen.kt:386`, `SellerProfileScreen.kt:302`, `CategoriesScreen.kt:294`, `PlansScreen.kt:134`, `PaywallScreen.kt:143`, `OperationsScreens.kt:378`), plus `CustomerDetailsScreen.kt:250,288` and `OperationsScreens.kt:969,1007` |
| `semantics {}` blocks | 20 | 14 headings + 6 custom (`OrderakComponents.kt:86`, `AuthSharedUi.kt:77`, `NewOrderScreen.kt:187,198`, `TodayScreen.kt:247`, `SemanticChip.kt:36`) |
| `clearAndSetSemantics` | 2 | `TodayScreen.kt:247`, `SemanticChip.kt:36` |
| `stateDescription` | **0** | No toggle/switch/read-state is exposed to TalkBack |
| `testTag` | **4, all in `androidTest`** (`LocaleUiTest.kt:101,114,118`) | **Zero production test hooks** — no stable selector for UI automation or a11y tests |
| Reduced motion (`LocalMotionDurationScale`) | **0** | No way to honour the OS animator-duration setting |
| `AnimatedVisibility` | 5 sites | `AuthHeader.kt:68`, `AuthPhoneForm.kt:128,186`, `AuthSharedUi.kt:64,179` |
| `animateFloatAsState` | 1 | `ShopSetupScreen.kt:259` (setup progress) |
| `tween(300)` | 6 | `AuthHeader.kt:70-71`, `AuthPhoneForm.kt:130-131`, `AuthSharedUi.kt:181-182` |
| `spring(`, `Crossfade`, `updateTransition`, `rememberInfiniteTransition`, `animateColorAsState`, `animateContentSize`, `graphicsLayer` | **0 each** | Motion is confined to the auth funnel; every list, state change and surface switch is instantaneous |

### 7.2 Support by dimension

| Dimension | Status and evidence |
| --- | --- |
| Content descriptions | Partial: every icon-only control is labelled, but 35 icons are `null` (mostly decorative, **not verified per site**). Evidence in §7.1 |
| Semantics structure | Weak: section headers (`SettingsScreen.kt:362-373`, `AccountContent.kt:178-182`, `StoreInfoScreen.kt:435`, `SellerProfileScreen.kt:392-395`) are not headings; the plan comparison table has no row/column association (`PlansScreen.kt:196-245`); errors have no `liveRegion`, so appearing messages are not announced (`AuthSharedUi.kt:77`); disabled primary buttons never state their reason (`NewOrderScreen.kt:252`, `ProductEditScreen.kt:304`) |
| Contrast | **Strong and guarded**: 6 schemes × 48 roles contrast-validated at generation; semantic containers carry outlines that survive greyscale (`T/Color.kt:42-44`, `CUI/SemanticRole.kt:54-57`); `GeneratedDesignSystemTest.kt` checks 6 combos, no transparent role, and the 48dp floor |
| Dynamic type | Delegated to `sp` with no explicit handling and no font-scale screenshots; no `fontScale` reads (0 matches). Risk points are fixed heights: OTP boxes 64dp (`AuthOtpForm.kt:249`), photo box 180dp (`ProductEditScreen.kt:176`), OTTO digit boxes ~44dp wide inside a 64dp row; Welcome's fixed CTA column reserves only 240dp of scroll clearance (`AuthScreen.kt:307-318,340-347`) (**layout risk unverified without rendering**) |
| Dark mode | Handled (`isSystemInDarkTheme()` default `T/Theme.kt:117`; user override `MainActivity.kt:59-63`; `values-night/themes.xml:4-6`) and screenshot-tested per state |
| Contrast levels | Handled + guarded (`MainActivity.kt:64-80`, `build.gradle.kts:771-777`); **no in-app control** (§2.1.9) |
| Touch targets | ≥48dp enforced by token and guard, with the two exceptions in §5.5 |
| Adaptive layout | No `WindowSizeClass`; no tablet/landscape treatment beyond devices' `≥720dp` split (`OperationsScreens.kt:902-903`) |
| Accessibility tests | None found: no a11y assertions in `androidTest`, no `testTag` to write them against |

---

## 8. Screen-contract and screenshot obligations

### 8.1 The enforcement chain

| Artifact | What it enforces | Located |
| --- | --- | --- |
| `UX/screen-contracts.mjs` | 28 contracts: `kotlinRoute`, `surface`, `states`, `entry`, `exit`, `data`, `actions[{do, via \| status}]`, `entitlementKey`, `featureStatus`, `phase`. `STATES = ["loading","content","empty","error"]` | `UX/screen-contracts.mjs:59-717`, `ACTION_SOURCE:736-746`, `UNVERIFIED_ACTIONS:719` (empty, "may shrink and never grow") |
| `UX/verify-screen-contracts.mjs` | Routes ↔ contracts both ways; exit/entry targets resolve; states ⊆ taxonomy and include `content` unless `transient`; `entitlementKey` ∈ plan catalogue; surface ∈ 5; **every declared action's `via` symbol must appear inside that screen's own composable body** (per-screen brace-matched body, `:120`); `SettingsRoute` must stay deleted (`DELETED_ROUTES:57`); duplicate ids and stale `UNVERIFIED_ACTIONS` fail | `UX/verify-screen-contracts.mjs:1-19,101-274`; CI `docs-ci.yml:115-116` |
| `UX/feature-surface-map.mjs` + verifier | All **242** catalogue features classified (SCREEN 108 / SECTION 84 / FIELD 23 / NONE 27); implemented ≠ L4 | `docs/ux/feature-surface-map.md:8-18`; CI `docs-ci.yml:113` |
| `UX/design-coverage.mjs` | Contract id → artboard **name** map; offline artboard decided per surface (today/orders/store yes; customers/account null) | `UX/design-coverage.mjs:42-83`; CI `docs-ci.yml:129` |
| `UX/render-coverage.mjs` | Every declared render has a reference PNG; every reference-producing `@PreviewTest` is declared (`screen` vs `component`); a `screen` entry must name a real contract state; **`FLOOR = 83` proven screen-states ratchet** | `UX/render-coverage.mjs:58-463,466,481-522`; CI `docs-ci.yml:141-144` |
| `docs/ux/screen-contracts.md`, `docs/ux/feature-surface-map.md` | Generated docs — "Do not edit by hand — change the contracts" (`screen-contracts.md:11`) | Regenerated by `UX/generate-ux-docs.mjs:26-35`; CI diffs them (`docs-ci.yml:162-181`) |
| `B/design/app-screen-manifest.ts` | 27 hand-maintained screen entries (`name`, `android_route`, `parent_route`, `surface`, `transitions[]`, `states[]`, `offline_capable`, `entitlement_key`, `feature_status`) feeding the admin panel | `B/design/app-screen-manifest.ts:66-94`; consumed at `B/admin/admin-project.ts:14` |
| `tooling/repository/verify-screen-manifest.mjs` | Every route in `Routes.kt` must be registered; every manifest route must exist; `parent_route`/transitions/surface/states/status/entitlement_key validated against `Routes.kt` and the plan catalogue | `tooling/repository/verify-screen-manifest.mjs:95-137`; CI `docs-ci.yml:69` |
| Screenshot suite | 21 classes, ~254 `@PreviewTest`s, 256 staging reference PNGs + 3 debug (localization) | `apps/seller-android/app/src/screenshotTest/**`, `apps/seller-android/app/src/screenshotTestStagingDebug/reference/**`; CI `android-ci.yml:82-84` (`validateStagingDebugScreenshotTest`) |
| `:app:verifyLocalizationContract` | Localization architecture incl. **hardcoded source paths and literals** | `build.gradle.kts:290-399`, wired to `preBuild` `:1034-1040` |
| `:app:verifyDesignSystemContract` | Schema v2, identical fallback hash across three files, 6 schemes, 15 type roles, 48dp floor, approved font, code-only colour, Material You off, **brand `#014D4E` pinned in 3 places**, commerce role, 4 container outlines | `build.gradle.kts:724-861`, wired `:1038` |
| `:app:verifyDataAuthorityContract` | UI must read the states that make a failed write visible: `state.writeError` and `state.stockConflict` in `ProductEditScreen.kt`, `viewModel.stuck` and `discardStuck` in `ProductsScreen.kt` | `build.gradle.kts:975-1021`, wired `:1039` |
| `:app:verifyAuthPhase1Contract` | Behavioural pins **inside UI source text** (see §10) | `build.gradle.kts:401-643`, wired `:1036` |
| `:app:lintStagingDebug` | `HardcodedText`, `RtlHardcoded`, `SetTextI18n`, `MissingTranslation`, `ExtraTranslation` as errors | `apps/seller-android/app/build.gradle.kts:182-185`; CI `android-ci.yml:54-56` |
| `tooling/repository/verify-contract-guards.mjs` | The five protected tasks cannot be weakened (no `onlyIf`, `enabled = false`, `StopExecutionException`, properties/env switches) | `package.json:20` |
| `tooling/repository/verify-money-locale.mjs`, `verify-no-hardcoded-colors.mjs` | Money formatters must name a locale; no hand-written colour in Android | `docs-ci.yml:82-83,106-107` |

### 8.2 What a redesign is forced to update

1. **`UX/screen-contracts.mjs`** — every added/renamed/removed screen, state, exit, entry or action,
   including re-anchoring each `via` symbol inside the screen's own composable body. Moving a callback
   into a child composable requires an `ACTION_SOURCE` entry (`:736-746`) or the check fails.
2. **`B/design/app-screen-manifest.ts`** — same commit as any `Routes.kt` change; a route rename
   silently breaks the admin screen-identity mapping (`docs/domains/design-system.md:97-101`).
3. **`docs/ux/screen-contracts.md` / `feature-surface-map.md`** — regenerated, never hand-edited.
4. **`tooling/ux/design-coverage.mjs` `DESIGNS`** — any state added to a contract needs an artboard name
   mapping, and the offline decision per surface must stay explicit.
5. **`tooling/ux/render-coverage.mjs` `RENDERS` + `FLOOR`** — new previews must be classified, and the
   proven-state count may not fall below 83.
6. **Screenshot references** — all 256 staging PNGs for any surface whose visuals change; regenerate with
   `:app:updateStagingDebugScreenshotTest`, then `:app:validateStagingDebugScreenshotTest`.
   Time zone/locale are pinned for renders (`apps/seller-android/app/build.gradle.kts:277-281`), so a
   failure is real, not host noise. Rebuild them **per redesigned surface, reviewed screen by screen —
   never whole-suite regeneration in one commit** (RD-12, `docs/redesign/redesign-decisions.md:130-137`).
7. **`tooling/ux/implementation-evidence.mjs`** — new/renamed screens and routes need evidence entries
   (`verify-implementation-status.mjs`), whose behaviour baseline "may shrink and never grow".
8. **Gradle guards' source-text pins**, if any UI file's literals change (§10).

### 8.3 Commands a redesign must run

```powershell
gradlew.bat verifyLocalizationContract verifyAuthPhase1Contract verifySellerApiContract verifyDesignSystemContract verifyDataAuthorityContract
gradlew.bat testStagingDebugUnitTest lintStagingDebug
gradlew.bat validateStagingDebugScreenshotTest          # or updateStagingDebugScreenshotTest to regenerate
gradlew.bat connectedStagingDebugAndroidTest            # locale/RTL matrix; not yet a required check
node tooling/ux/verify-screen-contracts.mjs
node tooling/ux/verify-feature-surface-map.mjs
node tooling/ux/design-coverage.mjs
node tooling/ux/render-coverage.mjs
node tooling/ux/verify-implementation-status.mjs
node tooling/ux/generate-ux-docs.mjs
node tooling/repository/verify-screen-manifest.mjs
node tooling/repository/verify-money-locale.mjs
node tooling/repository/verify-contract-guards.mjs
```

---

## 9. Top 20 redesign opportunities, ordered by user impact

Constraints already decided elsewhere and assumed throughout this list: the five surfaces stay
(Today/Orders/Store/Customers/Account) and a sixth tab is a product-architecture change
(RD-02, `docs/redesign/redesign-decisions.md:34-41`); the brand seed, generated scheme and Cairo are
kept, with layout/density/hierarchy/composition as the redesign's material (RD-03, `:43-50`); token
changes, if any, are additive and justified one at a time. Items 13-15 therefore reorganise inside the
existing five surfaces rather than proposing new ones.

| # | Opportunity | Why it is first-order | Evidence |
| --- | --- | --- | --- |
| 1 | **Give every list an exit from failure.** Orders/Store/Customers errors are terminal because `onRetry` is omitted and the orders upstream cannot restart | A seller whose local read fails loses the whole surface until app restart | `OrdersContent.kt:72` + `OrdersViewModel.kt:65-70`; `StoreContent.kt:105`; `CustomersContent.kt:60` |
| 2 | **Make the first-run Store state self-serving.** Return before the FAB branch means a new seller has no add control while the copy says "tap ➕" | Blocks the app's core onboarding loop | `StoreContent.kt:115-127` vs `:211`; `RES/values/strings.xml:84` |
| 3 | **Report customer-edit failures.** `saveFailed` is emitted into the void | A seller believes an edit reached the buyer's record when it did not | `CustomerDetailsScreen.kt:142` vs `:162` |
| 4 | **Fix NewOrder save: mixed-currency crash path, no failure state, keyboard covers Save** | One wrong basket crashes or silently stalls the primary daily action | `NewOrderViewModel.kt:44,163-181`; `OrderRepository.kt:111-112`; `NewOrderScreen.kt:250-254` |
| 5 | **Confirm destructive actions consistently** (device revoke and AI reset have none; passkey revoke and category delete do) | Irreversible device logout and transcript loss with one tap | `OperationsScreens.kt:986-988`, `:1318` vs `:837-858`, `CategoriesScreen.kt:206-218` |
| 6 | **Unblock the local-only order.** Pipeline actions disabled while the banner offers nothing | The order cannot progress and the seller cannot fix it from the screen | `OrderDetailsScreen.kt:404-422`, `:259-264` |
| 7 | **Distinguish "loading" from "not found" and stop hiding the payment section** | A missing order spins forever; a paid order cannot take a corrected payment | `OrderDetailsScreen.kt:178-181`, `:324` |
| 8 | **Give Today's empty state a real action, and make counters' retry independent** | The home screen's only empty branch is prose | `TodayScreen.kt:185-195`; also `:88-92` (three unused state fields) |
| 9 | **Rebuild the buy path.** The only purchase control is buried in Account and prints a Play product id; Plans and Paywall have none; recover-purchases is hidden while billing is closed | Monetisation is structurally unreachable when billing opens | `AccountContent.kt:117-139`; `PaywallScreen.kt:201-204`; `OperationsScreens.kt:1171-1177` |
| 10 | **One app bar, one section vocabulary.** The shell bar shows only the shop name, surfaces have no titles, the Account tab stacks two bars, and section headers name one member of their group | Chrome currently tells the seller nothing about where they are | `MainScreen.kt:254-262`; `SettingsScreen.kt:274-285`; `AccountContent.kt:144-145,152-153,170-173` |
| 11 | **Unify plan/limit formatting.** Paywall prints raw values (can render `true`/`false`) and shows the "unknown" copy for unlimited or unloaded snapshots; Plans maps booleans; Paywall never names the limit key | The app contradicts itself about what a plan includes | `PaywallScreen.kt:78,99,182,233-239` vs `PlansScreen.kt:233-239` |
| 12 | **Make `FeatureGate` real.** Its upgrade chip is inert, it never says what is gated or which plan includes it, and only one screen uses it | Gated features either look tappable-and-dead or vanish silently | `FeatureGate.kt:85-124` vs `SemanticChip.kt:28-57`; `OrderDetailsScreen.kt:336` (sole use); `AccountContent.kt:165` |
| 13 | **Redesign the Orders list as a work queue.** 9 filter chips, no search, CANCELLED unfilterable, no per-row primary action, no offline state | This is the screen a seller lives on | `OrdersContent.kt:88-153`, `:125`, `:150`; `OrdersScreen.kt:68-111` |
| 14 | **Preserve tab state and give tabs a back behaviour.** No nested NavHost / `SaveableStateHolder`, so search, scroll and dialogs reset; back on a non-Today surface exits the app | Every tab switch costs the seller their place | `MainScreen.kt:94,146,176-233` (TODO acknowledges it); no `BackHandler` outside `AuthScreen.kt:161` / `ShopSetupScreen.kt:115` |
| 15 | **Promote daily actions out of Account** (support, subscription, payouts, plans) and give the Account surface a real information hierarchy | Five of ten account destinations are one-purpose screens that hide money and support actions | `MainScreen.kt:219-231`; `AccountContent.kt:152-222` |
| 16 | **Establish one state vocabulary** (loading/empty/error) with a single loading treatment and a single empty-state contract including a way out | Three loading treatments, four empty shapes, five error mechanisms today | §5.1, §5.6; `StateComponents.kt:38-186`; `TodayScreen.kt:301`; `AccountContent.kt:252`; `CategoriesScreen.kt:315,347-353` |
| 17 | **Accessibility baseline for the redesign**: `testTag`s, `stateDescription` for toggles/read state, `liveRegion` for errors, headings on section headers, an accessible plan comparison (rows/cells), ≥48dp danger rows, spoken reasons for disabled buttons | Today: 0 production testTags, 0 stateDescriptions, unreadable comparison table, 44dp role-less rows | §7.1-7.2; `PlansScreen.kt:196-245`; `AccountContent.kt:225-240` |
| 18 | **Token hygiene pass**: adopt spacing/shape tokens in the form and detail screens, add the missing token groups (elevation, motion, opacity, icon size, control height, pill, breakpoints), and delete or wire the 28 unread M3 roles and 3 unused extended roles | Two halves of the same product do not share a spacing vocabulary; a designer cannot control motion or elevation at all | §2.2-2.3 |
| 19 | **Localization/RTL sweep**: replace the eight production literals, unify to one language picker, isolate mixed-script rows, and re-check the hardcoded LTR price/stock island | These are the only places the localized contract is broken by hand | §6.2-6.3 |
| 20 | **Add motion with intent and an off switch**: the app has 6 hardcoded 300ms tweens in the auth funnel and nothing anywhere else, plus no reduced-motion path; list changes, state transitions and surface switches are instantaneous | The redesign's "feel" budget is currently unspent and uncontrolled | §7.1; `AuthHeader.kt:70-71`, `AuthPhoneForm.kt:130-131`, `AuthSharedUi.kt:181-182` |

---

## 10. Must not break

### 10.1 Source-text pins in UI files (a redesign edit can fail a build for wording reasons)

| Guard | Pinned in | Requires |
| --- | --- | --- |
| `:app:verifyAuthPhase1Contract` | `A/feature/auth/AuthScreen.kt` | must contain `canVerifyOtp(state.code, state.isVerifying)`, `enabled = !phoneLocked`, `if (state.showOtpFallback)`; must **not** contain `PredictiveBackHandler` (`build.gradle.kts:600-613`) |
| `:app:verifyAuthPhase1Contract` | `A/feature/settings/SettingsScreen.kt` | must contain `sessionLogoutManager.logout()`; must **not** contain `runLogoutSequence(` (`build.gradle.kts:530-531`) |
| `:app:verifyLocalizationContract` | `A/feature/auth/LanguageSheet.kt` (path hardcoded at `:302-304`) | must contain `AppLocales.supported.forEach`; must **not** contain `language_system_default` or `followSystem(` (`:360-365`) |
| `:app:verifyDataAuthorityContract` | `A/feature/products/ProductEditScreen.kt`, `ProductsScreen.kt` | `state.writeError`, `state.stockConflict`, `viewModel.stuck`, `discardStuck` must all remain read by the screen (`:980-1021`) |
| `:app:verifyAuthPhase1Contract` | all of `src/main/**/*.kt` | forbidden substrings: `setAppVerificationDisabledForTesting`, `setAutoRetrievedSmsCodeForPhoneNumber`, `FAKE_CODE`, `sendWhatsAppOtp`, `requestWhatsAppOtp`, `+201001854507`, `654321` (`:626-641`) |
| `:app:verifySellerApiContract` | all of `src/main/**/*.kt` | no `/api/…` literal outside the `/v1/` prefix, comments included (`:706-724`) |
| `:app:verifyDesignSystemContract` | `T/Theme.kt` | must call `GeneratedDesignSystem.colorScheme(`/`extendedColors(`, contain `OrderakTypography.withGenerated`, `LocalOrderakSpacing provides spacing`, `generatedShapes`, `Surface(`; must not mention `BrandingRepository`, `remoteConfig`, `dynamicDarkColorScheme` (`:803-825`) |
| `:app:verifyDesignSystemContract` | `T/Type.kt` | must contain `Tajawal` and `Noto Sans Arabic` (`:856-859`) |
| `:app:verifyDesignSystemContract` | `data/theme/ThemePreferencesRepository.kt` | must contain `dynamicColorEnabled = false` (`:813-818`) |

### 10.2 Brand, token and asset invariants

- Seed `primary = #014D4E` pinned in `design/design-system.default.json`, `design/tokens.json` **and**
  `0xFF014D4E` in `T/GeneratedDesignSystem.kt` (`build.gradle.kts:833-838`); a rebrand is a guard edit
  plus a generator run, in the same commit. Regeneration command:
  `services/backend/npm run design-system:generate`.
- The 64-hex `DEFAULT_FALLBACK_HASH` must match in `T/DesignSystemContract.kt:7`,
  `design/design-system.default.json` `contentHash` and `T/GeneratedDesignSystem.kt:30`
  (`build.gradle.kts:755-766`). Hand-editing generated files fails the build.
- Full 15-role typography scale must stay generated (`:778-787`); `MINIMUM_TOUCH_TARGET_DP >= 48`
  (`:788-792`); font family ∈ {cairo, tajawal, noto-arabic} (`:793-798`); all 6 light/dark × contrast
  schemes present (`:771-777`); commerce role and its container outline exist (`:843-846`); all four
  semantic container outlines exist (`:850-855`).
- Material You stays disabled (`:813-818`); colour stays code-only (`:808-811`); shapes/spacing values
  outside `0f..40f` / `0f..144f` are silently replaced (`T/Theme.kt:83,96`).
- Semantic role meanings: one meaning per role, brand never signals state, monetisation never borrows a
  status colour (`CUI/SemanticRole.kt:16-26,40-45`; `T/Color.kt:35-37`).

### 10.3 Navigation, localization and screen-identity contracts

- `SettingsRoute` must stay deleted (`UX/verify-screen-contracts.mjs:57`; `docs/ux/screen-contracts.md:17-18`);
  the Account surface is the only way in.
- Every `Routes.kt` route needs a contract **and** a manifest entry, in the same commit
  (`UX/verify-screen-contracts.mjs:251-256`; `tooling/repository/verify-screen-manifest.mjs:104-137`).
- Every declared action's `via` symbol must remain inside the owning composable body; moving a callback
  into a child needs an `ACTION_SOURCE` entry (`UX/screen-contracts.mjs:736-746`).
- `UNVERIFIED_ACTIONS` may shrink and never grow (`:719`); `render-coverage` proven states may not fall
  below 83 (`UX/render-coverage.mjs:466`).
- Locale set `ar/en/fr`, default `en`, exact key/type parity, no manual locale XML,
  `generateLocaleConfig = true`, `enableSplit = false`, native language names, numeral-system invariant
  (§6.4) — all guarded, and any change must be announced and reflected in
  `docs/architecture/localization-architecture.md` (contract version 3),
  `docs/contracts/localization-invariants.md` (v1) and `docs/platforms/android-localization-profile.md`
  (v1) in the same commit (`build.gradle.kts:321-332`).
- `MainActivity` must remain an `AppCompatActivity` (per-app locale backport,
  `MainActivity.kt:29-34`; `docs/architecture/localization-architecture.md:60-62`).
- Auth contract v8 semantics that the Android profile pins (OTP binding, inline OTP, explicit Verify,
  single logout sequence, rejected-credential local clear) require explicit approval to change
  (`docs/contracts/auth-phase1-contract.md`; AGENTS.md).

### 10.4 Verification obligations (cannot be bypassed)

- The five protected Gradle tasks may not gain `onlyIf`, `enabled = false`, `StopExecutionException`,
  property or env-var switches (`tooling/repository/verify-contract-guards.mjs`, `package.json:20`).
- `docs/ux/*.md` are generated artifacts; CI diffs them after regeneration (`docs-ci.yml:162-181`).
- Screenshot validation is a separate CI job (`android-ci.yml:68-97`); a visual change without
  regenerated references fails it.
- `connectedStagingDebugAndroidTest` (locale/RTL matrix) exists but is **not yet a required check**
  (`android-ci.yml:195-209`) — a redesign must run it deliberately.

---

## 11. Unverified / limits of this audit

Everything below could not be confirmed by static reading and needs rendering, device runs or tool
execution.

1. Runtime overlap/measurement claims: Welcome's fixed CTA column at large font scale
   (`AuthScreen.kt:307-347`), the fixed 420dp country list (`:525`), OTP box width at 360dp
   (`AuthOtpForm.kt:221-256`), the double elevation band behind the keyboard
   (`AuthScreen.kt:220-227`), `FullScreenLoading()` as a `LazyColumn` item (`NewOrderScreen.kt:160`),
   `fillMaxSize` empty states inside a scrolling parent (`OperationsScreens.kt:752,899`), Paywall
   overflow without `verticalScroll` (`PaywallScreen.kt:152-155`), the nested-Scaffold double app bar
   (`SettingsScreen.kt:274-285` inside `MainScreen.kt:254-262`).
2. Material 3 default elevations, shapes and interactive-size expansions (Card/Surface/FilterChip/
   Switch): assumed compliant, not measured.
3. TalkBack behaviour of: the transparent OTP field (`AuthOtpForm.kt:270-272`), the double-semantics
   birth-year field (`ShopSetupScreen.kt:328-336`), the `clearAndSetSemantics` on top of `clickable`
   (`TodayScreen.kt:247`), and the duplicate node risk in `UsageMeter` (`OrderakComponents.kt:86`).
4. Whether each of the 35 `contentDescription = null` icons is genuinely decorative in context — not
   verified per site.
5. Whether any store can hold two currencies today (the NewOrder crash path is a code-level certainty;
   reachability depends on data).
6. Whether a paywall can be reached for an `unlimited` entitlement key — the code path exists
   (`PaywallScreen.kt:78-182`) and is wired for `MAX_CATEGORIES` only (`CategoriesScreen.kt:200`).
7. `design/design-system.default.json` `validation.contrast[]` entry count (4372-line file; `valid: true`
   at `:2764`) — not independently counted.
8. Whether the admin web app reads the fixture's `web` oklch projection (`:671-2762`).
9. The screenshot plugin's own reference-dir mapping and pixel tolerance (from
   `libs.plugins.screenshot` / `gradle/libs.versions.toml`, not read).
10. Whether a fast `ShopSetupScreen` exit can outrun the 350 ms draft-save debounce
    (`ShopSetupViewModel.kt:547-553`).
11. `docs/ux/*.md` freshness versus `tooling/ux/*.mjs` (generators were not run).
12. Runtime behaviour of `animateFloatAsState` default spec in setup progress (`ShopSetupScreen.kt:259`).

---

## 12. Alignment with the existing redesign decision log

`docs/redesign/redesign-decisions.md` carries five open Phase-0 questions whose "closed by" evidence
this audit partly supplies. Status of each:

| Question | Asked for | Status in this audit |
| --- | --- | --- |
| **Q3** — which UI literals bypass the token system on each surface, and how many? (blocks Phase 3) | Phase 0 literal scan | **Answered** — §2.2 (token inventory, groups that do not exist) and §2.3 (per-file counts: ~105 raw `dp` padding/spacing sites, ~134 raw size/height/width/alpha sites, 19 raw `RoundedCornerShape(`, 6 `FontWeight.` literals, 6 `tween(300)`, 0 `fontSize` literals outside `Type.kt`), with the offending files ranked |
| **Q8** — current count of screenshot cases, so the redesign's delta is provable (blocks Phase 6) | Phase 0 baseline | **Answered** — §8.1: 21 screenshot test classes, ~254 `@PreviewTest`s, **256** staging reference PNGs + 3 debug, `render-coverage` `FLOOR = 83`, and the contract's own plan of 83 states × 2 themes = 166 (`docs/ux/screen-contracts.md:40`) |
| **Q10** — which shared UI patterns are duplicated across the surfaces today (blocks Phase 2) | Phase 0 pattern scan | **Answered** — §3.1 (every reusable component with its call sites and its non-use) and §3.2 (eight duplicated patterns: chips, section headers, list rows, loading, empty, destructive confirmation, form fields, language picker) |
| **Q9** — current tap counts for the app's three primary tasks (blocks Phase 2) | Phase 0 measurement | **Not answered** — tap counts need interaction traces or device runs, which this read-only audit did not perform. The raw material is here (routes, entries/exits, per-screen actions, §4), but the counts are **unverified** |
| **Q4** — does the pending design-system snapshot activation interact with a redesign that changes tokens? (blocks Phase 1) | Design-system domain review | **Partially informed** — §2.1 establishes that no Android delivery path exists for admin publications today (compiled-in tokens, guarded at `build.gradle.kts:808-811`), so an activation cannot reach the app without a new mechanism. Whether one is planned is outside this audit |

Also consistent with this audit: RD-01 (visual layer and surface area change; contracts do not —
§8, §10 are the contract inventory), RD-12 (per-surface screenshot rebuilds — §8.2 item 6), and the
localization/Auth/design-system invariants that AGENTS.md marks as approval-gated (§10.3).
