-- ============================================================
-- Migration 016: App Screen Tree Hierarchy
-- Purpose: Add parent_id column to app_screens so the admin
--          panel can render a collapsible tree view that shows
--          the navigation flow (screen sequences) of the Android
--          app: Splash → Sign In → Shop Setup → Dashboard, with
--          tab screens (Orders/Products/Customers) and their
--          detail screens branching from Dashboard.
-- ============================================================

-- Add parent_id for tree hierarchy in App Screens.
-- Self-referencing FK: a screen's parent must exist in the same table.
ALTER TABLE app_screens ADD COLUMN parent_id INTEGER REFERENCES app_screens(id);
CREATE INDEX IF NOT EXISTS idx_screens_parent ON app_screens(parent_id);

-- Seed parent relationships from the Android manifest
-- Root: Splash
UPDATE app_screens SET parent_id = NULL WHERE android_route = 'SplashRoute';

-- Sign In parent = Splash
UPDATE app_screens SET parent_id = (SELECT id FROM app_screens WHERE android_route = 'SplashRoute')
  WHERE android_route = 'AuthRoute';

-- Shop Setup parent = Sign In
UPDATE app_screens SET parent_id = (SELECT id FROM app_screens WHERE android_route = 'AuthRoute')
  WHERE android_route = 'ShopSetupRoute';

-- Dashboard parent = Shop Setup
UPDATE app_screens SET parent_id = (SELECT id FROM app_screens WHERE android_route = 'ShopSetupRoute')
  WHERE android_route = 'MainRoute';

-- Tab screens (Orders, Products, Customers) parent = Dashboard
UPDATE app_screens SET parent_id = (SELECT id FROM app_screens WHERE android_route = 'MainRoute')
  WHERE android_route IN ('MainRoute#orders', 'MainRoute#products', 'MainRoute#customers');

-- Product Editor parent = Products
UPDATE app_screens SET parent_id = (SELECT id FROM app_screens WHERE android_route = 'MainRoute#products')
  WHERE android_route = 'ProductEditRoute';

-- New Order parent = Orders
UPDATE app_screens SET parent_id = (SELECT id FROM app_screens WHERE android_route = 'MainRoute#orders')
  WHERE android_route = 'NewOrderRoute';

-- Order Details parent = Orders
UPDATE app_screens SET parent_id = (SELECT id FROM app_screens WHERE android_route = 'MainRoute#orders')
  WHERE android_route = 'OrderDetailsRoute';

-- Customer Details parent = Customers
UPDATE app_screens SET parent_id = (SELECT id FROM app_screens WHERE android_route = 'MainRoute#customers')
  WHERE android_route = 'CustomerRoute';

-- Settings parent = Dashboard
UPDATE app_screens SET parent_id = (SELECT id FROM app_screens WHERE android_route = 'MainRoute')
  WHERE android_route = 'SettingsRoute';

-- Store Information parent = Settings
UPDATE app_screens SET parent_id = (SELECT id FROM app_screens WHERE android_route = 'SettingsRoute')
  WHERE android_route = 'StoreInfoRoute';

-- Categories parent = Settings
UPDATE app_screens SET parent_id = (SELECT id FROM app_screens WHERE android_route = 'SettingsRoute')
  WHERE android_route = 'CategoriesRoute';