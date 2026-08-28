-- The settings route is gone; the account surface hosts what it showed.
--
-- Migration 048 recorded `SettingsRoute` as a screen with ten transitions, and
-- nine other screens named it as their parent. That was true then: the account
-- surface and the route both rendered the same composable, and the route was
-- kept reachable until the surface had been checked against it entry by entry.
--
-- It has been, and the route is deleted in the app. Two defects went with it,
-- both invisible while the screen had two ways in: the top bar drew a back
-- arrow that did nothing on the tab, and saving payout details called the
-- screen's dismiss callback, so on the tab a successful save reported itself
-- by doing nothing at all.
--
-- Keep 048 immutable and converge with idempotent UPDATEs, the same shape as
-- 039b and 047. `tooling/repository/verify-screen-manifest.mjs` fails the build
-- if the manifest and Routes.kt disagree again.

-- The screen itself becomes the account surface entry, like the other tabs.
UPDATE app_screens
   SET android_route = 'MainRoute#account',
       name          = 'Account',
       description   = 'Account surface: store, plan, devices, support'
 WHERE android_route = 'SettingsRoute';

-- The children need no update. app_screens stores parent_id, an integer FK
-- resolved from the manifest's parent_route at sync time (016, and
-- syncAppScreens in admin-project.ts). Renaming this row's android_route does
-- not change its id, so every child still points at the right row, and the
-- next sync resolves the new route name to the same id.

-- Transitions are stored as JSON, so repoint the targets textually.
UPDATE app_screens
   SET transitions = REPLACE(transitions, '"SettingsRoute"', '"MainRoute#account"')
 WHERE transitions LIKE '%"SettingsRoute"%';

-- OCR receipt assistance ships in the app: the seller picks a transfer
-- screenshot, ML Kit reads it, and the amount is matched against the order
-- total. The catalogue said `planned` until the gate migration went looking
-- for its key, which made the old gate answer "not built" to a seller whose
-- plan simply did not include it.
UPDATE entitlement_definitions
   SET implementation_status = 'implemented'
 WHERE entitlement_key = 'payments_finance.ocr_receipt_assistance';
