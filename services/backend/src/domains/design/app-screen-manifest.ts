/**
 * Defines a screen in the Android app navigation graph.
 * Used by the admin panel to track design/development progress
 * and to render a tree view of screen navigation sequences.
 */
export interface AppScreenManifestItem {
	name: string;
	description: string;
	/** Kotlin route constant (e.g. 'MainRoute', 'AuthRoute') */
	android_route: string;
	/** Display ordering in the tree (lower = first) */
	sort_order: number;
	/**
	 * Android route of the parent screen in the navigation flow.
	 * Forms the tree hierarchy: Splash -> Sign In -> Shop Setup -> Dashboard -> tab screens.
	 * null = root screen (Splash).
	 */
	parent_route: string | null;
	/**
	 * Which of the five surfaces this screen belongs to. A tree says what sits
	 * under what; it does not say which part of the product a screen is.
	 */
	surface: AppSurface;
	/**
	 * What actually moves a seller between screens. `parent_route` cannot express
	 * this: a tree has no room for a trigger or a condition, which is why the
	 * documented "valid cached session goes Splash -> Dashboard directly" branch
	 * was unrepresentable while Dashboard's recorded parent was Shop Setup.
	 */
	transitions: AppScreenTransition[];
	/**
	 * The states this screen actually has, from its contract. Not every screen
	 * has four: Splash has no empty state and no content of its own. The
	 * screenshot suite asserts coverage of exactly what is declared here.
	 */
	states: AppScreenState[];
	/**
	 * True when the screen keeps rendering cached content under an offline
	 * banner instead of falling to an error state.
	 */
	offline_capable: boolean;
	/**
	 * The catalogue feature key that gates this screen, or null when it is
	 * ungated. The KEY only: per-plan values live in D1 as versioned revisions,
	 * and copying them here would recreate the drift this field exists to close.
	 */
	entitlement_key: string | null;
	/** Mirrors implementation_status in the plan catalogue. */
	feature_status: "implemented" | "planned";
}

export type AppSurface = "today" | "orders" | "store" | "customers" | "account";
export type AppScreenState = "loading" | "content" | "empty" | "error";

export interface AppScreenTransition {
	/** Destination android_route, or a synthetic surface key. */
	to: string;
	/** What the seller did, or what the app observed. */
	trigger: string;
	/** When this edge is taken rather than a sibling. */
	condition?: string;
}

// Generated from navigation/Routes.kt, OrderakNavHost.kt, and MainScreen tabs.
// Keep route keys stable: the admin sync uses them as screen identities.
export const APP_SCREEN_MANIFEST: AppScreenManifestItem[] = [
	{ name: "Splash", description: "Startup and destination routing", android_route: "SplashRoute", sort_order: 10, parent_route: null, surface: "today", transitions: [{ to: "MainRoute", trigger: "startup", condition: "valid server session" }, { to: "AuthRoute", trigger: "startup", condition: "no session" }, { to: "RestrictedAccountRoute", trigger: "startup", condition: "account restricted" }], states: ["loading", "error"], offline_capable: false, entitlement_key: null, feature_status: "implemented" },
	{ name: "Sign In", description: "Seller authentication", android_route: "AuthRoute", sort_order: 20, parent_route: "SplashRoute", surface: "today", transitions: [{ to: "MainRoute", trigger: "passkey sign-in" }, { to: "MainRoute", trigger: "OTP verified", condition: "store exists" }, { to: "ShopSetupRoute", trigger: "OTP verified", condition: "new seller" }, { to: "AuthRoute", trigger: "OTP verified", condition: "code invalid or expired" }], states: ["loading", "content", "error"], offline_capable: false, entitlement_key: null, feature_status: "implemented" },
	{ name: "Shop Setup", description: "Initial store configuration", android_route: "ShopSetupRoute", sort_order: 30, parent_route: "AuthRoute", surface: "account", transitions: [{ to: "MainRoute", trigger: "store created" }, { to: "AuthRoute", trigger: "back", condition: "draft retained" }], states: ["loading", "content", "error"], offline_capable: false, entitlement_key: null, feature_status: "implemented" },
	{ name: "Dashboard", description: "Main application shell", android_route: "MainRoute", sort_order: 40, parent_route: "ShopSetupRoute", surface: "today", transitions: [{ to: "MainRoute#orders", trigger: "select surface" }, { to: "MainRoute#products", trigger: "select surface" }, { to: "MainRoute#customers", trigger: "select surface" }, { to: "SettingsRoute", trigger: "select surface" }, { to: "MainRoute#version-governance", trigger: "version policy not ok" }], states: ["content"], offline_capable: false, entitlement_key: null, feature_status: "implemented" },
	{ name: "Orders", description: "Order list in the main shell", android_route: "MainRoute#orders", sort_order: 50, parent_route: "MainRoute", surface: "orders", transitions: [{ to: "OrderDetailsRoute", trigger: "open order" }, { to: "NewOrderRoute", trigger: "create manual order" }], states: ["loading", "content", "empty", "error"], offline_capable: true, entitlement_key: "max_orders_per_month", feature_status: "implemented" },
	{ name: "Products", description: "Product list in the main shell", android_route: "MainRoute#products", sort_order: 60, parent_route: "MainRoute", surface: "store", transitions: [{ to: "ProductEditRoute", trigger: "add product", condition: "under plan limit" }, { to: "PaywallRoute", trigger: "add product", condition: "at plan limit" }, { to: "ProductEditRoute", trigger: "edit product" }, { to: "CategoriesRoute", trigger: "open categories" }], states: ["loading", "content", "empty", "error"], offline_capable: true, entitlement_key: "max_products", feature_status: "implemented" },
	{ name: "Customers", description: "Customer list in the main shell", android_route: "MainRoute#customers", sort_order: 70, parent_route: "MainRoute", surface: "customers", transitions: [{ to: "CustomerRoute", trigger: "open customer" }], states: ["loading", "content", "empty", "error"], offline_capable: true, entitlement_key: null, feature_status: "implemented" },
	{ name: "Product Editor", description: "Create or edit a product", android_route: "ProductEditRoute", sort_order: 80, parent_route: "MainRoute#products", surface: "store", transitions: [{ to: "MainRoute#products", trigger: "save or back" }, { to: "PaywallRoute", trigger: "save", condition: "creating at plan limit" }], states: ["loading", "content", "error"], offline_capable: true, entitlement_key: "max_products", feature_status: "implemented" },
	{ name: "New Order", description: "Manual order creation", android_route: "NewOrderRoute", sort_order: 90, parent_route: "MainRoute#orders", surface: "orders", transitions: [{ to: "OrderDetailsRoute", trigger: "order created" }, { to: "MainRoute#orders", trigger: "back" }], states: ["loading", "content", "error"], offline_capable: true, entitlement_key: "max_orders_per_month", feature_status: "implemented" },
	{ name: "Order Details", description: "Order detail and status", android_route: "OrderDetailsRoute", sort_order: 100, parent_route: "MainRoute#orders", surface: "orders", transitions: [{ to: "CustomerRoute", trigger: "open customer" }, { to: "MainRoute#orders", trigger: "back" }], states: ["loading", "content", "error"], offline_capable: true, entitlement_key: null, feature_status: "implemented" },
	{ name: "Customer Details", description: "Customer profile and order history", android_route: "CustomerRoute", sort_order: 110, parent_route: "MainRoute#customers", surface: "customers", transitions: [{ to: "OrderDetailsRoute", trigger: "open order" }, { to: "MainRoute#customers", trigger: "back" }], states: ["loading", "content", "error"], offline_capable: true, entitlement_key: null, feature_status: "implemented" },
	{ name: "Settings", description: "Application settings", android_route: "SettingsRoute", sort_order: 120, parent_route: "MainRoute", surface: "account", transitions: [{ to: "StoreInfoRoute", trigger: "open entry" }, { to: "SellerProfileRoute", trigger: "open entry" }, { to: "CatalogLanguagesRoute", trigger: "open entry" }, { to: "SubscriptionRoute", trigger: "open entry" }, { to: "DevicesRoute", trigger: "open entry" }, { to: "SupportRoute", trigger: "open entry" }, { to: "AnnouncementsRoute", trigger: "open entry" }, { to: "AiAssistantRoute", trigger: "open entry" }, { to: "DeletionStatusRoute", trigger: "open entry" }, { to: "AuthRoute", trigger: "sign out" }], states: ["loading", "content"], offline_capable: true, entitlement_key: null, feature_status: "implemented" },
	{ name: "Store Information", description: "Store identity and public details", android_route: "StoreInfoRoute", sort_order: 130, parent_route: "SettingsRoute", surface: "store", transitions: [{ to: "SettingsRoute", trigger: "back" }], states: ["loading", "content", "error"], offline_capable: false, entitlement_key: null, feature_status: "implemented" },
	{ name: "Categories", description: "Product category management", android_route: "CategoriesRoute", sort_order: 140, parent_route: "SettingsRoute", surface: "store", transitions: [{ to: "MainRoute#products", trigger: "back" }, { to: "PaywallRoute", trigger: "add category", condition: "at plan limit" }], states: ["loading", "content", "empty", "error"], offline_capable: true, entitlement_key: "max_categories", feature_status: "implemented" },
	{ name: "Restricted Account", description: "Stable suspended or banned account state", android_route: "RestrictedAccountRoute", sort_order: 150, parent_route: "SplashRoute", surface: "account", transitions: [{ to: "SupportRoute", trigger: "contact support" }, { to: "AuthRoute", trigger: "sign out" }], states: ["content"], offline_capable: false, entitlement_key: null, feature_status: "implemented" },
	{ name: "Support", description: "Seller support ticket list and creation", android_route: "SupportRoute", sort_order: 160, parent_route: "SettingsRoute", surface: "account", transitions: [{ to: "SupportTicketRoute", trigger: "open ticket" }, { to: "SettingsRoute", trigger: "back" }], states: ["loading", "content", "empty", "error"], offline_capable: false, entitlement_key: "support_service.in_app_support_tickets", feature_status: "implemented" },
	{ name: "Support Ticket", description: "Threaded support conversation", android_route: "SupportTicketRoute", sort_order: 170, parent_route: "SupportRoute", surface: "account", transitions: [{ to: "SupportRoute", trigger: "back" }], states: ["loading", "content", "error"], offline_capable: false, entitlement_key: "support_service.in_app_support_tickets", feature_status: "implemented" },
	{ name: "Announcements", description: "Targeted seller announcements", android_route: "AnnouncementsRoute", sort_order: 180, parent_route: "SettingsRoute", surface: "account", transitions: [{ to: "SettingsRoute", trigger: "back" }], states: ["loading", "content", "empty", "error"], offline_capable: false, entitlement_key: null, feature_status: "implemented" },
	{ name: "Catalog Languages", description: "Arabic and English product translation review", android_route: "CatalogLanguagesRoute", sort_order: 190, parent_route: "SettingsRoute", surface: "store", transitions: [{ to: "SettingsRoute", trigger: "back" }], states: ["loading", "content", "empty", "error"], offline_capable: false, entitlement_key: "language_localization.seller_translation_review", feature_status: "implemented" },
	{ name: "Devices", description: "Account device and session management", android_route: "DevicesRoute", sort_order: 200, parent_route: "SettingsRoute", surface: "account", transitions: [{ to: "SettingsRoute", trigger: "back" }, { to: "PaywallRoute", trigger: "add device", condition: "at plan limit" }], states: ["loading", "content", "error"], offline_capable: false, entitlement_key: "max_concurrent_devices", feature_status: "implemented" },
	{ name: "Seller Profile", description: "Seller personal details and email verification", android_route: "SellerProfileRoute", sort_order: 205, parent_route: "SettingsRoute", surface: "account", transitions: [{ to: "SettingsRoute", trigger: "back" }], states: ["loading", "content", "error"], offline_capable: false, entitlement_key: null, feature_status: "implemented" },
	{ name: "Deletion Status", description: "Account deletion request lifecycle", android_route: "DeletionStatusRoute", sort_order: 210, parent_route: "SettingsRoute", surface: "account", transitions: [{ to: "SettingsRoute", trigger: "back" }], states: ["loading", "content", "error"], offline_capable: false, entitlement_key: null, feature_status: "implemented" },
	{ name: "Subscription", description: "Subscription status and Play management guidance", android_route: "SubscriptionRoute", sort_order: 220, parent_route: "SettingsRoute", surface: "account", transitions: [{ to: "PlansRoute", trigger: "view plans" }, { to: "SettingsRoute", trigger: "back" }], states: ["loading", "content", "error"], offline_capable: true, entitlement_key: null, feature_status: "implemented" },
	{ name: "AI Assistant", description: "Entitlement and deployment-gated seller assistant", android_route: "AiAssistantRoute", sort_order: 230, parent_route: "SettingsRoute", surface: "account", transitions: [{ to: "SettingsRoute", trigger: "back" }], states: ["loading", "content", "empty", "error"], offline_capable: false, entitlement_key: "max_ai_requests_per_month", feature_status: "implemented" },
	{ name: "App Version Governance", description: "Warning, grace, forced-update, denial and maintenance states", android_route: "MainRoute#version-governance", sort_order: 240, parent_route: "MainRoute", surface: "today", transitions: [{ to: "MainRoute", trigger: "dismiss", condition: "warning mode only" }], states: ["content"], offline_capable: false, entitlement_key: null, feature_status: "implemented" },
];
