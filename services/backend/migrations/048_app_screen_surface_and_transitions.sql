-- Carries the extended screen manifest into the admin screen tree.
--
-- app_screens has stored `parent_id` since migration 016, which answers "what
-- sits under what". It has never been able to answer "what moves a seller from
-- here to there", so the branch documented in the product plan — a valid cached
-- session goes Splash straight to Dashboard — was unrepresentable while
-- Dashboard's recorded parent was Shop Setup. A tree is not a flow.
--
-- These columns close that gap and three others: which of the five surfaces a
-- screen belongs to, which states it actually has, and which entitlement gates
-- it. Values are written by the manifest sync in admin-project.ts, so a fresh
-- database converges on the next sync and an existing one converges in place.
--
-- transitions and states are JSON text rather than child tables on purpose:
-- they are read as a whole, written only by the sync, and never queried by
-- element. A join table would add two migrations and buy nothing.
--
-- entitlement_key holds the KEY only. Per-plan values live in
-- plan_revision_entitlements as versioned revisions, and copying them here
-- would recreate exactly the drift this work exists to close.

ALTER TABLE app_screens ADD COLUMN surface TEXT;
ALTER TABLE app_screens ADD COLUMN transitions TEXT NOT NULL DEFAULT '[]';
ALTER TABLE app_screens ADD COLUMN states TEXT NOT NULL DEFAULT '[]';
ALTER TABLE app_screens ADD COLUMN offline_capable INTEGER NOT NULL DEFAULT 0;
ALTER TABLE app_screens ADD COLUMN entitlement_key TEXT;
ALTER TABLE app_screens ADD COLUMN feature_status TEXT NOT NULL DEFAULT 'planned';

-- The admin tree groups by surface; without this every open of the screens
-- page scans the table.
CREATE INDEX IF NOT EXISTS idx_screens_surface ON app_screens(surface);
