/**
 * What the legacy plan model can honestly say about the entitlement catalogue.
 *
 * WHY THIS FILE EXISTS
 *   `ENTITLEMENTS_ENABLED` is false in both environments, so the policy engine
 *   has never served a seller. Before work item 03a the consequence was not that
 *   the app fell back to something simpler — it was that the app received no
 *   entitlement map at all: `GET /api/v1/entitlements` answered 503, the
 *   piggybacked plan config carried no `entitlements` key, and so every gate and
 *   every usage meter read an empty map. A resolver that fails closed on an
 *   empty map is correct and was doing its job; it had nothing to work with.
 *
 *   The compatibility layer therefore has to produce the same SHAPE the engine
 *   produces, out of the data the legacy plan model actually holds: same keys,
 *   same fields, same types, so that no client code has to know — or can tell —
 *   which side served it (I-4).
 *
 * WHAT IT DELIBERATELY DOES NOT DO
 *   It does not invent policy. The legacy `plans` table gates a handful of
 *   columns and nothing else, so every feature outside those columns is reported
 *   as available. That is the truth of what the app permits today, not a guess
 *   at what the engine will decide once it is on. Values may therefore change
 *   when the engine is enabled; the KEY SET must not, and that is the thing
 *   work item 03b asserts.
 *
 * WHY THE LIST IS HERE RATHER THAN READ FROM D1
 *   `entitlement_definitions` is seeded by migration 025, so reading it would
 *   make the legacy path depend on catalogue rows being present in every
 *   environment — the one dependency this path exists in order not to have.
 *   The drift that creates is answered by a test instead: entitlement
 *   projection specs compare this list against the source catalogue and fail
 *   naming any key that was added, removed or reclassified.
 *
 * WHY `customers_crm.editable_customer_profiles` IS PRESENT AGAIN
 *   It was held out of this list while migration 047 called it `implemented` in
 *   D1 and the screen rendered an order list with no edit control and no write
 *   path — the finding that put the behaviour axis into the evidence verifier.
 *   Work item 11 shipped the editor, the customers resource and a behaviour test
 *   that asserts an edit survives the sync after it, so the claim is now true and
 *   the key belongs in the snapshot. It is a paid feature: the free plan's row
 *   below is `disabled`, matching the plan revisions seeded by migration 025.
 */

export interface LegacyFeatureEntitlement {
	key: string;
	category: string;
	name: string;
	value_type: "boolean" | "integer" | "text" | "enum";
	display_value: string;
}

/**
 * Implemented catalogue features the legacy model reports on.
 *
 * Taken from the source catalogue's `implemented` set, minus the limit and ads
 * keys, which the snapshot derives from the plan row instead.
 */
export const LEGACY_FEATURE_ENTITLEMENTS: readonly LegacyFeatureEntitlement[] = [
	{ key: "essential_data_retention", category: "Plan limits", name: "Essential data retention", value_type: "text", display_value: "Full" },
	{ key: "products_catalog.product_creation_and_editing", category: "Products & catalog", name: "Product creation and editing", value_type: "boolean", display_value: "Included" },
	{ key: "products_catalog.product_descriptions", category: "Products & catalog", name: "Product descriptions", value_type: "boolean", display_value: "Included" },
	{ key: "products_catalog.public_orderak_catalog", category: "Products & catalog", name: "Public Orderak catalog", value_type: "boolean", display_value: "Included" },
	{ key: "orders_fulfilment.manual_order_creation", category: "Orders & fulfilment", name: "Manual order creation", value_type: "boolean", display_value: "Included" },
	{ key: "orders_fulfilment.public_catalog_orders", category: "Orders & fulfilment", name: "Public catalog orders", value_type: "boolean", display_value: "Included" },
	{ key: "orders_fulfilment.order_history", category: "Orders & fulfilment", name: "Order history", value_type: "boolean", display_value: "Included" },
	{ key: "orders_fulfilment.order_status_updates", category: "Orders & fulfilment", name: "Order status updates", value_type: "boolean", display_value: "Included" },
	{ key: "orders_fulfilment.paid_unpaid_tracking", category: "Orders & fulfilment", name: "Paid / unpaid tracking", value_type: "boolean", display_value: "Included" },
	{ key: "customers_crm.customer_list_and_order_history", category: "Customers & CRM", name: "Customer list and order history", value_type: "boolean", display_value: "Included" },
	{ key: "customers_crm.editable_customer_profiles", category: "Customers & CRM", name: "Editable customer profiles", value_type: "boolean", display_value: "Included" },
	{ key: "payments_finance.instapay_vodafone_cash_instructions", category: "Payments & finance", name: "InstaPay / Vodafone Cash instructions", value_type: "boolean", display_value: "Included" },
	{ key: "payments_finance.ocr_receipt_assistance", category: "Payments & finance", name: "OCR receipt assistance", value_type: "text", display_value: "Included" },
	{ key: "analytics_reporting.operational_dashboard", category: "Analytics & reporting", name: "Operational dashboard", value_type: "text", display_value: "Essential counts" },
	{ key: "ai_capabilities.basic_ai_assistance", category: "AI capabilities", name: "Basic AI assistance", value_type: "text", display_value: "Limited" },
	{ key: "team_security.owner_account", category: "Team & security", name: "Owner account", value_type: "boolean", display_value: "Included" },
	{ key: "team_security.multiple_owner_devices", category: "Team & security", name: "Multiple owner devices", value_type: "boolean", display_value: "Included" },
	{ key: "team_security.session_and_device_management", category: "Team & security", name: "Session and device management", value_type: "text", display_value: "Basic recovery" },
	{ key: "apis_automation.standard_orderak_backend", category: "APIs & automation", name: "Standard Orderak backend", value_type: "boolean", display_value: "Included" },
	{ key: "language_localization.arabic_seller_interface", category: "Language & localization", name: "Arabic seller interface", value_type: "boolean", display_value: "Included" },
	{ key: "language_localization.english_seller_interface", category: "Language & localization", name: "English seller interface", value_type: "boolean", display_value: "Included" },
	{ key: "language_localization.french_seller_interface", category: "Language & localization", name: "French seller interface", value_type: "boolean", display_value: "Included" },
	{ key: "language_localization.arabic_public_storefront", category: "Language & localization", name: "Arabic public storefront", value_type: "boolean", display_value: "Included" },
	{ key: "language_localization.english_public_storefront", category: "Language & localization", name: "English public storefront", value_type: "boolean", display_value: "Included" },
	{ key: "language_localization.seller_translation_review", category: "Language & localization", name: "Seller translation review", value_type: "text", display_value: "Included" },
	{ key: "support_service.in_app_support_tickets", category: "Support & service", name: "In-app support tickets", value_type: "boolean", display_value: "Included" },
];

/**
 * The one implemented feature the legacy plans table actually gates.
 *
 * `multi_device_enabled` is a real column with a real effect, so reporting this
 * key as universally available would promise a seller on a single-device plan
 * something the server then refuses.
 */
export const LEGACY_MULTI_DEVICE_KEY = "team_security.multiple_owner_devices";

/**
 * Implemented features the legacy plans table gates by the plan's existence
 * rather than by a column of its own.
 *
 * A seller with no row in `plans` is on free. The catalogue's plan revisions put
 * this key at `disabled` on free and `Included` on all three paid tiers, and
 * there is no legacy column that says so — so the gate is the plan row itself.
 * Reporting it as universally available would offer every free seller an editor
 * the plan comparison sells at paid1.
 */
export const LEGACY_PAID_ONLY_KEYS: readonly string[] = [
	"customers_crm.editable_customer_profiles",
];

/**
 * Integer limits the snapshot reports, each with the catalogue's own status.
 *
 * `max_team_members` is the reason this carries a status rather than being a
 * bare list of keys. The plan comparison shows a team-size row, the legacy
 * config has always sent a number for it, and nothing server-side enforces it —
 * so the catalogue calls it planned, and reporting it as implemented would have
 * been this file telling the app a limit is real when no code applies it. It is
 * still SENT, because the engine sends it too and the key sets have to match;
 * it is sent as planned, which the resolver reads as unbuilt.
 */
export const LEGACY_LIMIT_ENTITLEMENTS: readonly {
	key: string;
	implementation_status: "implemented" | "partial" | "planned";
}[] = [
	{ key: "max_products", implementation_status: "implemented" },
	{ key: "max_categories", implementation_status: "implemented" },
	{ key: "max_orders_per_month", implementation_status: "implemented" },
	{ key: "max_ai_requests_per_month", implementation_status: "implemented" },
	{ key: "max_concurrent_devices", implementation_status: "implemented" },
	{ key: "max_team_members", implementation_status: "planned" },
];

export const LEGACY_LIMIT_KEYS = LEGACY_LIMIT_ENTITLEMENTS.map((limit) => limit.key);
