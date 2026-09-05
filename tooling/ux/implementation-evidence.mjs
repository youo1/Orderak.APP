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
 * WHY THERE ARE LEVELS AND NOT ONE ANSWER
 *   The first version of this file proved one thing: a symbol with the right
 *   name exists somewhere. That is worth having, and it is not the same as the
 *   feature working. `customers_crm.editable_customer_profiles` passed for
 *   months because a composable called `CustomerDetailsScreen` is declared — on
 *   a screen with no edit control, no save, and a ViewModel that exposes no
 *   write path at all. The symbol was real. The feature was not.
 *
 *   So evidence is graded, and each level is a different claim:
 *
 *     DECLARED            the catalogue says so
 *     EXISTS              a symbol of that name resolves       (kind + value)
 *     REACHABLE           no deployment gate closes it         (reachable)
 *     BEHAVIOUR-TESTED    a test asserts what it does          (behaviour)
 *     INTEGRATION-TESTED  a client actually calls it           (integration)
 *
 *   A feature can sit at EXISTS for a long time and that is fine, as long as the
 *   report says EXISTS rather than "implemented". What is not fine is a single
 *   number that reads as though every level had been reached.
 *
 * kind — the EXISTS axis:
 *   screen    a Compose function in the Android app
 *   route     a @Serializable route in Routes.kt
 *   endpoint  a seller API path served by the Worker
 *   binding   an entitlement enforced in backend code
 *   resource  Android string resources for a locale
 *   module    a source file in the repository that implements the behaviour
 *
 * behaviour — { layer, file, test }:
 *   layer     "android" | "backend" — which side actually proved it
 *   file      the test file's basename
 *   test      the exact test name, as written
 *
 *   The layer is recorded because most of these are server-side tests standing
 *   in for a screen. A backend test proving orders advance through their
 *   pipeline is real evidence that the pipeline works; it proves nothing about
 *   the screen that drives it. Labelling the layer keeps that difference visible
 *   instead of letting one green tick imply more than it earned.
 *
 * integration — a symbol that must appear in the Android client's network layer.
 *   Proof that something calls the thing, rather than that it exists to be
 *   called. An endpoint with no caller is the failure this axis is for.
 *
 * reachable — the name of the deployment variable that can close this feature.
 *   Omitted means "no gate is known", which is weaker than "no gate exists" and
 *   the report says so rather than implying the absence was verified.
 */

// key: { kind, value, reachable?, behaviour?, integration?, note? }
export const EVIDENCE = {
  // ---- plan limits: enforced server-side through the entitlement engine ----
  "max_products":              { kind: "binding", value: "max_products" },
  "max_categories":            { kind: "binding", value: "max_categories" },
  "max_orders_per_month":      { kind: "binding", value: "max_orders_per_month" },
  "max_ai_requests_per_month": { kind: "binding", value: "max_ai_requests_per_month" },
  "max_concurrent_devices":    { kind: "binding", value: "max_concurrent_devices" },
  "show_ads":                  { kind: "endpoint", value: "/api/v1/ads/active", integration: "/api/v1/ads/active" },
  // Not an entitlement binding despite the catalogue row: its binding is
  // `core_universal`, and the behaviour lives in the retention job.
  "essential_data_retention": {
    kind: "module",
    value: "services/backend/src/domains/identity/retention.ts",
    behaviour: { layer: "backend", file: "retention.spec.ts", test: "removes or de-identifies technical data older than 30 days" },
  },

  // ---- products & catalog ----
  "products_catalog.product_creation_and_editing": {
    kind: "screen",
    value: "ProductEditScreen",
    behaviour: { layer: "backend", file: "store.spec.ts", test: "assigns product codes and links categories" },
  },
  "products_catalog.product_descriptions": { kind: "screen", value: "ProductEditScreen" },
  "products_catalog.public_orderak_catalog": { kind: "endpoint", value: "/api/v1/store", integration: "/api/v1/store" },

  // ---- orders & fulfilment ----
  "orders_fulfilment.manual_order_creation": { kind: "screen", value: "NewOrderScreen" },
  "orders_fulfilment.public_catalog_orders": { kind: "endpoint", value: "/api/v1/orders", integration: "/api/v1/orders" },
  "orders_fulfilment.order_history":         { kind: "screen", value: "OrdersScreen" },
  "orders_fulfilment.order_status_updates": {
    kind: "screen",
    value: "OrderDetailsScreen",
    behaviour: { layer: "backend", file: "order-status.spec.ts", test: "advances one step and reports that it changed" },
  },
  "orders_fulfilment.paid_unpaid_tracking": {
    kind: "screen",
    value: "OrderDetailsScreen",
    behaviour: { layer: "backend", file: "order-status.spec.ts", test: "accepts NEW to PAID, which is a second forward path and not a skipped step" },
  },

  // ---- payments & finance ----
  // The seller picks a transfer screenshot, ML Kit reads it, and the amount is
  // matched against the order total. Built since before the migration; the
  // catalogue said "planned" until the gate migration went looking for its key.
  "payments_finance.ocr_receipt_assistance": {
    kind: "module",
    value: "apps/seller-android/app/src/main/java/app/orderak/seller/feature/payment/PaymentVerifier.kt",
    behaviour: { layer: "android", file: "PaymentVerifierTest.kt", test: "matches latin amount and extracts ref" },
  },

  // ---- team & security ----
  "team_security.owner_account": { kind: "screen", value: "SellerProfileScreen" },
  "team_security.multiple_owner_devices": {
    kind: "route",
    value: "DevicesRoute",
    behaviour: { layer: "backend", file: "operations-coverage.spec.ts", test: "lists and revokes an additional device without exposing the primary secret" },
  },

  // ---- APIs ----
  "apis_automation.standard_orderak_backend": { kind: "endpoint", value: "/api/v1/config", integration: "/api/v1/config" },

  // ---- localisation ----
  "language_localization.arabic_seller_interface":   { kind: "resource", value: "values-ar" },
  "language_localization.english_seller_interface":  { kind: "resource", value: "values-en" },
  "language_localization.french_seller_interface":   { kind: "resource", value: "values-fr" },
  "language_localization.arabic_public_storefront":  { kind: "endpoint", value: "/api/v1/store" },
  "language_localization.english_public_storefront": { kind: "endpoint", value: "/api/v1/store" },

  // ---- promoted in an earlier pass; evidence retained ----
  "customers_crm.customer_list_and_order_history":   { kind: "screen", value: "CustomersScreen" },
  "customers_crm.editable_customer_profiles": {
    kind: "screen",
    value: "CustomerDetailsScreen",
    note: "DO NOT PROMOTE on this evidence. The screen resolves, and it renders an order list with no edit control, no save and no write path in its ViewModel — this row is why the behaviour axis exists. The catalogue sold it at paid1 while the app could not do it. Promote it when work item 11 ships the editor, together with a behaviour test that asserts an edit persists.",
  },
  "analytics_reporting.operational_dashboard":       { kind: "screen", value: "MainScreen" },
  "support_service.in_app_support_tickets":          { kind: "endpoint", value: "/api/v1/support/tickets", integration: "/api/v1/support/tickets" },
  "team_security.session_and_device_management":     { kind: "endpoint", value: "/api/v1/devices", integration: "/api/v1/devices" },
  "language_localization.seller_translation_review": { kind: "endpoint", value: "/api/v1/catalog/translations", integration: "/api/v1/catalog/translations" },
  "ai_capabilities.basic_ai_assistance": {
    kind: "screen",
    value: "AiAssistantScreen",
    reachable: "AI_ASSISTANT_ENABLED",
    note: "Built and wired, but fail-closed behind AI_ASSISTANT_ENABLED. Implemented is a code fact; reachable is a runtime fact.",
  },
};

export const KINDS = ["screen", "route", "endpoint", "binding", "resource", "module"];

/** Kinds whose claim is about behaviour, and so must name a test. */
export const KINDS_REQUIRING_BEHAVIOUR = ["screen", "route", "module"];

/**
 * Features already marked `implemented` when the behaviour axis arrived, with no
 * test to name.
 *
 * WHY THIS EXISTS AND WHY IT IS NOT A LOOPHOLE
 *   Requiring behaviour evidence retroactively failed eight features at once,
 *   and a guard that is red on arrival gets switched off rather than satisfied.
 *   This records the debt instead. Every entry is printed on every run, and the
 *   verifier fails if the set GROWS. It can only shrink. A newly implemented
 *   screen, route or module cannot join it: from here on the only way to make
 *   that claim is to name a test.
 *
 *   A skipped check is invisible and unbounded. This is named, counted and
 *   monotonic, which is a different thing.
 *
 * WHAT IS DELIBERATELY NOT HERE
 *   customers_crm.editable_customer_profiles. Every entry below is a real
 *   feature that lacks a test. That one is a claim with no feature underneath
 *   it: the screen renders an order list and offers no way to edit anything, so
 *   writing its test would mean writing the editor first. It is left failing on
 *   purpose, and work item 11 is what resolves it.
 */
export const BEHAVIOUR_BASELINE = {
  "products_catalog.product_descriptions":
    "Descriptions persist through the catalogue mirror, but nothing asserts that a description survives the round trip.",
  "orders_fulfilment.manual_order_creation":
    "Cannot be tested honestly yet. The order is written to Room and never reaches the server, so there is no server behaviour to assert and no client harness for the screen. Work item 05 makes this testable.",
  "orders_fulfilment.order_history":
    "The order list renders from Room. A screenshot test covers the list component; nothing covers the screen's own loading, empty and error states.",
  "customers_crm.customer_list_and_order_history":
    "Customers are derived on-device by aggregating orders. Neither the aggregation nor the screen is covered.",
  "analytics_reporting.operational_dashboard":
    "The Today surface composes its counters from local queries. Neither the counters nor the surface is covered.",
  "ai_capabilities.basic_ai_assistance":
    "Fail-closed behind AI_ASSISTANT_ENABLED in both environments, so there is no reachable path to exercise. The gate is reported separately; this entry is the test gap, not the gate.",
  "team_security.owner_account":
    "The profile screen edits seller details. Onboarding validation is tested; this screen's own save path is not.",
};
