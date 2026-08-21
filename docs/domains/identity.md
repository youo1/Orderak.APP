---
status: current
generated: false
owner: backend
last_verified: 2026-08-21
applies_to: [production, staging]
authoritative_for: [identity-domain]
---
# Identity domain

Who a seller is, how they prove it, and how the account ends.

This page covers the account. The store that account owns — its code, slug and
public URL — is the [stores domain](./stores.md), even though both live in the
same table. See [One table, two meanings](#one-table-two-meanings).

## Runtime state

| Flag | Production | Staging |
| --- | --- | --- |
| `AUTH_IDENTITY_ENABLED` | `true` | `true` |
| `PHONE_CHANGE_ENABLED` | `true` | `true` |
| `ONBOARDING_ENABLED` | `false` | `true` |
| `PASSKEY_ENABLED` | `false` | `true` |
| `LOCAL_JWT_VERIFICATION` | `false` | `true` |

Onboarding v2 and passkeys are held closed in production until the release
gates in the [production auth plan](../product/production-auth-plan.md) are met —
Play signing is the outstanding one. Staging keeps them on so the flow stays
testable. Flip them together with that document, not before.

`LOCAL_JWT_VERIFICATION` is a staging convenience. Production verifies Firebase
tokens against Google, not locally.

## One table, two meanings

`sellers` is both the account row and the store row. It was created in
`001_init.sql` as the seller table, and store identity — `store_code`, `slug`,
`public_identifier`, `country_code` — was added to the same table later.

The consequence is that **`seller_id` and `store_id` are the same value** and
both names appear in the codebase for it. Nothing distinguishes an account from
its store at the schema level, because there is exactly one of each per row.

The organization layer sits above this and is where multi-store and
multi-member modelling actually happens; see
[entitlements](./entitlements.md#the-naming-trap-first) for that model.

## Tables

| Table | Holds |
| --- | --- |
| `sellers` | The account and its store, merged. Phone is unique. |
| `seller_profiles` | Full name and optional private email, keyed 1:1 by `seller_id`. Unique index on `lower(email_private)`. |
| `seller_auth_identities` | Verified provider identities. `provider` is constrained to `firebase_phone`; `status` is `active`, `superseded` or `revoked`. |
| `seller_devices` | One row per authorized device: `(seller_id, secret_hash)`. Only the hash is stored. |
| `passkey_credentials` / `webauthn_challenges` | WebAuthn credentials and in-flight challenges. |
| `recent_auth_proofs` | Short-lived proof that a strong authentication happened recently, for step-up. |
| `onboarding_sessions` | Resumable onboarding drafts with an absolute expiry. |
| `phone_change_challenges` | In-flight phone-number changes. |
| `email_verification_tokens` | Single-use verification links for the optional private email. |
| `deletion_requests` | Account-deletion intake and fulfillment state. |
| `legal_acceptances` | Which policy version a seller accepted, and when. |
| `identity_migration_issues` | Records identities the v2 backfill could not resolve. |

## Authentication

**Firebase phone OTP is the primary flow.** The Android app performs the SMS
verification; the backend verifies the resulting token and never sees the code.
`syncVerifiedFirebaseIdentity` and `findSellerByVerifiedIdentity` in
`services/backend/src/domains/identity/identity.ts` are the join between a
verified Firebase subject and an Orderak account.

The guarantees this flow must hold — phone binding, replay resistance, stale
callback rejection, resend state — are a versioned contract, not an
implementation detail. They live in the
[seller authentication contract](../contracts/auth-phase1-contract.md) and the
[authentication security invariants](../contracts/authentication-security-invariants.md).
**Those documents are authoritative over this one on anything security-relevant.**

**Passkeys** are implemented with `@simplewebauthn/server` and exposed under
`/api/v1/auth/passkeys/*` — registration options and completion, authentication
options and completion, and a list endpoint. Gated by `PASSKEY_ENABLED`.

**Onboarding v2** runs `/api/v1/onboarding/account`, `/api/v1/onboarding/complete`
and `/api/v1/onboarding/slug/check`, backed by `onboarding_sessions`. An
onboarding session is a resumable draft only — D1 remains the account authority,
and nothing is real until completion.

### Device secrets have one implementation

`provisionDeviceSecret` in `domains/identity/seller-session.ts` authorizes a
client-generated device secret after strong proof. Legacy OTP, onboarding v2 and
passkey sign-in all call the same function.

That is deliberate and worth preserving: three separate implementations would
let device caps and single-device recovery drift apart silently. The function
also enforces the `max_concurrent_devices` entitlement when
`ENTITLEMENTS_ENABLED` is true, which is why an identity concern reaches into
the [entitlements domain](./entitlements.md).

Only `secret_hash` is stored. The secret itself exists on the device and in the
request that provisioned it, nowhere else.

## Phone change

`domains/identity/phone-change.ts`, gated by `PHONE_CHANGE_ENABLED`, moves an
account to a new verified number through `phone_change_challenges`. The
transferred value is E.164, resend state is bound to the phone number, and
stale callbacks are rejected — properties fixed by the authentication contract
rather than chosen here.

## Account deletion

> **Status: intake works; fulfillment is not confirmed.** `docs/index.md`
> carries this as the repository's only P0, tracked as `ISS-013` / `FND-011`.
> The code described below exists and is reachable. Whether it completes
> correctly in production has not been evidenced.

`domains/identity/deletion.ts` provides intake over `handleDeletionRoutes`, a
scheduled sweep in `processDeletionRequests`, per-request fulfillment in
`fulfillDeletion`, and an administrator-triggered `retryDeletionRequest`.

Fulfillment reaches outside D1: it deletes the Firebase identity via the
Firebase Admin API and cancels any gateway subscriptions it can enumerate. Both
are external calls that can fail independently of the D1 write, which is the
part that needs evidence before this P0 can close.

Operate this through the
[account deletion runbook](../runbooks/account-deletion.md), which is marked
blocked for the same reason.

## Retention

`domains/identity/retention.ts` runs a daily cleanup over **16 rules**. Some
delete rows; some only null out an IP column while keeping the record, which is
the right shape for audit data that must survive its personal data.

Each rule deletes in batches of 1,000 and stops after at most 10 batches per
run, so one rule can clear at most 10,000 rows per day. That bound is
intentional — it keeps a single cron invocation inside its time budget and
turns a large backlog into several days of work rather than one long
transaction.

Representative periods: `error_logs` 30 days, `webhook_events` 90 days,
`admin_audit` IP nulled at 30 days and the row deleted at 2 years,
`webauthn_challenges` and `recent_auth_proofs` 1 day past expiry.

The rule list in code is the implementation. The **legal** retention position is
the [retention matrix](../governance/retention-matrix.md), and the two must
agree; where they disagree, the matrix states the commitment and the code is the
defect.

## Boundaries

- **Store identity** — codes, slugs, public URLs — is the [stores domain](./stores.md).
- **Organizations, membership and tenancy** are covered in [entitlements](./entitlements.md).
- **Admin users** are a separate identity system entirely: `admin_users`,
  `admin_sessions`, `admin_recovery_codes`, `admin_invitations`. They belong to
  the admin control plane and share no tables with sellers.
- **Security properties** belong to the contracts, not here.

## Related

- [Seller authentication contract](../contracts/auth-phase1-contract.md)
- [Authentication security invariants](../contracts/authentication-security-invariants.md)
- [Android auth profile](../platforms/android-auth-profile.md)
- [Production auth plan](../product/production-auth-plan.md)
- [Account deletion runbook](../runbooks/account-deletion.md)
- [Firebase authentication outage runbook](../runbooks/firebase-auth-outage.md)
- [Retention and deletion matrix](../governance/retention-matrix.md)
