---
status: current
generated: false
owner: security
last_verified: 2026-08-12
applies_to: [production, staging]
---
# Worker secret rotation runbook

> **Status:** Staging procedure verified against the live Staging Workers on
> 2026-08-12. Production is the same procedure against different values, but
> its row counts must be re-measured first — every "safe to rotate" verdict
> below is a statement about Staging's data, not a property of the key.

Worker runtime secrets live on the Worker, not in either repository. Rotating
one is `wrangler secret put`, which **deploys a new Worker version on every
call** — so rotating several one at a time walks the Worker through several
intermediate states, each live. Rotate a related set together and verify once.

## What is actually set, and what rotating it costs

Measured with `wrangler secret list` and row counts against
`orderak-db-staging`, not from a design document.

### `orderak-worker-staging` — 2 secrets

| Secret | Depends on stored data? | Verdict |
| --- | --- | --- |
| `BUYER_PRIVACY_PEPPER` | `buyer_restrictions` (0 rows), `buyer_privacy_requests` (0 rows) | **Safe to rotate** — but see the two-Worker hazard below |
| `FIREBASE_WEB_API_KEY` | No | **Do not rotate reflexively.** A public client identifier, shipped inside the Android app. Its protection is Google Cloud API restrictions and Firebase App Check — review those instead |

Everything else the code can read — `DEEPSEEK_API_KEY`,
`PAYMENT_WEBHOOK_SECRET`, `FIREBASE_SERVICE_ACCOUNT_*`, `GOOGLE_PLAY_*` — is
**not set on Staging**, because the features behind them are off. Nothing to
rotate.

### `orderak-admin-worker-staging` — 9 secrets

| Secret | Depends on stored data? | Verdict |
| --- | --- | --- |
| `ADMIN_SESSION_PEPPER` | `admin_sessions` (0 rows) | **Safe.** Worst case is re-login, and there is nothing to invalidate |
| `ADMIN_EXPORT_SIGNING_KEY` | Outstanding 5-minute download links only | **Safe.** Not a bundle signature — it peppers a single-use download token |
| `ADMIN_JWT_SECRET` | Local test bearer only | **Safe** |
| `ADMIN_API_KEY` | Bootstrap/break-glass only | **Safe** — verify the bootstrap endpoint immediately after |
| `ADMIN_BREAK_GLASS_IP_ALLOWLIST` | — | Configuration, not a credential |
| `BUYER_PRIVACY_PEPPER` | Same tables as above | **Safe**, with the hazard below |
| `ADMIN_RECOVERY_PEPPER` | `admin_recovery_codes` (10 rows) | **Schedule it.** Rotating invalidates all ten codes; every admin must regenerate. Not dangerous, but not silent either |
| `ADMIN_TOTP_KEY_V1` | `admin_users.totp_secret_ciphertext` (1 enrolled, all on version 1) | **Rotate into V2** — see below |
| `ADMIN_AUDIT_SIGNING_KEY` | `admin_audit_exports` (5 rows, **no key-version column**) | **BLOCKED** — see below |

## Two hazards that are not obvious from the key names

### `BUYER_PRIVACY_PEPPER` is one value across two Workers

It is set on both `orderak-worker-staging` and `orderak-admin-worker-staging`,
and it must hold the **same value in both**. The public Worker hashes a buyer
phone with it when checking restrictions; the admin Worker hashes with it when
recording one. `shared.ts` states this directly: *"the same pepper the admin
surface uses to hash buyer phone numbers, so an identifier is peppered
consistently wherever it is derived."*

Rotating it on one Worker and not the other does not fail loudly. The public
Worker simply stops matching restrictions the admin Worker wrote, and a
blocked buyer is silently unblocked. **Rotate both, then verify a restriction
still matches, before considering it done.**

With both dependent tables empty on Staging this is currently harmless — which
is exactly why it is worth rotating now rather than after they fill.

### TOTP rotation is a config change, not just a secret

`keyForVersion` (`admin-auth.ts:145-149`) supports **only versions 1 and 2**.
Staging's single enrolled admin is on version 1, so version 2 is free and no
code change is needed. But the active version is chosen by
`ADMIN_TOTP_KEY_CURRENT`, which is a **var in `wrangler.admin.jsonc`**
(currently `"1"`), not a secret. So the rotation is:

1. `wrangler secret put ADMIN_TOTP_KEY_V2` — a fresh base64url 32-byte key.
2. Change `ADMIN_TOTP_KEY_CURRENT` to `"2"` in `wrangler.admin.jsonc` and
   deploy.
3. **Keep `ADMIN_TOTP_KEY_V1` set.** Existing ciphertext still records
   `totp_key_version = 1` and is decrypted with it. Removing V1 locks that
   admin out.
4. V1 becomes removable only once no row references version 1 — which, with
   one enrolled admin, means after they re-enroll.

If both slots were ever in use at once there would be no free version, and
adding V3 is a code change. That is not the case today.

## The one that is blocked

`ADMIN_AUDIT_SIGNING_KEY` HMAC-signs each hash-chained audit archive.
`admin_audit_exports` has 5 rows, and its schema is:

```text
id, first_audit_id, last_audit_id, event_count, object_key,
content_hash, signature, previous_hash, status, created_at, verified_at
```

**There is no key-version column.** Rotating the key makes those five
signatures unverifiable with no way to know which key signed which — the
archive stops being evidence, quietly, and only when someone tries to verify
it.

Making this rotatable is a code and schema change, not an operational step:

- a migration adding a key-version column, and the same version in the R2
  object metadata;
- a verification path that accepts the current and the previous key, selected
  by that version;
- a test that verifies a **pre-rotation** archive after rotating.

Until that ships, `ADMIN_AUDIT_SIGNING_KEY` is not rotatable without
destroying existing audit evidence. Recorded rather than worked around.

## Order of work

Rotate related values together, because each `wrangler secret put` deploys a
new version:

1. **Both Workers, one window:** `BUYER_PRIVACY_PEPPER` on
   `orderak-worker-staging` and `orderak-admin-worker-staging`. Verify a
   restriction round-trip afterwards.
2. **Admin Worker:** `ADMIN_SESSION_PEPPER`, `ADMIN_EXPORT_SIGNING_KEY`,
   `ADMIN_JWT_SECRET`, `ADMIN_API_KEY` together. Then sign in, and call the
   bootstrap endpoint with the new `ADMIN_API_KEY`.
3. **TOTP:** the four steps above, then have the enrolled admin complete a
   TOTP challenge.
4. **Scheduled separately:** `ADMIN_RECOVERY_PEPPER`, once admins are told to
   regenerate their codes.
5. **Blocked:** `ADMIN_AUDIT_SIGNING_KEY`.

Generate only locally-random secrets with `openssl rand -base64 32`. It does
**not** apply to provider credentials, service-account JSON, or version
numbers.

Record the date and owner of each rotation in `docs/governance/`. Never record
a value.

## After rotating

- Admin sign-in, a TOTP challenge, and a recovery-code use.
- An audit export, and **verification of an archive written before the
  rotation** — the check that would have caught the missing key-version
  column.
- A buyer-restriction match, proving both Workers still share one pepper.
- `wrangler secret list` on both Workers, confirming nothing was dropped.

## Declaring required secrets

Wrangler supports a `secrets.required` list that fails `wrangler deploy` when
a named secret is not configured, instead of failing at the first request that
needs it. It is **not configured here yet**, and adding it needs care: naming
a secret that is not actually set breaks the next deploy. The lists above are
the verified starting point — every entry is confirmed present on its Worker.

Note the known first-deploy problem
([workers-sdk#14258](https://github.com/cloudflare/workers-sdk/issues/14258)):
on a Worker that does not exist yet, `secret put` cannot run, and only
`wrangler deploy --secrets-file` works. That does not affect these Workers,
which already exist.
