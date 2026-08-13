---
status: current
generated: false
owner: backend
last_verified: 2026-08-13
applies_to: [staging]
---
# Phase 7b — staging runtime secret rotation

Executed 2026-08-13. **Staging only.** Production is untouched, per the plan.

Secret values were generated and entered by the repository owner. They were
never transmitted to, seen by, or entered by the assistant, and no value is
recorded here or anywhere else in the repository.

## What was rotated

Seven distinct values across two Workers.

| Secret | Worker | Kind |
| --- | --- | --- |
| `BUYER_PRIVACY_PEPPER` | both, one value | replace |
| `ADMIN_SESSION_PEPPER` | admin | replace |
| `ADMIN_EXPORT_SIGNING_KEY` | admin | replace |
| `ADMIN_JWT_SECRET` | admin | replace |
| `ADMIN_API_KEY` | admin | replace |
| `ADMIN_TOTP_KEY_V2` | admin | **additive** |
| `ADMIN_AUDIT_KEY_V2` | admin | **additive** |

Confirmed by `wrangler secret list` after the fact: `orderak-worker-staging`
carries 2 secrets, `orderak-admin-worker-staging` carries 11, and
`ADMIN_TOTP_KEY_V1` and `ADMIN_AUDIT_SIGNING_KEY` are **both still present**.
That is the point of an additive rotation — existing ciphertext and existing
archives record the version they were written under, so the old key must
survive its own replacement.

**Not rotated:** `ADMIN_RECOVERY_PEPPER`, deferred because it would invalidate
all 10 stored recovery codes and needs admins scheduled to regenerate first.
`ADMIN_BREAK_GLASS_IP_ALLOWLIST` is configuration, not a credential.
`FIREBASE_WEB_API_KEY` is issued by Google and rotates from the Firebase
console.

## Ordering, and why it was not optional

Both V2 secrets were confirmed present **before** the version selectors were
moved. Reversing that order would leave `currentTotpKey()` resolving to an
unset key and returning `null`, which fails TOTP closed and locks out the
enrolled admin.

`ADMIN_AUDIT_KEY_CURRENT` had never been declared anywhere. The code read it
through a `?? "1"` fallback, so behaviour was right but the active version was
implied rather than stated. It is now declared explicitly, which is where
someone debugging a signature mismatch will look for it.

## Deploy

The first deploy **failed**, on the deployment-map tripwire:

```text
OpenAPI operation inventory changed: expected 245, found 246.
```

That is the tripwire working, not a problem with it — a new route reached the
deploy without the spec inventory being deliberately updated. Raised to 246 and
redeployed.

Confirmed against the deployed version `26574065-a195-4a9b-a94d-4c33b2b737f4`
rather than against the config file:

```text
env.ADMIN_AUDIT_KEY_CURRENT ("2")
env.ADMIN_TOTP_KEY_CURRENT  ("2")
```

## The gap this phase exposed

The runbook names "verification of an archive written before the rotation" as
the check that proves an additive rotation worked. **It could not be run.**

`verifyAuditArchives()` had existed with tests since migration 043 landed, and
nothing outside the test suite ever called it. No route, no cron, no queue
consumer. So on a live system `admin_audit_exports.verified_at` was still never
written and no signature was ever checked — the exact defect the function was
written to close, reproduced one level up in the wiring.

Closed by `POST /api/admin/v1/security/audit-archives/verify`, gated on
`security:manage`, audited as `admin.audit_archives_verified`, with five tests
covering the wiring rather than the logic.

## Verification

### Stage 1 — content hashes, before any admin session existed

All five archives then present still matched the content hash recorded in D1.
Each object was downloaded from `orderak-admin-audit-staging` and its SHA-256
recomputed independently of the Worker:

```text
HASH OK  audit/2026-08-01/9-11-d1f2163977a84fb4.json  v1  (693 bytes)
HASH OK  audit/2026-07-31/7-8-f835e20ce75e8e01.json   v1  (454 bytes)
HASH OK  audit/2026-07-31/4-6-26ee44295fb34baa.json   v1  (661 bytes)
HASH OK  audit/2026-07-31/2-3-88d7c53bb0583282.json   v1  (458 bytes)
HASH OK  audit/2026-07-31/1-1-d237631b6bb09d7c.json   v1  (270 bytes)

content-hash verification: 5 pass, 0 fail
```

This proves the objects were not altered. It cannot prove they were written by
something holding the signing key — only the HMAC does that, and the key lives
inside the Worker.

### Stage 2 — signatures, through the new endpoint

The repository owner signed in to the staging panel and the endpoint was
called against that session. **Password and TOTP code were entered by the
owner; the assistant neither saw nor entered either.**

`POST /api/admin/v1/security/audit-archives/verify` → `200`:

```text
checked: 6   failed: 0

audit/2026-08-13/12-12-c120914842d2ea92.json   v2   ok
audit/2026-08-01/9-11-d1f2163977a84fb4.json    v1   ok
audit/2026-07-31/7-8-f835e20ce75e8e01.json     v1   ok
audit/2026-07-31/4-6-26ee44295fb34baa.json     v1   ok
audit/2026-07-31/2-3-88d7c53bb0583282.json     v1   ok
audit/2026-07-31/1-1-d237631b6bb09d7c.json     v1   ok
```

**Six, not five.** A new archive was written on 2026-08-13 under
`signing_key_version = 2` — the rotation's first output, produced by the
audit events from this session's own activity.

That makes the result stronger than the check was designed to be. It proves
both directions in one call:

- five archives signed under **version 1** still verify after the Worker moved
  to version 2, which is the property migration 043 exists for; and
- a new archive signed under **version 2** verifies, so the rotated key is
  live and correct rather than merely configured.

`admin_audit_exports.verified_at` is now populated for **6 of 6** rows. Before
this call it was 0 of 6, and had been 0 for the lifetime of the table.

### Stage 3 — sign-in and TOTP

Sign-in succeeded on the first attempt, which is itself the check: the session
was issued under the rotated `ADMIN_SESSION_PEPPER`, and the TOTP challenge
passed for the one enrolled admin whose secret is encrypted under **version 1**
while `ADMIN_TOTP_KEY_CURRENT` is now `"2"`. Additive rotation confirmed on the
TOTP path as well as the audit path.

**Correction.** An earlier version of this record said the session was issued
under the rotated `ADMIN_JWT_SECRET` as well. That is wrong. On the admin
Worker `ADMIN_JWT_SECRET` is read only when `LOCAL_ADMIN_ENABLED` is `"true"`
(`admin-auth.ts:180`), a bearer-token path for local development.
`LOCAL_ADMIN_ENABLED` is set in no environment, so the path is closed and the
value is **inert** on the deployed Worker — it is not on Production at all.
Rotating it was harmless but proved nothing, and sign-in did not exercise it.
Sessions are cookie-based and peppered with `ADMIN_SESSION_PEPPER`.

### Stage 4 — one pepper across two Workers

A restriction was created through the **admin** Worker for `+201555000111`,
then an order was submitted to the **public** Worker for the same number.

| Request | Result |
| --- | --- |
| restricted number | `403 buyer_restricted` |
| a different number (control) | `400 products` |
| restricted number, after revoke | `400 products` |

The control matters. Without it, a `403` proves only that the order was
rejected, not *why*. A different number reaching `400 products` — a later
failure, at product resolution — shows the `403` was specifically the
restriction matching, which can only happen if the hash the admin Worker wrote
equals the hash the public Worker computed. **Both Workers hold the same
`BUYER_PRIVACY_PEPPER`.**

The third row confirms the revoke took effect, so the check cleaned up after
itself. `buyer_restrictions` is back to 0 active; the revoked row is retained
deliberately, as the audit trail of the restriction having existed.

The order used a deliberately non-existent `product_code`, because the staging
store has zero products. The restriction check runs *before* product
resolution, so the two outcomes stay distinguishable without seeding data.

### Not performed — recovery code

The runbook lists a recovery-code use. **Deliberately skipped.**
`ADMIN_RECOVERY_PEPPER` was not rotated, so the ten stored codes are untouched
by this rotation and the check would prove nothing about it. The session such a
login issues uses the same `ADMIN_JWT_SECRET` and `ADMIN_SESSION_PEPPER` that
stage 3 already exercised, and using a code consumes one of ten. It belongs to
the rotation of that pepper, not this one.

### A probe that did not work

Route reachability was probed by expecting `401` for a wired route and `404`
for an unrouted one — the technique that resolved the `handleDeletionRoutes`
question in Phase 5b. **It does not discriminate on the admin Worker**, which
authenticates before routing:

```text
POST /api/admin/v1/security/audit-archives/verify  -> 401
POST /api/admin/v1/security                        -> 401
POST /api/admin/v1/definitely-not-a-route          -> 401
```

A known-bad path returns 401 as well, so the probe proves nothing about
routing. Recorded because the same technique will be reached for again, and it
is only valid on the public Worker.

## Outcome

**Phase 7b is complete for staging.** Every check the runbook names was
performed except the recovery-code use, which is deferred with a stated reason
rather than skipped silently.

What the evidence supports, stated at full strength:

- Seven secrets rotated; both prior key versions retained and still in use.
- Archives signed under version 1 verify after the move to version 2, and a
  new archive signed under version 2 verifies. Rotation proven in both
  directions.
- `verified_at` is written on a live system for the first time.
- Sign-in and TOTP work under the rotated secrets.
- Both Workers demonstrably share one `BUYER_PRIVACY_PEPPER`, established with
  a control rather than a single positive.

Outstanding, and tracked elsewhere:

- `ADMIN_RECOVERY_PEPPER` rotation, once admins are scheduled to regenerate
  their ten codes. The recovery-code check belongs to that work.
- Phase 7c, production. Not started; the plan holds production untouched until
  cutover.
