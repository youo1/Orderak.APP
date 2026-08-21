---
status: archived
generated: false
owner: security
last_verified: 2026-08-16
applies_to: [production]
---
# Phase 7c — production runtime secret rotation

Executed 2026-08-16, inside the cutover window, after production began
deploying from `Orderak.APP`. Secret values were generated and entered by the
repository owner; none was seen or entered by the assistant, and none is
recorded here.

## Step 0 — migration 043, the blocking prerequisite

Applied during the first production deploy from `Orderak.APP`.

```text
d1_migrations ledger          44 -> 45
admin_audit_exports.signing_key_version   present
22 archives, 22 with a version recorded
```

The backfill mattered: every existing archive carries version 1 explicitly,
so none was left null for the rotation to strand.

## Dependencies, re-measured in the window

The runbook requires this rather than trusting a dated line, because the whole
safety argument rests on it.

```text
buyer_restrictions 0 · buyer_privacy_requests 0 · admin_sessions 0
admin_recovery_codes 10 · totp enrolled 1 · audit archives 22
```

## Rotated

| Secret | Kind |
| --- | --- |
| `BUYER_PRIVACY_PEPPER` | replace — **one value across both Workers** |
| `ADMIN_SESSION_PEPPER` | replace |
| `ADMIN_EXPORT_SIGNING_KEY` | replace |
| `ADMIN_API_KEY` | replace |
| `ADMIN_TOTP_KEY_V2` | **additive** |
| `ADMIN_AUDIT_KEY_V2` | **additive** |

`ADMIN_TOTP_KEY_V1` and `ADMIN_AUDIT_SIGNING_KEY` remain set and must. Version
selectors `ADMIN_TOTP_KEY_CURRENT` and `ADMIN_AUDIT_KEY_CURRENT` were added to
the production config — neither existed before, so both were reaching version 1
through a `?? "1"` fallback — and confirmed live on version
`953b8e73-a266-4caa-a622-0f0c09151896`.

**Ordering held**: both V2 secrets confirmed present before the selectors moved.
The reverse leaves `currentTotpKey()` returning null and fails TOTP closed, on
production, with one enrolled admin.

## Not rotated, each with its reason

| Secret | Why |
| --- | --- |
| `ADMIN_RECOVERY_PEPPER` | Ten live codes would be invalidated; admins must be scheduled to regenerate first |
| `DEEPSEEK_API_KEY` | `AI_ASSISTANT_ENABLED` is `false` |
| `PAYMENT_WEBHOOK_SECRET` | `BILLING_ENABLED` is `false`, and it needs a provider window |
| `FIREBASE_WEB_API_KEY` | A public client identifier, not a bearer credential |
| `ADMIN_API_KEY`, `ADMIN_JWT_SECRET` on the **public** Worker | Vestigial — the correct action is deletion, not rotation |

## Verified

**Sign-in and TOTP.** The owner signed in to `admin.orderak.app`. That is the
check: the session was issued under the rotated `ADMIN_SESSION_PEPPER`, and the
enrolled admin's TOTP ciphertext — recorded under version 1 — still decrypted
with `ADMIN_TOTP_KEY_CURRENT` now `"2"`.

**Archives.** `POST /api/admin/v1/security/audit-archives/verify` returned
`failed: 0`, every result `signing_key_version: 1`. Archives signed under the
old key still verify after the Worker moved to version 2, which is the property
migration 043 exists for.

### And a defect the verification itself exposed

The endpoint reported **`checked: 20`** against production's **22** archives.
The route took the function's default limit and said nothing about the
remainder, so `failed: 0` read as "all archives verify" while two were never
examined — and because the query orders by `last_audit_id DESC`, the two skipped
were the **oldest**, the ones most likely to have lost their key or rotted.

Found by comparing the assistant's run against the owner's report of the same
call: 20 against 22 is exactly the default. The response now returns `written`
and `unchecked` alongside `checked` whether or not anything failed, and
`?limit=N` raises the bound.

## The production soak, and why it is not a load test

Phase 8 says to soak production after this rotation. `api-load.js` refuses to
run against production by design:

```js
if (/^https:\/\/api\.orderak\.app$/i.test(baseUrl)) {
  throw new Error("Load tests are forbidden against production.");
}
```

That guard was not bypassed. A cutover soak is an **observation period** under
real traffic, not synthetic load — and production carries no organic traffic
(0 orders, 1 seller), so there is nothing for a monitoring window to measure.
This is the same gap already recorded for the auth-failure-rate and
queue-backlog triggers.

What was done instead, and labelled as what it is: **an 8-minute observation at
roughly 0.17 requests/second** — monitoring, not load.

| Surface | n | codes | median | p95 | max |
| --- | --- | --- | --- | --- | --- |
| `api.orderak.app/health` | 80 | 200 × 80 | 201 ms | 316 ms | 350 ms |
| `admin.orderak.app/` | 80 | 200 × 80 | 210 ms | 239 ms | 325 ms |

Zero non-200 across 160 samples. That is evidence the rotation did not break
production. **It is not a soak**, and does not satisfy Phase 8's requirement;
that requirement cannot be satisfied until production carries real traffic.
