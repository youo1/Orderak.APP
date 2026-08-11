-- Atomic Google Play verification claims. Queue delivery remains at-least-once;
-- the lease serializes Orderak state transitions without claiming exactly-once
-- provider calls.

ALTER TABLE play_verification_jobs ADD COLUMN claim_token TEXT;
ALTER TABLE play_verification_jobs ADD COLUMN claim_started_at TEXT;
ALTER TABLE play_verification_jobs ADD COLUMN claim_expires_at TEXT;
ALTER TABLE play_verification_jobs
  ADD COLUMN lease_reclaim_count INTEGER NOT NULL DEFAULT 0;
ALTER TABLE play_verification_jobs ADD COLUMN last_lease_reclaimed_at TEXT;
ALTER TABLE play_verification_jobs ADD COLUMN requeued_from_job_id TEXT
  REFERENCES play_verification_jobs(id);

CREATE INDEX idx_play_jobs_claimable
  ON play_verification_jobs(status,next_attempt_at,claim_expires_at,created_at);

-- An authorized DLQ action is idempotent: one dead-lettered parent can create
-- at most one child verification job.
CREATE UNIQUE INDEX idx_play_jobs_one_requeue_child
  ON play_verification_jobs(requeued_from_job_id)
  WHERE requeued_from_job_id IS NOT NULL;

PRAGMA optimize;
