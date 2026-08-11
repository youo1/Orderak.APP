# ADR-006: Authoritative asynchronous Google Play lifecycle verification

**Status:** accepted; production activation gated

**Date:** 2026-07-22

**Supersedes:** none; extends ADR-005

**Superseded by:** none

## Context

Direct verification, RTDN, reconciliation, and operational retries can arrive
concurrently and out of order. Pub/Sub redelivery is unordered, a Worker can
commit D1 state and fail before queue dispatch, and Google may be temporarily
unavailable. A purchase token identifies a subscription entity but does not
uniquely identify each lifecycle transition. Disabling new sales must not stop
renewal, refund, revocation, restore, or acknowledgement processing for payers.

## Decision

Keep D1 as the billing and entitlement authority; do not introduce Durable
Objects without measured D1 overload or hot-organization contention.

All verification sources create a `play_verification_jobs` outbox row containing
AES-GCM token ciphertext and dispatch only `{version:1,jobId}` to the dedicated
`orderak-play-billing` queue. The private Admin Worker consumes at bounded batch
size/concurrency. An organization-scoped monotonic generation is incremented
immediately before the authoritative Google query; D1 triggers abort the entire
subscription/purchase write batch if a newer generation has started. RTDN
notification type/timestamp never grants or revokes access by itself.

Entitlement state commits before acknowledgement. Retryable provider failures
use bounded exponential queue retry; exhausted jobs enter a separate DLQ whose
consumer persists state, audit evidence, and an alert. RBAC/fresh-auth admin
requeue creates a new job without decrypting or returning the token. A minute
outbox sweep recovers database/queue dispatch gaps and daily reconciliation
enqueues the least-recently-verified entities through the same path.

Queue delivery is at-least-once. A claimant uses one atomic `UPDATE … RETURNING`
to acquire a 120-second lease and increment the attempt count. Every job-state
write requires its current random claim token; active-lease duplicates are
acknowledged as no-ops, and expired leases are reclaimable. Generation guards
remain the final entitlement-write defense. A zombie Worker can resume after
expiry and duplicate a Google verification or acknowledgement call, but cannot
commit with a stale claim/generation. These calls never create a purchase
charge. Lease duration/reclaims are monitored and the constant changes only
from recorded percentile evidence. A dead-lettered parent has at most one
idempotent requeue child.

Separate `BILLING_ENABLED` acquisition from
`GOOGLE_PLAY_LIFECYCLE_ENABLED`. After the first real purchase, rollback turns
off acquisition while keeping lifecycle processing on.

## Consequences

- Delayed responses cannot overwrite newer organization state.
- Queue/Pub/Sub duplicates are safe and every lifecycle job re-queries Google.
- D1, Queue, DLQ, secrets, alerting, and a tested on-call runbook become release
  dependencies.
- Direct verification may return `202 verification_pending`; Android must
  persist only the verification ID/retry time and poll in WorkManager.
- Unsupported multiple-active/add-on shapes fail closed and retain the last
  authoritative entitlement, requiring operational review.
- The generation is organization-wide, so a very hot organization may
  supersede more work; this is intentional safety and an observable signal.

## Alternatives considered

- **Durable Objects per organization:** provides serialized execution but adds
  routing, testing, and operational complexity before contention evidence.
- **Purchase-token deduplication only:** cannot distinguish ordered lifecycle
  states and can allow an older response to overwrite a newer one.
- **Synchronous RTDN/direct writes:** leaves dispatch/retry gaps and couples user
  latency to provider availability.
- **Disable all billing on rollback:** strands existing payers and misses
  revocations/refunds, so only acquisition may be disabled after launch.
