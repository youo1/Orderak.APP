-- 062_age_confirmation_evidence.sql
--
-- Records affirmative age confirmation on the existing legal-acceptance row.
--
-- The new onboarding account step confirms the canonical statement
-- "عمري ١٨ عامًا أو أكثر" instead of collecting a year of birth. The evidence
-- belongs beside the terms acceptance that was shown in the same step, so it is
-- stored on `legal_acceptances`: erasure already knows how to delete and
-- de-identify those rows, and a separate per-seller table would be left behind.
--
-- All four columns are nullable so existing evidence rows remain valid and keep
-- their current meaning. A legacy request from an installed client records the
-- legacy source with a NULL statement, because that client never displayed the
-- canonical statement. The source marker on the onboarding session carries the
-- account-step decision to completion; it never carries a year of birth.
--
-- This migration is additive only. It does not change city or category columns,
-- does not drop or rewrite any existing column or value, and has no backfill.
--
-- ROLLBACK
--   The columns are nullable and unused by older Workers, so rollback is a
--   Worker revert. Dropping the columns afterward is optional and would discard
--   age-confirmation evidence; no application path requires it.

ALTER TABLE legal_acceptances ADD COLUMN age_confirmation_statement_text TEXT;
ALTER TABLE legal_acceptances ADD COLUMN age_confirmation_source TEXT;
ALTER TABLE legal_acceptances ADD COLUMN age_confirmation_confirmed_at TEXT;
ALTER TABLE legal_acceptances ADD COLUMN age_confirmation_terms_version INTEGER;
ALTER TABLE onboarding_sessions ADD COLUMN age_confirmation_source TEXT;
