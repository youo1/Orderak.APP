-- 042: give outbound_email_jobs the two columns an outbox needs.
--
-- WHY
--   Email was queued before anything durable existed. QueueTransport pushed the
--   whole job onto the Queue and the consumer created the outbound_email_jobs
--   row on first delivery, so between the two there was no record that an email
--   had been requested at all. A Queue send that failed, or a message that was
--   lost, left nothing behind: no row, no retry, no evidence. The seller waits
--   for a verification mail that was never recorded as attempted.
--
--   Google Play already does this correctly — play_verification_jobs is
--   committed to D1 first, only the id goes on the Queue, and a one-minute
--   sweep recovers jobs whose commit succeeded before the send did. This brings
--   email to the same shape.
--
--   payload         the EmailJob as JSON, so the consumer reads what to send
--                   from the durable record rather than from the message. It is
--                   cleared once the mail is sent: the status history is worth
--                   keeping, the recipient and rendered body are not.
--   dispatched_at   NULL until the Queue accepted the id. That is precisely the
--                   set the sweep re-dispatches.
--
--   Both are nullable: rows written by the previous code have neither, and
--   messages already in flight during the rollout still carry their payload.

ALTER TABLE outbound_email_jobs ADD COLUMN payload TEXT;
ALTER TABLE outbound_email_jobs ADD COLUMN dispatched_at TEXT;

-- The sweep's query: queued, never dispatched, oldest first.
CREATE INDEX IF NOT EXISTS idx_outbound_email_jobs_undispatched
  ON outbound_email_jobs(status, dispatched_at, created_at);
