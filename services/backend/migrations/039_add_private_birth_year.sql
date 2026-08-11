-- Forward repair for Auth V6 birth-year storage.
--
-- Migration 033 was already applied in production before the approved
-- birth-year amendment was authored. Keep 033 as deployed history and add the
-- private fields here so both migration replay and existing databases converge.
ALTER TABLE onboarding_sessions
  ADD COLUMN birth_year INTEGER
  CHECK (birth_year IS NULL OR birth_year BETWEEN 1900 AND 9999);

-- Nullable at the schema layer for legacy profiles. Auth V6 onboarding still
-- requires and validates a birth year before every new profile insert.
ALTER TABLE seller_profiles
  ADD COLUMN birth_year INTEGER
  CHECK (birth_year IS NULL OR birth_year BETWEEN 1900 AND 9999);
