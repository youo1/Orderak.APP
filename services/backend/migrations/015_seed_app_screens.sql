INSERT INTO app_screens (name,description,status,design_status,development_status,android_route,sort_order,source,last_synced_at)
SELECT 'Splash','Startup and destination routing','planned','not_started','not_started','SplashRoute',10,'android_manifest',datetime('now') WHERE NOT EXISTS (SELECT 1 FROM app_screens WHERE android_route='SplashRoute');
INSERT INTO app_screens (name,description,status,design_status,development_status,android_route,sort_order,source,last_synced_at)
SELECT 'Sign In','Seller authentication','planned','not_started','not_started','AuthRoute',20,'android_manifest',datetime('now') WHERE NOT EXISTS (SELECT 1 FROM app_screens WHERE android_route='AuthRoute');
INSERT INTO app_screens (name,description,status,design_status,development_status,android_route,sort_order,source,last_synced_at)
SELECT 'Shop Setup','Initial store configuration','planned','not_started','not_started','ShopSetupRoute',30,'android_manifest',datetime('now') WHERE NOT EXISTS (SELECT 1 FROM app_screens WHERE android_route='ShopSetupRoute');
INSERT INTO app_screens (name,description,status,design_status,development_status,android_route,sort_order,source,last_synced_at)
SELECT 'Dashboard','Main application shell','planned','not_started','not_started','MainRoute',40,'android_manifest',datetime('now') WHERE NOT EXISTS (SELECT 1 FROM app_screens WHERE android_route='MainRoute');
INSERT INTO app_screens (name,description,status,design_status,development_status,android_route,sort_order,source,last_synced_at)
SELECT 'Orders','Order list in the main shell','planned','not_started','not_started','MainRoute#orders',50,'android_manifest',datetime('now') WHERE NOT EXISTS (SELECT 1 FROM app_screens WHERE android_route='MainRoute#orders');
INSERT INTO app_screens (name,description,status,design_status,development_status,android_route,sort_order,source,last_synced_at)
SELECT 'Products','Product list in the main shell','planned','not_started','not_started','MainRoute#products',60,'android_manifest',datetime('now') WHERE NOT EXISTS (SELECT 1 FROM app_screens WHERE android_route='MainRoute#products');
INSERT INTO app_screens (name,description,status,design_status,development_status,android_route,sort_order,source,last_synced_at)
SELECT 'Customers','Customer list in the main shell','planned','not_started','not_started','MainRoute#customers',70,'android_manifest',datetime('now') WHERE NOT EXISTS (SELECT 1 FROM app_screens WHERE android_route='MainRoute#customers');
INSERT INTO app_screens (name,description,status,design_status,development_status,android_route,sort_order,source,last_synced_at)
SELECT 'Product Editor','Create or edit a product','planned','not_started','not_started','ProductEditRoute',80,'android_manifest',datetime('now') WHERE NOT EXISTS (SELECT 1 FROM app_screens WHERE android_route='ProductEditRoute');
INSERT INTO app_screens (name,description,status,design_status,development_status,android_route,sort_order,source,last_synced_at)
SELECT 'New Order','Manual order creation','planned','not_started','not_started','NewOrderRoute',90,'android_manifest',datetime('now') WHERE NOT EXISTS (SELECT 1 FROM app_screens WHERE android_route='NewOrderRoute');
INSERT INTO app_screens (name,description,status,design_status,development_status,android_route,sort_order,source,last_synced_at)
SELECT 'Order Details','Order detail and status','planned','not_started','not_started','OrderDetailsRoute',100,'android_manifest',datetime('now') WHERE NOT EXISTS (SELECT 1 FROM app_screens WHERE android_route='OrderDetailsRoute');
INSERT INTO app_screens (name,description,status,design_status,development_status,android_route,sort_order,source,last_synced_at)
SELECT 'Customer Details','Customer profile and order history','planned','not_started','not_started','CustomerRoute',110,'android_manifest',datetime('now') WHERE NOT EXISTS (SELECT 1 FROM app_screens WHERE android_route='CustomerRoute');
INSERT INTO app_screens (name,description,status,design_status,development_status,android_route,sort_order,source,last_synced_at)
SELECT 'Settings','Application settings','planned','not_started','not_started','SettingsRoute',120,'android_manifest',datetime('now') WHERE NOT EXISTS (SELECT 1 FROM app_screens WHERE android_route='SettingsRoute');
INSERT INTO app_screens (name,description,status,design_status,development_status,android_route,sort_order,source,last_synced_at)
SELECT 'Store Information','Store identity and public details','planned','not_started','not_started','StoreInfoRoute',130,'android_manifest',datetime('now') WHERE NOT EXISTS (SELECT 1 FROM app_screens WHERE android_route='StoreInfoRoute');
INSERT INTO app_screens (name,description,status,design_status,development_status,android_route,sort_order,source,last_synced_at)
SELECT 'Categories','Product category management','planned','not_started','not_started','CategoriesRoute',140,'android_manifest',datetime('now') WHERE NOT EXISTS (SELECT 1 FROM app_screens WHERE android_route='CategoriesRoute');
