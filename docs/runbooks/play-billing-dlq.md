---
status: current
generated: false
owner: backend
last_verified: 2026-09-06
applies_to: [production, staging]
---
# Google Play billing DLQ runbook

Use this runbook for any `play_verification_dlq` or
`play_security_conflict` alert. One event may represent paid access not granted,
access not revoked, or an acknowledgement requiring intervention. Treat every
event as urgent; never copy token ciphertext into tickets, chat, or logs.

Every step below is available in the admin console under
**Commerce → Purchase verification**, which lists the queue, shows health, and
performs the audited requeue. The API calls are named so the runbook stays
readable when the console is unavailable, not because they are the intended
route. A purchase is money already taken; the recovery path for a paying seller
should not require a terminal.

## Triage

1. Open the job. In the console, filter by status `dead_lettered` and select the
   row; by API, `GET /api/admin/v1/billing/verifications/{id}` with
   `subscriptions:view`. Record job ID, organization, source, attempt count,
   sanitized error, generation, and timestamps. Neither surface exposes the raw
   token or ciphertext.
2. Check queue health — shown on the same console page, or
   `/api/admin/v1/billing/health`: lifecycle/acquisition flags, oldest queued
   message, backlog, undispatched count, DLQ count, provider circuit state,
   claim-duration p50/p95/max versus 120 seconds, and reclaim frequency.
3. Check Cloudflare Queue metrics for `orderak-play-billing` and D1 query
   latency/QPS/storage. Do not infer or report an internal D1 queue depth.
4. For `linked_purchase_cross_organization`, `purchase_token_reused`, account
   mismatch, or package mismatch: do not requeue until Security confirms the
   organization binding. Preserve all audit evidence.
5. For timeout, connection, `408`, `409`, `429`, or `5xx`: confirm Google Play
   recovery and that the circuit is closed/half-open before requeueing.
6. For disabled mapping or unsupported purchase shape: verify Play Console
   product/base-plan/add-on configuration. Keep the last authoritative access;
   do not manually grant from RTDN content or a screenshot.

## Audited requeue

1. An administrator with `subscriptions:manage` requests a fresh action
   authorization for action `billing.verification_retry` and entity ID equal to
   the dead-lettered job ID. Fresh password and TOTP are required; the approval
   expires in five minutes and is single-use. The console requests this for you
   when you submit the requeue form.
2. Submit the requeue with a written reason. The console does this; by API it is
   `POST /api/admin/v1/billing/verifications/{id}/retry` with header
   `x-admin-action-authorization` and JSON `{ "reason": "..." }`. A job that is
   not `dead_lettered` is refused with 409 `verification_not_dead_lettered` —
   the queue has not given up on it yet, and requeuing is not a way to hurry it.
3. Record the returned verification ID. Repeating the same authorized request
   returns the existing child; the dead-lettered parent can create only one.
   The action reuses encrypted D1 material and writes an audit event.
4. Follow the new job to `succeeded`, `superseded`, or a new terminal/DLQ state.
   Confirm the seller's fresh entitlement snapshot and acknowledgement state.

## Recovery checks

Queue delivery is at-least-once. A duplicate received during an active lease is
an acknowledged no-op and must not call Google. An expired lease is reclaimable.
A paused zombie Worker can resume after expiry and duplicate a verification or
acknowledgement call; neither creates a purchase charge. Claim-token writes and
organization generations prevent stale Orderak state.

For any reclaim, inspect `lease_reclaim_count`, `last_lease_reclaimed_at`, claim
duration percentiles, D1/provider latency, Worker exceptions, and redelivery.
Alert when p95 approaches 120 seconds or reclaims persist. Change the lease only
with recorded dashboard evidence and reviewed deployment—not during an incident.

- `undispatched = 0` and no pending job older than five minutes.
- DLQ has no unreviewed events; every security conflict has a Security owner.
- Queue backlog is below 100 and oldest-message age below five minutes.
- Provider circuit has closed after a successful half-open probe.
- The affected organization's latest Play purchase and entitlement generation
  match; no replaced token retains standalone access.
- Incident/audit record includes root cause, customer impact, remediation, and
  whether finance, security, or release approval is required.

## Rollback

If failures affect new acquisitions, set `BILLING_ENABLED=false` and the D1
`billing_enabled` control to false. After any real purchase, keep
`GOOGLE_PLAY_LIFECYCLE_ENABLED=true` so RTDN, reconciliation, refunds,
revocations, restore, and acknowledgement continue. Do not deactivate mappings
needed to interpret existing purchases.
