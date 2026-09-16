/**
 * What is actually DRAWN, as opposed to what is claimed to be designed.
 *
 *   node tooling/ux/render-coverage.mjs
 *
 * WHY THIS EXISTS ALONGSIDE design-coverage.mjs
 *   `design-coverage.mjs` maps each contract state to an artboard *name* and
 *   checks that the name is present in its own object literal. Nothing in that
 *   loop can fail when a state is undrawn, unbuilt, or deleted — the اليوم
 *   contract passed it for months while two of its four states did not exist.
 *   It answers "did someone write down a name", which is not a question worth
 *   asking twice.
 *
 *   A screenshot reference PNG is a better oracle, because it cannot be written
 *   down. It exists only because a @PreviewTest composed that state and the
 *   renderer produced pixels. This tool checks those files.
 *
 * THE DISTINCTION THAT CARRIES THE WHOLE FILE
 *   A render proves a contract state only when it renders THE SCREEN. A render
 *   of a shared component — FullScreenEmpty with the right string, a row card
 *   in a hand-built Column — proves the component behaves, and proves nothing
 *   at all about what the screen does with it. If OrdersScreen stopped calling
 *   FullScreenEmpty tomorrow, `ordersEmptyState` would still be green.
 *
 *   So every render is classified `screen` or `component`, and only `screen`
 *   counts toward contract coverage. The classification is the point: it is the
 *   line between evidence and decoration, and it is not fudgeable, because a
 *   `screen` entry must name a contract and a state that contract declares.
 *
 * WHAT IT ENFORCES
 *   1. Every declared render has a reference PNG.       (no claim without pixels)
 *   2. Every reference-producing @PreviewTest is declared here.  (no render without a claim)
 *   3. A `screen` entry names a real contract and a state it declares.
 *   4. Proven state count never falls below FLOOR.      (ratchet)
 *
 * Rule 4 is what stops rule 1 being satisfied by deleting the claim.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { CONTRACTS } from "./screen-contracts.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const ANDROID = path.join(ROOT, "apps/seller-android/app");
const SOURCE = path.join(ANDROID, "src/screenshotTest/java");
const REFERENCE_ROOTS = ["src/screenshotTestStagingDebug/reference", "src/screenshotTestDebug/reference"]
  .map(p => path.join(ANDROID, p));

/**
 * Preview function -> what it proves.
 *
 *   kind "screen"    + contract + state — renders the screen composable itself.
 *   kind "component" + note              — renders a component in isolation.
 *
 * `offline` marks the banner-over-content modifier, which is not a state (see
 * design-coverage.mjs) and so is tracked but not counted.
 */
export const RENDERS = {
  // ---- the one surface that is a screen composable taking a state ----
  // TodayScreen(state) IS the surface, so a literal TodayUiState renders the
  // real thing. This is the shape every other surface still has to reach.
  todayLoadingLight: { kind: "screen", contract: "today", state: "loading", theme: "light" },
  todayLoadingDark: { kind: "screen", contract: "today", state: "loading", theme: "dark" },
  todayContentLight: { kind: "screen", contract: "today", state: "content", theme: "light" },
  todayContentDark: { kind: "screen", contract: "today", state: "content", theme: "dark" },
  todayEmptyLight: { kind: "screen", contract: "today", state: "empty", theme: "light" },
  todayEmptyDark: { kind: "screen", contract: "today", state: "empty", theme: "dark" },
  todayErrorLight: { kind: "screen", contract: "today", state: "error", theme: "light" },
  todayErrorDark: { kind: "screen", contract: "today", state: "error", theme: "dark" },
  todayOfflineLight: { kind: "screen", contract: "today", offline: true, theme: "light" },
  todayOfflineDark: { kind: "screen", contract: "today", offline: true, theme: "dark" },
  todayGreyscale: { kind: "component", note: "اليوم counters survive greyscale — colour is never the only carrier" },
  todayContentEnglish: { kind: "component", note: "the اليوم counters in English — the control for the Arabic digits" },

  // ---- components, not screens ----
  // Each of these renders a shared component with a surface's copy in it. That
  // proves the component and the string; it does not prove the screen chooses
  // them, which is exactly the defect class this repo keeps producing.
  // The only shared state component no screen render reaches: FullScreenError's
  // two callers, PlansScreen and OperationsScreens, are not previewable yet.
  stateError: { kind: "component", note: "FullScreenError carries a retry" },
  stateErrorDark: { kind: "component", note: "FullScreenError, dark" },

  // ---- الطلبات ----
  ordersLoadingLight: { kind: "screen", contract: "orders", state: "loading", theme: "light" },
  ordersLoadingDark: { kind: "screen", contract: "orders", state: "loading", theme: "dark" },
  ordersContentLight: { kind: "screen", contract: "orders", state: "content", theme: "light" },
  ordersContentDark: { kind: "screen", contract: "orders", state: "content", theme: "dark" },
  ordersEmptyLight: { kind: "screen", contract: "orders", state: "empty", theme: "light" },
  ordersEmptyDark: { kind: "screen", contract: "orders", state: "empty", theme: "dark" },
  // The orders are on the device either way, so the error keeps the list and
  // marks the one the server refused rather than replacing it with a message.
  ordersErrorLight: { kind: "screen", contract: "orders", state: "error", theme: "light" },
  ordersErrorDark: { kind: "screen", contract: "orders", state: "error", theme: "dark" },
  ordersFilteredToNone: { kind: "component", note: "filtered to none keeps the chips — the way out is to clear one" },
  ordersFilteredUnpaid: { kind: "component", note: "a اليوم counter's filter arrives visible, so it can be cleared" },

  // ---- العملاء ----
  customersLoadingLight: { kind: "screen", contract: "customers", state: "loading", theme: "light" },
  customersLoadingDark: { kind: "screen", contract: "customers", state: "loading", theme: "dark" },
  customersContentLight: { kind: "screen", contract: "customers", state: "content", theme: "light" },
  customersContentDark: { kind: "screen", contract: "customers", state: "content", theme: "dark" },
  customersEmptyLight: { kind: "screen", contract: "customers", state: "empty", theme: "light" },
  customersEmptyDark: { kind: "screen", contract: "customers", state: "empty", theme: "dark" },
  // This surface's failure is a total it cannot honestly add up, not a lost
  // connection: it is aggregated from orders already on the device.
  customersErrorLight: { kind: "screen", contract: "customers", state: "error", theme: "light" },
  customersErrorDark: { kind: "screen", contract: "customers", state: "error", theme: "dark" },
  customersSearchEmpty: { kind: "component", note: "a search matching nothing is not an empty customer list" },

  // ---- حسابي ----
  // planName seeded "Free" and aiAvailable seeded false, so this surface told a
  // paying seller they were on the free plan and hid the AI entry, then
  // corrected both a beat later. The loading render is what those two nulls buy.
  accountLoadingLight: { kind: "screen", contract: "account", state: "loading", theme: "light" },
  accountLoadingDark: { kind: "screen", contract: "account", state: "loading", theme: "dark" },
  accountContentLight: { kind: "screen", contract: "account", state: "content", theme: "light" },
  accountContentDark: { kind: "screen", contract: "account", state: "content", theme: "dark" },
  accountFreePlan: { kind: "component", note: "aiAvailable=false omits the entry rather than showing it locked — NotBuilt carries no upgrade affordance" },
  accountLinkPending: { kind: "component", note: "the store link before it has been issued" },

  // المتجر, once StoreContent(state) existed to render. These replace four
  // `products*` renders that called FullScreenEmpty and FullScreenLoading
  // directly: they were green whatever the screen did, which is the thing this
  // guard was written to stop counting.
  storeLoadingLight: { kind: "screen", contract: "store", state: "loading", theme: "light" },
  storeLoadingDark: { kind: "screen", contract: "store", state: "loading", theme: "dark" },
  storeContentLight: { kind: "screen", contract: "store", state: "content", theme: "light" },
  storeContentDark: { kind: "screen", contract: "store", state: "content", theme: "dark" },
  storeEmptyLight: { kind: "screen", contract: "store", state: "empty", theme: "light" },
  storeEmptyDark: { kind: "screen", contract: "store", state: "empty", theme: "dark" },
  // The store's error is not a blank screen: products stuck on the device block
  // the catalogue refresh, so the surface keeps listing what Room holds and says
  // the sync is stopped over the top of it.
  storeErrorLight: { kind: "screen", contract: "store", state: "error", theme: "light" },
  storeErrorDark: { kind: "screen", contract: "store", state: "error", theme: "dark" },
  storeSearchEmpty: { kind: "component", note: "a search matching nothing is not an empty catalogue — same screen, not a declared state" },
  // The content state again in English. Not a state — the same one, in the
  // language where a numeral mismatch is invisible, which is why المتجر carried
  // one for as long as it did.
  storeContentEnglish: { kind: "component", note: "the store row in English — price, stock and meter in one numeral system" },
  storeAtLimit: { kind: "component", note: "at the plan limit the FAB locks rather than vanishing — a gate, not a state" },

  orderListLight: { kind: "component", note: "real OrderCard rows in a hand-built Column — proves the card, not OrdersScreen" },
  orderListDark: { kind: "component", note: "OrderCard, dark" },
  orderListGreyscale: { kind: "component", note: "order status survives greyscale" },

  componentGalleryLight: { kind: "component", note: "the shared component vocabulary, light" },
  componentGalleryDark: { kind: "component", note: "the shared component vocabulary, dark" },
  componentGalleryGreyscale: { kind: "component", note: "the vocabulary survives greyscale" },

  surfaceBarLight: { kind: "component", note: "the five-surface bar, light" },
  surfaceBarDarkAccount: { kind: "component", note: "the bar with حسابي active, dark" },
  surfaceBarEnglish: { kind: "component", note: "the bar in English — labels must not clip" },

  localizationSurfaceScreenshot: { kind: "component", note: "ar/en/fr side by side; one render per locale" },

  // ================= account pages =================
  // All three computed `isEmpty = !busy && items.isEmpty()`, and both halves
  // were true before anything started loading: _busy seeds false and the lists
  // seeded emptyList(). "Nothing here yet" greeted a seller who had tickets,
  // announcements or translations, every time, for as long as the request took.
  supportLoadingLight: { kind: "screen", contract: "support", state: "loading", theme: "light" },
  supportLoadingDark: { kind: "screen", contract: "support", state: "loading", theme: "dark" },
  supportContentLight: { kind: "screen", contract: "support", state: "content", theme: "light" },
  supportContentDark: { kind: "screen", contract: "support", state: "content", theme: "dark" },
  supportEmptyLight: { kind: "screen", contract: "support", state: "empty", theme: "light" },
  supportEmptyDark: { kind: "screen", contract: "support", state: "empty", theme: "dark" },
  supportErrorLight: { kind: "screen", contract: "support", state: "error", theme: "light" },
  supportErrorDark: { kind: "screen", contract: "support", state: "error", theme: "dark" },

  announcementsLoadingLight: { kind: "screen", contract: "announcements", state: "loading", theme: "light" },
  announcementsLoadingDark: { kind: "screen", contract: "announcements", state: "loading", theme: "dark" },
  announcementsContentLight: { kind: "screen", contract: "announcements", state: "content", theme: "light" },
  announcementsContentDark: { kind: "screen", contract: "announcements", state: "content", theme: "dark" },
  // Actionless, like the customers surface and unlike support above: a seller
  // cannot make an announcement happen.
  announcementsEmptyLight: { kind: "screen", contract: "announcements", state: "empty", theme: "light" },
  announcementsEmptyDark: { kind: "screen", contract: "announcements", state: "empty", theme: "dark" },
  announcementsErrorLight: { kind: "screen", contract: "announcements", state: "error", theme: "light" },
  announcementsErrorDark: { kind: "screen", contract: "announcements", state: "error", theme: "dark" },

  catalogLanguagesLoadingLight: { kind: "screen", contract: "catalog-languages", state: "loading", theme: "light" },
  catalogLanguagesLoadingDark: { kind: "screen", contract: "catalog-languages", state: "loading", theme: "dark" },
  catalogLanguagesContentLight: { kind: "screen", contract: "catalog-languages", state: "content", theme: "light" },
  catalogLanguagesContentDark: { kind: "screen", contract: "catalog-languages", state: "content", theme: "dark" },
  // The state this screen declared and did not have: with nothing to translate
  // it fell through to content and drew two language buttons over blank space.
  catalogLanguagesEmptyLight: { kind: "screen", contract: "catalog-languages", state: "empty", theme: "light" },
  catalogLanguagesEmptyDark: { kind: "screen", contract: "catalog-languages", state: "empty", theme: "dark" },
  catalogLanguagesErrorLight: { kind: "screen", contract: "catalog-languages", state: "error", theme: "light" },
  catalogLanguagesErrorDark: { kind: "screen", contract: "catalog-languages", state: "error", theme: "dark" },

  // ---- support ticket: two declared states that did not exist ----
  // The page passed no busy and no error to OperationPage at all, and the view
  // model threw `result.error` away without looking at it.
  ticketLoadingLight: { kind: "screen", contract: "support-ticket", state: "loading", theme: "light" },
  ticketLoadingDark: { kind: "screen", contract: "support-ticket", state: "loading", theme: "dark" },
  ticketContentLight: { kind: "screen", contract: "support-ticket", state: "content", theme: "light" },
  ticketContentDark: { kind: "screen", contract: "support-ticket", state: "content", theme: "dark" },
  ticketClosed: { kind: "screen", contract: "support-ticket", state: "content", theme: "light", note: "a closed thread is a record, not a conversation — no reply box" },
  ticketErrorLight: { kind: "screen", contract: "support-ticket", state: "error", theme: "light" },
  ticketErrorDark: { kind: "screen", contract: "support-ticket", state: "error", theme: "dark" },

  // ---- deletion status ----
  // null is both "no request" and "not read", and it is the seed.
  deletionLoadingLight: { kind: "screen", contract: "deletion-status", state: "loading", theme: "light" },
  deletionLoadingDark: { kind: "screen", contract: "deletion-status", state: "loading", theme: "dark" },
  deletionNoneLight: { kind: "screen", contract: "deletion-status", state: "content", theme: "light", note: "read, and there genuinely is no request" },
  deletionNoneDark: { kind: "screen", contract: "deletion-status", state: "content", theme: "dark" },
  deletionPending: { kind: "screen", contract: "deletion-status", state: "content", theme: "light", note: "the case the seed hid for as long as the call took" },
  deletionErrorLight: { kind: "screen", contract: "deletion-status", state: "error", theme: "light" },
  deletionErrorDark: { kind: "screen", contract: "deletion-status", state: "error", theme: "dark" },

  // ---- subscription ----
  subscriptionLoadingLight: { kind: "screen", contract: "subscription", state: "loading", theme: "light" },
  subscriptionLoadingDark: { kind: "screen", contract: "subscription", state: "loading", theme: "dark" },
  subscriptionContentLight: { kind: "screen", contract: "subscription", state: "content", theme: "light" },
  subscriptionContentDark: { kind: "screen", contract: "subscription", state: "content", theme: "dark" },
  subscriptionPurchaseClosed: { kind: "screen", contract: "subscription", state: "content", theme: "light", note: "the real state today; the banner has to reach the plan list" },
  subscriptionPurchaseOpen: { kind: "screen", contract: "subscription", state: "content", theme: "light" },
  subscriptionVerifying: { kind: "screen", contract: "subscription", state: "loading", theme: "light", note: "money moved, entitlement has not" },
  subscriptionBillingError: { kind: "screen", contract: "subscription", state: "error", theme: "light" },

  // ---- devices ----
  devicesLoadingLight: { kind: "screen", contract: "devices", state: "loading", theme: "light" },
  devicesLoadingDark: { kind: "screen", contract: "devices", state: "loading", theme: "dark" },
  devicesContentLight: { kind: "screen", contract: "devices", state: "content", theme: "light" },
  devicesContentDark: { kind: "screen", contract: "devices", state: "content", theme: "dark" },
  devicesNoPasskeySupport: { kind: "screen", contract: "devices", state: "content", theme: "light", note: "below Android 9 the control is disabled, not hidden" },
  // "recent_auth_required" means sign in again, not try again, and the retry
  // button routes to reauthentication for exactly that code.
  devicesRecentAuthRequired: { kind: "screen", contract: "devices", state: "error", theme: "light" },
  devicesErrorDark: { kind: "screen", contract: "devices", state: "error", theme: "dark" },

  // ---- ai assistant ----
  // The one screen here that does not load on entry, which is why _busy could
  // not simply seed true for the six that share it.
  assistantEmptyLight: { kind: "screen", contract: "ai-assistant", state: "empty", theme: "light" },
  assistantEmptyDark: { kind: "screen", contract: "ai-assistant", state: "empty", theme: "dark" },
  assistantContentLight: { kind: "screen", contract: "ai-assistant", state: "content", theme: "light" },
  assistantContentDark: { kind: "screen", contract: "ai-assistant", state: "content", theme: "dark" },
  assistantSending: { kind: "screen", contract: "ai-assistant", state: "loading", theme: "light" },
  assistantErrorLight: { kind: "screen", contract: "ai-assistant", state: "error", theme: "light" },
  assistantErrorDark: { kind: "screen", contract: "ai-assistant", state: "error", theme: "dark" },

  // ================= entry =================
  // Splash had no name at all: it was an anonymous block inside
  // `composable<SplashRoute> { }`, which is why nothing could render it and why
  // verify-screen-contracts passed it — its bodyFor looks for a SplashScreen()
  // that did not exist, and returns early because the contract declares no
  // actions. A screen with two declared states and no name.
  splashLoadingLight: { kind: "screen", contract: "splash", state: "loading", theme: "light" },
  splashLoadingDark: { kind: "screen", contract: "splash", state: "loading", theme: "dark" },
  splashErrorLight: { kind: "screen", contract: "splash", state: "error", theme: "light" },
  splashErrorDark: { kind: "screen", contract: "splash", state: "error", theme: "dark" },

  // The page a suspended seller stares at. Rendering it is what showed the back
  // arrow that did nothing.
  restrictedAccountLight: { kind: "screen", contract: "restricted-account", state: "content", theme: "light" },
  restrictedAccountDark: { kind: "screen", contract: "restricted-account", state: "content", theme: "dark" },

  // ================= shop setup =================
  // Both step composables took a ShopSetupViewModel directly, so the second
  // screen a new seller ever sees could not be drawn at all — a screen with a
  // taxonomy call, a city search, a slug check, three loading states and three
  // error states, and renders of none of them. ShopSetupActions is what replaced
  // that: thirteen no-op-defaulted lambdas in one value.
  setupAccountLight: { kind: "screen", contract: "shop-setup", state: "content", theme: "light" },
  setupAccountDark: { kind: "screen", contract: "shop-setup", state: "content", theme: "dark" },
  setupAccountEmpty: { kind: "screen", contract: "shop-setup", state: "content", theme: "light", note: "how a seller actually meets step 1" },
  setupStoreLight: { kind: "screen", contract: "shop-setup", state: "content", theme: "light" },
  setupStoreDark: { kind: "screen", contract: "shop-setup", state: "content", theme: "dark" },
  setupStoreCitySuggestions: { kind: "screen", contract: "shop-setup", state: "content", theme: "light", note: "suggestions returned; picking one closes the list" },
  setupStoreCityManual: { kind: "screen", contract: "shop-setup", state: "content", theme: "light", note: "a town the catalogue has never heard of still has to be typeable" },

  setupAccountSaving: { kind: "screen", contract: "shop-setup", state: "loading", theme: "light" },
  setupStoreSaving: { kind: "screen", contract: "shop-setup", state: "loading", theme: "light" },
  setupStoreSavingDark: { kind: "screen", contract: "shop-setup", state: "loading", theme: "dark" },
  setupStoreTaxonomyLoading: { kind: "screen", contract: "shop-setup", state: "loading", theme: "light" },
  setupStoreCitySearching: { kind: "screen", contract: "shop-setup", state: "loading", theme: "light" },
  setupStoreSlugChecking: { kind: "screen", contract: "shop-setup", state: "loading", theme: "light" },

  setupStoreError: { kind: "screen", contract: "shop-setup", state: "error", theme: "light" },
  setupStoreErrorDark: { kind: "screen", contract: "shop-setup", state: "error", theme: "dark" },
  setupAccountInvalidEmail: { kind: "screen", contract: "shop-setup", state: "error", theme: "light", note: "blank is valid — email is optional — so this exists only once typed" },
  // The render that showed a red box with no message and no visible retry, on
  // the one step that cannot be finished without a category.
  setupStoreTaxonomyError: { kind: "screen", contract: "shop-setup", state: "error", theme: "light", note: "blocks the flow, so it must explain itself" },
  setupStoreCityError: { kind: "screen", contract: "shop-setup", state: "error", theme: "light", note: "does NOT block the flow — manual entry is the way through" },
  setupStoreSlugTaken: { kind: "screen", contract: "shop-setup", state: "error", theme: "light", note: "pick another name" },
  setupStoreSlugOffline: { kind: "screen", contract: "shop-setup", state: "error", theme: "light", note: "we do not know yet — showing TAKEN here sends a seller off to rename a shop that was never taken" },

  // ================= auth =================
  // The first screen a tester opens, and the contract the audit called its
  // worst at five unverified claims. It needed no split: AuthScreenContent has
  // taken an AuthUiState all along and nobody ever rendered it.
  //
  // Success is deliberately not here. It is not a state a seller sees — the
  // composable runs a LaunchedEffect on it and navigates away — so a render of
  // it would prove a side effect and nothing else.
  authWelcomeLight: { kind: "screen", contract: "auth", state: "content", theme: "light" },
  authWelcomeDark: { kind: "screen", contract: "auth", state: "content", theme: "dark" },
  authWelcomePasskeyLoading: { kind: "screen", contract: "auth", state: "loading", theme: "light" },
  authPhoneSendingDark: { kind: "screen", contract: "auth", state: "loading", theme: "dark" },
  authWelcomePasskeyFailed: { kind: "screen", contract: "auth", state: "error", theme: "light" },
  authOtpWrongCodeDark: { kind: "screen", contract: "auth", state: "error", theme: "dark" },

  // The rest render the same screen in the same three states, reached through
  // the other steps of the flow. They are `screen` because that is what they
  // are — the Set dedupes, so extra proof of an already-proven state costs
  // nothing and calling them `component` to keep a count tidy would be the one
  // fudge the kind field exists to prevent.
  authWelcomeRestricted: { kind: "screen", contract: "auth", state: "error", theme: "light", note: "the one auth error where retrying will not help — no encouraging retry" },
  authPhoneLight: { kind: "screen", contract: "auth", state: "content", theme: "light", note: "phone step, a valid number" },
  authPhoneDark: { kind: "screen", contract: "auth", state: "content", theme: "dark", note: "phone step, dark" },
  authPhoneEmpty: { kind: "screen", contract: "auth", state: "content", theme: "light", note: "the state the phone step actually opens in" },
  authPhoneSending: { kind: "screen", contract: "auth", state: "loading", theme: "light", note: "requesting the code" },
  authPhoneInvalid: { kind: "screen", contract: "auth", state: "error", theme: "light", note: "the seller's to fix" },
  authPhoneNoNetwork: { kind: "screen", contract: "auth", state: "error", theme: "light", note: "not the seller's to fix — distinct from INVALID_PHONE on purpose" },
  authOtpLight: { kind: "screen", contract: "auth", state: "content", theme: "light", note: "code step, phone locked above it" },
  authOtpDark: { kind: "screen", contract: "auth", state: "content", theme: "dark", note: "code step, dark" },
  authOtpResendable: { kind: "screen", contract: "auth", state: "content", theme: "light", note: "countdown spent, so resend is offered rather than implied" },
  authOtpVerifying: { kind: "screen", contract: "auth", state: "loading", theme: "light", note: "verifying the code" },
  authOtpWrongCode: { kind: "screen", contract: "auth", state: "error", theme: "light", note: "wrong code — the render that caught the OTP text bleeding through its own boxes" },
  authOtpExpired: { kind: "screen", contract: "auth", state: "error", theme: "light", note: "expired is not wrong: a new code, not a better guess" },
  authPasskeyInvite: { kind: "screen", contract: "auth", state: "content", theme: "light", note: "offered to an existing seller" },
  authPasskeyCreating: { kind: "screen", contract: "auth", state: "loading", theme: "light", note: "the system ceremony in flight" },
  authPasskeyDeferred: { kind: "screen", contract: "auth", state: "content", theme: "light", note: "a new seller: recorded now, ceremony after setup — must not look like a passkey exists" },
};

/** Proven screen-states may never drop below this. Raise it; never lower it. */
export const FLOOR = 55;

/**
 * The whole decision, with nothing to do with the filesystem.
 *
 * Split out so its red ticks can be seen on purpose in render-coverage.test.mjs
 * — the audit next door went a year without that, and the failure it missed was
 * not exotic.
 *
 * @param renders      fn -> classification (the RENDERS shape above)
 * @param discovered   Map fn -> reference directory, from the source tree
 * @param hasReference (dir, fn) -> boolean
 * @param contracts    the screen contracts
 * @param floor        minimum proven screen-states
 */
export function checkRenders({ renders, discovered, hasReference, contracts, floor }) {
  const problems = [];
  const provenStates = new Set();
  const provenOffline = new Set();

  for (const fn of discovered.keys()) {
    if (!renders[fn]) {
      problems.push(`@PreviewTest ${fn} is not classified in RENDERS — say whether it proves a screen state or a component`);
    }
  }

  for (const [fn, r] of Object.entries(renders)) {
    const dir = discovered.get(fn);
    if (dir === undefined) {
      problems.push(`RENDERS declares ${fn}, but no @PreviewTest by that name exists`);
      continue;
    }
    if (!hasReference(dir, fn)) {
      problems.push(`${fn}: no reference PNG under ${dir} — run :app:updateStagingDebugScreenshotTest`);
      continue;
    }
    if (r.kind !== "screen") continue;

    const contract = contracts.find(c => c.id === r.contract);
    if (!contract) { problems.push(`${fn}: unknown contract "${r.contract}"`); continue; }
    if (r.offline) {
      if (!contract.offline) problems.push(`${fn}: contract "${r.contract}" is not offline-capable`);
      else provenOffline.add(r.contract);
      continue;
    }
    if (!contract.states.includes(r.state)) {
      problems.push(`${fn}: contract "${r.contract}" does not declare state "${r.state}"`);
      continue;
    }
    provenStates.add(`${r.contract}.${r.state}`);
  }

  if (provenStates.size < floor) {
    problems.push(`proven screen-states fell to ${provenStates.size}, below the floor of ${floor}`);
  }
  return { problems, provenStates, provenOffline };
}

/** Every @PreviewTest in a Kotlin source tree, mapped to its reference dir. */
export function discoverPreviews(sourceRoot, { readdir, readFile, relative }) {
  const discovered = new Map();
  const problems = [];
  for (const file of readdir(sourceRoot)) {
    const text = readFile(file);
    const pkg = text.match(/^package\s+([\w.]+)/m)?.[1];
    if (!pkg) { problems.push(`${relative(file)}: no package declaration`); continue; }
    const base = file.replace(/\\/g, "/").split("/").pop().replace(/\.kt$/, "");
    const dir = `${pkg.replace(/\./g, "/")}/${base}Kt`;
    // Everything after an @PreviewTest up to its `fun name(`.
    for (const chunk of text.split("@PreviewTest").slice(1)) {
      const fn = chunk.match(/\bfun\s+(\w+)\s*\(/)?.[1];
      if (fn) discovered.set(fn, dir);
      else problems.push(`${relative(file)}: @PreviewTest with no following function`);
    }
  }
  return { discovered, problems };
}

/* ---- wiring, only when run as a script ------------------------------- */

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  const kotlinFiles = dir => !fs.existsSync(dir) ? [] :
    fs.readdirSync(dir, { withFileTypes: true }).flatMap(e => {
      const p = path.join(dir, e.name);
      return e.isDirectory() ? kotlinFiles(p) : e.name.endsWith(".kt") ? [p] : [];
    });

  const { discovered, problems: scanProblems } = discoverPreviews(SOURCE, {
    readdir: kotlinFiles,
    readFile: f => fs.readFileSync(f, "utf8"),
    relative: f => path.relative(ROOT, f),
  });

  const hasReference = (dir, fn) => REFERENCE_ROOTS.some(root => {
    const full = path.join(root, dir);
    return fs.existsSync(full) &&
      fs.readdirSync(full).some(f => f.startsWith(fn + "_") && f.endsWith(".png"));
  });

  const { problems, provenStates, provenOffline } =
    checkRenders({ renders: RENDERS, discovered, hasReference, contracts: CONTRACTS, floor: FLOOR });
  problems.unshift(...scanProblems);

  const totalStates = CONTRACTS.reduce((a, c) => a + c.states.length, 0);
  const screenRenders = Object.values(RENDERS).filter(r => r.kind === "screen").length;
  const outstanding = CONTRACTS.flatMap(c =>
    c.states.filter(s => !provenStates.has(`${c.id}.${s}`)).map(s => `${c.id}.${s}`));

  console.log(`Renders: ${Object.keys(RENDERS).length} (${screenRenders} screen, ${Object.keys(RENDERS).length - screenRenders} component)`);
  console.log(`Contract states proven by a render of the screen: ${provenStates.size} of ${totalStates}`);
  console.log(`  proven: ${[...provenStates].sort().join(", ")}`);
  console.log(`  offline modifier proven: ${[...provenOffline].sort().join(", ") || "none"}`);

  const byContract = new Map();
  for (const s of outstanding) {
    const id = s.slice(0, s.lastIndexOf("."));
    byContract.set(id, (byContract.get(id) ?? []).concat(s.slice(s.lastIndexOf(".") + 1)));
  }
  console.log(`\nNOT PROVEN — ${outstanding.length} states across ${byContract.size} contracts:`);
  for (const [id, states] of byContract) console.log(`  ${id.padEnd(20)} ${states.join(", ")}`);
  console.log(`
  A state leaves this list when a @PreviewTest renders THE SCREEN in it. Most of
  these screens cannot be rendered by a preview at all yet: they read a Hilt view
  model rather than taking a state, which is the same reason اليوم went unproven
  while living inside MainScreen.kt. Extracting a stateless composable is the
  work; the render is how you find out you did it.`);

  if (problems.length) {
    console.error(`\nFAIL — ${problems.length} problem(s):`);
    for (const p of problems) console.error("  " + p);
    process.exit(1);
  }
  console.log(`\nOK — every render is classified, every claim has pixels behind it.`);
}
