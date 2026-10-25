-- 063_clear_stored_birth_years.sql
--
-- D-13 option A: stop retaining a year of birth now that age eligibility is
-- recorded as affirmative confirmation evidence.
--
-- A draft saved by the previous Worker may already have status 'account_saved'
-- with a birth year on the onboarding session and no source marker. Mark those
-- rows first so the legacy completion path can still recognize them after the
-- year is gone. Only then clear the stored values in both columns.
--
-- This migration keeps both birth_year columns. It does not rewrite 033, 039 or
-- 062, and it does not touch the age-confirmation evidence on
-- legal_acceptances; installed clients may still submit a legacy year as age
-- evidence without having it stored.
--
-- ROLLBACK
--   The cleared years cannot be reconstructed from this migration. Restore them
--   from a verified D1 backup if one exists before the migration was applied.

UPDATE onboarding_sessions SET age_confirmation_source='android_onboarding_v2_legacy_birth_year' WHERE status='account_saved' AND birth_year IS NOT NULL AND age_confirmation_source IS NULL;
UPDATE seller_profiles SET birth_year=NULL WHERE birth_year IS NOT NULL;
UPDATE onboarding_sessions SET birth_year=NULL WHERE birth_year IS NOT NULL;
