/**
 * Orderak — implementation evidence (PHASE 2).
 *
 * `implementation_status` in the plan catalogue is a CLAIM. Nothing verified it
 * against the code, and it had drifted in both directions: features shipping in
 * the app were still marked `planned`, and the "23 implemented" headline the
 * whole migration was framed around was wrong.
 *
 * This file makes the claim checkable. Every feature the catalogue marks
 * `implemented` must name evidence here, and the evidence must resolve. A
 * `planned` feature that names evidence is reported as a promotion candidate,
 * not silently promoted — status is a product decision, evidence is a fact.
 *
 * kind:
 *   screen    a Compose function in the Android app
 *   route     a @Serializable route in Routes.kt
 *   endpoint  a seller API path served by the Worker
 *   binding   an entitlement enforced in backend code
 *   resource  Android string resources for a locale
 *   module    a source file in the repository that implements the behaviour
 */

// key: { kind, value, note? }
export const EVIDENCE = {
  // ---- plan limits: enforced server-side through the entitlement engine ----
  "max_products":              { kind: "binding", value: "max_products" },
  "max_categories":            { kind: "binding", value: "max_categories" },
  "max_orders_per_month":      { kind: "binding", value: "max_orders_per_month" },
  "max_ai_requests_per_month": { kind: "binding", value: "max_ai_requests_per_month" },
  "max_concurrent_devices":    { kind: "binding", value: "max_concurrent_devices" },
  "show_ads":                  { kind: "endpoint", value: "/api/v1/ads/active" },
  // Not an entitlement binding despite the catalogue row: its binding is
  // `core_universal`, and the behaviour lives in the retention job.
  "essential_data_retention":  { kind: "module", value: "services/backend/src/domains/identity/retention.ts" },

  // ---- products & catalog ----
  "products_catalog.product_creation_and_editing": { kind: "screen", value: "ProductEditScreen" },
  "products_catalog.product_descriptions":         { kind: "screen", value: "ProductEditScreen" },
  "products_catalog.public_orderak_catalog":       { kind: "endpoint", value: "/api/v1/store" },

  // ---- orders & fulfilment ----
  "orders_fulfilment.manual_order_creation": { kind: "screen", value: "NewOrderScreen" },
  "orders_fulfilment.public_catalog_orders": { kind: "endpoint", value: "/api/v1/orders" },
  "orders_fulfilment.order_history":         { kind: "screen", value: "OrdersScreen" },
  "orders_fulfilment.order_status_updates":  { kind: "screen", value: "OrderDetailsScreen" },
  "orders_fulfilment.paid_unpaid_tracking":  { kind: "screen", value: "OrderDetailsScreen" },

  // ---- payments & finance ----
  // The seller picks a transfer screenshot, ML Kit reads it, and the amount is
  // matched against the order total. Built since before the migration; the
  // catalogue said "planned" until the gate migration went looking for its key.
  "payments_finance.ocr_receipt_assistance": {
    kind: "module",
    value: "apps/seller-android/app/src/main/java/app/orderak/seller/feature/payment/PaymentVerifier.kt",
  },

  // ---- team & security ----
  "team_security.owner_account":          { kind: "screen", value: "SellerProfileScreen" },
  "team_security.multiple_owner_devices": { kind: "route", value: "DevicesRoute" },

  // ---- APIs ----
  "apis_automation.standard_orderak_backend": { kind: "endpoint", value: "/api/v1/config" },

  // ---- localisation ----
  "language_localization.arabic_seller_interface":   { kind: "resource", value: "values-ar" },
  "language_localization.english_seller_interface":  { kind: "resource", value: "values-en" },
  "language_localization.french_seller_interface":   { kind: "resource", value: "values-fr" },
  "language_localization.arabic_public_storefront":  { kind: "endpoint", value: "/api/v1/store" },
  "language_localization.english_public_storefront": { kind: "endpoint", value: "/api/v1/store" },

  // ================================================================
  // Promotion candidates — evidence verified, catalogue still says
  // `planned`. Listed so the audit reports them; promoting them is a
  // product decision, not something this file may make on its own.
  // ================================================================
  "customers_crm.customer_list_and_order_history": { kind: "screen", value: "CustomersScreen" },
  "customers_crm.editable_customer_profiles":      { kind: "screen", value: "CustomerDetailsScreen" },
  "analytics_reporting.operational_dashboard":     { kind: "screen", value: "MainScreen" },
  "support_service.in_app_support_tickets":        { kind: "endpoint", value: "/api/v1/support/tickets" },
  "team_security.session_and_device_management":   { kind: "endpoint", value: "/api/v1/devices" },
  "language_localization.seller_translation_review":{ kind: "endpoint", value: "/api/v1/catalog/translations" },
  "ai_capabilities.basic_ai_assistance":           { kind: "screen", value: "AiAssistantScreen",
    note: "Built and wired, but fail-closed behind AI_ASSISTANT_ENABLED. Implemented is a code fact; reachable is a runtime fact." },
};

export const KINDS = ["screen", "route", "endpoint", "binding", "resource", "module"];
