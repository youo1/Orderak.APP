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

## What was verified, and what was not

**Verified independently — no secret required.** All five staging archives
still match the content hash recorded in D1. Each object was downloaded from
`orderak-admin-audit-staging` and its SHA-256 recomputed:

```text
HASH OK  audit/2026-08-01/9-11-d1f2163977a84fb4.json  v1  (693 bytes)
HASH OK  audit/2026-07-31/7-8-f835e20ce75e8e01.json   v1  (454 bytes)
HASH OK  audit/2026-07-31/4-6-26ee44295fb34baa.json   v1  (661 bytes)
HASH OK  audit/2026-07-31/2-3-88d7c53bb0583282.json   v1  (458 bytes)
HASH OK  audit/2026-07-31/1-1-d237631b6bb09d7c.json   v1  (270 bytes)

content-hash verification: 5 pass, 0 fail
```

All five are `signing_key_version = 1`, written before the rotation. Their
objects are intact after it.

**Not verified — requires the signing key or an admin session:**

1. **HMAC signature** of those five archives. The content hash proves the
   object was not altered; only the signature proves it was written by
   something holding the key. That check lives inside the Worker, which is why
   the endpoint was needed, and it has not been called yet.
2. Admin sign-in under the new `ADMIN_JWT_SECRET` and `ADMIN_SESSION_PEPPER`.
3. A TOTP challenge by the one enrolled admin, proving V1 ciphertext still
   decrypts after `ADMIN_TOTP_KEY_CURRENT` moved to 2.
4. A recovery-code use.
5. A buyer-restriction round trip, proving both Workers received the same
   `BUYER_PRIVACY_PEPPER`. Cannot be checked from outside: computing the hash
   requires the pepper, and confirming a match requires driving a restriction
   through the admin Worker and an order through the public one.

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

## Residual state

Staging is running on rotated secrets with both key versions live. The
rotation is **not fully proven** until the five checks above are performed by
someone holding an admin session. Until then the strongest statement supported
by evidence is: the secrets are in place, the version selectors are live in the
deployed Worker, and archive contents are intact.
