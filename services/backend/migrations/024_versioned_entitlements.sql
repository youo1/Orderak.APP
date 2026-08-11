-- Orderak D1 — organization-scoped versioned plans and entitlement foundation.
-- CHG-004. Local/development migration only until billing and production approvals are complete.
-- Existing plans/subscriptions remain intact during the compatibility window.

PRAGMA defer_foreign_keys = TRUE;

CREATE TABLE organizations (
  id                   TEXT PRIMARY KEY,
  name                 TEXT NOT NULL,
  owner_store_id       TEXT NOT NULL UNIQUE,
  status               TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','suspended','closed')),
  default_locale       TEXT NOT NULL DEFAULT 'en',
  created_at           TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at           TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE organization_stores (
  organization_id TEXT NOT NULL,
  store_id        TEXT NOT NULL UNIQUE,
  is_primary      INTEGER NOT NULL DEFAULT 0 CHECK (is_primary IN (0,1)),
  created_at      TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (organization_id, store_id),
  FOREIGN KEY (organization_id) REFERENCES organizations(id)
);

CREATE TABLE organization_members (
  id              TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL,
  seller_id       TEXT,
  role            TEXT NOT NULL DEFAULT 'owner',
  status          TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('invited','active','disabled')),
  created_at      TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at      TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (organization_id) REFERENCES organizations(id)
);

CREATE TABLE subscription_plans (
  id                  TEXT PRIMARY KEY,
  plan_key            TEXT NOT NULL UNIQUE CHECK (plan_key IN ('free','paid1','paid2','paid3')),
  name                TEXT NOT NULL,
  description         TEXT,
  target_customer     TEXT,
  primary_value       TEXT,
  sort_order          INTEGER NOT NULL,
  active              INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0,1)),
  current_revision_id TEXT,
  created_at          TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at          TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE plan_revisions (
  id                  TEXT PRIMARY KEY,
  plan_id             TEXT NOT NULL,
  version             INTEGER NOT NULL CHECK (version > 0),
  status              TEXT NOT NULL CHECK (status IN ('draft','published','retired')),
  change_type         TEXT NOT NULL DEFAULT 'initial' CHECK (change_type IN ('initial','additive','restrictive','mixed')),
  source_catalog_hash TEXT,
  created_by          INTEGER,
  published_by        INTEGER,
  created_at          TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at          TEXT NOT NULL DEFAULT (datetime('now')),
  lock_version        INTEGER NOT NULL DEFAULT 0,
  edit_token          TEXT,
  published_at        TEXT,
  retired_at          TEXT,
  UNIQUE (plan_id, version),
  FOREIGN KEY (plan_id) REFERENCES subscription_plans(id)
);

CREATE TABLE entitlement_definitions (
  entitlement_key      TEXT PRIMARY KEY,
  category             TEXT NOT NULL,
  name                 TEXT NOT NULL,
  description          TEXT,
  value_type           TEXT NOT NULL CHECK (value_type IN ('boolean','integer','text','enum')),
  unit                 TEXT,
  reset_period         TEXT NOT NULL DEFAULT 'none' CHECK (reset_period IN ('none','calendar_month_utc')),
  supports_unlimited   INTEGER NOT NULL DEFAULT 0 CHECK (supports_unlimited IN (0,1)),
  higher_is_better     INTEGER NOT NULL DEFAULT 0 CHECK (higher_is_better IN (0,1)),
  implementation_status TEXT NOT NULL CHECK (implementation_status IN ('implemented','partial','planned')),
  enforcement_binding TEXT,
  admin_configurable   INTEGER NOT NULL DEFAULT 0 CHECK (admin_configurable IN (0,1)),
  core_universal       INTEGER NOT NULL DEFAULT 0 CHECK (core_universal IN (0,1)),
  sort_order           INTEGER NOT NULL,
  active               INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0,1)),
  created_at           TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at           TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE plan_revision_entitlements (
  revision_id     TEXT NOT NULL,
  entitlement_key TEXT NOT NULL,
  value_mode      TEXT NOT NULL CHECK (value_mode IN ('value','disabled','unlimited','custom_required')),
  bool_value      INTEGER CHECK (bool_value IS NULL OR bool_value IN (0,1)),
  int_value       INTEGER CHECK (int_value IS NULL OR int_value >= 0),
  text_value      TEXT,
  display_value   TEXT NOT NULL,
  updated_at      TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (revision_id, entitlement_key),
  FOREIGN KEY (revision_id) REFERENCES plan_revisions(id),
  FOREIGN KEY (entitlement_key) REFERENCES entitlement_definitions(entitlement_key)
);

CREATE TABLE organization_subscriptions (
  id                    TEXT PRIMARY KEY,
  organization_id       TEXT NOT NULL,
  plan_revision_id      TEXT NOT NULL,
  pending_revision_id   TEXT,
  pending_effective_at  TEXT,
  source                TEXT NOT NULL CHECK (source IN ('free','legacy','google_play','manual')),
  status                TEXT NOT NULL CHECK (status IN ('pending','active','grace','canceled','on_hold','paused','expired','revoked')),
  legacy_subscription_id INTEGER,
  current_period_start  TEXT,
  current_period_end    TEXT,
  cancel_at_period_end  INTEGER NOT NULL DEFAULT 0 CHECK (cancel_at_period_end IN (0,1)),
  created_at            TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at            TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (organization_id) REFERENCES organizations(id),
  FOREIGN KEY (plan_revision_id) REFERENCES plan_revisions(id),
  FOREIGN KEY (pending_revision_id) REFERENCES plan_revisions(id)
);

CREATE TABLE organization_entitlement_overrides (
  id                 TEXT PRIMARY KEY,
  organization_id    TEXT NOT NULL,
  entitlement_key    TEXT NOT NULL,
  value_mode         TEXT NOT NULL CHECK (value_mode IN ('value','disabled','unlimited')),
  bool_value         INTEGER CHECK (bool_value IS NULL OR bool_value IN (0,1)),
  int_value          INTEGER CHECK (int_value IS NULL OR int_value >= 0),
  text_value         TEXT,
  reason             TEXT NOT NULL,
  effective_at       TEXT NOT NULL DEFAULT (datetime('now')),
  expires_at         TEXT,
  created_by         INTEGER NOT NULL,
  created_at         TEXT NOT NULL DEFAULT (datetime('now')),
  revoked_at         TEXT,
  revoked_by         INTEGER,
  FOREIGN KEY (organization_id) REFERENCES organizations(id),
  FOREIGN KEY (entitlement_key) REFERENCES entitlement_definitions(entitlement_key)
);

CREATE TABLE entitlement_usage_counters (
  organization_id TEXT NOT NULL,
  entitlement_key TEXT NOT NULL,
  period_start    TEXT NOT NULL,
  period_end      TEXT NOT NULL,
  used            INTEGER NOT NULL DEFAULT 0 CHECK (used >= 0),
  updated_at      TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (organization_id, entitlement_key, period_start),
  FOREIGN KEY (organization_id) REFERENCES organizations(id),
  FOREIGN KEY (entitlement_key) REFERENCES entitlement_definitions(entitlement_key)
);

CREATE TABLE entitlement_usage_reservations (
  id              TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL,
  entitlement_key TEXT NOT NULL,
  period_start    TEXT NOT NULL,
  delta           INTEGER NOT NULL CHECK (delta > 0),
  idempotency_key TEXT NOT NULL,
  status          TEXT NOT NULL DEFAULT 'reserved' CHECK (status IN ('reserved','committed','voided')),
  created_at      TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at      TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (organization_id, entitlement_key, idempotency_key),
  FOREIGN KEY (organization_id) REFERENCES organizations(id),
  FOREIGN KEY (entitlement_key) REFERENCES entitlement_definitions(entitlement_key)
);

CREATE TABLE organization_plan_approvals (
  organization_id TEXT NOT NULL,
  plan_id         TEXT NOT NULL,
  approved_by     INTEGER NOT NULL,
  approved_at     TEXT NOT NULL DEFAULT (datetime('now')),
  expires_at      TEXT,
  notes           TEXT NOT NULL,
  revoked_at      TEXT,
  PRIMARY KEY (organization_id, plan_id),
  FOREIGN KEY (organization_id) REFERENCES organizations(id),
  FOREIGN KEY (plan_id) REFERENCES subscription_plans(id)
);

CREATE TABLE play_product_mappings (
  id              TEXT PRIMARY KEY,
  plan_id         TEXT NOT NULL,
  product_id      TEXT NOT NULL,
  base_plan_id    TEXT NOT NULL CHECK (base_plan_id IN ('monthly','annual')),
  package_name    TEXT NOT NULL DEFAULT 'app.orderak.seller',
  active          INTEGER NOT NULL DEFAULT 0 CHECK (active IN (0,1)),
  last_synced_at  TEXT,
  price_snapshot_json TEXT,
  created_at      TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (product_id, base_plan_id),
  FOREIGN KEY (plan_id) REFERENCES subscription_plans(id)
);

CREATE TABLE play_purchases (
  id                       TEXT PRIMARY KEY,
  organization_id          TEXT NOT NULL,
  subscription_id          TEXT,
  product_mapping_id       TEXT NOT NULL,
  purchase_token_hash      TEXT NOT NULL UNIQUE,
  purchase_token_encrypted TEXT NOT NULL,
  linked_token_hash        TEXT,
  order_id                 TEXT,
  state                    TEXT NOT NULL,
  acknowledgement_state    TEXT,
  region_code              TEXT,
  start_at                 TEXT,
  expires_at               TEXT,
  raw_etag                 TEXT,
  last_verified_at         TEXT NOT NULL DEFAULT (datetime('now')),
  created_at               TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at               TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (organization_id) REFERENCES organizations(id),
  FOREIGN KEY (subscription_id) REFERENCES organization_subscriptions(id),
  FOREIGN KEY (product_mapping_id) REFERENCES play_product_mappings(id)
);

CREATE TABLE play_billing_events (
  message_id       TEXT PRIMARY KEY,
  notification_type INTEGER,
  purchase_token_hash TEXT,
  event_time       TEXT,
  status           TEXT NOT NULL DEFAULT 'received' CHECK (status IN ('received','processed','ignored','failed')),
  error_code       TEXT,
  received_at      TEXT NOT NULL DEFAULT (datetime('now')),
  processed_at     TEXT
);

CREATE TABLE plan_change_notices (
  id              TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL,
  from_revision_id TEXT NOT NULL,
  to_revision_id  TEXT NOT NULL,
  effective_at    TEXT NOT NULL,
  change_type     TEXT NOT NULL CHECK (change_type IN ('restrictive','mixed')),
  acknowledged_at TEXT,
  created_at      TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (organization_id) REFERENCES organizations(id)
);

CREATE TABLE storefront_locale_definitions (
  locale_tag            TEXT PRIMARY KEY,
  name                  TEXT NOT NULL,
  implementation_status TEXT NOT NULL CHECK (implementation_status IN ('implemented','planned')),
  core_universal        INTEGER NOT NULL DEFAULT 0 CHECK (core_universal IN (0,1)),
  active                INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0,1))
);

CREATE TABLE organization_storefront_locales (
  organization_id TEXT NOT NULL,
  locale_tag      TEXT NOT NULL,
  enabled         INTEGER NOT NULL DEFAULT 1 CHECK (enabled IN (0,1)),
  enabled_by      INTEGER,
  enabled_at      TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (organization_id, locale_tag),
  FOREIGN KEY (organization_id) REFERENCES organizations(id),
  FOREIGN KEY (locale_tag) REFERENCES storefront_locale_definitions(locale_tag)
);

CREATE INDEX idx_org_stores_org ON organization_stores(organization_id);
CREATE INDEX idx_org_members_org_status ON organization_members(organization_id, status);
CREATE INDEX idx_plan_revisions_plan_status ON plan_revisions(plan_id, status, version DESC);
CREATE INDEX idx_entitlement_defs_category_order ON entitlement_definitions(category, sort_order);
CREATE INDEX idx_plan_entitlements_revision ON plan_revision_entitlements(revision_id);
CREATE INDEX idx_org_subscriptions_active ON organization_subscriptions(organization_id, status, current_period_end);
CREATE INDEX idx_org_overrides_active ON organization_entitlement_overrides(organization_id, entitlement_key, revoked_at, expires_at);
CREATE INDEX idx_usage_period ON entitlement_usage_counters(organization_id, period_start, period_end);
CREATE INDEX idx_play_purchase_org ON play_purchases(organization_id, updated_at DESC);
CREATE INDEX idx_play_purchase_linked ON play_purchases(linked_token_hash);
CREATE INDEX idx_plan_notices_org ON plan_change_notices(organization_id, effective_at);

INSERT INTO subscription_plans (id,plan_key,name,description,target_customer,primary_value,sort_order,active,current_revision_id) VALUES
  ('0bc913e8-9760-489d-85ce-ed416f1f3194','free','Free','Core utility with practical starter limits','New or occasional seller','Essential selling tools',0,1,'02b0f3d1-62ec-4f1f-baa8-164e905312eb'),
  ('29b0920e-4ea7-4340-8631-2d9552c2b77c','paid1','Paid 1','Entry paid tier for individual sellers','Individual seller','Remove everyday limits',1,1,'c65852f6-ae3a-430b-aec5-81bd7b5fd76d'),
  ('26e1e24b-7237-4e38-931a-a3e2e7380591','paid2','Paid 2','Growth tier for power sellers and teams','Power seller or growing team','Growth, automation and teamwork',2,1,'ae9d2f87-ac08-4986-b823-10d647b360f6'),
  ('716e6c85-21a5-42b2-9a9b-b96621322814','paid3','Paid 3','Organization tier with custom capacity and controls','Organization or multi-location business','Scale, governance and custom service',3,1,'e8e42795-e48a-4e6b-86a6-57848cd75bfe');

INSERT INTO plan_revisions (id,plan_id,version,status,change_type,published_at) VALUES
  ('02b0f3d1-62ec-4f1f-baa8-164e905312eb','0bc913e8-9760-489d-85ce-ed416f1f3194',1,'published','initial',datetime('now')),
  ('c65852f6-ae3a-430b-aec5-81bd7b5fd76d','29b0920e-4ea7-4340-8631-2d9552c2b77c',1,'published','initial',datetime('now')),
  ('ae9d2f87-ac08-4986-b823-10d647b360f6','26e1e24b-7237-4e38-931a-a3e2e7380591',1,'published','initial',datetime('now')),
  ('e8e42795-e48a-4e6b-86a6-57848cd75bfe','716e6c85-21a5-42b2-9a9b-b96621322814',1,'published','initial',datetime('now'));

INSERT INTO storefront_locale_definitions(locale_tag,name,implementation_status,core_universal) VALUES
  ('ar','Arabic','implemented',1),
  ('en','English','implemented',1);

INSERT INTO play_product_mappings(id,plan_id,product_id,base_plan_id,active) VALUES
  ('3e1e9324-46bf-4868-a9dd-8fa608cd8e51','29b0920e-4ea7-4340-8631-2d9552c2b77c','orderak_paid1','monthly',0),
  ('d6697bf5-b1ee-41cf-b50a-c65a73088883','29b0920e-4ea7-4340-8631-2d9552c2b77c','orderak_paid1','annual',0),
  ('1f3a2a15-4bea-4435-adb9-f0ead8595e12','26e1e24b-7237-4e38-931a-a3e2e7380591','orderak_paid2','monthly',0),
  ('4615e78a-b69a-436f-82d9-93142c750847','26e1e24b-7237-4e38-931a-a3e2e7380591','orderak_paid2','annual',0),
  ('1e8056e5-862c-4b11-a5d2-15de6d5d9e50','716e6c85-21a5-42b2-9a9b-b96621322814','orderak_paid3','monthly',0),
  ('01cfc3ea-01b2-40f2-939f-97dd6946f847','716e6c85-21a5-42b2-9a9b-b96621322814','orderak_paid3','annual',0);

-- Every current seller becomes the owner and primary store of one organization.
INSERT INTO organizations(id,name,owner_store_id,default_locale,created_at,updated_at)
SELECT lower(hex(randomblob(4)) || '-' || hex(randomblob(2)) || '-4' || substr(hex(randomblob(2)),2) || '-' ||
       substr('89ab',abs(random()) % 4 + 1,1) || substr(hex(randomblob(2)),2) || '-' || hex(randomblob(6))),
       COALESCE(NULLIF(store_name,''),'Orderak organization'), id, COALESCE(NULLIF(lang,''),'en'),
       COALESCE(created_at,datetime('now')), COALESCE(updated_at,datetime('now'))
FROM sellers;

INSERT INTO organization_stores(organization_id,store_id,is_primary)
SELECT id,owner_store_id,1 FROM organizations;

INSERT INTO organization_members(id,organization_id,seller_id,role,status)
SELECT lower(hex(randomblob(4)) || '-' || hex(randomblob(2)) || '-4' || substr(hex(randomblob(2)),2) || '-' ||
       substr('89ab',abs(random()) % 4 + 1,1) || substr(hex(randomblob(2)),2) || '-' || hex(randomblob(6))),
       id,owner_store_id,'owner','active' FROM organizations;

-- Preserve legacy paid/free assignments through an explicit revision mapping.
INSERT INTO organization_subscriptions(
  id,organization_id,plan_revision_id,source,status,legacy_subscription_id,current_period_end,created_at,updated_at
)
SELECT lower(hex(randomblob(4)) || '-' || hex(randomblob(2)) || '-4' || substr(hex(randomblob(2)),2) || '-' ||
       substr('89ab',abs(random()) % 4 + 1,1) || substr(hex(randomblob(2)),2) || '-' || hex(randomblob(6))),
       o.id,
       CASE s.plan_id
         WHEN 'starter' THEN 'c65852f6-ae3a-430b-aec5-81bd7b5fd76d'
         WHEN 'professional' THEN 'ae9d2f87-ac08-4986-b823-10d647b360f6'
         ELSE '02b0f3d1-62ec-4f1f-baa8-164e905312eb'
       END,
       'legacy',
       CASE s.status
         WHEN 'past_due' THEN 'on_hold'
         WHEN 'pending' THEN 'pending'
         WHEN 'canceled' THEN 'canceled'
         ELSE 'active'
       END,
       s.id,s.current_period_end,COALESCE(s.created_at,datetime('now')),COALESCE(s.updated_at,datetime('now'))
FROM subscriptions s
JOIN organization_stores os ON os.store_id=s.seller_id
JOIN organizations o ON o.id=os.organization_id;

PRAGMA optimize;
