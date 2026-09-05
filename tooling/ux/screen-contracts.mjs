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
 *                control at all, and `subscription` points at a Plans screen
 *                that does not exist.
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
      { do: "request OTP", status: "unverified" },
      { do: "verify OTP", status: "unverified" },
      { do: "change number", status: "unverified" },
      { do: "resend", status: "unverified" },
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
      { do: "save account step", status: "unverified" },
      { do: "check slug", status: "unverified" },
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
      { do: "contact support", status: "unverified" },
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
      { do: "open order", status: "unverified" },
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
      { do: "pull to refresh", status: "unverified" },
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
      { do: "advance status", status: "unverified" },
      { do: "reject", via: "cancel" },
      { do: "mark paid", status: "unverified" },
      { do: "open customer", status: "unverified" },
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
      { do: "search", status: "planned", why: "work item 12 builds it" },
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
      { do: "rename", status: "unverified" },
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
      { do: "edit translation", status: "unverified" },
      { do: "request retranslation", status: "unverified" },
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
      { do: "search", status: "planned", why: "work item 12 builds it" },
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
    data: ["customer", "order history", "contact"],
    actions: [
      { do: "open order", via: "onOpenOrder" },
      { do: "contact", status: "planned", why: "work item 11 builds the editor" },
      { do: "edit", status: "planned", why: "work item 11 builds the editor" },
    ],
    states: ["loading", "content", "error"],
    offline: true,
    entitlementKey: null,
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
      { do: "switch language", status: "unverified" },
      { do: "purchase plan", via: "purchase" },
      { do: "delete account", status: "unverified" },
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
      { do: "add passkey", via: "onAdd" },
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
      { do: "close", status: "unverified" },
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
      { do: "open link", status: "unverified" },
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
      { do: "view plans", status: "planned", why: "PlansRoute does not exist yet — work item 08" },
      { do: "register interest", status: "unverified" },
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
      { do: "compare plans", status: "planned", why: "the screen does not exist yet — work item 08" },
    ],
    states: ["loading", "content", "error"],
    offline: false,
    entitlementKey: null,
    featureStatus: "planned",
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
      { do: "upgrade", status: "planned", why: "the screen does not exist yet — work item 08" },
      { do: "register interest", status: "planned", why: "the screen does not exist yet — work item 08" },
      { do: "dismiss", status: "planned", why: "the screen does not exist yet — work item 08" },
    ],
    states: ["content"],
    offline: false,
    entitlementKey: null,
    featureStatus: "planned",
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
  "auth:request OTP",
  "auth:verify OTP",
  "auth:change number",
  "auth:resend",
  "auth:switch language",
  "shop-setup:save account step",
  "shop-setup:check slug",
  "shop-setup:select city",
  "restricted-account:contact support",
  "version-governance:update",
  "version-governance:dismiss — التحذير فقط",
  "today:open order",
  "orders:pull to refresh",
  "order-details:advance status",
  "order-details:mark paid",
  "order-details:open customer",
  "categories:rename",
  "store-info:copy link",
  "catalog-languages:edit translation",
  "catalog-languages:request retranslation",
  "account:switch language",
  "account:delete account",
  "support-ticket:close",
  "announcements:open link",
  "subscription:register interest",
]);

/**
 * Composables that do not follow the id-to-ScreenName convention, so the
 * verifier cannot find them by name alone. Tabs have no route and no screen of
 * their own; the version gate is a private composable inside the shell.
 */
export const ACTION_SOURCE = {
  "main-shell": "MainScreen",
  "version-governance": "VersionBlockingScreen",
  today: "DashboardTab",
  store: "ProductsScreen",
  account: "SettingsScreen",
};
