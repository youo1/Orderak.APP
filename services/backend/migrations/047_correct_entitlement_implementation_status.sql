-- Forward correction for entitlement implementation_status drift.
--
-- Migration 025 seeded entitlement_definitions from the plan catalogue as it
-- stood on 2026-07-19. Nothing has ever verified those statuses against the
-- code, and seven of them were wrong in the same direction: the feature ships
-- in the app, the catalogue still called it `planned`. The published headline
-- "23 of 242 implemented" was therefore understated; the real figure is 30.
--
-- Keep migration 025 immutable and converge existing and freshly replayed
-- databases with an idempotent UPDATE, the same shape as 039b.
--
-- Each row below is backed by evidence that resolves in the repository. The
-- evidence is declared in tooling/ux/implementation-evidence.mjs and enforced
-- by tooling/ux/verify-implementation-status.mjs, which fails the build if an
-- `implemented` claim stops resolving. That guard is the reason this drift
-- cannot recur silently.

-- CustomersScreen
UPDATE entitlement_definitions SET implementation_status = 'implemented'
  WHERE entitlement_key = 'customers_crm.customer_list_and_order_history';

-- CustomerDetailsScreen
UPDATE entitlement_definitions SET implementation_status = 'implemented'
  WHERE entitlement_key = 'customers_crm.editable_customer_profiles';

-- MainScreen — the dashboard counters and plan meters
UPDATE entitlement_definitions SET implementation_status = 'implemented'
  WHERE entitlement_key = 'analytics_reporting.operational_dashboard';

-- /api/v1/support/tickets, reached from SupportRoute
UPDATE entitlement_definitions SET implementation_status = 'implemented'
  WHERE entitlement_key = 'support_service.in_app_support_tickets';

-- /api/v1/devices, reached from DevicesRoute
UPDATE entitlement_definitions SET implementation_status = 'implemented'
  WHERE entitlement_key = 'team_security.session_and_device_management';

-- /api/v1/catalog/translations, reached from CatalogLanguagesRoute
UPDATE entitlement_definitions SET implementation_status = 'implemented'
  WHERE entitlement_key = 'language_localization.seller_translation_review';

-- AiAssistantScreen. Built and wired; still fail-closed behind
-- AI_ASSISTANT_ENABLED. `implementation_status` is a code fact and this row is
-- now truthful. Whether a seller can reach it is a runtime fact carried by the
-- flag, and the UI must render it as "not built yet" rather than as an upgrade:
-- no plan change makes it reachable, so offering one would be a dead end.
UPDATE entitlement_definitions SET implementation_status = 'implemented'
  WHERE entitlement_key = 'ai_capabilities.basic_ai_assistance';
