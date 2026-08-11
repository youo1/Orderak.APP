-- Structured public store identifier: /c/<ISO2>-<slug>-<STORE_CODE>
-- e.g. /c/EG-fresh-market-A1B2C3
--
-- Adds three columns to `sellers`:
--   store_code        -> permanent, immutable 6-char unique key (never changes)
--   country_code      -> ISO2 (EG, SA, ...), rarely changes
--   public_identifier -> composed URL segment "<ISO2>-<slug>-<STORE_CODE>"
--
-- The slug + store_name stay editable; store_code is the real stable key, so
-- old shared links keep working even after a seller renames their store.
--
-- Run with:
--   npx wrangler d1 execute orderak-db --remote --file=migrations/008_store_codes.sql
--   npx wrangler d1 execute orderak-db --local  --file=migrations/008_store_codes.sql

ALTER TABLE sellers ADD COLUMN store_code TEXT;
ALTER TABLE sellers ADD COLUMN country_code TEXT;
ALTER TABLE sellers ADD COLUMN public_identifier TEXT;

-- Backfill: give every existing seller a permanent store_code (6 hex chars,
-- uppercase), a default country_code, and a composed public_identifier.
-- randomblob(8) -> hex -> take first 6 chars for a short opaque code.
UPDATE sellers
SET store_code = substr(upper(hex(randomblob(8))), 1, 6)
WHERE store_code IS NULL OR store_code = '';

-- Default country to EG for legacy rows (they were Egypt-only at launch).
UPDATE sellers
SET country_code = 'EG'
WHERE country_code IS NULL OR country_code = '';

-- Compose the public identifier from ISO + existing slug + store_code.
-- Rows without a slug fall back to "store" so the identifier stays well-formed.
UPDATE sellers
SET public_identifier =
  country_code || '-' ||
  COALESCE(NULLIF(slug, ''), 'store') || '-' ||
  store_code
WHERE public_identifier IS NULL OR public_identifier = '';

-- Uniqueness + fast lookups. store_code and public_identifier are both unique;
-- matching is case-insensitive so shared links resolve regardless of casing.
CREATE UNIQUE INDEX IF NOT EXISTS idx_sellers_store_code
  ON sellers(store_code COLLATE NOCASE);
CREATE UNIQUE INDEX IF NOT EXISTS idx_sellers_public_identifier
  ON sellers(public_identifier COLLATE NOCASE);
