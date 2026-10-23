-- 064_pending_email_changes.sql
--
-- Adds the pending email-change request for the seller private profile.
--
-- The address and its token hash are transient verification data with a
-- 24-hour validity. Only the sha256 hash of the raw link token is stored; the
-- raw token exists in the transactional verification link only.
--
-- A new request supersedes every outstanding request for the seller before it
-- is inserted. Confirmation consumes only the still-current, unexpired token
-- and replaces the profile email in the same statement. The trigger repeats the
-- case-insensitive uniqueness check so a race with another seller cannot
-- overwrite an address. Used, expired and superseded rows are purged by the
-- existing retention cleanup on the same cadence and window as
-- email_verification_tokens.
--
-- This migration creates only this table, its indexes, and its confirmation
-- trigger. It does not widen email_verification_tokens.kind or change the
-- initial-verification and resend flows.
--
-- ROLLBACK
--   Drop the trigger, then the table. Rolling back discards any pending
--   requests; no current profile email is stored in this table.

CREATE TABLE pending_email_changes (
  id            TEXT PRIMARY KEY,
  seller_id     TEXT NOT NULL,
  email         TEXT NOT NULL,
  token_hash    TEXT NOT NULL UNIQUE,
  created_at    TEXT NOT NULL DEFAULT (datetime('now')),
  expires_at    TEXT NOT NULL,
  used_at       TEXT,
  superseded_at TEXT,
  FOREIGN KEY (seller_id) REFERENCES sellers(id)
);
CREATE INDEX idx_pending_email_changes_seller ON pending_email_changes(seller_id, created_at DESC);
CREATE INDEX idx_pending_email_changes_current ON pending_email_changes(token_hash, used_at, superseded_at, expires_at);
CREATE TRIGGER trg_pending_email_change_applied
AFTER UPDATE OF used_at ON pending_email_changes
WHEN OLD.used_at IS NULL AND NEW.used_at IS NOT NULL
BEGIN
  UPDATE seller_profiles
  SET email_private=NEW.email,email_verified_at=NEW.used_at,updated_at=NEW.used_at
  WHERE seller_id=NEW.seller_id
    AND NOT EXISTS (
      SELECT 1 FROM seller_profiles p
      WHERE p.seller_id!=NEW.seller_id AND lower(p.email_private)=lower(NEW.email)
    );
END;
