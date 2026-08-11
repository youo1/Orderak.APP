-- Clear slugs that look like phone numbers (all digits, at least 7 digits).
-- The backend will regenerate a safe slug (e.g. EG-store-x7k2m9pa)
-- next time the seller syncs (Register request).
UPDATE sellers
SET slug = NULL
WHERE slug NOT GLOB '*[^0-9]*'   -- slug is all digits
  AND length(slug) >= 7;         -- minimum phone number length
