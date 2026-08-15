---
status: current
generated: false
owner: security
last_verified: 2026-08-15
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
| `ADMIN_AUDIT_SIGNING_KEY` | `admin_audit_exports` (5 rows, each recording its key version since migration 043) | **Rotate into V2**, keeping V1 set — see below |

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

## The audit signing key, and why it needed code before it could rotate

`ADMIN_AUDIT_SIGNING_KEY` HMAC-signs each hash-chained audit archive.
`admin_audit_exports` recorded the signature and nothing about which key
produced it, so rotating the key made every existing archive unverifiable
with no way to know which key to try — 5 archives in Staging, 21 in
Production. The archive stopped being evidence quietly, and only at the
moment someone tried to rely on it.

Worse, and not visible from the schema: **there was no verification path at
all.** The `verified_at` column was never written by any code, and the
`signature` was never checked. The chain was being produced and never used,
which is indistinguishable from not having one until it matters.

Both are now fixed (migration `043_audit_signing_key_version`):

- `signing_key_version` on `admin_audit_exports`, defaulting to `1`, and the
  same version in the R2 object's `customMetadata`. Either store alone can
  reconstruct how to check an archive.
- `verifyAuditArchives()` reads each object back, recomputes the content hash
  and the HMAC **with the key version recorded against that archive**, and
  stamps `verified_at`.
- Version 1 resolves to the existing `ADMIN_AUDIT_SIGNING_KEY`, so the 26
  existing archives verify unchanged. Nothing is re-signed.

### Rotating it

1. `wrangler secret put ADMIN_AUDIT_KEY_V2`.
2. Set `ADMIN_AUDIT_KEY_CURRENT` to `"2"` in `wrangler.admin.jsonc`, deploy.
3. **Keep `ADMIN_AUDIT_SIGNING_KEY` set.** It is version 1, and every archive
   written before the rotation still needs it. Removing it too early makes
   verification report `key_unavailable` — deliberately a distinct outcome
   from `signature_mismatch`, so a configuration gap is not mistaken for
   tampering.
4. Version 1 becomes removable only once no archive under it is still within
   its retention window.

`test/admin-audit-key-rotation.spec.ts` holds the property this exists for:
an archive written under version 1 still verifies after the Worker has moved
to version 2. It also covers tampering, signature swaps, the
missing-key case, and refusing to archive at all when the current version has
no key configured.

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
5. `ADMIN_AUDIT_SIGNING_KEY` into V2, keeping V1 set.

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

## Production (Phase 7c)

Read-only evidence gathered 2026-08-12. **Nothing below has been rotated** —
production rotation happens inside the cutover window and is followed by its
own soak.

### Why it waits for the cutover window

A soak validates one specific combination of code, configuration and secrets.
Rotating a secret after a soak invalidates the soak — the thing that was
proven healthy is no longer the thing that is running. So production rotation
goes **inside** the window, and the production soak runs **after** it, never
before.

### Migration 043 is a hard prerequisite, and it is not applied

Measured 2026-08-15:

```text
d1_migrations ledger    production 44    staging 45
admin_audit_exports.signing_key_version    absent on production
```

Rotating `ADMIN_AUDIT_SIGNING_KEY` on production before 043 lands would leave
its **21 existing archives** carrying no key version, and therefore
unverifiable — precisely the failure the migration was written to prevent.

The migration file exists **only in `Orderak.APP`**, which does not deploy
production. Two routes were considered:

| | Route | Verdict |
| --- | --- | --- |
| a | Port 043 into the old repository so its next production deploy applies it | **Rejected** |
| b | Apply it from `Orderak.APP` inside the cutover window, as the first step of 7c | **Chosen 2026-08-15** |

Route (a) was rejected because it makes a production schema change happen as a
side effect of copying a file: the migration would run on whichever production
deploy came next, for whatever unrelated reason that deploy was triggered.
Nobody would have decided to change production's schema at that moment. Route
(b) keeps it a deliberate, scheduled step with the rest of the rotation, in a
window where someone is watching.

**7c therefore begins by applying 043 to production, before any secret is
touched.**

### Measured production state

| | Production | Staging |
| --- | --- | --- |
| `buyer_restrictions` / `buyer_privacy_requests` | 0 / 0 | 0 / 0 |
| `admin_users` with TOTP enrolled | 1, all on key version 1 | 1, version 1 |
| `admin_audit_exports` | **21** | 5 |
| `admin_sessions` | 0 | 0 |
| `admin_recovery_codes` | 10 | 10 |
| `play_purchases` | 0 | 0 |
| `sellers` / `orders` | 1 / 0 | — |

Every verdict in the Staging table above holds for Production, with one
difference in degree: `ADMIN_AUDIT_SIGNING_KEY` covers **21** archives
rather than 5. Migration 043 must be applied to Production before rotating it —
until then those rows carry no version and the rotation would leave them
unverifiable, which is the failure the migration exists to prevent.

### Secrets set on Production but not Staging

Production's public Worker carries five secrets Staging's does not:
`ADMIN_API_KEY`, `ADMIN_JWT_SECRET`, `DEEPSEEK_API_KEY`, `FORWARD_TO`,
`PAYMENT_WEBHOOK_SECRET`.

`DEEPSEEK_API_KEY` and `PAYMENT_WEBHOOK_SECRET` are real provider credentials
and are genuine rotation targets — `PAYMENT_WEBHOOK_SECRET` must change at the
provider and on the Worker in the same window, or webhook signature
verification fails in between.

**`ADMIN_API_KEY` and `ADMIN_JWT_SECRET` on the public Worker appear to be
vestigial.** Every admin route is defined in `entrypoints/admin-worker.ts`;
the public Worker mounts none of them, and the only code reading these values
is `domains/admin/admin-auth.ts`, which the public Worker does not reach.
Staging's public Worker does not have them, which is consistent with them
being left over from when the admin panel was served by the main Worker.

`ADMIN_API_KEY` is the bootstrap/break-glass credential for creating the first
admin owner. Nothing on that Worker uses it, so it is not exploitable through
the application — but it is a high-value credential sitting on the
internet-facing Worker for no reason, and anyone able to read that Worker's
secrets gets it.

**Proposed, not done:** delete both from the production public Worker with
`wrangler secret delete`, after confirming against production traffic that no
request path reaches admin-auth there. That is a production change and needs
its own go-ahead; it is recorded here rather than performed.

### Production rotation order

Same grouping as Staging, plus the provider credentials.

**Step 0, before any secret is touched: apply migration 043 to production and
confirm `admin_audit_exports.signing_key_version` exists.** The audit key
cannot be rotated until it does, and it is absent today. Re-verify the ledger
reads 45, not 44.

1. `BUYER_PRIVACY_PEPPER` on **both** Workers in one window — the same
   two-Worker hazard applies, and production's dependent tables are also
   empty today. **Re-measure those tables in the window rather than trusting
   this line** — it was true on 2026-08-12, and the whole reason direct
   rotation is safe is that they are empty.
2. Admin Worker: `ADMIN_SESSION_PEPPER`, `ADMIN_EXPORT_SIGNING_KEY`,
   `ADMIN_API_KEY` together.
3. `DEEPSEEK_API_KEY` — revoke the old key in the DeepSeek dashboard after
   the new one is live, not before.
4. `PAYMENT_WEBHOOK_SECRET` — provider and Worker in the same window; test
   with a sandbox event before considering it done.
5. TOTP into V2, keeping V1 set, then `ADMIN_TOTP_KEY_CURRENT` to `"2"`.
6. `ADMIN_RECOVERY_PEPPER` once admins are scheduled to regenerate.
7. `ADMIN_AUDIT_SIGNING_KEY` — now rotatable, using the four steps above.

Then the production soak, on the rotated configuration.

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

## `secrets.required` — configured 2026-08-13

Both wrangler configs now declare `secrets.required`, per environment. A deploy
fails naming the missing secret, instead of the first request that needs it
failing at runtime.

The lists are **measured, not aspirational** — every name was confirmed present
with `wrangler secret list` on the Worker it applies to, on 2026-08-13.
Declaring a secret that is not set breaks the next deploy, so an aspirational
list is worse than none.

| Config | Production | Staging |
| --- | --- | --- |
| `wrangler.jsonc` | 5 | 2 |
| `wrangler.admin.jsonc` | 7 | 9 |

Staging's admin list carries `ADMIN_AUDIT_KEY_V2` and `ADMIN_TOTP_KEY_V2`,
which Production does not have. Both are the **current** version on Staging, so
a deploy without them would leave `currentTotpKey()` and
`currentAuditKeyVersion()` resolving to unset keys — TOTP and audit archiving
would fail closed at first use.

Staging's public list omits Production's `DEEPSEEK_API_KEY`, `FORWARD_TO` and
`PAYMENT_WEBHOOK_SECRET`: staging runs with billing, AI and email forwarding
off and does not call those services.

### Deliberately not required

- **`ADMIN_JWT_SECRET`** — read only when `LOCAL_ADMIN_ENABLED` is `"true"`
  (`admin-auth.ts:180`). That variable is set in no environment, so the path is
  closed and the value is inert. It is absent from the Production admin Worker
  entirely; requiring it would fail a Production deploy over a value nothing
  reads.
- **`ADMIN_API_KEY` and `ADMIN_JWT_SECRET` on the public Worker** — recorded
  above as vestigial and candidates for deletion. Requiring them would make
  their removal a deploy failure, cementing a credential that should go.
- **`ADMIN_BREAK_GLASS_IP_ALLOWLIST`** — absent on Production, optional in code.

### The guard was observed failing

A gate never seen failing is not a gate. Negative-tested by adding
`DEFINITELY_NOT_SET_ANYWHERE` to Staging's admin list:

```text
X [ERROR] The following required secrets have not been set: DEFINITELY_NOT_SET_ANYWHERE
```

**`wrangler deploy --dry-run` does not perform this check** — it bundles
locally and never contacts the API, so it exits cleanly with a missing required
secret. The validation runs on `wrangler deploy` and `wrangler versions upload`.
Do not treat a clean dry-run as evidence that secrets are configured.

### It changes type generation

Defining `secrets` at any config level makes `wrangler types` stop inferring
secret names from `.dev.vars` / `--env-file` and generate them from
`secrets.required` instead, as **non-optional** strings. `wrangler-types.env`
therefore no longer feeds type generation.

`src/env.d.ts` deliberately keeps secrets optional, by `Omit`-ing the secret
names from the generated bindings and taking them from `OrderakSecrets`:

```ts
type AdminWorkerEnv = Omit<AdminWorkerBindings, keyof OrderakSecrets> & OrderakSecrets;
```

`secrets.required` is a deploy-time guarantee; it says nothing about a Worker
already running, and it does not cover secrets present in only one environment.
The runtime guards that depend on a key possibly being absent — the
`key_unavailable` branch of archive verification is the clearest — must stay
type-checked. Typing secrets as always present would make those branches look
dead and invite their removal.
