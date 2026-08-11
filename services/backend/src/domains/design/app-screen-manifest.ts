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
	 * Forms the tree hierarchy: Splash → Sign In → Shop Setup → Dashboard → tab screens.
	 * null = root screen (Splash).
	 */
	parent_route: string | null;
}

// Generated from navigation/Routes.kt, OrderakNavHost.kt, and MainScreen tabs.
// Keep route keys stable: the admin sync uses them as screen identities.
export const APP_SCREEN_MANIFEST: AppScreenManifestItem[] = [
	{ name: "Splash", description: "Startup and destination routing", android_route: "SplashRoute", sort_order: 10, parent_route: null },
	{ name: "Sign In", description: "Seller authentication", android_route: "AuthRoute", sort_order: 20, parent_route: "SplashRoute" },
	{ name: "Shop Setup", description: "Initial store configuration", android_route: "ShopSetupRoute", sort_order: 30, parent_route: "AuthRoute" },
	{ name: "Dashboard", description: "Main application shell", android_route: "MainRoute", sort_order: 40, parent_route: "ShopSetupRoute" },
	{ name: "Orders", description: "Order list in the main shell", android_route: "MainRoute#orders", sort_order: 50, parent_route: "MainRoute" },
	{ name: "Products", description: "Product list in the main shell", android_route: "MainRoute#products", sort_order: 60, parent_route: "MainRoute" },
	{ name: "Customers", description: "Customer list in the main shell", android_route: "MainRoute#customers", sort_order: 70, parent_route: "MainRoute" },
	{ name: "Product Editor", description: "Create or edit a product", android_route: "ProductEditRoute", sort_order: 80, parent_route: "MainRoute#products" },
	{ name: "New Order", description: "Manual order creation", android_route: "NewOrderRoute", sort_order: 90, parent_route: "MainRoute#orders" },
	{ name: "Order Details", description: "Order detail and status", android_route: "OrderDetailsRoute", sort_order: 100, parent_route: "MainRoute#orders" },
	{ name: "Customer Details", description: "Customer profile and order history", android_route: "CustomerRoute", sort_order: 110, parent_route: "MainRoute#customers" },
	{ name: "Settings", description: "Application settings", android_route: "SettingsRoute", sort_order: 120, parent_route: "MainRoute" },
	{ name: "Store Information", description: "Store identity and public details", android_route: "StoreInfoRoute", sort_order: 130, parent_route: "SettingsRoute" },
	{ name: "Categories", description: "Product category management", android_route: "CategoriesRoute", sort_order: 140, parent_route: "SettingsRoute" },
	{ name: "Restricted Account", description: "Stable suspended or banned account state", android_route: "RestrictedAccountRoute", sort_order: 150, parent_route: "SplashRoute" },
	{ name: "Support", description: "Seller support ticket list and creation", android_route: "SupportRoute", sort_order: 160, parent_route: "SettingsRoute" },
	{ name: "Support Ticket", description: "Threaded support conversation", android_route: "SupportTicketRoute", sort_order: 170, parent_route: "SupportRoute" },
	{ name: "Announcements", description: "Targeted seller announcements", android_route: "AnnouncementsRoute", sort_order: 180, parent_route: "SettingsRoute" },
	{ name: "Catalog Languages", description: "Arabic and English product translation review", android_route: "CatalogLanguagesRoute", sort_order: 190, parent_route: "SettingsRoute" },
	{ name: "Devices", description: "Account device and session management", android_route: "DevicesRoute", sort_order: 200, parent_route: "SettingsRoute" },
	{ name: "Deletion Status", description: "Account deletion request lifecycle", android_route: "DeletionStatusRoute", sort_order: 210, parent_route: "SettingsRoute" },
	{ name: "Subscription", description: "Subscription status and Play management guidance", android_route: "SubscriptionRoute", sort_order: 220, parent_route: "SettingsRoute" },
	{ name: "AI Assistant", description: "Entitlement and deployment-gated seller assistant", android_route: "AiAssistantRoute", sort_order: 230, parent_route: "SettingsRoute" },
	{ name: "App Version Governance", description: "Warning, grace, forced-update, denial and maintenance states", android_route: "MainRoute#version-governance", sort_order: 240, parent_route: "MainRoute" },
];
