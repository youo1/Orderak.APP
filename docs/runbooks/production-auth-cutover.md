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
...
-    "FIREBASE_PROJECT_ID": ""
+    "FIREBASE_PROJECT_ID": "<the production Firebase project id>"
```

**All three ship together, in one deployment.** This is the whole reason the
runbook exists. Each pairing of two-without-the-third produces a system that
looks like it works and cannot (BR-113):

| Shipped | Result |
|---|---|
| Flags true, project id empty | The routes open and every sign-in fails token verification. A seller sees a generic error on a screen that invites them to sign up. |
| Project id set, flags false | Nothing changes. The project is configured, unreachable, and looks configured — which is worse than absent, because the next person assumes it was tried. |
| Flags true, project id set, no Digital Asset Links | Phone sign-in works and passkeys silently do not resolve. The app offers a passkey, the ceremony starts, nothing completes. |

Today production accepts **no** sign-in at all. The app's only auth path is
`POST /api/v1/auth/phone/complete`, gated on `ONBOARDING_ENABLED`; the only
alternative is passkey, gated on `PASSKEY_ENABLED`; and `FIREBASE_PROJECT_ID`
is the empty string. Staging has all three set correctly, which is why the flow
is testable there and nowhere else.

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
