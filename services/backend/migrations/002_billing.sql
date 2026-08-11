-- Orderak D1 — Billing, Coupons, Affiliate & Ads schema
-- Run remote: npx wrangler d1 execute orderak-db --remote --file=migrations/002_billing.sql
-- Run local:  npx wrangler d1 execute orderak-db --local  --file=migrations/002_billing.sql
--
-- NOTE: all money is stored as INTEGER "piasters" (EGP * 100). Never floats.

-- Give every seller a unique referral code (added to the existing table).
ALTER TABLE sellers ADD COLUMN referral_code TEXT;

-- ---------------------------------------------------------------------------
-- Plans & their features
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS plans (
  id             TEXT PRIMARY KEY,                 -- 'free' | 'starter' | 'professional'
  name           TEXT NOT NULL,
  price_piasters INTEGER NOT NULL DEFAULT 0,       -- 0 for free
  currency       TEXT NOT NULL DEFAULT 'EGP',
  interval        TEXT NOT NULL DEFAULT 'monthly',  -- 'monthly' | 'yearly'
  ads_enabled    INTEGER NOT NULL DEFAULT 0,       -- 1 = show ads (free only)
  active         INTEGER NOT NULL DEFAULT 1,
  sort_order     INTEGER NOT NULL DEFAULT 0,
  created_at     TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS plan_features (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  plan_id     TEXT NOT NULL,
  feature_key TEXT NOT NULL,
  name        TEXT NOT NULL,
  description TEXT,
  enabled     INTEGER NOT NULL DEFAULT 1,
  FOREIGN KEY (plan_id) REFERENCES plans(id),
  UNIQUE(plan_id, feature_key)
);

-- ---------------------------------------------------------------------------
-- Subscriptions
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS subscriptions (
  id                 INTEGER PRIMARY KEY AUTOINCREMENT,
  seller_id          INTEGER NOT NULL,
  plan_id            TEXT NOT NULL,
  status             TEXT NOT NULL DEFAULT 'active',  -- active | past_due | canceled | pending
  gateway            TEXT NOT NULL DEFAULT 'mock',
  gateway_sub_id     TEXT,
  amount_piasters    INTEGER NOT NULL DEFAULT 0,      -- amount actually charged (after discounts)
  coupon_code        TEXT,
  idempotency_key    TEXT,
  current_period_end TEXT,                            -- NULL = never expires (free)
  created_at         TEXT DEFAULT (datetime('now')),
  updated_at         TEXT DEFAULT (datetime('now')),
  FOREIGN KEY (seller_id) REFERENCES sellers(id),
  FOREIGN KEY (plan_id) REFERENCES plans(id)
);

-- ---------------------------------------------------------------------------
-- Coupons
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS coupons (
  code          TEXT PRIMARY KEY,                    -- uppercase code, e.g. WELCOME20
  discount_type TEXT NOT NULL DEFAULT 'percentage',  -- 'percentage' | 'fixed'
  value         INTEGER NOT NULL DEFAULT 0,          -- percent (0-100) OR fixed piasters
  expires_at    TEXT,                                -- NULL = never
  max_uses      INTEGER NOT NULL DEFAULT 0,          -- 0 = unlimited
  used_count    INTEGER NOT NULL DEFAULT 0,
  active        INTEGER NOT NULL DEFAULT 1,
  created_at    TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS coupon_uses (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  coupon_code     TEXT NOT NULL,
  seller_id       INTEGER NOT NULL,
  subscription_id INTEGER,
  applied_at      TEXT DEFAULT (datetime('now')),
  FOREIGN KEY (coupon_code) REFERENCES coupons(code),
  FOREIGN KEY (seller_id) REFERENCES sellers(id),
  UNIQUE(coupon_code, seller_id)
);

-- ---------------------------------------------------------------------------
-- Affiliate / referral program
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS affiliate_settings (
  id                   INTEGER PRIMARY KEY CHECK (id = 1),  -- single-row config
  commission_type      TEXT NOT NULL DEFAULT 'percentage',  -- 'percentage' | 'fixed'
  commission_value     INTEGER NOT NULL DEFAULT 20,         -- percent OR fixed piasters
  referral_bonus_type  TEXT NOT NULL DEFAULT 'percentage',  -- discount for the referred user
  referral_bonus_value INTEGER NOT NULL DEFAULT 10,
  min_payout_piasters  INTEGER NOT NULL DEFAULT 10000,      -- 100 EGP
  payout_info          TEXT,
  updated_at           TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS referrals (
  id                   INTEGER PRIMARY KEY AUTOINCREMENT,
  referrer_id          INTEGER NOT NULL,            -- seller who owns the code
  referred_id          INTEGER NOT NULL,            -- seller who signed up with the code
  code                 TEXT NOT NULL,
  status               TEXT NOT NULL DEFAULT 'pending',  -- pending | qualified | paid
  commission_piasters  INTEGER NOT NULL DEFAULT 0,
  created_at           TEXT DEFAULT (datetime('now')),
  qualified_at         TEXT,
  FOREIGN KEY (referrer_id) REFERENCES sellers(id),
  FOREIGN KEY (referred_id) REFERENCES sellers(id),
  UNIQUE(referred_id)                              -- a seller can only be referred once
);

-- ---------------------------------------------------------------------------
-- Ads
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS ads (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  title       TEXT NOT NULL,
  image_url   TEXT NOT NULL,
  click_url   TEXT,
  type        TEXT NOT NULL DEFAULT 'banner',   -- banner | interstitial | native
  target_plan TEXT NOT NULL DEFAULT 'free',     -- 'free' | 'all' | plan id
  frequency   INTEGER NOT NULL DEFAULT 1,       -- how often to show (app hint)
  weight      INTEGER NOT NULL DEFAULT 1,       -- ordering / rotation weight
  active      INTEGER NOT NULL DEFAULT 1,
  created_at  TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS ad_impressions (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  ad_id      INTEGER NOT NULL,
  seller_id  INTEGER,
  kind       TEXT NOT NULL DEFAULT 'impression', -- impression | click
  created_at TEXT DEFAULT (datetime('now')),
  FOREIGN KEY (ad_id) REFERENCES ads(id)
);

-- ---------------------------------------------------------------------------
-- Lightweight rate limiting (for coupon endpoints, etc.)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS rate_limits (
  bucket       TEXT PRIMARY KEY,       -- e.g. "coupon:apply:<sellerId>"
  count        INTEGER NOT NULL DEFAULT 0,
  window_start INTEGER NOT NULL        -- unix seconds
);

-- ---------------------------------------------------------------------------
-- Indexes
-- ---------------------------------------------------------------------------
CREATE INDEX IF NOT EXISTS idx_subs_seller       ON subscriptions(seller_id);
CREATE INDEX IF NOT EXISTS idx_subs_status       ON subscriptions(status);
CREATE INDEX IF NOT EXISTS idx_subs_gateway_sub  ON subscriptions(gateway_sub_id);
CREATE INDEX IF NOT EXISTS idx_features_plan     ON plan_features(plan_id);
CREATE INDEX IF NOT EXISTS idx_coupon_uses_code  ON coupon_uses(coupon_code);
CREATE INDEX IF NOT EXISTS idx_coupon_uses_sel   ON coupon_uses(seller_id);
CREATE INDEX IF NOT EXISTS idx_referrals_refr    ON referrals(referrer_id);
CREATE INDEX IF NOT EXISTS idx_referrals_status  ON referrals(status);
CREATE INDEX IF NOT EXISTS idx_ads_active        ON ads(active, target_plan);
CREATE INDEX IF NOT EXISTS idx_sellers_refcode   ON sellers(referral_code);

-- ---------------------------------------------------------------------------
-- Seed data: the three plans + features + default affiliate settings
-- ---------------------------------------------------------------------------
INSERT OR IGNORE INTO plans (id, name, price_piasters, currency, interval, ads_enabled, active, sort_order) VALUES
  ('free',         'Free',         0,      'EGP', 'monthly', 1, 1, 0),
  ('starter',      'Starter',      9900,   'EGP', 'monthly', 0, 1, 1),
  ('professional', 'Professional', 29900,  'EGP', 'monthly', 0, 1, 2);

INSERT OR IGNORE INTO plan_features (plan_id, feature_key, name, description, enabled) VALUES
  ('free',         'products_limit',  'Up to 20 products',      'List up to 20 products',            1),
  ('free',         'ads',             'Ads shown',              'Free plan shows ads',               1),
  ('free',         'ai_chat',         'Basic AI assistant',     'Limited AI order assistant',        1),
  ('free',         'analytics',       'Analytics',              'Sales analytics dashboard',         0),
  ('starter',      'products_limit',  'Up to 200 products',     'List up to 200 products',           1),
  ('starter',      'ads',             'Ad-free',                'No ads',                            0),
  ('starter',      'ai_chat',         'AI assistant',           'Full AI order assistant',           1),
  ('starter',      'analytics',       'Analytics',              'Sales analytics dashboard',         1),
  ('professional', 'products_limit',  'Unlimited products',     'Unlimited products',                1),
  ('professional', 'ads',             'Ad-free',                'No ads',                            0),
  ('professional', 'ai_chat',         'Advanced AI assistant',  'Priority AI order assistant',       1),
  ('professional', 'analytics',       'Advanced analytics',     'Advanced analytics + export',       1),
  ('professional', 'priority_support','Priority support',       '24/7 priority support',             1);

INSERT OR IGNORE INTO affiliate_settings
  (id, commission_type, commission_value, referral_bonus_type, referral_bonus_value, min_payout_piasters, payout_info)
VALUES
  (1, 'percentage', 20, 'percentage', 10, 10000, 'Payouts via Vodafone Cash / InstaPay');
