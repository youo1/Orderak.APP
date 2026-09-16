/**
 * Orderak — Screen contracts (PHASE 0B).
 *
 * One contract per screen in the target architecture. This is the definition
 * the designs are drawn against and the source PHASE 5 feeds the screen
 * manifest from. Defining it BEFORE the designs is deliberate: a screen whose
 * data, exits and states are not settled cannot be designed honestly.
 *
 * kotlinRoute  the @Serializable route in app/navigation/Routes.kt, or null for
 *              a surface hosted inside MainRoute (tabs) or an overlay.
 * surface      today | orders | store | customers | account
 * states       the states this screen ACTUALLY has. Not every screen has four:
 *              Splash has no empty state, Plans has no empty state. The
 *              screenshot suite asserts coverage of what is declared here.
 * offline      true when the screen must keep rendering cached content with an
 *              offline banner rather than falling to an error state.
 * transient    true for a routing screen that has no content of its own — it
 *              resolves and navigates away. Only a transient screen may omit
 *              the content state.
 * phase        which migration phase builds it (6..10), or null for "carried".
 *
 * actions      what a seller can DO on the screen. Each entry is an object,
 *              never a bare label, because a label proves nothing:
 *
 *                { do: "save", via: "save" }
 *                  `via` names a symbol that must appear inside this screen's
 *                  own composable body. Verified mechanically.
 *
 *                { do: "search", status: "planned", why: "..." }
 *                  Declared in the design, confirmed absent from the screen.
 *                  Kept rather than deleted so the intent survives, and so the
 *                  day it is built the entry becomes a `via`.
 *
 *                { do: "resend", status: "unverified" }
 *                  Present in the design, delegated to a helper this pass did
 *                  not trace. Listed in UNVERIFIED_ACTIONS below, which may
 *                  shrink and never grow.
 *
 *              WHY THIS SHAPE EXISTS
 *                verify-screen-contracts.mjs checked routes, states,
 *                entitlement keys and exit targets, and never checked actions
 *                at all. So `customer-details` could declare "contact" and
 *                "edit" on a screen with neither, and both `store` and
 *                `customers` could declare a "search" that does not exist. The
 *                audit expected four such actions. Converting all 81 found
 *                thirteen: `categories` declares a "reorder" with no ordering
 *                control, `deletion-status` declares "request deletion" and
 *                "cancel request" on a screen that reports status and offers no
 *                control at all, and `subscription` pointed at a Plans screen
 *                that did not exist.
 *
 *              A `planned` entry's `why` is a claim about the world and ages
 *                like one. `subscription`'s said "PlansRoute does not exist yet"
 *                long after it was built and wired — the route existed, the
 *                paywall reached it, and only the screen that declares it as an
 *                exit did not. Re-read the reason, not just the status.
 */

export const STATES = ["loading", "content", "empty", "error"];

export const CONTRACTS = [
  // ============ shell and entry ============
  {
    id: "splash",
    kotlinRoute: "SplashRoute",
    surface: "today",
    purpose: "توجيه البدء حسب حالة الجلسة قبل ما يشوف البائع أي واجهة",
    entry: ["cold start", "warm start"],
    exit: ["MainRoute — جلسة صالحة", "AuthRoute — مفيش جلسة", "RestrictedAccountRoute — حساب مقيَّد"],
    data: ["cached session", "server session check", "app version policy"],
    actions: [],
    states: ["loading", "error"],
    offline: false,
    transient: true,
    entitlementKey: null,
    featureStatus: "implemented",
    phase: 10,
  },
  {
    id: "auth",
    kotlinRoute: "AuthRoute",
    surface: "today",
    purpose: "دخول البائع: مفتاح مرور للراجع، أو هاتف ورمز للجديد",
    entry: ["SplashRoute — مفيش جلسة", "تسجيل خروج"],
    exit: ["MainRoute — متجر موجود", "ShopSetupRoute — بائع جديد"],
    data: ["passkey availability", "phone country catalogue", "OTP state", "terms/privacy versions"],
    actions: [
      { do: "passkey sign-in", via: "onPasskeySignIn" },
      // All five go through one `dispatch(AuthEvent)` rather than a callback
      // per action, which is why searching for "requestOtp" found nothing. The
      // four OTP intents are dispatched, so `dispatch` — wired in this screen's
      // own body — is what carries them.
      { do: "request OTP", via: "dispatch" },
      { do: "verify OTP", via: "dispatch" },
      { do: "change number", via: "dispatch" },
      { do: "resend", via: "dispatch" },
      // Traced and still unverified, deliberately. `AuthScreen` is a thin
      // wrapper around `AuthScreenContent`, and the language sheet lives in the
      // child with local `showLanguage` state — not dispatched, so no symbol in
      // this screen's body carries it. The control is real
      // (AuthScreen.kt:135); this check cannot see across that split, and
      // inventing a via to satisfy it would be the lie the check exists to stop.
      { do: "switch language", status: "unverified" },
    ],
    states: ["content", "loading", "error"],
    offline: false,
    entitlementKey: null,
    featureStatus: "implemented",
    phase: 10,
  },
  {
    id: "shop-setup",
    kotlinRoute: "ShopSetupRoute",
    surface: "account",
    purpose: "إنشاء الحساب والمتجر في خطوتين، بمسوّدة قابلة للاستئناف",
    entry: ["AuthRoute — تحقّق ناجح لبائع جديد"],
    exit: ["MainRoute — اكتمل الإنشاء", "AuthRoute — رجوع مع حفظ المسوّدة"],
    data: ["resumable draft", "business categories", "city catalogue", "slug availability"],
    actions: [
      { do: "save account step", via: "next" },
      // Not a control the seller operates: `checkSlug()` is private and fires as
      // they type the shop name, and the screen renders only the RESULT. Both
      // this and the city picker live in child composables of ShopSetupScreen,
      // so no symbol in its own body carries them — traced to
      // `slugAvailability` and `onCitySelected` respectively, and left
      // unverified rather than given a via this check would be wrong to accept.
      { do: "see slug availability", status: "unverified" },
      { do: "select city", status: "unverified" },
      { do: "create store", via: "onCreate" },
    ],
    states: ["content", "loading", "error"],
    offline: false,
    entitlementKey: null,
    featureStatus: "implemented",
    phase: 10,
  },
  {
    id: "restricted-account",
    kotlinRoute: "RestrictedAccountRoute",
    surface: "account",
    purpose: "يشرح للبائع إن حسابه مقيَّد وإيه المسار المتاح",
    entry: ["SplashRoute — حساب مقيَّد", "أي شاشة — إشارة CREDENTIAL_REJECTED/ACCOUNT_RESTRICTED"],
    exit: ["SupportRoute", "AuthRoute — تسجيل خروج"],
    data: ["restriction reason", "support entry point"],
    actions: [
      // Real, but not via SupportRoute: a restricted account sits outside the
      // main shell, so the control opens a mailto intent instead. The exit
      // above said SupportRoute and was wrong about how, not whether.
      { do: "contact support", via: "restricted_contact" },
      { do: "sign out", via: "onLogout" },
    ],
    states: ["content"],
    offline: false,
    entitlementKey: null,
    featureStatus: "implemented",
    phase: 10,
  },
  {
    id: "main-shell",
    kotlinRoute: "MainRoute",
    surface: "today",
    purpose: "الهيكل: خمسة أسطح في تنقّل سفلي، وoverlay حوكمة الإصدار فوقهم",
    entry: ["SplashRoute", "AuthRoute", "ShopSetupRoute"],
    exit: ["كل شاشات التفاصيل"],
    data: ["active surface", "app version policy", "unread announcements"],
    actions: [
      { do: "switch surface", via: "SellerSurface" },
    ],
    states: ["content"],
    offline: false,
    entitlementKey: null,
    featureStatus: "implemented",
    phase: 8,
  },
  {
    id: "version-governance",
    kotlinRoute: null,
    surface: "today",
    purpose: "overlay بستة أوضاع من versionUiMode(): تحذير، تحديث إجباري، محظور، صيانة، تحذير قديم",
    entry: ["MainRoute — سياسة إصدار غير ok"],
    exit: ["متجر Play", "استمرار — في وضع التحذير فقط"],
    data: ["AppVersionPolicy", "config age"],
    actions: [
      { do: "update", status: "unverified" },
      { do: "dismiss — التحذير فقط", status: "unverified" },
    ],
    states: ["content"],
    offline: false,
    entitlementKey: null,
    featureStatus: "implemented",
    phase: 8,
  },

  // ============ surface: today ============
  {
    id: "today",
    kotlinRoute: null,
    surface: "today",
    purpose: "شغل النهارده: عدّادات، استهلاك الخطة، رابط الكتالوج، تنبيهات",
    entry: ["MainRoute — السطح الافتراضي"],
    exit: ["OrderDetailsRoute", "AnnouncementsRoute", "SubscriptionRoute", "مشاركة الكتالوج"],
    data: ["today counters", "entitlement usage", "catalog link", "unread announcements", "billing notices"],
    actions: [
      { do: "pull to refresh", via: "onRefresh" },
      { do: "share catalog", via: "productsForShare" },
      // Was `{ do: "open order", status: "unverified" }`, and the doubt was
      // earned: no counter opened an order, and all three opened the same
      // unfiltered list. Each now opens the orders it counts.
      { do: "open filtered orders", via: "onOpenCounter" },
      { do: "retry a failed plan refresh", via: "onRetry" },
      { do: "open announcements", via: "onOpenAnnouncements" },
    ],
    states: ["loading", "content", "empty", "error"],
    offline: true,
    entitlementKey: null,
    featureStatus: "implemented",
    phase: 8,
  },

  // ============ surface: orders ============
  {
    id: "orders",
    kotlinRoute: null,
    surface: "orders",
    purpose: "قائمة الطلبات مرتّبة بالأولوية: محتاج تصرّف قبل اللي خلص",
    entry: ["MainRoute — تاب الطلبات", "today — فتح طلب"],
    exit: ["OrderDetailsRoute", "NewOrderRoute"],
    data: ["orders page", "status filters", "sync state"],
    actions: [
      { do: "filter by status", via: "setFilter" },
      { do: "open order", via: "onOpen" },
      { do: "create manual order", via: "onNew" },
      // Demoted from unverified to planned: there is no PullToRefreshBox on this
      // screen and never was. The list is a Room flow, so it updates itself and a
      // gesture would refresh nothing the seller can see — اليوم carries the pull
      // because its plan usage genuinely comes from the network.
      { do: "pull to refresh", status: "planned", why: "the list is a Room flow; no refresh gesture exists" },
    ],
    states: ["loading", "content", "empty", "error"],
    offline: true,
    entitlementKey: "max_orders_per_month",
    featureStatus: "implemented",
    phase: 7,
  },
  {
    id: "order-details",
    kotlinRoute: "OrderDetailsRoute",
    surface: "orders",
    purpose: "تفاصيل الطلب وتقدّم حالته وتأكيد الدفع",
    entry: ["orders", "today", "customer-details", "NewOrderRoute — بعد الإنشاء"],
    exit: ["CustomerRoute", "رجوع"],
    data: ["order", "line items", "customer", "status history", "payment state"],
    actions: [
      // Both were real and had simply never been traced to a symbol.
      { do: "advance status", via: "advance" },
      { do: "reject", via: "cancel" },
      { do: "mark paid", via: "markPaidManually" },
      { do: "open customer", via: "onOpenCustomer" },
    ],
    states: ["loading", "content", "error"],
    offline: true,
    entitlementKey: null,
    featureStatus: "implemented",
    phase: 7,
  },
  {
    id: "new-order",
    kotlinRoute: "NewOrderRoute",
    surface: "orders",
    purpose: "تسجيل طلب يدوي للبيع اللي بيحصل برّه الكتالوج",
    entry: ["orders", "today"],
    exit: ["OrderDetailsRoute — بعد الإنشاء، مع popUpTo", "رجوع"],
    data: ["product picker", "customer lookup", "order limit usage"],
    actions: [
      { do: "add line", via: "changeQty" },
      { do: "set customer", via: "onPhone" },
      { do: "submit", via: "save" },
    ],
    states: ["content", "loading", "error"],
    offline: true,
    entitlementKey: "max_orders_per_month",
    featureStatus: "implemented",
    phase: 7,
  },

  // ============ surface: store ============
  {
    id: "store",
    kotlinRoute: null,
    surface: "store",
    purpose: "الكتالوج: المنتجات والتصنيفات والواجهة العامة",
    entry: ["MainRoute — تاب المتجر"],
    exit: ["ProductEditRoute", "CategoriesRoute", "StoreInfoRoute", "PaywallRoute — عند الحد"],
    data: ["products page", "product limit usage", "category count"],
    actions: [
      { do: "add product", via: "onAdd" },
      { do: "edit product", via: "onEdit" },
      { do: "search", via: "SearchField" },
      { do: "open categories", status: "planned", why: "the entry lives on the account surface, not here" },
    ],
    states: ["loading", "content", "empty", "error"],
    offline: true,
    entitlementKey: "max_products",
    featureStatus: "implemented",
    phase: 6,
  },
  {
    id: "product-edit",
    kotlinRoute: "ProductEditRoute",
    surface: "store",
    purpose: "إنشاء وتعديل منتج بصوره وسعره ومخزونه",
    entry: ["store — إضافة أو تعديل"],
    exit: ["رجوع", "PaywallRoute — إنشاء عند الحد"],
    data: ["product", "categories", "media upload state", "product limit usage"],
    actions: [
      { do: "save", via: "save" },
      { do: "upload image", via: "onImagePicked" },
      { do: "set category", via: "onCategory" },
      { do: "publish/hide", via: "onAvailable" },
      { do: "delete", via: "delete" },
    ],
    states: ["loading", "content", "error"],
    offline: true,
    entitlementKey: "max_products",
    featureStatus: "implemented",
    phase: 6,
  },
  {
    id: "categories",
    kotlinRoute: "CategoriesRoute",
    surface: "store",
    purpose: "إدارة تصنيفات الكتالوج",
    entry: ["store", "product-edit"],
    exit: ["رجوع"],
    data: ["categories", "category limit usage"],
    actions: [
      { do: "add", via: "create" },
      // Was unverified, and the doubt was earned: `rename` existed on the view
      // model since it was written and no screen ever offered it, so a typo in a
      // category name was permanent — the only way out was deleting the
      // category, which takes its products' filing with it.
      { do: "rename", via: "pendingRename" },
      { do: "reorder", status: "planned", why: "no ordering control exists on the screen" },
      { do: "delete", via: "delete" },
    ],
    states: ["loading", "content", "empty", "error"],
    offline: true,
    entitlementKey: "max_categories",
    featureStatus: "implemented",
    phase: 6,
  },
  {
    id: "store-info",
    kotlinRoute: "StoreInfoRoute",
    surface: "store",
    purpose: "هوية المتجر العامة: الاسم واللوجو والتصنيف والمدينة والرابط",
    entry: ["store", "account"],
    exit: ["رجوع"],
    data: ["store profile", "business subcategories", "slug", "logo"],
    actions: [
      { do: "save", via: "save" },
      { do: "upload logo", via: "uploadImage" },
      { do: "copy link", status: "unverified" },
    ],
    states: ["loading", "content", "error"],
    offline: false,
    entitlementKey: null,
    featureStatus: "implemented",
    phase: 6,
  },
  {
    id: "catalog-languages",
    kotlinRoute: "CatalogLanguagesRoute",
    surface: "store",
    purpose: "مراجعة ترجمات الكتالوج واعتمادها",
    entry: ["account", "store"],
    exit: ["رجوع"],
    data: ["translations", "provenance", "supported locales"],
    actions: [
      { do: "approve", via: "saveTranslation" },
      { do: "edit translation", via: "saveTranslation" },
      // No control, no view-model call, no endpoint reached from here.
      { do: "request retranslation", status: "planned", why: "no retranslation control exists on the screen" },
    ],
    states: ["loading", "content", "empty", "error"],
    offline: false,
    entitlementKey: "language_localization.seller_translation_review",
    featureStatus: "implemented",
    phase: 10,
  },

  // ============ surface: customers ============
  {
    id: "customers",
    kotlinRoute: null,
    surface: "customers",
    purpose: "قائمة العملاء وقيمتهم وآخر تعامل",
    entry: ["MainRoute — تاب العملاء"],
    exit: ["CustomerRoute"],
    data: ["customers page", "aggregate spend"],
    actions: [
      { do: "search", via: "SearchField" },
      { do: "open customer", via: "onOpen" },
    ],
    states: ["loading", "content", "empty", "error"],
    offline: true,
    entitlementKey: null,
    featureStatus: "implemented",
    phase: 8,
  },
  {
    id: "customer-details",
    kotlinRoute: "CustomerRoute",
    surface: "customers",
    purpose: "ملف العميل وسجل طلباته",
    entry: ["customers", "order-details"],
    exit: ["OrderDetailsRoute", "رجوع"],
    data: ["customer", "order history", "contact", "edit availability"],
    actions: [
      { do: "open order", via: "onOpenOrder" },
      { do: "contact", via: "contactCustomer" },
      { do: "edit", via: "save" },
    ],
    states: ["loading", "content", "error"],
    offline: true,
    // The editor is a paid feature. The gate resolves fail-closed, so a seller
    // with no snapshot sees the fields read-only rather than editable.
    entitlementKey: "customers_crm.editable_customer_profiles",
    featureStatus: "implemented",
    phase: 8,
  },

  // ============ surface: account ============
  {
    id: "account",
    kotlinRoute: null,
    surface: "account",
    // Rewritten from SettingsScreen.kt on 2026-09-05. The previous version
    // described four groups, listed nine exits and named two actions; the screen
    // has six sections, ten exits and six actions. It had drifted quietly because
    // verify-screen-contracts.mjs checks routes, states, entitlement keys and
    // exit targets, and has never checked `actions` at all.
    purpose: "ست مجموعات: الخطة · المتجر والهوية · الدعم · الأجهزة والاشتراك · بيانات التحصيل · إجراءات الحساب",
    entry: ["MainRoute — تاب حسابي"],
    exit: [
      "SellerProfileRoute", "StoreInfoRoute", "CategoriesRoute", "CatalogLanguagesRoute",
      "SubscriptionRoute", "DevicesRoute", "SupportRoute",
      "AnnouncementsRoute", "AiAssistantRoute", "DeletionStatusRoute",
    ],
    data: [
      "seller profile", "plan summary", "entitlement states for every entry",
      "public slug", "payout handles (InstaPay, Vodafone Cash)",
    ],
    actions: [
      { do: "open group entry", via: "onOpenStoreInfo" },
      { do: "save payout and slug", via: "savePayout" },
      // Both were real and untraced: the language sheet is behind `showLanguage`
      // and account deletion behind `requestAccountDeletion`.
      { do: "switch language", via: "showLanguage" },
      { do: "purchase plan", via: "purchase" },
      { do: "delete account", via: "requestAccountDeletion" },
      { do: "sign out", via: "onLogout" },
    ],
    states: ["content", "loading"],
    offline: true,
    entitlementKey: null,
    featureStatus: "implemented",
    phase: 8,
  },
  {
    id: "seller-profile",
    kotlinRoute: "SellerProfileRoute",
    surface: "account",
    purpose: "بيانات البائع الشخصية",
    entry: ["account"],
    exit: ["رجوع"],
    data: ["seller profile", "verified phone", "email verification state"],
    actions: [
      { do: "save", via: "save" },
      { do: "resend email verification", via: "resendEmailVerification" },
    ],
    states: ["loading", "content", "error"],
    offline: false,
    entitlementKey: null,
    featureStatus: "implemented",
    phase: 10,
  },
  {
    id: "devices",
    kotlinRoute: "DevicesRoute",
    surface: "account",
    purpose: "الأجهزة النشطة ومفاتيح المرور، وإنهاء الجلسات",
    entry: ["account"],
    exit: ["رجوع"],
    data: ["devices", "passkeys", "device limit usage"],
    actions: [
      { do: "revoke device", via: "revokeDevice" },
      // Was via "onAdd", a parameter name of the header composable rather than
      // the operation. Splitting DevicesContent out moved that parameter, and
      // the guard caught it. `createPasskey` is what actually carries the
      // action and is what its two siblings above and below already name.
      { do: "add passkey", via: "createPasskey" },
      { do: "remove passkey", via: "deletePasskey" },
    ],
    states: ["loading", "content", "error"],
    offline: false,
    entitlementKey: "max_concurrent_devices",
    featureStatus: "implemented",
    phase: 10,
  },
  {
    id: "support",
    kotlinRoute: "SupportRoute",
    surface: "account",
    purpose: "تذاكر الدعم الخاصة بالبائع",
    entry: ["account", "restricted-account"],
    exit: ["SupportTicketRoute", "رجوع"],
    data: ["tickets"],
    actions: [
      { do: "open ticket", via: "onTicket" },
      { do: "create ticket", via: "createTicket" },
    ],
    states: ["loading", "content", "empty", "error"],
    offline: false,
    entitlementKey: "support_service.in_app_support_tickets",
    featureStatus: "implemented",
    phase: 10,
  },
  {
    id: "support-ticket",
    kotlinRoute: "SupportTicketRoute",
    surface: "account",
    purpose: "محادثة تذكرة دعم واحدة",
    entry: ["support"],
    exit: ["رجوع"],
    data: ["ticket", "messages"],
    actions: [
      { do: "reply", via: "reply" },
      // The screen only HIDES the reply box when a ticket is already closed;
      // nothing on it closes one. Reading a status is not an action.
      { do: "close", status: "planned", why: "the screen reads closed status but offers no control to close" },
    ],
    states: ["loading", "content", "error"],
    offline: false,
    entitlementKey: "support_service.in_app_support_tickets",
    featureStatus: "implemented",
    phase: 10,
  },
  {
    id: "announcements",
    kotlinRoute: "AnnouncementsRoute",
    surface: "account",
    purpose: "إعلانات المنصّة الموجّهة للبائع",
    entry: ["account", "today — مؤشر غير مقروء"],
    exit: ["رجوع"],
    data: ["announcements", "read state"],
    actions: [
      { do: "mark read", via: "markAnnouncementRead" },
      // Announcements carry no link control — tapping one marks it read.
      { do: "open link", status: "planned", why: "announcements render text only; no link affordance exists" },
    ],
    states: ["loading", "content", "empty", "error"],
    offline: false,
    entitlementKey: null,
    featureStatus: "implemented",
    phase: 10,
  },
  {
    id: "deletion-status",
    kotlinRoute: "DeletionStatusRoute",
    surface: "account",
    purpose: "حالة طلب حذف الحساب ومواعيده",
    entry: ["account"],
    exit: ["رجوع"],
    data: ["deletion request", "deadline", "provider state"],
    actions: [
      { do: "request deletion", status: "planned", why: "the screen reports status only; there is no control" },
      { do: "cancel request", status: "planned", why: "the screen reports status only; there is no control" },
    ],
    states: ["loading", "content", "error"],
    offline: false,
    entitlementKey: null,
    featureStatus: "implemented",
    phase: 10,
  },
  {
    id: "ai-assistant",
    kotlinRoute: "AiAssistantRoute",
    surface: "account",
    purpose: "المساعد الذكي — محكوم بعلم نشر ومقفول حالياً",
    entry: ["account"],
    exit: ["رجوع"],
    data: ["AI enablement flag", "quota usage", "published prompt"],
    actions: [
      { do: "send message", via: "sendChat" },
    ],
    states: ["loading", "content", "empty", "error"],
    offline: false,
    entitlementKey: "max_ai_requests_per_month",
    featureStatus: "implemented",
    phase: 10,
  },

  // ============ subscription surfaces ============
  {
    id: "subscription",
    kotlinRoute: "SubscriptionRoute",
    surface: "account",
    purpose: "الخطة الحالية والاستهلاك مقابل الحدود",
    entry: ["account", "today — لافتة الخطة", "paywall"],
    exit: ["PlansRoute", "رجوع"],
    data: ["subscription status", "entitlement usage", "billing flag state"],
    actions: [
      // The `planned` reason had gone stale: PlansRoute was built and wired, and
      // PaywallScreen reached it — but this screen, which declares it as an exit,
      // never did. Its purchase-closed banner told a seller purchasing was shut
      // and offered nothing, while the plans comparison exists precisely to be
      // read in that state.
      { do: "view plans", via: "onViewPlans" },
      // Demoted from unverified to planned: there is no control, no string and
      // no backend endpoint. Collecting interest means contacting those sellers
      // later, which is a product decision rather than a wiring gap.
      { do: "register interest", status: "planned", why: "no notify-me control or endpoint exists" },
      { do: "restore purchase", via: "recoverPurchases" },
    ],
    states: ["loading", "content", "error"],
    offline: true,
    entitlementKey: null,
    featureStatus: "implemented",
    phase: 9,
  },
  {
    id: "plans",
    kotlinRoute: "PlansRoute",
    surface: "account",
    purpose: "مقارنة الخطط الأربع بالحدود المعتمدة — للعرض طول ما الشراء مقفول",
    entry: ["subscription", "paywall"],
    exit: ["رجوع"],
    data: ["plan catalogue", "current plan", "billing flag state"],
    actions: [
      { do: "compare plans", via: "PlanComparison" },
    ],
    states: ["loading", "content", "error"],
    offline: false,
    entitlementKey: null,
    featureStatus: "implemented",
    phase: 9,
  },
  {
    id: "paywall",
    kotlinRoute: "PaywallRoute",
    surface: "account",
    purpose: "لحظة الوصول لحد الخطة — بتنتهي عند «بلّغني» مش عند دفع",
    entry: ["store — إضافة عند الحد", "product-edit", "categories", "new-order", "devices"],
    exit: ["PlansRoute", "رجوع للشاشة اللي جت منها"],
    data: ["which limit", "current usage", "next plan limits", "billing flag state"],
    actions: [
      { do: "view plans", via: "onViewPlans" },
      { do: "dismiss", via: "onBack" },
    ],
    states: ["content"],
    offline: false,
    entitlementKey: null,
    featureStatus: "implemented",
    phase: 9,
  },
];

/**
 * Actions declared in a contract, present in the design, and not yet tied to a
 * symbol in their screen's composable body.
 *
 * WHY THIS EXISTS AND WHY IT IS NOT A LOOPHOLE
 *   Most of these are real and simply delegated: AuthScreen is thirteen lines
 *   that hands off to sub-composables, so "request OTP" is genuinely there and
 *   the anchor is one level down. Tracing all twenty-five properly is a screen
 *   reading exercise, and guessing an anchor to clear the list would be the
 *   fabrication this whole mechanism exists to stop.
 *
 *   So they are recorded instead. The verifier fails if this set GROWS: a new
 *   action must name a `via` or declare itself planned. It can only shrink.
 *   A stale entry — one that now has a `via` — fails too, so the list cannot
 *   quietly outlive the debt.
 *
 * HOW TO REMOVE ONE
 *   Open the screen, find the handler that performs the action, and replace
 *   `status: "unverified"` with `via: "thatSymbol"`. If the handler does not
 *   exist, it is `status: "planned"` with a reason, not an unverified entry.
 */
export const UNVERIFIED_ACTIONS = new Set([
  // Traced to a real control that lives in a CHILD composable, so no symbol
  // in the named screen's own body carries it. Kept here rather than given a
  // via this check would be wrong to accept.
  "auth:switch language",
  "shop-setup:see slug availability",
  "shop-setup:select city",
  "version-governance:update",
  "version-governance:dismiss — التحذير فقط",
  "store-info:copy link",
]);

/**
 * Composables that do not follow the id-to-ScreenName convention, so the
 * verifier cannot find them by name alone. Tabs have no route and no screen of
 * their own; the version gate is a private composable inside the shell.
 */
/**
 * Where a contract's actions actually live, when that is not `<Id>Screen`.
 *
 * These are not aliases for convenience. Each one records that the screen a
 * seller reaches is a Hilt-wired wrapper, and the composable that decides what
 * is drawn — and therefore the one whose body can be checked — is somewhere
 * else. `store` moved here when `ProductsScreen` was split so its states could
 * be rendered by a preview at all; the guard caught the move on the same
 * commit, which is the behaviour worth keeping.
 */
export const ACTION_SOURCE = {
  "main-shell": "MainScreen",
  "version-governance": "VersionBlockingScreen",
  today: "DashboardTab",
  store: "StoreContent",
  customers: "CustomersContent",
  "restricted-account": "RestrictedAccountContent",
  plans: "PlansContent",
  account: "SettingsScreen",
};
