---
status: current
generated: false
owner: security
last_verified: 2026-09-06
applies_to: [production]
---
# Opening production sign-in

Item 02 of the implementation programme, and the last one. Three variables in
one deployment. Everything difficult about it is what has to be true first.

## What the change is

In `services/backend/wrangler.jsonc`, the production `vars` block:

```diff
-    "ONBOARDING_ENABLED": "false",
-    "PASSKEY_ENABLED": "false",
+    "ONBOARDING_ENABLED": "true",
+    "PASSKEY_ENABLED": "true",
```

**That is the whole change to open sign-in.** Two flags.

### What `FIREBASE_PROJECT_ID` does and does not gate

Production has `FIREBASE_PROJECT_ID: ""`, and it is easy to read that as "no
Firebase". It is not, and getting this wrong in either direction wastes time.

Token verification is `verifyFirebasePhone()` in
`services/backend/src/domains/stores/api-store.ts`. It has two paths:

- **Local JWKS** — taken only when `LOCAL_JWT_VERIFICATION="true"` **and**
  `FIREBASE_PROJECT_ID` is set. Production has the first as `"false"`, so this
  path is off by configuration, not by accident.
- **Remote** — `identitytoolkit.googleapis.com/v1/accounts:lookup`, keyed on
  `FIREBASE_WEB_API_KEY`. It does not read `FIREBASE_PROJECT_ID` at all.

`FIREBASE_WEB_API_KEY` is in production's `secrets.required`, so a production
deploy has one. **Phone sign-in in production therefore verifies against
whatever project that key belongs to, with `FIREBASE_PROJECT_ID` empty.** The
empty value costs a network round-trip per verification and nothing else.

Where the empty value *does* bite is account deletion. `firebaseAdminToken()`
in `domains/identity/deletion.ts` requires `FIREBASE_PROJECT_ID` plus the
service-account pair, and throws `firebase_admin_credentials_missing` before any
D1 cleanup — deliberately fail-closed, so a deletion request removes nothing
rather than removing local data and orphaning a live Firebase identity. With the
value empty, **account deletion cannot complete**, which is a PDPL obligation.

So set it, and set the service-account pair with it — but set it because
deletion needs it, not because sign-in is blocked on it. Sign-in is blocked on
the two flags above.

| Shipped | Result |
|---|---|
| Both flags true | Sign-in opens and verifies remotely against the `FIREBASE_WEB_API_KEY` project |
| Flags true, no Digital Asset Links | Phone sign-in works and passkeys silently do not resolve. The app offers a passkey, the ceremony starts, nothing completes |
| Flags true, `FIREBASE_PROJECT_ID` still empty | Sign-in works; **account deletion fails closed** and stays failed |

Today production accepts **no** sign-in: `POST /api/v1/auth/phone/complete` is
gated on `ONBOARDING_ENABLED`, and the only alternative is passkey, gated on
`PASSKEY_ENABLED`. Both are `"false"`. Staging has both true, which is why the
flow is testable there and nowhere else.

### The Android side is separate, and is a real gate

`apps/seller-android/app/google-services.json` is the CI placeholder
(its `project_id` is the CI placeholder); `app/src/staging/` holds the real
staging Firebase project's config; there is **no**
`app/src/production/google-services.json`. Both real
files are gitignored, so nothing in the repository shows this.

`assembleProductionRelease` fails by design until a production config is
downloaded. That is the gate the release build hits — not the Worker var.

## What must be true first

### External, and none of it is in this repository

1. **A production Firebase project** with Phone Auth enabled and an explicit SMS
   region policy. Not the staging project — see
   [production-auth-plan.md](../product/production-auth-plan.md) §Environments
   for why the separation is load-bearing.
2. **Fingerprints registered** on that project's Android app: the release upload
   key's SHA-1 and SHA-256, **and** Google Play App Signing's SHA-1 and SHA-256.
   Both pairs. Play re-signs the bundle, so the certificate a device presents is
   Play's, not the upload key's — registering only the upload key produces sign-in
   that works on a sideloaded build and fails from the Play install.
3. **App Check** registered with Play Integrity, in monitor mode first.
4. **Digital Asset Links published** for `app.orderak.seller`, or passkeys will
   not resolve. This is the one that fails quietly.
5. **A signed production build** that has been installed from a Play track and
   used to sign in against staging first. See
   [android-release.md](../guides/android-release.md).

### The readiness gate

Every row of the production readiness gate must be **yes**, with named evidence.
The rows that are not code, and that no CI run can close:

- physical-device evidence for sign-up, sign-in by code, passkey registration,
  passkey sign-in, and refusal on a wrong code
- a restore drill against the production database
- rollback rehearsed for every irreversible step
- migrations verified applied on production **read-only** — see
  [d1-migration-drift.md](d1-migration-drift.md) §2, whose standard of evidence
  is worth keeping: a single telltale column is not sufficient evidence that an
  entire migration ran

And one that is a decision rather than a task: section 2.1 of
[incident-response.md](incident-response.md) accepts manual detection as a
residual risk only while a **named person** is answerable for checking the four
surfaces on a stated cadence. That name does not exist yet. Until it does,
detection is unowned, and launching means nobody is responsible for noticing.

## Deploying

Production deploys are frozen fail-closed. `PRODUCTION_DEPLOYS_ENABLED` must be
`"true"`; an absent variable blocks. The inline comment reads *"PRODUCTION
FREEZE, 2026-08-24 — the project is in testing and delivery is staging-only"*,
and lifting it is part of this decision rather than a preliminary to it.

Production also requires a typed `DEPLOY_PRODUCTION` plus a 40-character SHA,
the `production` GitHub environment, a deploy-owner and staging-provenance
check, and a verified backup under 24 hours old.

Migrations apply **before** the Workers deploy, so between those steps the
previous release serves live traffic against the new schema. Nothing in this
change touches schema, so that window is not a concern here — but do not bundle
a migration into this deployment to save a step.

## Verifying, on a physical device

A staging pass proves nothing about production: different Firebase project,
different fingerprints, different asset links. Every line below is done on a
real device running the build installed from Play.

| Check | Passes when |
|---|---|
| Sign-up | A new phone number receives a code and completes onboarding to a usable store |
| Sign-in by code | An existing seller signs in on a second device |
| Wrong code | Refused, with the stable error, and not counted as a success |
| Passkey registration | The system ceremony completes and the credential is listed |
| Passkey sign-in | A returning seller signs in without a code |
| Session | The seller is still signed in after force-stopping and reopening |

Record the results in `docs/governance/evidence/`. Physical-device evidence is
the only evidence that counts for this item, because the failure modes are all
in the parts CI cannot reach.

## Rollback

**Set both flags false and redeploy.** That closes new sign-in within one
deployment.

**It is not fully reversible.** Accounts created while sign-in was open continue
to exist, hold data, and must be supported — a seller who signed up in the open
window does not stop being a seller because the flag moved back. Closing the
door does not empty the room.

So the rollback question is not "can we undo this" but "can we support what was
created before we undo it". If the answer is no, do not open.

Leave `FIREBASE_PROJECT_ID` set on rollback. It grants nothing on its own —
both routes are shut — and clearing it would mean the next attempt starts from
an unconfigured project again, which is how a two-step change becomes a
three-step one.
