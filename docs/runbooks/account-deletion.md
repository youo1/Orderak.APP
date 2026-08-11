# Account deletion runbook

> **Status:** Fail-closed fulfillment implemented; production activation gated
>
> **Owner:** Privacy process owner — Ayman Mohamed Abdellatif
>
> **Target:** Complete a verified request within the published 90-day product
> commitment, subject to legal review and documented retention exceptions.
>
> **Authority:** `docs/governance/retention-matrix.md` defines the intended data
> treatment. This runbook describes the current safe operating procedure.

Use this runbook for requests received through the authenticated Android path,
`https://orderak.app/delete-account`, or `support@orderak.app`.

## 1. Current implementation status

The daily scheduled handler calls `processDeletionRequests()`. It selects only
`verified` requests whose `deadline_at` is due, in batches of ten. Billing
cancellation, deletion and verification of the seller's R2 prefix, and Firebase
Authentication deletion through service-account OAuth must succeed before the
D1 cleanup batch can de-identify evidence and mark the request `completed`.
Failures leave the request verified and retryable.

Production activation still requires migration 026, the three Firebase Admin
Worker secrets, least-privilege IAM, staging success/failure/retry evidence, a
current retention-matrix review, and an operator alert for approaching deadlines.
Until those deployment gates are recorded, do not claim that production
fulfillment is active merely because repository code exists.

## 2. Intake and identity verification

1. Review pending and verified requests every business day:

   ```cmd
   cd services/backend
   npx wrangler d1 execute orderak-db --remote --command "SELECT id,phone_e164,email,source,status,requested_at,verified_at,deadline_at FROM deletion_requests WHERE status IN ('pending','verified') ORDER BY deadline_at"
   ```

2. Treat `android_authenticated` requests as verified only when the request row
   was created through the authenticated seller endpoint.
3. For a public-web or email request, do not rely on knowledge of the phone
   number. Ask the requester to sign in and use **Settings → Request account
   deletion**, or complete a fresh Firebase SMS verification for the exact
   account phone. Record only the verification outcome and UTC time.
4. Record requested export, subscription cancellation, legal-hold, accounting,
   and dispute requirements before fulfillment.
5. Escalate any identity mismatch or legal hold to the privacy owner. Do not
   delete while identity or scope is uncertain.

## 3. Pre-deletion gate

Until production activation evidence is approved, every fulfillment requires:

- explicit privacy-owner and engineering-lead approval;
- the exact request ID, seller ID, Firebase UID, and R2 prefix independently
  checked by two people;
- a current D1 Time Travel bookmark and protected export;
- an inventory of seller-scoped rows and R2 objects before deletion;
- a tested, request-specific script generated from the current production
  schema—not copied from an old runbook;
- a maintenance window and a documented rollback/incident path.

The reviewer must reconcile the script with every row in the retention matrix.
In particular, legal and accounting records may require de-identification or
continued retention instead of deletion.

## 4. Controlled fulfillment sequence

Execute the approved script first against a restored or staging copy with the
same schema, then in production:

1. Cancel active external subscriptions and capture the provider result. Do not
   continue on an unexplained cancellation failure.
2. Provide the requested data export before destructive processing.
3. Delete all R2 objects under the independently verified
   `stores/<seller-uuid>/` prefix and verify the prefix is empty.
4. Delete seller-scoped child records before parent records: order items and
   orders; translation/media/variant rows and products; categories; promotional
   links; support records; and device credentials.
5. Apply the approved billing, consent-evidence, seller-identity, store-code,
   referral-code, and legal-hold treatment from the reviewed retention decision.
6. Delete the corresponding Firebase Authentication user with an authorized
   Firebase administrative mechanism and capture confirmation.
7. Re-query every in-scope table and R2 prefix before changing the request to
   `completed`.
8. Store minimized completion evidence and notify the requester without
   exposing internal IDs.

Do not paste a general-purpose production `DELETE` transaction into this
document. The schema and legal retention decisions can change; an executable
script must be generated, reviewed, and attached to the individual change
record.

## 5. Verification and closure

Confirm and record:

- all seller device credentials are invalid;
- personal store/contact/payout fields are removed or approved for retention;
- buyer/order/catalog/support data follows the reviewed retention decision;
- R2 contains no object under the seller prefix;
- the Firebase Authentication user is deleted;
- external subscriptions are cancelled;
- required legal/accounting evidence is minimized and isolated;
- the deletion request is de-identified and marked complete only after all
  mandatory steps succeed;
- the requester receives a completion notice and a clear description of any
  lawful retention exception.

If any mandatory step fails, keep the request open, record the failure without
PII in logs, restore/contain if necessary, and escalate before the deadline.

## 6. Scheduled processing

The Worker cron runs both technical retention cleanup and deadline-due account
deletion processing at 02:17 UTC. Technical cleanup covers `error_logs`, IP
fields, `admin_sessions`, rate-limit buckets, webhook/email events, impressions,
and expired announcements. Account deletion is a separate fail-closed workflow
within the same scheduled event.

Cloudflare Workers Logs retention is plan-dependent: currently 3 days on
Workers Free and 7 days on Workers Paid. Verify the active plan and export
incident evidence before it expires.

## 7. Release gate for automation

Automatic fulfillment may be documented as current only after a separately
approved code change proves that:

- the scheduler invokes the idempotent workflow and duplicate/retry behavior is tested;
- external-service failures prevent false completion;
- Firebase deletion is implemented and verified;
- retention-matrix treatment matches the code field by field;
- retries are idempotent and concurrency-safe;
- integration tests cover success, partial failure, recovery, legal hold, and
  deadline monitoring;
- an operator alert is raised for every request approaching its deadline.

## References

- [Cloudflare D1 Time Travel and backups](https://developers.cloudflare.com/d1/reference/time-travel/)
- `docs/governance/retention-matrix.md`
- `docs/architecture/security-model.md`
